/**
 * Analítica first-party mínima del sitio (hoy: tours virtuales). Principios:
 * - Sin IP, sin user agent, sin cookies ni datos personales en `site_events`. `session_key` es aleatoria por pestaña.
 * - Lista cerrada de eventos y de propiedades por evento (lo desconocido se descarta), tamaño acotado.
 * - Solo eventos de tours publicados que el sitio realmente muestra (propiedad publicada o demo): no se puede escribir
 *   basura apuntando a ids inventados.
 * - Rate limit por IP (clave con hash, vive 1 día en rate_limit_buckets) y por sesión.
 * - Respeta Do Not Track / Global Privacy Control también en el servidor.
 * - Retención: 13 meses (tarea diaria site.events_purge).
 */
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, type Database } from "../db";
import { isEnabled } from "../flags";
import { rateLimit } from "../rate-limit";
import { registerJobHandler } from "../jobs/registry";
import { addScheduledTask } from "../jobs/scheduled";

export const SITE_EVENT_NAMES = [
  "virtual_tour_opened",
  "virtual_tour_scene_viewed",
  "virtual_tour_hotspot_clicked",
  "virtual_tour_floorplan_opened",
  "virtual_tour_guided_started",
  "virtual_tour_cta_clicked",
  "virtual_tour_closed",
] as const;
export type SiteEventName = (typeof SITE_EVENT_NAMES)[number];

export const SITE_EVENTS_MAX_BYTES = 2048;
export const SITE_EVENTS_RETENTION_MONTHS = 13;
export const SITE_EVENTS_RATE = { perIp: 240, perSession: 400, windowSeconds: 600 } as const;

const source = z.enum(["start", "hotspot", "bar", "list", "plan", "guided", "history"]);
/** Propiedades admitidas por evento. Todo lo demás se descarta. */
const PROPS: Record<SiteEventName, z.ZodType> = {
  virtual_tour_opened: z.object({ entry: z.enum(["cover", "tab", "direct"]).optional() }),
  virtual_tour_scene_viewed: z.object({ source: source.optional() }),
  virtual_tour_hotspot_clicked: z.object({ kind: z.enum(["scene", "info", "cta"]).optional() }),
  virtual_tour_floorplan_opened: z.object({}),
  virtual_tour_guided_started: z.object({}),
  virtual_tour_cta_clicked: z.object({ cta: z.enum(["visit", "whatsapp", "share", "properties", "contact"]).optional() }),
  virtual_tour_closed: z.object({ durationMs: z.number().int().min(0).max(24 * 3600 * 1000).optional(), scenesViewed: z.number().int().min(0).max(500).optional() }),
};

export const siteEventSchema = z
  .object({
    name: z.enum(SITE_EVENT_NAMES),
    sessionKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
    tourId: z.uuid(),
    sceneSlug: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
    hotspotId: z.uuid().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

export type SiteEventInput = z.input<typeof siteEventSchema>;
export type RecordResult = { status: "stored" } | { status: "ignored"; reason: "invalid" | "unknown_tour" | "disabled" | "dnt" } | { status: "rate_limited" };

function cleanProps(name: SiteEventName, raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const keys = Object.keys((PROPS[name] as z.ZodObject<z.ZodRawShape>).shape ?? {});
  const picked = Object.fromEntries(Object.entries(raw).filter(([k]) => keys.includes(k)));
  const r = PROPS[name].safeParse(picked);
  return r.success ? (r.data as Record<string, unknown>) : {};
}

const ipKey = (ip: string) => createHash("sha256").update(`site-events:${ip}`).digest("hex").slice(0, 32);

/**
 * Registra un evento. Nunca lanza por datos del cliente (responde "ignored"); lanza solo si falla la base.
 * `privacySignal`: DNT: 1 o Sec-GPC: 1 → no se guarda nada.
 */
export async function recordSiteEvent(db: Database, raw: unknown, ctx: { ip: string | null; privacySignal: boolean }): Promise<RecordResult> {
  if (ctx.privacySignal) return { status: "ignored", reason: "dnt" };
  const parsed = siteEventSchema.safeParse(raw);
  if (!parsed.success) return { status: "ignored", reason: "invalid" };
  const e = parsed.data;
  if (!(await isEnabled(db, "virtual_tours"))) return { status: "ignored", reason: "disabled" };

  const byIp = await rateLimit(db, `site-events:ip:${ctx.ip ? ipKey(ctx.ip) : "unknown"}`, ctx.ip ? SITE_EVENTS_RATE.perIp : SITE_EVENTS_RATE.perIp * 10, SITE_EVENTS_RATE.windowSeconds);
  if (!byIp.allowed) return { status: "rate_limited" };
  const bySession = await rateLimit(db, `site-events:session:${e.sessionKey}`, SITE_EVENTS_RATE.perSession, SITE_EVENTS_RATE.windowSeconds);
  if (!bySession.allowed) return { status: "rate_limited" };

  // Solo tours que el sitio muestra; la escena y el punto se resuelven dentro del mismo tour (si no, se descartan).
  const tour = await sql<{ property_id: string; scene_id: string | null; hotspot_id: string | null }>`
    select t.property_id,
      (select s.id from virtual_tour_scenes s where s.tour_id = t.id and s.slug = ${e.sceneSlug ?? null} and s.is_published) as scene_id,
      (select h.id from virtual_tour_hotspots h join virtual_tour_scenes s on s.id = h.scene_id where s.tour_id = t.id and h.id = ${e.hotspotId ?? null}) as hotspot_id
    from virtual_tours t join properties p on p.id = t.property_id
    where t.id = ${e.tourId} and t.status = 'published' and p.deleted_at is null and (p.is_published or p.is_demo)`.execute(db);
  const row = tour.rows[0];
  if (!row) return { status: "ignored", reason: "unknown_tour" };

  await db
    .insertInto("site_events")
    .values({
      name: e.name,
      session_key: e.sessionKey,
      property_id: row.property_id,
      tour_id: e.tourId,
      scene_id: row.scene_id,
      scene_slug: row.scene_id ? (e.sceneSlug ?? null) : null,
      hotspot_id: row.hotspot_id,
      props: JSON.stringify(cleanProps(e.name, e.props)),
    })
    .execute();
  return { status: "stored" };
}

const PURGE_BATCH = 5_000;

export async function purgeSiteEvents(db: Database, months = SITE_EVENTS_RETENTION_MONTHS): Promise<{ deleted: number }> {
  let deleted = 0;
  for (let i = 0; i < 40; i++) {
    const r = await sql`delete from site_events where id in (
      select id from site_events where occurred_at < now() - make_interval(months => ${months}) limit ${PURGE_BATCH})`.execute(db);
    const n = Number(r.numAffectedRows ?? 0);
    deleted += n;
    if (n < PURGE_BATCH) break;
  }
  return { deleted };
}

registerJobHandler("site.events_purge", async (_p, { db }) => purgeSiteEvents(db));
addScheduledTask({ type: "site.events_purge", every: "daily", timeoutMs: 120_000 });
