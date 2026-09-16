/**
 * Parser del webhook de WhatsApp Cloud API (campo "messages"). Función pura: separa cada mensaje entrante y cada
 * actualización de estado en un evento independiente con id externo estable (para deduplicar reintentos de Meta).
 * Tolerante a campos nuevos: valida lo que usamos y conserva el resto en `raw`.
 */
import { z } from "zod";

const errorSchema = z.looseObject({
  code: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  error_data: z.looseObject({ details: z.string().optional() }).optional(),
});

const messageSchema = z.looseObject({
  id: z.string().min(1).max(200),
  from: z.string().regex(/^\d{6,20}$/),
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string().min(1).max(40),
  text: z.looseObject({ body: z.string() }).optional(),
  button: z.looseObject({ text: z.string().optional(), payload: z.string().optional() }).optional(),
  interactive: z
    .looseObject({
      type: z.string().optional(),
      button_reply: z.looseObject({ id: z.string().optional(), title: z.string().optional() }).optional(),
      list_reply: z.looseObject({ id: z.string().optional(), title: z.string().optional(), description: z.string().optional() }).optional(),
    })
    .optional(),
  image: z.looseObject({ caption: z.string().optional() }).optional(),
  video: z.looseObject({ caption: z.string().optional() }).optional(),
  document: z.looseObject({ caption: z.string().optional(), filename: z.string().optional() }).optional(),
  location: z.looseObject({ name: z.string().optional(), address: z.string().optional() }).optional(),
  reaction: z.looseObject({ message_id: z.string().optional(), emoji: z.string().optional() }).optional(),
  context: z.looseObject({ id: z.string().optional() }).optional(),
});

const statusSchema = z.looseObject({
  id: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  timestamp: z.string().regex(/^\d{1,12}$/),
  recipient_id: z.string().max(40).optional(),
  errors: z.array(errorSchema).optional(),
});

const valueSchema = z.looseObject({
  messaging_product: z.string().optional(),
  metadata: z.looseObject({ phone_number_id: z.string().optional(), display_phone_number: z.string().optional() }).optional(),
  contacts: z.array(z.looseObject({ wa_id: z.string().optional(), profile: z.looseObject({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
});

export const webhookSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      id: z.string().optional(),
      changes: z.array(z.looseObject({ field: z.string().optional(), value: z.unknown() })).default([]),
    }),
  ),
});

export type MessageKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "interactive"
  | "button"
  | "reaction"
  | "unsupported";

const KNOWN_KINDS = new Set<MessageKind>(["text", "image", "audio", "video", "document", "sticker", "location", "contacts", "interactive", "button", "reaction"]);

export type InboundMessageEvent = {
  kind: "message";
  externalEventId: string;
  phoneNumberId: string | null;
  waId: string;
  profileName: string | null;
  messageId: string;
  timestamp: number;
  messageKind: MessageKind;
  /** Texto legible (cuerpo, título del botón, pie de foto). null si no hay texto. */
  text: string | null;
  raw: Record<string, unknown>;
};

export type StatusEvent = {
  kind: "status";
  externalEventId: string;
  phoneNumberId: string | null;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed" | "other";
  rawStatus: string;
  timestamp: number;
  recipientId: string | null;
  error: { code: string | null; title: string | null; detail: string | null } | null;
  raw: Record<string, unknown>;
};

export type WebhookEvent = InboundMessageEvent | StatusEvent;

export type ParseResult = { ok: true; events: WebhookEvent[]; skipped: number } | { ok: false; error: string };

function textOf(m: z.infer<typeof messageSchema>): string | null {
  switch (m.type) {
    case "text":
      return m.text?.body ?? null;
    case "button":
      return m.button?.text ?? m.button?.payload ?? null;
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
    case "image":
      return m.image?.caption ?? null;
    case "video":
      return m.video?.caption ?? null;
    case "document":
      return m.document?.caption ?? null;
    case "location":
      return [m.location?.name, m.location?.address].filter(Boolean).join(" — ") || null;
    case "reaction":
      return m.reaction?.emoji ?? null;
    default:
      return null;
  }
}

export function parseWebhook(body: unknown): ParseResult {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: "estructura de webhook inválida" };
  if (parsed.data.object !== "whatsapp_business_account") return { ok: false, error: `objeto no soportado: ${parsed.data.object}` };

  const events: WebhookEvent[] = [];
  let skipped = 0;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field && change.field !== "messages") {
        skipped++;
        continue;
      }
      const value = valueSchema.safeParse(change.value);
      if (!value.success) {
        skipped++;
        continue;
      }
      const phoneNumberId = value.data.metadata?.phone_number_id ?? null;
      const contacts = value.data.contacts ?? [];
      for (const rawMsg of value.data.messages ?? []) {
        const m = messageSchema.safeParse(rawMsg);
        if (!m.success) {
          skipped++;
          continue;
        }
        const contact = contacts.find((c) => c.wa_id === m.data.from) ?? (contacts.length === 1 ? contacts[0] : undefined);
        const kind = KNOWN_KINDS.has(m.data.type as MessageKind) ? (m.data.type as MessageKind) : "unsupported";
        events.push({
          kind: "message",
          externalEventId: `message:${m.data.id}`,
          phoneNumberId,
          waId: m.data.from,
          profileName: contact?.profile?.name?.trim().slice(0, 200) || null,
          messageId: m.data.id,
          timestamp: Number(m.data.timestamp),
          messageKind: kind,
          text: textOf(m.data)?.slice(0, 4096) ?? null,
          raw: m.data as Record<string, unknown>,
        });
      }
      for (const rawStatus of value.data.statuses ?? []) {
        const s = statusSchema.safeParse(rawStatus);
        if (!s.success) {
          skipped++;
          continue;
        }
        const known = ["sent", "delivered", "read", "failed"].includes(s.data.status);
        const err = s.data.errors?.[0];
        events.push({
          kind: "status",
          externalEventId: `status:${s.data.id}:${s.data.status}`,
          phoneNumberId,
          messageId: s.data.id,
          status: known ? (s.data.status as StatusEvent["status"]) : "other",
          rawStatus: s.data.status,
          timestamp: Number(s.data.timestamp),
          recipientId: s.data.recipient_id ?? null,
          error: err
            ? { code: err.code != null ? String(err.code) : null, title: err.title ?? err.message ?? null, detail: err.error_data?.details ?? null }
            : null,
          raw: s.data as Record<string, unknown>,
        });
      }
    }
  }
  return { ok: true, events, skipped };
}
