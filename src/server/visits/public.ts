/**
 * Link temporal del cliente (`/visita/[token]`). Reglas (docs/operations/VISITS.md §Link del cliente):
 * - En la base solo el hash SHA-256 del token. Formato inválido, inexistente, revocado, rotado o vencido → la MISMA
 *   respuesta genérica (null), con el mismo trabajo (siempre una búsqueda por hash).
 * - Rate limit por IP (clave con hash): general y de fallos. Superado el de fallos, ni un token válido responde.
 * - Datos mínimos: nombre de pila, propiedad (sin dirección exacta si está oculta), asesor, contacto AUTORIZADO y estado.
 *   Nunca ubicación del agente, teléfonos privados, notas ni ids internos.
 * - Visita finalizada/cancelada/no se presentó: sin estado en vivo, solo el cierre (y el agradecimiento si una persona
 *   lo preparó).
 */
import { createHash } from "node:crypto";
import { sql, type Database } from "../db";
import { hashToken } from "../auth/tokens";
import { isEnabled } from "../flags";
import { peekRateLimit, rateLimit } from "../rate-limit";
import { publicMediaUrl, publicZoneLabel } from "../properties/public";
import { publicStreet, telHref, tidyTitle, whatsappHref } from "../properties/public-helpers";
import { loadSiteInfo } from "../site/info";
import { clientPhase, firstName, isClientLinkValid, type ClientPhase } from "./rules";
import { getVisitSettings } from "./settings";
import { recordVisitEvent } from "./timeline";

export const CLIENT_LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const CLIENT_LINK_RATE = { perIp: 120, windowSeconds: 600, failuresPerIp: 20, failureWindowSeconds: 3600 } as const;

export type AuthorizedContact = { whatsappUrl: string | null; phoneHref: string | null; phoneLabel: string | null; source: "agent" | "company" | null };

export type ClientVisitView =
  | {
      kind: "live";
      phase: Exclude<ClientPhase, "closed">;
      clientFirstName: string | null;
      startsAt: string;
      endsAt: string;
      checkedInAt: string | null;
      property: { code: number; title: string; zone: string | null; street: string | null; coverUrl: string | null };
      agent: { fullName: string };
      contact: AuthorizedContact;
    }
  | {
      kind: "closed";
      clientFirstName: string | null;
      propertyTitle: string;
      agent: { fullName: string };
      /** Agradecimiento preparado y guardado por una persona. Sin eso, solo el cierre genérico. */
      message: string | null;
      contact: AuthorizedContact;
    };

export type ClientVisitStatus = { phase: ClientPhase; checkedInAt: string | null };

type Ctx = { ip: string | null; userAgent?: string | null; now?: Date };

const ipKey = (ip: string | null) => (ip ? createHash("sha256").update(`visit-link:${ip}`).digest("hex").slice(0, 32) : "unknown");

/** Previsualizadores de enlaces (WhatsApp, redes, buscadores): no cuentan como apertura del cliente. */
export function isLinkPreviewBot(ua: string | null | undefined): boolean {
  return /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|curl|wget|headless/i.test(ua ?? "");
}

async function resolve(db: Database, token: string, ctx: Ctx) {
  if (!(await isEnabled(db, "client_visit_link")) || !(await isEnabled(db, "visits_operations"))) return null;
  const k = ipKey(ctx.ip);
  const mult = ctx.ip ? 1 : 10;
  const general = await rateLimit(db, `visit-link:ip:${k}`, CLIENT_LINK_RATE.perIp * mult, CLIENT_LINK_RATE.windowSeconds);
  if (!general.allowed) return null;
  const failures = await peekRateLimit(db, `visit-link:fail:${k}`, CLIENT_LINK_RATE.failureWindowSeconds);
  if (failures >= CLIENT_LINK_RATE.failuresPerIp * mult) return null;
  // Siempre se busca por hash (también con formato inválido): mismo trabajo para cualquier respuesta negativa.
  const hash = hashToken(CLIENT_LINK_TOKEN_RE.test(token) ? token : `invalid:${token.slice(0, 100)}`);
  const row = await db
    .selectFrom("appointment_public_links as l")
    .innerJoin("appointments as a", "a.id", "l.appointment_id")
    .select([
      "l.id as link_id",
      "l.revoked_at",
      "l.expires_at",
      "l.last_opened_at",
      "a.id as appointment_id",
      "a.kind",
      "a.status",
      "a.starts_at",
      "a.ends_at",
      "a.checked_in_at",
      "a.finished_at",
      "a.assigned_user_id",
      "a.property_id",
      "a.contact_id",
    ])
    .where("l.token_hash", "=", hash)
    .executeTakeFirst();
  const settings = await getVisitSettings(db);
  const now = ctx.now ?? new Date();
  const valid =
    row &&
    CLIENT_LINK_TOKEN_RE.test(token) &&
    row.kind === "visit" &&
    isClientLinkValid({ revokedAt: row.revoked_at, endsAt: row.ends_at, finishedAt: row.finished_at, hardExpiresAt: row.expires_at, graceHours: settings.clientLinkGraceHours }, now);
  if (!valid) {
    await rateLimit(db, `visit-link:fail:${k}`, CLIENT_LINK_RATE.failuresPerIp * mult, CLIENT_LINK_RATE.failureWindowSeconds);
    return null;
  }
  return row;
}

