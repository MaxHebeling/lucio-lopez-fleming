/**
 * «Resumen de hoy» (flag `ai_daily_brief`): tarjeta al tope del Tablero, por rol y alcance, calculada desde datos reales.
 *
 * - Cada conteo aplica el MISMO alcance que la lista a la que enlaza (agente: lo suyo; quien ve todo: el equipo) y
 *   siempre la organización del usuario. Ítems en cero no se muestran.
 * - Cache por usuario y día de Salta (`ai_daily_briefs`): se reutiliza `ai.daily_brief.cache_minutes` salvo que algo lo
 *   haya invalidado (decisiones en Tareas sugeridas, reacciones de IA, anomalías nuevas) o la persona pida actualizar.
 * - Con clave: 2–3 líneas redactadas (hechos + interpretación) SOLO si cambiaron los conteos, con tope diario de
 *   intentos por usuario, guardas de cifras y registro en ai_interactions. Sin clave o ante cualquier falla, nada.
 */
import "server-only";
import type { Database, Executor } from "../../db";
import { sql } from "../../db";
import { can, requirePermission, requireStaff, type Actor, type StaffActor } from "../../auth/actor";
import { leadScope, tryScope } from "../../crm/access";
import { isEnabled } from "../../flags";
import { rateLimit } from "../../rate-limit";
import { AppError } from "../../errors";
import { untrustedData } from "../core/governance";
import { findViolations, emptyFacts, addGroundedText } from "../guards";
import { dailyBriefPrompt, type DailyBriefOutput } from "../prompts/management";
import { aiAvailable, runExtractTask, type TaskDeps } from "../run-task";
import { contactInScopeSql } from "../../sales/scope";
import { getManagementSettings, saltaDayStart, saltaToday } from "../management-settings";
import { suggestionVisibility } from "../task-center/service";
import { ANOMALY_TO_SUGGEST } from "../task-center/collectors";
import { buildBriefItems, factsHash, firstName, greeting, narrativeViolations, saltaHour, type BriefCount, type BriefFacts, type BriefItem } from "./rules";

export const DAILY_BRIEF_FLAG = "ai_daily_brief";

type Counter = Promise<BriefCount | null>;

async function visitsToday(db: Executor, a: StaffActor, day: string, visitsOn: boolean): Counter {
  const team = can(a, "visits.monitor") || can(a, "agenda.read_all");
  if (!team && !can(a, "agenda.manage") && !can(a, "visits.operate")) return null;
  const from = saltaDayStart(day);
  const to = new Date(from.getTime() + 86_400_000);
  const r = await sql<{ n: number }>`
    select count(*)::int as n from appointments ap join users u on u.id = ap.assigned_user_id
     where u.organization_id = ${a.organizationId} and ap.kind = 'visit' and ap.status <> 'cancelled'
       and ap.starts_at >= ${from} and ap.starts_at < ${to} ${team ? sql`` : sql`and ap.assigned_user_id = ${a.userId}`}`.execute(db);
  const href = team ? (visitsOn && can(a, "visits.monitor") ? "/crm/centro-operativo" : "/crm/agenda") : visitsOn && can(a, "visits.operate") ? "/crm/mis-visitas" : "/crm/agenda";
  return { key: "visits_today", count: r.rows[0]?.n ?? 0, href, scope: team ? "all" : "own" };
}

async function salesSuggestions(db: Executor, a: StaffActor, now: Date): Promise<BriefCount[]> {
  if (!(await isEnabled(db, "ai_task_center")) || !(await isEnabled(db, "ai_matching"))) return [];
  if (!can(a, "tasks.manage") && !can(a, "tasks.read_all")) return [];
  if (!can(a, "contacts.read") || !tryScope(leadScope, a)) return [];
  const team = can(a, "tasks.read_all") && can(a, "leads.read_all");
  const v = await suggestionVisibility(db, a, team);
  const r = await sql<{ high_intent: number; contacts: number }>`
    select count(*) filter (where r.rule_key = 'contact_today')::int as high_intent, count(distinct r.contact_id)::int as contacts
      from sales_recommendations r
     where ${v.predicate} and r.source = 'sales_nba' and (r.status = 'open' or (r.status = 'snoozed' and r.snoozed_until <= ${now}))`.execute(db);
  const suffix = v.team ? "&vista=equipo" : "";
  return [
    { key: "high_intent_leads", count: r.rows[0]?.high_intent ?? 0, href: `/crm/tareas-sugeridas?origen=ventas&regla=contact_today${suffix}`, scope: v.team ? "all" : "own" },
    { key: "clients_follow_up", count: r.rows[0]?.contacts ?? 0, href: `/crm/tareas-sugeridas?origen=ventas${suffix}`, scope: v.team ? "all" : "own" },
  ];
}

