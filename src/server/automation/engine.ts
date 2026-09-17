import { sql, type Database, type Executor } from "../db";
import { log } from "../log";
import { withEventCause } from "../events";
import { enqueue } from "../jobs/queue";
import { PermanentJobError, registerJobHandler } from "../jobs/registry";
import { evaluateConditions } from "./conditions";
import { getAction, type AutomationEvent } from "./actions";
import { dispatchAllowed, LOOP_GUARD_LABEL, loopGuard, normalizeMaxDepth } from "./loop-guard";

/** Profundidad máxima de una cadena de eventos derivados (`ai.events.max_depth`, 3 por defecto). */
export async function maxEventDepth(db: Executor): Promise<number> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", "ai.events.max_depth").executeTakeFirst();
  return normalizeMaxDepth(row?.value);
}

/** Automatizaciones que causaron el evento y sus ancestros (recorre causation_id, acotado). */
async function causalChain(db: Executor, eventId: string): Promise<Array<string | null>> {
  const r = await sql<{ caused_by_automation: string | null }>`
    with recursive chain(id, causation_id, caused_by_automation, n) as (
      select id, causation_id, caused_by_automation, 0 from domain_events where id = ${eventId}
      union all
      select e.id, e.causation_id, e.caused_by_automation, c.n + 1
        from domain_events e join chain c on e.id = c.causation_id
       where c.n < 50
    )
    select caused_by_automation from chain order by n`.execute(db);
  return r.rows.map((x) => x.caused_by_automation);
}

/**
 * Toma eventos pendientes del outbox y encola un job por cada automatización habilitada que escuche ese evento.
 * Todo en una transacción con SKIP LOCKED: dos despachadores concurrentes no procesan el mismo evento.
 */
export async function dispatchPendingEvents(db: Database, limit = 100): Promise<{ events: number; jobs: number }> {
  return db.transaction().execute(async (trx) => {
    const events = await sql<{ id: string; event_type: string; depth: number }>`
      select id, event_type, depth from domain_events where dispatched_at is null
       order by id limit ${limit} for update skip locked`.execute(trx);
    let jobs = 0;
    const maxDepth = events.rows.some((e) => e.depth > 0) ? await maxEventDepth(trx) : null;
    for (const ev of events.rows) {
      // Evento derivado demasiado profundo: queda registrado pero no dispara nada (protección contra loops).
      if (maxDepth !== null && !dispatchAllowed(ev.depth, maxDepth)) {
        log.warn("automation.loop_guard", { eventId: ev.id, type: ev.event_type, depth: ev.depth, reason: "max_depth" });
        await trx
          .updateTable("domain_events")
          .set({ dispatched_at: new Date(), dispatch_attempts: sql`dispatch_attempts + 1`, last_error: LOOP_GUARD_LABEL.max_depth })
          .where("id", "=", ev.id)
          .execute();
        continue;
      }
      const autos = await trx
        .selectFrom("automation_definitions")
        .select(["id", "key"])
        .where("trigger_event", "=", ev.event_type)
        .where("is_enabled", "=", true)
        .execute();
      for (const a of autos) {
        const id = await enqueue(trx, {
          type: "automation.run",
          payload: { automationId: a.id, eventId: ev.id },
          dedupeKey: `automation:${a.id}:${ev.id}`,
          maxAttempts: 5,
        });
        if (id) jobs++;
      }
      await trx
        .updateTable("domain_events")
        .set({ dispatched_at: new Date(), dispatch_attempts: sql`dispatch_attempts + 1` })
        .where("id", "=", ev.id)
        .execute();
    }
    return { events: events.rows.length, jobs };
  });
}

