/**
 * Sincronización propiedad ↔ portal.
 * - Acción `sync_publications` (property.updated/published/unpublished): encola `portals.sync` por propiedad+canal.
 * - Job `portals.sync`: reclama la fila con `sync_locked_until` (exclusión entre workers que markPublications no pisa),
 *   arma el payload, compara `last_payload_hash` (sin cambios → no reenvía), publica / actualiza / da de baja según
 *   `desired_state`, guarda `external_id`/`external_url`. Si hay external_id SIEMPRE actualiza (nunca crea un segundo aviso).
 * - Antes de escribir en el portal marca `remote_write_started_at`; solo un resultado definitivo la limpia. Si quedó
 *   marcada (corte, timeout, resultado incierto) `external_id null` NO prueba que no haya aviso: se busca por
 *   referencia propia antes de crear o de dar por despublicado.
 * - Al terminar relee `desired_state` en la misma sentencia: si cambió mientras hablaba con el portal (p. ej. se
 *   despublicó durante la creación) queda `pending` y encola la acción que corresponde (dar de baja lo recién creado).
 * - Fallas: transitorias → `retrying` con backoff de la cola; datos inválidos → `failed` (no se reintenta);
 *   resultado incierto → `failed` pidiendo verificar (sin reintento automático); sin credenciales → `awaiting_credentials`.
 *   El dato del CRM nunca se revierte ni se toca.
 * - Respeta el flag `portal_sync` y `publication_channels.is_enabled`.
 */
import { sql, type Database, type Executor } from "../../db";
import { registerAction } from "../../automation/actions";
import { isEnabled } from "../../flags";
import { log } from "../../log";
import { RetryableError } from "../../resilience";
import { enqueue } from "../../jobs/queue";
import { PermanentJobError, registerJobHandler } from "../../jobs/registry";
import { addScheduledTask } from "../../jobs/scheduled";
import { reflectIntegrationConfig } from "../status";
import { portalAdapter } from "./registry";
import { loadPortalProperty, payloadHash } from "./snapshot";
import type { PortalFailure } from "./types";

export const PORTAL_SYNC_MAX_ATTEMPTS = 6;
export const SYNC_LEASE_MINUTES = 15;

export async function enqueuePortalSync(db: Executor, propertyId: string, channelKey: string, reason: string): Promise<string | null> {
  return enqueue(db, {
    type: "portals.sync",
    payload: { propertyId, channelKey },
    dedupeKey: `portals.sync:${propertyId}:${channelKey}:${reason}`,
    maxAttempts: PORTAL_SYNC_MAX_ATTEMPTS,
    timeoutMs: 120_000,
  });
}

registerAction("sync_publications", async (_params, ctx) => {
  if (ctx.event.aggregateType !== "property") return { skipped: "el evento no es de una propiedad" };
  if (!(await isEnabled(ctx.db, "portal_sync"))) return { skipped: "feature flag portal_sync apagado" };
  const rows = await ctx.db
    .selectFrom("property_publications as pp")
    .innerJoin("publication_channels as c", "c.key", "pp.channel_key")
    .select(["pp.id", "pp.channel_key", "pp.sync_status", "c.is_enabled"])
    .where("pp.property_id", "=", ctx.event.aggregateId)
    .where("c.kind", "=", "portal")
    .execute();
  let queued = 0;
  for (const r of rows) {
    if (!r.is_enabled) {
      if (r.sync_status !== "disabled") await ctx.db.updateTable("property_publications").set({ sync_status: "disabled" }).where("id", "=", r.id).where("sync_status", "<>", "syncing").execute();
      continue;
    }
    if (await enqueuePortalSync(ctx.db, ctx.event.aggregateId, r.channel_key, `event:${ctx.event.id}`)) queued++;
  }
  return { queued };
});

export type SyncResult = { status: "skipped" | "unchanged" | "synced" | "awaiting_credentials" | "disabled"; detail?: string; externalId?: string | null };