async function newMatches(db: Executor, a: StaffActor): Counter {
  if (!(await isEnabled(db, "ai_matching")) || !can(a, "properties.read") || !can(a, "contacts.read")) return null;
  const scope = tryScope(leadScope, a);
  if (!scope) return null;
  const r = await sql<{ n: number }>`
    select count(distinct p.id)::int as n from properties p
     where p.organization_id = ${a.organizationId} and p.is_published and not p.is_demo and p.deleted_at is null
       and p.published_at >= now() - interval '7 days'
       and exists (select 1 from property_matches m join contacts c on c.id = m.contact_id
                    where m.property_id = p.id and m.status = 'candidate' and c.organization_id = p.organization_id and c.deleted_at is null
                      and ${contactInScopeSql(scope, "c")})`.execute(db);
  return { key: "new_matches", count: r.rows[0]?.n ?? 0, href: "/crm/propiedades?compatibles=recientes", scope: scope.all ? "all" : "own" };
}

async function overdueFollowUps(db: Executor, a: StaffActor): Counter {
  if (!can(a, "tasks.manage") && !can(a, "tasks.read_all")) return null;
  const team = can(a, "tasks.read_all");
  const r = await sql<{ n: number }>`
    select count(*)::int as n from tasks t left join users u on u.id = t.assigned_user_id left join users cu on cu.id = t.created_by
     where t.status = 'open' and t.kind = 'follow_up' and t.due_at < now()
       and coalesce(u.organization_id, cu.organization_id) = ${a.organizationId}
       ${team ? sql`` : sql`and t.assigned_user_id = ${a.userId}`}`.execute(db);
  return { key: "overdue_followups", count: r.rows[0]?.n ?? 0, href: `/crm/tareas?status=overdue&kind=follow_up${team ? "&view=team" : ""}`, scope: team ? "all" : "own" };
}

async function visitAlerts(db: Executor, a: StaffActor, visitsOn: boolean): Promise<BriefCount[]> {
  if (!visitsOn) return [];
  const monitor = can(a, "visits.monitor");
  if (!monitor && !can(a, "visits.operate")) return [];
  const r = await sql<{ unassigned: number; incidents: number }>`
    select count(*) filter (where al.kind = 'unassigned_upcoming')::int as unassigned,
           count(*) filter (where al.kind <> 'unassigned_upcoming' and al.severity in ('critical', 'warning'))::int as incidents
      from visit_alerts al join appointments ap on ap.id = al.appointment_id join users u on u.id = ap.assigned_user_id
     where al.resolved_at is null and u.organization_id = ${a.organizationId} ${monitor ? sql`` : sql`and ap.assigned_user_id = ${a.userId}`}`.execute(db);
  const out: BriefCount[] = [{ key: "open_incidents", count: r.rows[0]?.incidents ?? 0, href: monitor ? "/crm/centro-operativo" : "/crm/mis-visitas", scope: monitor ? "all" : "own" }];
  if (monitor) out.push({ key: "unassigned_visits", count: r.rows[0]?.unassigned ?? 0, href: "/crm/centro-operativo", scope: "all" });
  return out;
}

