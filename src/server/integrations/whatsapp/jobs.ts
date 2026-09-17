/** Handlers de jobs de WhatsApp + asistente de IA. Se registran al importarse desde src/server/jobs/handlers.ts. */
import { enqueue } from "../../jobs/queue";
import { PermanentJobError, registerJobDeadHandler, registerJobHandler } from "../../jobs/registry";
import { addScheduledTask } from "../../jobs/scheduled";
import { handoffAfterDeadJob, runAssistantTurn } from "../../ai/whatsapp/agent";
import { SEND_REPLY_JOB } from "../../conversations/service";
import { AI_REPLY_JOB, assertWebhookEventId, PROCESS_INBOUND_JOB, processWebhookEvent } from "./inbound";
import { deliverConversationMessage, flushHeldMessages } from "./outbound";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidField(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== "string" || !UUID.test(v)) throw new PermanentJobError(`${key} inválido`);
  return v;
}

registerJobHandler(PROCESS_INBOUND_JOB, (payload, { db, actor }) => processWebhookEvent(db, actor, assertWebhookEventId(payload)));

registerJobHandler(SEND_REPLY_JOB, (payload, { db }) => deliverConversationMessage(db, uuidField(payload, "messageId")));

registerJobHandler(AI_REPLY_JOB, (payload, { db, actor, signal }) =>
  runAssistantTurn(db, actor, { conversationId: uuidField(payload, "conversationId"), messageId: uuidField(payload, "messageId") }, { signal }),
);

// Si el turno muere (intentos agotados, error permanente o lease vencido), la conversación pasa a una persona con
// resumen y el cliente recibe el aviso: nunca queda esperando una respuesta que no va a llegar.
registerJobDeadHandler(AI_REPLY_JOB, async (payload, { db, actor, error }) => {
  const conversationId = payload.conversationId;
  const messageId = payload.messageId;
  if (typeof conversationId !== "string" || !UUID.test(conversationId) || typeof messageId !== "string" || !UUID.test(messageId)) return;
  await handoffAfterDeadJob(db, actor, { conversationId, messageId, error });
});

export const FLUSH_HELD_JOB = "whatsapp.flush_held";
addScheduledTask({ type: FLUSH_HELD_JOB, every: "hourly" });
registerJobHandler(FLUSH_HELD_JOB, async (_payload, { db }) => {
  const requeued = await flushHeldMessages(db, (messageId) =>
    enqueue(db, { type: SEND_REPLY_JOB, payload: { messageId }, dedupeKey: `${SEND_REPLY_JOB}:${messageId}`, maxAttempts: 5, timeoutMs: 60_000, priority: 50 }),
  );
  return { requeued };
});