async function finish(db: Database, id: string, values: Record<string, unknown>): Promise<void> {
  await db.updateTable("property_publications").set(values).where("id", "=", id).execute();
}

/** Cierre tras haber reclamado la fila: libera el lock. */
async function release(db: Database, id: string, values: Record<string, unknown>): Promise<void> {
  await finish(db, id, { ...values, sync_locked_until: null });
}

/**
 * Registra un resultado exitoso y relee en la misma sentencia si el estado deseado sigue siendo el que se aplicó.
 * Si cambió (o la propiedad dejó de estar publicada) queda `pending` y se encola la acción correcta.
 */
async function releaseSynced(
  db: Database,
  pub: { id: string },
  propertyId: string,
  channelKey: string,
  applied: "published" | "unpublished",
  values: { external_id?: string | null; external_url?: string | null; last_payload_hash: string },
): Promise<boolean> {
  const r = await sql<{ still: boolean }>`
    update property_publications pp set
      sync_status = case when (${applied} = 'published') = (pp.desired_state = 'published' and p.is_published and p.deleted_at is null)
        then 'synced' else 'pending' end,
      external_id = ${values.external_id === undefined ? sql`pp.external_id` : values.external_id},
      external_url = ${values.external_url === undefined ? sql`pp.external_url` : values.external_url},
      last_payload_hash = ${values.last_payload_hash}, last_synced_at = now(), last_error = null, attempts = 0,
      sync_locked_until = null, remote_write_started_at = null
    from properties p
    where pp.id = ${pub.id} and p.id = pp.property_id
    returning (pp.sync_status = 'synced') as still`.execute(db);
  const still = r.rows[0]?.still ?? true;
  if (!still) {
    log.info("portals.desired_state_changed_during_sync", { propertyId, channelKey, applied });
    await enqueuePortalSync(db, propertyId, channelKey, `desired_changed:${Date.now()}`);
  }
  return still;
}

