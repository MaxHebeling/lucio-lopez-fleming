/** Textos honestos del copiloto cuando la IA no responde (un solo lugar, en español rioplatense). */
import type { AIFailureReason } from "../core/errors";

export const NOT_CONFIGURED_NOTICE = "El asistente de IA todavía no está configurado. Un administrador tiene que cargar la clave del proveedor en Integraciones.";

export function noticeFor(reason: AIFailureReason | null): string | null {
  switch (reason) {
    case null:
      return null;
    case "not_configured":
      return NOT_CONFIGURED_NOTICE;
    case "flag_disabled":
      return "El Asistente IA está apagado. Un administrador puede encenderlo en Integraciones → Feature flags.";
    case "budget_exhausted":
      return "Se alcanzó el presupuesto diario de IA. Hasta mañana respondo sin el modelo: con la guía y los datos directos del CRM.";
    case "rate_limited":
      return "El proveedor de IA está limitando pedidos en este momento. Te muestro la información directa del CRM.";
    case "timeout":
      return "La IA tardó demasiado en responder. Te muestro la información directa del CRM.";
    case "circuit_open":
      return "La IA está en pausa por fallas repetidas del proveedor. Te muestro la información directa del CRM.";
    case "invalid_output":
      return "La IA devolvió una respuesta con formato inválido y la descarté. Te muestro la información directa del CRM.";
    case "guard_blocked":
      return "Descarté la respuesta de la IA porque mencionaba datos que no pude verificar. Te muestro la información directa del CRM.";
    case "governance_blocked":
      return "La IA pidió una acción que no está permitida y la bloqueé. Te muestro la información directa del CRM.";
    case "provider_error":
      return "La IA no está respondiendo en este momento. Te muestro la información directa del CRM.";
  }
}
