/**
 * Plantillas de email transaccional: HTML + texto plano, marca sobria (tipografía del sistema, acento #AE2C25).
 * - Todo contenido dinámico se escapa (escapeHtml) antes de entrar al HTML.
 * - Los links solo pueden apuntar a APP_URL (paths relativos o URLs absolutas del mismo origen).
 * - Cada plantilla valida su payload con zod: payload inválido o plantilla desconocida = error permanente.
 * - `sensitiveKeys`: datos de un solo uso que se borran del payload cuando el mensaje sale de la cola (enviado, fallido
 *   definitivo o cancelado). `ONE_TIME_KEYS` se redacta siempre, aunque la plantilla no lo declare.
 * - WhatsApp (`WHATSAPP_TEMPLATES`): mismo payload validado con el esquema de la plantilla de email, más los parámetros del
 *   cuerpo de la plantilla aprobada en Meta, en el orden documentado en cada entrada.
 */
import { z } from "zod";

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

export type RenderedEmail = { subject: string; html: string; text: string };

const BRAND = "Lucio López Fleming";
const ACCENT = "#AE2C25";
const INK = "#141312";
const STONE = "#77716a";
const PAPER = "#f4f0ea";
const LINE = "#d9d1c6";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appUrl(): URL {
  const raw = process.env.APP_URL;
  if (!raw) throw new TemplateError("Falta APP_URL para construir links del email");
  return new URL(raw);
}

/** Solo links internos: "/crm/..." o una URL absoluta con el mismo origen que APP_URL. */
export function appLink(pathOrUrl: string): string {
  const base = appUrl();
  let u: URL;
  try {
    u = pathOrUrl.startsWith("/") && !pathOrUrl.startsWith("//") ? new URL(pathOrUrl, base) : new URL(pathOrUrl);
  } catch {
    throw new TemplateError("Link inválido en el payload");
  }
  if (u.origin !== base.origin) throw new TemplateError("Link fuera de APP_URL: no se envía");
  return u.toString();
}