export async function syncPublication(db: Database, propertyId: string, channelKey: string, attempt = 1, maxAttempts = PORTAL_SYNC_MAX_ATTEMPTS): Promise<SyncResult> {
  const pub = await db
    .selectFrom("property_publications as pp")
    .innerJoin("publication_channels as c", "c.key", "pp.channel_key")
    .select(["pp.id", "pp.sync_status", "pp.last_payload_hash", "pp.external_id", "pp.remote_write_started_at", "c.kind", "c.is_enabled", "c.integration_key"])
    .where("pp.property_id", "=", propertyId)
    .where("pp.channel_key", "=", channelKey)
    .executeTakeFirst();
  if (!pub) return { status: "skipped", detail: "la propiedad no tiene estado de publicación para este canal" };
  if (pub.kind !== "portal") return { status: "skipped", detail: "canal no es un portal" };
  if (!(await isEnabled(db, "portal_sync"))) return { status: "skipped", detail: "feature flag portal_sync apagado" };
  if (!pub.is_enabled) {
    await finish(db, pub.id, { sync_status: "disabled" });
    return { status: "disabled" };
  }
  if (pub.sync_status === "failed" && pub.remote_write_started_at) {
    // Resultado incierto pendiente de verificación: ninguna sincronización automática vuelve a escribir en el portal.
    // Lo destraba una persona (reintento manual, publicar/despublicar), y aun así se busca el aviso antes de crear.
    return { status: "skipped", detail: "resultado incierto: requiere verificación y reintento manual" };
  }
  const adapter = portalAdapter(channelKey);
  if (!adapter) {
    await finish(db, pub.id, { sync_status: "failed", last_error: `Sin adaptador para ${channelKey}` });
    throw new PermanentJobError(`Sin adaptador para ${channelKey}`);
  }
  const conf = await adapter.configuration(db);
  await reflectIntegrationConfig(db, adapter.integrationKey, conf.configured, conf.configured ? undefined : conf.reason);
  if (!conf.configured) {
    await finish(db, pub.id, { sync_status: "awaiting_credentials", last_error: conf.reason });
    return { status: "awaiting_credentials", detail: conf.reason };
  }

  // Reclamo exclusivo: otro worker con la misma fila en curso → se reintenta más tarde.
  const claimed = await sql<{ desired_state: string; external_id: string | null; last_payload_hash: string | null; remote_write_started_at: Date | null }>`
    update property_publications set sync_status = 'syncing', attempts = attempts + 1, last_attempt_at = now(),
           sync_locked_until = now() + make_interval(mins => ${SYNC_LEASE_MINUTES})
     where id = ${pub.id}
       and (sync_locked_until is null or sync_locked_until < now())
    returning desired_state, external_id, last_payload_hash, remote_write_started_at`.execute(db);
  const row = claimed.rows[0];
  if (!row) throw new RetryableError("La publicación se está sincronizando en otro proceso");
  const wasSynced = pub.sync_status === "synced";
  // Un intento anterior no terminó con un resultado definitivo: puede existir un aviso que no tenemos registrado.
  const previousUncertain = row.remote_write_started_at !== null;
  const markRemoteWrite = () => finish(db, pub.id, { remote_write_started_at: new Date() });

  const fail = async (f: PortalFailure): Promise<never | SyncResult> => {
    if (f.reason === "uncertain") {
      // Se conserva remote_write_started_at: el reintento (manual) buscará el aviso antes de crear otro.
      await release(db, pub.id, { sync_status: "failed", last_error: f.error });
      throw new PermanentJobError(f.error);
    }
    // El portal respondió que no aplicó la escritura: ya no hay nada incierto.
    const settled = { remote_write_started_at: null };
    if (f.reason === "awaiting_credentials") {
      await release(db, pub.id, { ...settled, sync_status: "awaiting_credentials", last_error: f.error });
      return { status: "awaiting_credentials", detail: f.error };
    }
    if (f.reason === "invalid_data") {
      await release(db, pub.id, { ...settled, sync_status: "failed", last_error: f.error });
      throw new PermanentJobError(f.error);
    }
    await release(db, pub.id, { ...settled, sync_status: attempt >= maxAttempts ? "failed" : "retrying", last_error: f.error });
    throw new RetryableError(f.error);
  };

  try {
    const property = await loadPortalProperty(db, propertyId);
    const desired = row.desired_state === "published" && property?.isPublished ? "published" : "unpublished";

    if (desired === "published" && property) {
      const prepared = adapter.prepare(property);
      if (!prepared.ok) return await fail({ ok: false, reason: "invalid_data", error: prepared.errors.join(" · ") });
      const hash = payloadHash(prepared.payload, "published");
      if (wasSynced && row.external_id && hash === row.last_payload_hash && !previousUncertain) {
        await release(db, pub.id, { sync_status: "synced", last_error: null });
        return { status: "unchanged", externalId: row.external_id };
      }
      await markRemoteWrite();
      const opts = { searchExisting: previousUncertain };
      const result = row.external_id ? await adapter.update(db, row.external_id, property, opts) : await adapter.publish(db, property, opts);
      if (!result.ok) return await fail(result);
      const still = await releaseSynced(db, pub, propertyId, channelKey, "published", { external_id: result.externalId, external_url: result.externalUrl, last_payload_hash: hash });
      return { status: "synced", externalId: result.externalId, detail: [result.adopted ? "aviso existente adoptado" : null, still ? null : "el estado deseado cambió: se encoló otra sincronización"].filter(Boolean).join(" · ") || undefined };
    }

    const hash = payloadHash(null, "unpublished");
    let externalId = row.external_id;
    if (!externalId && previousUncertain && adapter.findByReference) {
      // Una creación anterior pudo haber quedado hecha sin registrarse: si existe, se da de baja.
      const code = property?.code ?? (await db.selectFrom("properties").select("code").where("id", "=", propertyId).executeTakeFirst())?.code;
      if (code !== undefined) {
        const found = await adapter.findByReference(db, { id: propertyId, code });
        if (!found.ok) return await fail(found);
        externalId = found.item?.externalId ?? null;
        if (externalId) await finish(db, pub.id, { external_id: externalId, external_url: found.item?.externalUrl ?? null });
      }
    }
    if (!externalId || (wasSynced && hash === row.last_payload_hash && !previousUncertain)) {
      await releaseSynced(db, pub, propertyId, channelKey, "unpublished", { last_payload_hash: hash });
      return { status: externalId ? "unchanged" : "synced", detail: externalId ? undefined : "no había aviso que dar de baja", externalId };
    }
    await markRemoteWrite();
    const removed = await adapter.remove(db, externalId);
    if (!removed.ok) return await fail(removed);
    // Se conserva external_id: si se vuelve a publicar se reactiva el mismo aviso (no se crea otro).
    await releaseSynced(db, pub, propertyId, channelKey, "unpublished", { last_payload_hash: hash });
    return { status: "synced", externalId };
  } catch (e) {
    if (e instanceof PermanentJobError || e instanceof RetryableError) throw e;
    const message = ((e as Error).message ?? String(e)).slice(0, 1000);
    // Error inesperado (base, bug): se libera el lock; remote_write_started_at queda como estaba (si se marcó, incierto).
    await release(db, pub.id, { sync_status: attempt >= maxAttempts ? "failed" : "retrying", last_error: message });
    log.warn("portals.sync_unexpected", { propertyId, channelKey, error: message });
    throw e;
  }
}

