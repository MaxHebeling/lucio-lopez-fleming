/** Catálogos de conversaciones compartidos por servicios y UI (sin dependencias de servidor). */

export const HANDOFF_REASONS = [
  "customer_request",
  "negotiation",
  "reservation",
  "complaint",
  "documents",
  "sensitive",
  "closing_intent",
  "low_confidence",
  "ai_error",
  "ai_guard",
  "budget_exhausted",
  "ai_unavailable",
  "bot_disabled",
  "unsupported_message",
  "taken_by_agent",
  "other",
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

export const HANDOFF_LABEL: Record<HandoffReason, string> = {
  customer_request: "El cliente pidió hablar con una persona",
  negotiation: "Negociación u oferta",
  reservation: "Reserva o seña",
  complaint: "Reclamo",
  documents: "Documentación",
  sensitive: "Operación sensible",
  closing_intent: "Intención fuerte de cierre",
  low_confidence: "Baja confianza del asistente",
  ai_error: "Errores repetidos del asistente",
  ai_guard: "Respuesta del asistente descartada (datos no verificados)",
  budget_exhausted: "Presupuesto diario de IA agotado",
  ai_unavailable: "Asistente de IA sin credenciales",
  bot_disabled: "Asistente de IA desactivado",
  unsupported_message: "Mensaje que el asistente no puede leer (audio, foto, archivo…)",
  taken_by_agent: "Tomada por una persona del equipo",
  other: "Otro motivo",
};

export function handoffLabel(reason: string | null | undefined): string {
  if (!reason) return "—";
  return HANDOFF_LABEL[reason as HandoffReason] ?? reason;
}

export const MESSAGE_STATUS_LABEL: Record<string, string> = {
  received: "Recibido",
  queued: "En cola",
  sending: "Enviando",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Falló",
  awaiting_credentials: "Sin credenciales: no enviado",
};

export const MODE_LABEL: Record<string, string> = { bot: "Asistente", human: "Persona", closed: "Cerrada" };

/** Mensaje fijo al derivar (no contiene datos de inventario: nada que verificar). */
export const HANDOFF_ACK_MESSAGE =
  "Gracias por escribirnos. Te va a responder una persona del equipo de Lucio López Fleming a la brevedad.";

export const ASSISTANT_INTRO = "Hola, soy el asistente virtual de Lucio López Fleming.";
