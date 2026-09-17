/**
 * Contrato único para mensajes salientes (email / WhatsApp). Los módulos SOLO encolan acá;
 * el worker de integraciones renderiza la plantilla y envía (o deja `awaiting_credentials`).
 * dedupe_key hace que un mismo aviso nunca se envíe dos veces.
 */
import { enqueue } from "../jobs/queue";
import type { Executor } from "../db";

export type QueueMessageInput = {
  channel: "email" | "whatsapp";
  to: string;
  templateKey: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  entityType?: string;
  entityId?: string;
};

export async function queueMessage(db: Executor, m: QueueMessageInput): Promise<string | null> {
  const row = await db
    .insertInto("outbound_messages")
    .values({
      channel: m.channel,
      to_address: m.to,
      template_key: m.templateKey,
      payload: JSON.stringify(m.payload),
      dedupe_key: m.dedupeKey,
      entity_type: m.entityType ?? null,
      entity_id: m.entityId ?? null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!row) return null;
  await enqueue(db, { type: "messaging.send", payload: { messageId: row.id }, dedupeKey: `messaging.send:${row.id}`, maxAttempts: 6 });
  return row.id;
}
