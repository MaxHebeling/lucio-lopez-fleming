import { Alert, Badge } from "@/components/ui";
import { MESSAGE_STATUS_LABEL, MODE_LABEL } from "@/server/conversations/labels";
import type { ChannelStatus } from "@/server/conversations/queries";

export function ModeBadge({ mode }: { mode: string }) {
  const tone = mode === "bot" ? "info" : mode === "human" ? "warning" : "neutral";
  return <Badge tone={tone}>{MODE_LABEL[mode] ?? mode}</Badge>;
}

export function MessageStatus({ status }: { status: string }) {
  const tone = status === "read" || status === "delivered" || status === "sent" ? "success" : status === "failed" || status === "awaiting_credentials" ? "danger" : "neutral";
  return <Badge tone={tone}>{MESSAGE_STATUS_LABEL[status] ?? status}</Badge>;
}

/** Avisos honestos sobre lo que todavía no funciona (sin credenciales o flags apagados). */
export function ChannelBanners({ status }: { status: ChannelStatus }) {
  const notes: Array<{ tone: "warning" | "info"; text: string }> = [];
  if (!status.whatsappConfigured || status.whatsappStatus === "awaiting_credentials") {
    notes.push({
      tone: "warning",
      text: "WhatsApp Business todavía no está conectado (faltan credenciales de Meta). Las respuestas quedan registradas pero no se envían.",
    });
  } else if (!status.outboundEnabled) {
    notes.push({ tone: "warning", text: "El envío real de WhatsApp está desactivado (flag outbound_whatsapp): las respuestas quedan en cola." });
  } else if (status.whatsappStatus === "degraded" || status.whatsappStatus === "error") {
    notes.push({ tone: "warning", text: "WhatsApp está con fallas: algunos envíos pueden demorarse o fallar. Revisá Integraciones." });
  }
  if (!status.botEnabled) notes.push({ tone: "info", text: "El asistente de IA está apagado: todos los mensajes entrantes los atiende una persona." });
  else if (status.anthropicStatus === "awaiting_credentials") notes.push({ tone: "info", text: "El asistente de IA no tiene credenciales: las conversaciones nuevas se derivan a una persona." });
  if (!notes.length) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {notes.map((n) => (
        <Alert key={n.text} tone={n.tone}>
          {n.text}
        </Alert>
      ))}
    </div>
  );
}
