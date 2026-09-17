/**
 * Formularios públicos del sitio → CRM. Toda consulta termina en captureLead (contacto deduplicado, idempotencia,
 * evento lead.created). Acá se agregan las defensas propias de un formulario anónimo:
 * honeypot, rate limit por IP, flag `public_lead_capture` y validación estricta con mensajes en castellano.
 */
import "server-only";
import { z } from "zod";
import type { Database } from "../db";
import type { Actor } from "../auth/actor";
import { captureLead } from "../leads/capture";
import { isEnabled } from "../flags";
import { rateLimit } from "../rate-limit";
import { AppError } from "../errors";
import { errorFields, log } from "../log";
import { normalizePhone } from "../contacts/normalize";

export const LEAD_FORM_KINDS = ["property", "visit", "contact", "appraisal", "owner"] as const;
export type LeadFormKind = (typeof LEAD_FORM_KINDS)[number];

const RATE_LIMIT = { perIp: 6, windowSeconds: 600 } as const;

const optionalText = (max: number, tooLong: string) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(max, tooLong).optional().transform((s) => (s ? s : undefined)));

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"] as const;

export const publicLeadSchema = z
  .object({
    kind: z.enum(LEAD_FORM_KINDS),
    name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string({ error: "Contanos tu nombre" }).min(2, "Contanos tu nombre").max(120, "El nombre es muy largo")),
    email: z.preprocess(
      (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
      z.email("Revisá el email").max(254, "El email es muy largo").optional(),
    ),
    phone: optionalText(40, "El teléfono es muy largo"),
    message: optionalText(2000, "El mensaje es muy largo (máx. 2000 caracteres)"),
    propertyCode: z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : Number(v)), z.number().int().positive().max(9_999_999).optional()),
    operation: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["sale", "rent", "temporary_rent"]).optional()),
    // Tasación y propietarios ("Quiero vender mi propiedad"): qué quiere hacer, tipo y ubicación
    appraisalType: optionalText(60, "Tipo inválido"),
    appraisalZone: optionalText(160, "La zona es muy larga"),
    appraisalGoal: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["vender", "alquilar", "conocer"]).optional()),
    // Visita
    visitWhen: optionalText(120, "Texto muy largo"),
    // Anti-spam e idempotencia
    website: z.string().max(500).optional(),
    idempotencyKey: z.preprocess((v) => (typeof v === "string" && /^[A-Za-z0-9-]{16,80}$/.test(v) ? v : undefined), z.string().optional()),
    utm: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "Dejanos un teléfono o un email para responderte" });
    if (v.phone && !normalizePhone(v.phone, { defaultAreaCode: "387" })) ctx.addIssue({ code: "custom", path: ["phone"], message: "Revisá el teléfono (con código de área)" });
    if (v.kind === "owner" && v.appraisalGoal === "conocer") ctx.addIssue({ code: "custom", path: ["appraisalGoal"], message: "Elegí si querés vender o alquilar" });
    if ((v.kind === "appraisal" || v.kind === "owner") && !v.appraisalZone) ctx.addIssue({ code: "custom", path: ["appraisalZone"], message: "Contanos dónde está la propiedad" });
    if ((v.kind === "property" || v.kind === "visit") && !v.propertyCode) ctx.addIssue({ code: "custom", path: ["propertyCode"], message: "Falta la propiedad" });
  });
export type PublicLeadInput = z.input<typeof publicLeadSchema>;

export type PublicLeadResult =
  | { status: "sent"; duplicate: boolean }
  | { status: "disabled" }
  | { status: "rate_limited" }
  | { status: "invalid"; fieldErrors: Record<string, string[]> };

export function sanitizeUtm(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of UTM_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().replace(/[^\p{L}\p{N} ._\-+/:]/gu, "").slice(0, 200);
  }
  return out;
}

const APPRAISAL_GOAL: Record<string, string> = { vender: "Quiere vender", alquilar: "Quiere alquilar", conocer: "Quiere conocer el valor" };
const OWNER_GOAL: Record<string, string> = { vender: "Quiere vender su propiedad", alquilar: "Quiere alquilar su propiedad" };