async function authorizedContact(db: Database, agent: { full_name: string; whatsapp_e164: string | null; phone: string | null; public_profile: boolean }, propertyTitle: string): Promise<AuthorizedContact> {
  const text = `Hola ${firstName(agent.full_name) ?? ""}, te escribo por la visita a ${propertyTitle}.`.replace("Hola ,", "Hola,");
  // Datos del asesor solo si su perfil es público; si no, los canales generales de la inmobiliaria.
  if (agent.public_profile && (agent.whatsapp_e164 || agent.phone)) {
    return { whatsappUrl: whatsappHref(agent.whatsapp_e164, text), phoneHref: telHref(agent.phone), phoneLabel: agent.phone, source: "agent" };
  }
  const info = await loadSiteInfo(db);
  const wa = whatsappHref(info.whatsappE164, text);
  const tel = telHref(info.mainPhone);
  return wa || tel ? { whatsappUrl: wa, phoneHref: tel, phoneLabel: info.mainPhone, source: "company" } : { whatsappUrl: null, phoneHref: null, phoneLabel: null, source: null };
}

/** Vista completa para la página. `countOpen`: registra la apertura (no cuenta previsualizadores). */
export async function getClientVisitView(db: Database, token: string, ctx: Ctx & { countOpen?: boolean }): Promise<ClientVisitView | null> {
  const row = await resolve(db, token, ctx);
  if (!row) return null;
  const [agent, property, contact] = await Promise.all([
    db.selectFrom("users").select(["full_name", "whatsapp_e164", "phone", "public_profile"]).where("id", "=", row.assigned_user_id).executeTakeFirstOrThrow(),
    db
      .selectFrom("properties as p")
      .select([
        "p.code",
        "p.title",
        "p.location_id",
        "p.address_street",
        "p.address_number",
        "p.hide_exact_address",
        sql<{ source_url: string | null; storage_driver: string | null; storage_key: string | null; visibility: string | null } | null>`(select jsonb_build_object('source_url', m.source_url, 'storage_driver', f.storage_driver, 'storage_key', f.storage_key, 'visibility', f.visibility)
          from property_media m left join files f on f.id = m.file_id and f.deleted_at is null
          where m.property_id = p.id and m.deleted_at is null and m.kind = 'image' and m.status <> 'failed' order by m.is_cover desc, m.sort_order, m.created_at limit 1)`.as("cover"),
      ])
      .where("p.id", "=", row.property_id!)
      .executeTakeFirstOrThrow(),
    row.contact_id ? db.selectFrom("contacts").select(["first_name", "display_name"]).where("id", "=", row.contact_id).executeTakeFirst() : Promise.resolve(undefined),
  ]);
  if (ctx.countOpen && !isLinkPreviewBot(ctx.userAgent)) await registerOpen(db, row.link_id, row.appointment_id, row.last_opened_at);
  const title = tidyTitle(property.title);
  const clientFirstName = firstName(contact?.first_name ?? contact?.display_name);
  const contactInfo = await authorizedContact(db, agent, title);
  const phase = clientPhase(row.status);
  if (phase === "closed") {
    const thanks = row.status === "completed" ? await db.selectFrom("appointment_thanks").select("message").where("appointment_id", "=", row.appointment_id).executeTakeFirst() : undefined;
    return { kind: "closed", clientFirstName, propertyTitle: title, agent: { fullName: agent.full_name }, message: thanks?.message ?? null, contact: contactInfo };
  }
  return {
    kind: "live",
    phase,
    clientFirstName,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    checkedInAt: phase === "checked_in" || phase === "in_progress" ? (row.checked_in_at?.toISOString() ?? null) : null,
    property: {
      code: property.code,
      title,
      zone: await publicZoneLabel(db, property.location_id),
      street: property.hide_exact_address ? null : publicStreet(property.address_street, property.address_number, false),
      coverUrl: property.cover ? publicMediaUrl(property.cover) : null,
    },
    agent: { fullName: agent.full_name },
    contact: contactInfo,
  };
}

/** Estado liviano para el polling. Cerrada = solo `closed` (sin horarios ni nada en vivo). */
export async function getClientVisitStatus(db: Database, token: string, ctx: Ctx): Promise<ClientVisitStatus | null> {
  const row = await resolve(db, token, ctx);
  if (!row) return null;
  const phase = clientPhase(row.status);
  return { phase, checkedInAt: phase === "checked_in" || phase === "in_progress" ? (row.checked_in_at?.toISOString() ?? null) : null };
}

export function statusEtag(s: ClientVisitStatus): string {
  return `"${createHash("sha256").update(JSON.stringify(s)).digest("base64url").slice(0, 22)}"`;
}

async function registerOpen(db: Database, linkId: string, appointmentId: string, lastOpenedAt: Date | null): Promise<void> {
  // Una apertura por minuto como máximo (recargas no inflan el contador).
  if (lastOpenedAt && Date.now() - lastOpenedAt.getTime() < 60_000) return;
  await db.transaction().execute(async (trx) => {
    const r = await trx
      .updateTable("appointment_public_links")
      .set({ last_opened_at: new Date(), open_count: sql`open_count + 1` })
      .where("id", "=", linkId)
      .where((eb) => eb.or([eb("last_opened_at", "is", null), eb("last_opened_at", "<", new Date(Date.now() - 60_000))]))
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) > 0) await recordVisitEvent(trx, { kind: "client" }, appointmentId, "client_link_opened", {}, `client_link_opened:${linkId}`);
  });
}