async function anomalies(db: Executor, a: StaffActor): Counter {
  if (!(await isEnabled(db, "ai_task_center"))) return null;
  const team = can(a, "ai.executive") || can(a, "tasks.read_all");
  const ops = can(a, "automations.read") || can(a, "ai.read_usage");
  const leads = can(a, "leads.read_all") || can(a, "leads.read_own");
  // Con Centro de comando se enlaza ahí (todas); si no, a Tareas sugeridas, que muestra las que no tienen otra sugerencia.
  const commandCenter = can(a, "ai.executive") && (await isEnabled(db, "ai_executive"));
  const r = await sql<{ n: number }>`
    select count(*)::int as n from ai_anomalies an
     where an.organization_id = ${a.organizationId} and an.resolved_at is null and an.severity in ('warning', 'critical')
       ${team ? sql`` : sql`and an.assigned_user_id = ${a.userId}`}
       ${ops ? sql`` : sql`and an.entity_type <> 'organization'`}
       ${leads ? sql`` : sql`and an.entity_type <> 'lead'`}
       ${commandCenter ? sql`` : sql`and an.kind = any(${ANOMALY_TO_SUGGEST})`}`.execute(db);
  const href = commandCenter ? "/crm/centro-de-comando#anomalias" : `/crm/tareas-sugeridas?origen=anomalias${team ? "&vista=equipo" : ""}`;
  return { key: "anomalies", count: r.rows[0]?.n ?? 0, href, scope: team ? "all" : "own" };
}

async function lowQuality(db: Executor, a: StaffActor, threshold: number): Counter {
  if (!can(a, "properties.read") || !(await isEnabled(db, "ai_property_quality"))) return null;
  const team = can(a, "properties.assign_agents");
  const r = await sql<{ n: number }>`
    select count(*)::int as n from properties p join property_quality_reports q on q.property_id = p.id
     where p.organization_id = ${a.organizationId} and p.is_published and not p.is_demo and p.deleted_at is null and q.score < ${threshold}
       ${team ? sql`` : sql`and exists (select 1 from property_agents pa where pa.property_id = p.id and pa.user_id = ${a.userId})`}`.execute(db);
  return { key: "low_quality", count: r.rows[0]?.n ?? 0, href: `/crm/propiedades?quality=low&published=yes${team ? "" : `&agentId=${a.userId}`}`, scope: team ? "all" : "own" };
}

/** Conteos del día con el alcance del actor (sin cache). */
export async function computeBriefFacts(db: Executor, actor: StaffActor, now = new Date()): Promise<BriefFacts> {
  const day = saltaToday(now);
  const s = await getManagementSettings(db);
  const visitsOn = await isEnabled(db, "visits_operations");
  const parts = await Promise.all([
    visitsToday(db, actor, day, visitsOn),
    salesSuggestions(db, actor, now),
    newMatches(db, actor),
    overdueFollowUps(db, actor),
    visitAlerts(db, actor, visitsOn),
    anomalies(db, actor),
    lowQuality(db, actor, s.lowQualityScore),
  ]);
  const counts = parts.flat().filter((c): c is BriefCount => Boolean(c));
  return { day, items: buildBriefItems(counts) };
}

export type DailyBriefView = {
  greeting: string;
  name: string;
  day: string;
  items: BriefItem[];
  narrative: DailyBriefOutput | null;
  computedAt: Date;
  aiConfigured: boolean;
};

type Row = { facts: unknown; facts_hash: string; narrative: unknown; narrative_hash: string | null; ai_attempts: number; computed_at: Date; stale: boolean };

async function loadRow(db: Executor, userId: string, day: string): Promise<Row | undefined> {
  return db
    .selectFrom("ai_daily_briefs")
    .select(["facts", "facts_hash", "narrative", "narrative_hash", "ai_attempts", "computed_at", "stale"])
    .where("user_id", "=", userId)
    .where("day", "=", day)
    .executeTakeFirst() as Promise<Row | undefined>;
}