registerJobHandler("automation.run", async (payload, ctx) => {
  const automationId = String(payload.automationId);
  const eventId = String(payload.eventId);
  const auto = await ctx.db.selectFrom("automation_definitions").selectAll().where("id", "=", automationId).executeTakeFirst();
  if (!auto) throw new PermanentJobError(`Automatización ${automationId} inexistente`);
  const ev = await ctx.db.selectFrom("domain_events").selectAll().where("id", "=", eventId).executeTakeFirst();
  if (!ev) throw new PermanentJobError(`Evento ${eventId} inexistente`);

  // Registro de ejecución idempotente: una sola fila por (automatización, evento).
  const run = await sql<{ id: string; status: string; attempt: number }>`
    insert into automation_runs(automation_id, automation_version, trigger_event_id, input, status)
    values (${auto.id}, ${auto.version}, ${ev.id}, ${JSON.stringify({ payload: ev.payload })}::jsonb, 'running')
    on conflict (automation_id, trigger_event_id) do update
      set attempt = automation_runs.attempt + 1, status = 'running', error = null, started_at = now(), finished_at = null
      where automation_runs.status in ('failed', 'running')
    returning id, status, attempt`.execute(ctx.db);
  if (!run.rows[0]) return { skipped: "ya ejecutada" };
  const runId = run.rows[0].id;

  const event: AutomationEvent = {
    id: ev.id,
    type: ev.event_type,
    aggregateType: ev.aggregate_type,
    aggregateId: ev.aggregate_id,
    payload: (ev.payload ?? {}) as Record<string, unknown>,
    actorUserId: ev.actor_user_id,
  };

  try {
    if (!auto.is_enabled) {
      await finishRun(ctx.db, runId, "skipped", { reason: "automatización desactivada" });
      return { skipped: "desactivada" };
    }
    if (!evaluateConditions(auto.conditions, { event })) {
      await finishRun(ctx.db, runId, "skipped", { reason: "condiciones no cumplidas" });
      return { skipped: "condiciones" };
    }
    // Protección contra loops: profundidad máxima y misma automatización en la cadena causal.
    const verdict = loopGuard({ automationKey: auto.key, depth: ev.depth, maxDepth: await maxEventDepth(ctx.db), chainAutomations: ev.depth > 0 ? await causalChain(ctx.db, ev.id) : [] });
    if (!verdict.allowed) {
      log.warn("automation.loop_guard", { automation: auto.key, eventId: ev.id, depth: ev.depth, reason: verdict.reason });
      await finishRun(ctx.db, runId, "skipped", { reason: LOOP_GUARD_LABEL[verdict.reason], loopGuard: verdict.reason });
      return { skipped: "loop_guard", reason: verdict.reason };
    }
    // Acciones desconocidas (p. ej. una migración aplicada antes que el código que las registra, o un rollback del
    // código): la ejecución queda OMITIDA con el motivo, sin job muerto. Nada se ejecuta a medias.
    const actions = auto.actions as Array<Record<string, unknown>>;
    const unknown = actions.map((a) => String(a.type)).filter((t) => !getAction(t));
    if (unknown.length) {
      log.warn("automation.unknown_action", { automation: auto.key, eventId: ev.id, actions: unknown });
      await finishRun(ctx.db, runId, "skipped", { reason: `acción no disponible en esta versión: ${unknown.join(", ")}`, unknownActions: unknown });
      return { skipped: "unknown_action", actions: unknown };
    }
    const cause = { eventId: String(ev.id), correlationId: String(ev.correlation_id ?? ev.id), depth: ev.depth, automationKey: auto.key };
    const results: unknown[] = [];
    await withEventCause(cause, async () => {
      for (const [i, action] of actions.entries()) {
        const handler = getAction(String(action.type))!;
        results.push(await handler(action, { db: ctx.db, actor: ctx.actor, event, automationKey: auto.key, dedupeBase: `auto:${auto.key}:${ev.id}:${i}` }));
      }
    });
    await finishRun(ctx.db, runId, "succeeded", { actions: results });
    return { runId, actions: results.length };
  } catch (e) {
    await ctx.db
      .updateTable("automation_runs")
      .set({ status: "failed", error: ((e as Error).message ?? String(e)).slice(0, 2000), finished_at: new Date() })
      .where("id", "=", runId)
      .execute();
    log.warn("automation.run_failed", { automation: auto.key, eventId: ev.id, error: (e as Error).message });
    throw e;
  }
});

async function finishRun(db: Database, runId: string, status: "succeeded" | "skipped", result: unknown) {
  await db
    .updateTable("automation_runs")
    .set({ status, result: JSON.stringify(result), finished_at: new Date() })
    .where("id", "=", runId)
    .execute();
}