const name = z.string().trim().min(1).max(200);
const link = z.string().trim().min(1).max(2000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type Block = { kind: "p"; text: string } | { kind: "button"; label: string; href: string } | { kind: "facts"; rows: Array<[string, string]> } | { kind: "small"; text: string };

function layout(title: string, blocks: Block[], preheader: string): { html: string; text: string } {
  const body = blocks
    .map((b) => {
      switch (b.kind) {
        case "p":
          return `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK};">${escapeHtml(b.text)}</p>`;
        case "small":
          return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${STONE};">${escapeHtml(b.text)}</p>`;
        case "button":
          return `<p style="margin:24px 0;"><a href="${escapeHtml(b.href)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:8px;">${escapeHtml(b.label)}</a></p><p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:${STONE};word-break:break-all;">Si el botón no funciona, copiá este link: ${escapeHtml(b.href)}</p>`;
        case "facts":
          return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;border-collapse:collapse;">${b.rows
            .map(
              ([k, v]) =>
                `<tr><td style="padding:8px 0;border-top:1px solid ${LINE};font-size:13px;color:${STONE};width:40%;">${escapeHtml(k)}</td><td style="padding:8px 0;border-top:1px solid ${LINE};font-size:14px;color:${INK};">${escapeHtml(v)}</td></tr>`,
            )
            .join("")}</table>`;
      }
    })
    .join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;">
<tr><td style="padding:24px 28px 8px;border-bottom:3px solid ${ACCENT};"><p style="margin:0;font-size:18px;font-weight:700;color:${INK};">${BRAND}</p><p style="margin:4px 0 12px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${ACCENT};">Buenos negocios</p></td></tr>
<tr><td style="padding:24px 28px;"><h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${INK};">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${LINE};font-size:12px;line-height:1.5;color:${STONE};">${BRAND} · Salta, Argentina. Este es un mensaje automático.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    BRAND,
    "",
    title,
    "",
    ...blocks.map((b) => {
      switch (b.kind) {
        case "p":
        case "small":
          return b.text;
        case "button":
          return `${b.label}: ${b.href}`;
        case "facts":
          return b.rows.map(([k, v]) => `${k}: ${v}`).join("\n");
      }
    }),
    "",
    `${BRAND} · Salta, Argentina. Este es un mensaje automático.`,
  ].join("\n");
  return { html, text };
}

const MONEY = (amount: string | number, currency: string) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new TemplateError("Monto inválido");
  const hasCents = Math.round(n * 100) % 100 !== 0;
  const num = new Intl.NumberFormat("es-AR", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  return currency === "USD" ? `USD ${num}` : `$ ${num}`;
};

const LONG_DATE = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

type Definition<S extends z.ZodType> = {
  schema: S;
  sensitiveKeys: string[];
  render: (p: z.infer<S>) => RenderedEmail;
};

function define<S extends z.ZodType>(d: Definition<S>): Definition<S> {
  return d;
}

const resetSchema = z.object({ fullName: name, resetUrl: link, expiresMinutes: z.number().int().min(5).max(24 * 60).default(60) });

export const EMAIL_TEMPLATES = {
  password_reset: define({
    schema: resetSchema,
    sensitiveKeys: ["resetUrl"],
    render: (p) => {
      const title = "Restablecer tu contraseña";
      const r = layout(
        title,
        [
          { kind: "p", text: `Hola, ${p.fullName}.` },
          { kind: "p", text: "Recibimos un pedido para restablecer la contraseña de tu usuario del CRM." },
          { kind: "button", label: "Elegir una contraseña nueva", href: appLink(p.resetUrl) },
          { kind: "small", text: `El link vence en ${p.expiresMinutes} minutos y sirve una sola vez. Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.` },
        ],
        "Link para restablecer tu contraseña",
      );
      return { subject: title, ...r };
    },
  }),
  owner_password_reset: define({
    schema: resetSchema,
    sensitiveKeys: ["resetUrl"],
    render: (p) => {
      const title = "Restablecer tu contraseña del portal de propietarios";
      const r = layout(
        title,
        [
          { kind: "p", text: `Hola, ${p.fullName}.` },
          { kind: "p", text: "Recibimos un pedido para restablecer tu contraseña del portal de propietarios." },
          { kind: "button", label: "Elegir una contraseña nueva", href: appLink(p.resetUrl) },
          { kind: "small", text: `El link vence en ${p.expiresMinutes} minutos y sirve una sola vez. Si no lo pediste, ignorá este mensaje.` },
        ],
        "Link para restablecer tu contraseña",
      );
      return { subject: title, ...r };
    },
  }),
  staff_invite: define({
    schema: z.object({ fullName: name, inviteUrl: link, invitedBy: name.optional(), expiresHours: z.number().int().min(1).max(24 * 14).default(72) }),
    sensitiveKeys: ["inviteUrl"],
    render: (p) => {
      const title = "Te invitaron al CRM";
      const r = layout(
        title,
        [
          { kind: "p", text: `Hola, ${p.fullName}.` },
          { kind: "p", text: p.invitedBy ? `${p.invitedBy} te dio acceso al CRM de ${BRAND}.` : `Tenés acceso al CRM de ${BRAND}.` },
          { kind: "button", label: "Activar mi usuario", href: appLink(p.inviteUrl) },
          { kind: "small", text: `La invitación vence en ${p.expiresHours} horas.` },
        ],
        "Activá tu usuario del CRM",
      );
      return { subject: title, ...r };
    },
  }),
  owner_invite: define({
    schema: z.object({ fullName: name, inviteUrl: link, expiresHours: z.number().int().min(1).max(24 * 14).default(72) }),
    sensitiveKeys: ["inviteUrl"],
    render: (p) => {
      const title = "Tu acceso al portal de propietarios";
      const r = layout(
        title,
        [
          { kind: "p", text: `Hola, ${p.fullName}.` },
          { kind: "p", text: "Desde el portal podés consultar la información de tus propiedades administradas por nosotros." },
          { kind: "button", label: "Activar mi acceso", href: appLink(p.inviteUrl) },
          { kind: "small", text: `La invitación vence en ${p.expiresHours} horas.` },
        ],
        "Activá tu acceso al portal de propietarios",
      );
      return { subject: title, ...r };
    },
  }),
  owner_report_ready: define({
    schema: z.object({ fullName: name, periodLabel: z.string().trim().min(3).max(80), reportUrl: link }),
    sensitiveKeys: [],
    render: (p) => {
      const title = `Tu informe de ${p.periodLabel} está disponible`;
      const r = layout(
        title,
        [
          { kind: "p", text: `Hola, ${p.fullName}.` },
          { kind: "p", text: `Ya podés ver el informe del período ${p.periodLabel} en el portal de propietarios.` },
          { kind: "button", label: "Ver el informe", href: appLink(p.reportUrl) },
          { kind: "small", text: "Por seguridad, el informe se ve iniciando sesión en el portal." },
        ],
        `Informe de ${p.periodLabel}`,
      );
      return { subject: title, ...r };
    },
  }),
  rent_due_reminder: define({
    schema: z.object({
      recipientName: name,
      propertyLabel: z.string().trim().min(2).max(200),
      dueDate: isoDate,
      amount: z.union([z.string().regex(/^\d+(\.\d{1,2})?$/), z.number().nonnegative()]),
      currency: z.enum(["ARS", "USD"]),
      periodLabel: z.string().trim().min(3).max(80).optional(),
    }),
    sensitiveKeys: [],
    render: (p) => {
      const title = "Recordatorio de vencimiento de alquiler";
      const rows: Array<[string, string]> = [
        ["Propiedad", p.propertyLabel],
        ...(p.periodLabel ? ([["Período", p.periodLabel]] as Array<[string, string]>) : []),
        ["Vence", LONG_DATE(p.dueDate)],
        ["Importe", MONEY(p.amount, p.currency)],
      ];
      const r = layout(
        title,
        [
          { kind: "p", text: `Hola, ${p.recipientName}.` },
          { kind: "p", text: "Te recordamos el próximo vencimiento del alquiler:" },
          { kind: "facts", rows },
          { kind: "small", text: "Si ya realizaste el pago, desestimá este mensaje. Ante cualquier duda, respondé a este correo o comunicate con la inmobiliaria." },
        ],
        `Vence el ${LONG_DATE(p.dueDate)}`,
      );
      return { subject: `${title} · ${LONG_DATE(p.dueDate)}`, ...r };
    },
  }),
  lead_internal_notice: define({
    schema: z.object({
      leadPath: z.string().regex(/^\/crm\/leads\/[0-9a-f-]{36}$/),
      contactName: z.string().trim().max(200).nullable().optional(),
      sourceName: z.string().trim().max(120).nullable().optional(),
      propertyLabel: z.string().trim().max(240).nullable().optional(),
      message: z.string().max(5000).nullable().optional(),
    }),
    sensitiveKeys: [],
    render: (p) => {
      const title = "Nuevo lead";
      const rows: Array<[string, string]> = [];
      if (p.contactName) rows.push(["Contacto", p.contactName]);
      if (p.sourceName) rows.push(["Origen", p.sourceName]);
      if (p.propertyLabel) rows.push(["Propiedad", p.propertyLabel]);
      const blocks: Block[] = [{ kind: "p", text: "Entró un lead nuevo al CRM." }];
      if (rows.length) blocks.push({ kind: "facts", rows });
      if (p.message) blocks.push({ kind: "p", text: `Mensaje: ${p.message.slice(0, 1000)}` });
      blocks.push({ kind: "button", label: "Ver el lead en el CRM", href: appLink(p.leadPath) });
      blocks.push({ kind: "small", text: "Los datos de contacto se ven en el CRM (no se envían por email)." });
      const r = layout(title, blocks, p.sourceName ? `Lead desde ${p.sourceName}` : "Lead nuevo");
      return { subject: p.sourceName ? `Nuevo lead · ${p.sourceName}` : title, ...r };
    },
  }),
} as const;

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES;

export function isEmailTemplate(key: string): key is EmailTemplateKey {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, key);
}

export function renderEmail(key: string, payload: unknown): RenderedEmail {
  if (!isEmailTemplate(key)) throw new TemplateError(`Plantilla de email desconocida: ${key}`);
  const def = EMAIL_TEMPLATES[key] as Definition<z.ZodType>;
  const parsed = def.schema.safeParse(payload);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "_").slice(0, 10);
    throw new TemplateError(`Payload inválido para ${key}: ${fields.join(", ")}`);
  }
  return def.render(parsed.data);
}

/** Claves que SIEMPRE son de un solo uso (links con token), sea cual sea la plantilla. */
export const ONE_TIME_KEYS = ["resetUrl", "inviteUrl", "token"] as const;
export const REDACTED = "[redactado tras el envío]";

/** Payload sin los datos sensibles de un solo uso (se guarda así cuando el mensaje sale de la cola). */
export function redactSensitive(key: string, payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  const keys = new Set<string>([...ONE_TIME_KEYS, ...(isEmailTemplate(key) ? EMAIL_TEMPLATES[key].sensitiveKeys : [])]);
  for (const k of keys) if (k in out && out[k] !== null && out[k] !== undefined) out[k] = REDACTED;
  return out;
}

// ───────────── WhatsApp ─────────────

export type WhatsAppTemplateSpec = { name: string; language?: string; bodyParameters: string[] };

type WhatsAppDefinition<K extends EmailTemplateKey> = {
  /** Nombre de la plantilla aprobada en Meta. */
  name: string;
  /** Parámetros del cuerpo ({{1}}, {{2}}, ...) en orden. */
  bodyParameters: (p: z.infer<(typeof EMAIL_TEMPLATES)[K]["schema"]>) => string[];
};

/**
 * Plantillas de WhatsApp con parámetros. La plantilla aprobada en Meta debe tener EXACTAMENTE estos parámetros:
 * - rent_due_reminder: {{1}} nombre del destinatario, {{2}} propiedad, {{3}} fecha de vencimiento ("10 de octubre de 2026"),
 *   {{4}} importe pendiente ("$ 350.000" / "USD 1.200").
 */
export const WHATSAPP_TEMPLATES: { [K in EmailTemplateKey]?: WhatsAppDefinition<K> } = {
  rent_due_reminder: {
    name: "rent_due_reminder",
    bodyParameters: (p) => [p.recipientName, p.propertyLabel, LONG_DATE(p.dueDate), MONEY(p.amount, p.currency)],
  },
};

/**
 * Arma la plantilla de WhatsApp desde el payload de negocio (validado con el esquema de la plantilla).
 * Plantilla sin definición de WhatsApp o payload inválido → TemplateError (permanente).
 */
export function buildWhatsAppTemplate(key: string, payload: unknown): WhatsAppTemplateSpec {
  if (!isEmailTemplate(key) || !WHATSAPP_TEMPLATES[key]) throw new TemplateError(`Plantilla de WhatsApp desconocida: ${key}`);
  const def = WHATSAPP_TEMPLATES[key] as WhatsAppDefinition<EmailTemplateKey>;
  const parsed = (EMAIL_TEMPLATES[key] as Definition<z.ZodType>).schema.safeParse(payload);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".") || "_").slice(0, 10);
    throw new TemplateError(`Payload inválido para ${key}: ${fields.join(", ")}`);
  }
  const bodyParameters = def.bodyParameters(parsed.data as never).map((v) => String(v).trim());
  if (bodyParameters.some((v) => !v || v.length > 1024)) throw new TemplateError(`Parámetro vacío o demasiado largo en la plantilla de WhatsApp ${key}`);
  return { name: def.name, bodyParameters };
}

/**
 * "Render" de un mensaje de WhatsApp encolado: para plantillas conocidas recalcula los parámetros desde el payload de negocio
 * (la fuente de verdad) y exige que `whatsappTemplate` guardado coincida. Para plantillas sin parámetros definidos acá
 * acepta un `whatsappTemplate` explícito bien formado.
 */
export function renderWhatsApp(key: string, payload: Record<string, unknown>): WhatsAppTemplateSpec {
  const stored = payload.whatsappTemplate as { name?: unknown; language?: unknown; bodyParameters?: unknown } | undefined;
  if (isEmailTemplate(key) && WHATSAPP_TEMPLATES[key]) {
    const spec = buildWhatsAppTemplate(key, payload);
    if (stored !== undefined) {
      const sameParams = Array.isArray(stored.bodyParameters) && JSON.stringify(stored.bodyParameters) === JSON.stringify(spec.bodyParameters);
      if (stored.name !== spec.name || !sameParams) throw new TemplateError(`whatsappTemplate no coincide con el payload de ${key}`);
    }
    return typeof stored?.language === "string" ? { ...spec, language: stored.language } : spec;
  }
  if (stored === undefined) return { name: key, bodyParameters: [] };
  if (typeof stored !== "object" || stored === null) throw new TemplateError(`whatsappTemplate inválido para ${key}`);
  const params = stored.bodyParameters ?? [];
  if (!Array.isArray(params) || params.some((p) => typeof p !== "string" || !p.trim())) throw new TemplateError(`bodyParameters inválidos para ${key}`);
  const name = typeof stored.name === "string" ? stored.name : key;
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new TemplateError(`Nombre de plantilla de WhatsApp inválido: ${name}`);
  return { name, bodyParameters: params as string[], ...(typeof stored.language === "string" ? { language: stored.language } : {}) };
}