registerJobHandler("portals.sync", async (payload, ctx) => {
  const propertyId = typeof payload.propertyId === "string" ? payload.propertyId : "";
  const channelKey = typeof payload.channelKey === "string" ? payload.channelKey : "";
  if (!/^[0-9a-f-]{36}$/i.test(propertyId) || !/^[a-z0-9_]{2,40}$/.test(channelKey)) throw new PermanentJobError("portals.sync: payload inválido");
  return syncPublication(ctx.db, propertyId, channelKey, ctx.attempt);
});

/**
 * Cada hora: publicaciones pendientes o esperando credenciales en canales habilitados se vuelven a encolar
 * (así, al cargar credenciales, se sincroniza sin intervención), y también las trabadas en `syncing` hace más de
 * SYNC_LEASE_MINUTES (el worker murió). Las `failed` requieren reintento manual.
 */
export async function resumePortalSync(db: Database, limit = 300): Promise<{ queued: number }> {
  if (!(await isEnabled(db, "portal_sync"))) return { queued: 0 };
  const channels = await db.selectFrom("publication_channels").select(["key"]).where("kind", "=", "portal").where("is_enabled", "=", true).execute();
  let queued = 0;
  for (const c of channels) {
    const adapter = portalAdapter(c.key);
    if (!adapter) continue;
    const conf = await adapter.configuration(db);
    await reflectIntegrationConfig(db, adapter.integrationKey, conf.configured, conf.configured ? undefined : conf.reason);
    if (!conf.configured) continue;
    const rows = await db
      .selectFrom("property_publications")
      .select(["property_id"])
      .where("channel_key", "=", c.key)
      .where((eb) =>
        eb.or([
          eb("sync_status", "in", ["pending", "awaiting_credentials", "disabled"]),
          eb.and([eb("sync_status", "=", "syncing"), eb("last_attempt_at", "<", sql<Date>`now() - make_interval(mins => ${SYNC_LEASE_MINUTES})`)]),
        ]),
      )
      .orderBy("updated_at")
      .limit(limit)
      .execute();
    for (const r of rows) if (await enqueuePortalSync(db, r.property_id, c.key, "resume")) queued++;
  }
  return { queued };
}

registerJobHandler("portals.resume", async (_p, ctx) => resumePortalSync(ctx.db));
addScheduledTask({ type: "portals.resume", every: "hourly" });