export async function getDailyBrief(db: Database, rawActor: Actor, opts: { refresh?: boolean; now?: Date; deps?: TaskDeps } = {}): Promise<DailyBriefView | null> {
  requireStaff(rawActor);
  const actor = rawActor;
  requirePermission(actor, "dashboard.read");
  if (!(await isEnabled(db, DAILY_BRIEF_FLAG))) return null;
  const now = opts.now ?? new Date();
  const s = await getManagementSettings(db);
  const day = saltaToday(now);
  let row = await loadRow(db, actor.userId, day);
  const fresh = row && !row.stale && !opts.refresh && now.getTime() - new Date(row.computed_at).getTime() < s.briefCacheMinutes * 60_000;

  if (!fresh) {
    const facts = await computeBriefFacts(db, actor, now);
    const hash = factsHash(facts);
    await sql`
      insert into ai_daily_briefs(user_id, day, organization_id, facts, facts_hash, computed_at, stale)
      values (${actor.userId}, ${day}, ${actor.organizationId}, ${JSON.stringify(facts)}::jsonb, ${hash}, ${now}, false)
      on conflict (user_id, day) do update set facts = excluded.facts, facts_hash = excluded.facts_hash, computed_at = excluded.computed_at, stale = false,
        narrative = case when ai_daily_briefs.narrative_hash = excluded.facts_hash then ai_daily_briefs.narrative else null end,
        narrative_hash = case when ai_daily_briefs.narrative_hash = excluded.facts_hash then ai_daily_briefs.narrative_hash else null end`.execute(db);
    row = await loadRow(db, actor.userId, day);
  }
  const facts = row!.facts as BriefFacts;
  const items = Array.isArray(facts?.items) ? facts.items : [];
  const aiConfigured = await aiAvailable(db, opts.deps);
  let narrative = (row!.narrative as DailyBriefOutput | null) ?? null;

  // Redacción con IA: solo si hay algo que contar, cambió el resumen y queda cupo diario.
  if (aiConfigured && items.length && row!.narrative_hash !== row!.facts_hash && row!.ai_attempts < s.briefMaxAiPerDay) {
    await db.updateTable("ai_daily_briefs").set({ ai_attempts: row!.ai_attempts + 1 }).where("user_id", "=", actor.userId).where("day", "=", day).execute();
    const grounding = emptyFacts();
    const lines = items.map((i, n) => {
      addGroundedText(grounding, `${i.count} ${i.label}`);
      return `C${n + 1}. ${i.count} · ${i.label} — ${i.definition}`;
    });
    const res = await runExtractTask({
      db,
      who: { organizationId: actor.organizationId, userId: actor.userId, requestId: actor.requestId },
      purpose: "daily_brief",
      feature: "management.daily_brief",
      task: dailyBriefPrompt.task,
      prompt: dailyBriefPrompt,
      context: [untrustedData("conteos", lines.join("\n"), 3000)],
      messages: [{ role: "user", content: `Redactá el resumen de hoy para una persona con alcance ${items.every((i) => i.scope === "own") ? "propio (lo asignado a ella)" : "de equipo"}.` }],
      maxTokens: 400,
      timeoutMs: 15_000,
      deps: opts.deps,
      verify: (v) => {
        const texts = [v.hechos, ...v.interpretacion];
        return [...narrativeViolations(texts, items), ...texts.flatMap((t) => findViolations(t, grounding))];
      },
    });
    if (res.ok) {
      narrative = res.value;
      await db
        .updateTable("ai_daily_briefs")
        .set({ narrative: JSON.stringify(res.value), narrative_hash: row!.facts_hash, narrative_prompt: res.promptRef.slice(0, 80) })
        .where("user_id", "=", actor.userId)
        .where("day", "=", day)
        .execute();
    }
  }
  return { greeting: greeting(saltaHour(now)), name: firstName(actor.fullName), day, items, narrative, computedAt: new Date(row!.computed_at), aiConfigured };
}

/** «Actualizar» del tablero: recalcula ya (máximo una vez por minuto por usuario). */
export async function refreshDailyBrief(db: Database, actor: Actor): Promise<{ refreshed: true }> {
  requireStaff(actor);
  requirePermission(actor, "dashboard.read");
  const rl = await rateLimit(db, `ai:daily_brief:refresh:${actor.userId}`, 1, 60);
  if (!rl.allowed) throw new AppError("rate_limited", "El resumen se actualizó hace menos de un minuto.");
  await getDailyBrief(db, actor, { refresh: true });
  return { refreshed: true };
}