function composeMessage(v: z.infer<typeof publicLeadSchema>): string | null {
  const lines: string[] = [];
  if (v.kind === "visit") lines.push(`Pide coordinar una visita${v.visitWhen ? ` · Preferencia: ${v.visitWhen}` : ""}`);
  if (v.kind === "appraisal") {
    lines.push("Pide tasación");
    if (v.appraisalGoal) lines.push(APPRAISAL_GOAL[v.appraisalGoal]!);
  }
  if (v.kind === "owner") lines.push(`Propietario · ${OWNER_GOAL[v.appraisalGoal ?? "vender"]}`);
  if (v.kind === "appraisal" || v.kind === "owner") {
    if (v.appraisalType) lines.push(`Tipo: ${v.appraisalType}`);
    if (v.appraisalZone) lines.push(`Ubicación: ${v.appraisalZone}`);
  }
  if (v.message) lines.push(v.message);
  return lines.length ? lines.join("\n") : null;
}

/**
 * Interés del lead. Propietario que quiere vender → `sell_my_property`. Propietario que quiere alquilar → `appraisal`
 * (no hay un interés "alquilar mi propiedad": es el mismo criterio que ya usa el formulario de tasación con el objetivo
 * "alquilar"; ambos caen en el pipeline de captación y el mensaje lo aclara).
 */
export function leadInterest(v: Pick<z.infer<typeof publicLeadSchema>, "kind" | "appraisalGoal" | "operation">) {
  if (v.kind === "owner") return v.appraisalGoal === "alquilar" ? ("appraisal" as const) : ("sell_my_property" as const);
  if (v.kind === "appraisal") return "appraisal" as const;
  return v.operation ?? null;
}

/**
 * Procesa un envío de formulario público. Nunca devuelve "sent" si el lead no quedó guardado.
 * `ip` puede ser null (sin cabeceras de proxy): se limita con una clave compartida más permisiva.
 */
export async function submitPublicLead(db: Database, actor: Actor, ip: string | null, raw: unknown): Promise<PublicLeadResult> {
  const parsed = publicLeadSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
    return { status: "invalid", fieldErrors };
  }
  const v = parsed.data;

  // Honeypot: un bot completó el campo oculto. Se responde como enviado (no le damos señal) y no se guarda nada.
  if (v.website && v.website.trim() !== "") {
    log.warn("site.lead_honeypot", { kind: v.kind, requestId: actor.requestId });
    return { status: "sent", duplicate: false };
  }

  if (!(await isEnabled(db, "public_lead_capture"))) return { status: "disabled" };

  try {
    const key = ip ? `site-lead:ip:${ip}` : "site-lead:ip:unknown";
    const rl = await rateLimit(db, key, ip ? RATE_LIMIT.perIp : RATE_LIMIT.perIp * 10, RATE_LIMIT.windowSeconds);
    if (!rl.allowed) return { status: "rate_limited" };
  } catch (e) {
    // Fail-open: perder una consulta real es peor que dejar pasar un envío de más; queda logueado.
    log.error("site.lead_rate_limit_failed", { requestId: actor.requestId, ...errorFields(e) });
  }

  const sourceKey = v.kind === "appraisal" || v.kind === "owner" ? "web_appraisal" : v.kind === "contact" ? "web_contact" : "web_property";
  const operationInterest = leadInterest(v);
  try {
    const res = await captureLead(db, actor, {
      name: v.name,
      email: v.email ?? null,
      phone: v.phone ?? null,
      message: composeMessage(v),
      sourceKey,
      propertyCode: v.kind === "property" || v.kind === "visit" ? (v.propertyCode ?? null) : null,
      operationInterest,
      utm: sanitizeUtm(v.utm),
      idempotencyKey: v.idempotencyKey ? `web:${v.idempotencyKey}` : null,
      priority: v.kind === "visit" ? "high" : "normal",
    });
    return { status: "sent", duplicate: res.duplicate };
  } catch (e) {
    if (e instanceof AppError && e.code === "validation") {
      return { status: "invalid", fieldErrors: e.details ?? { _: [e.message] } };
    }
    throw e;
  }
}
