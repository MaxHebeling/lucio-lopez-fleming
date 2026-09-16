/**
 * Reglas deterministas de derivación ANTES de llamar a la IA: si el cliente pide una persona, negocia, quiere
 * reservar, reclama o habla de documentos, no se arriesga una respuesta automática. Conservador a propósito:
 * un falso positivo solo significa que responde una persona.
 */
import type { HandoffReason } from "../../conversations/labels";

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const RULES: Array<{ reason: HandoffReason; patterns: RegExp[] }> = [
  {
    reason: "customer_request",
    patterns: [
      /\b(hablar|comunicarme|comunicar|contactar(me)?|atender(me)?|atienda|pasame|pasas|pasan|pasenme|comunicas|derivame|derivas|derivan)\b.{0,40}\b(persona|humano|asesor[a]?|agente|alguien|vendedor[a]?|martillero|corredor[a]?|operador[a]?)\b/,
      /\b(persona real|un humano|no sos (una )?persona|no quiero (hablar con )?(un )?(bot|robot|maquina))\b/,
      /\bquiero (un|una|hablar con (un|una)) (asesor[a]?|persona|agente|vendedor[a]?)\b/,
    ],
  },
  {
    reason: "negotiation",
    patterns: [/\b(oferta|ofrezco|ofertar|contraoferta|negociar|negociable|rebaja|rebajan|descuento|me la dejan|me lo dejan|ultimo precio|precio final|permuta|permutar|aceptan menos)\b/],
  },
  {
    reason: "reservation",
    patterns: [/\b(reserva|reservar|reservarla|reservarlo|reservo|sena|senar|senarla|senarlo|dejar una sena)\b/],
  },
  {
    reason: "complaint",
    patterns: [/\b(reclamo|reclamar|queja|denuncia|denunciar|estafa|estafaron|abogado|defensa del consumidor|carta documento|inaceptable)\b/],
  },
  {
    reason: "documents",
    patterns: [/\b(escritura|boleto|contrato|dni|documentacion|documentos|recibo de sueldo|recibos de sueldo|titulo de propiedad|informe de dominio|garantia propietaria|seguro de caucion)\b/],
  },
  {
    reason: "closing_intent",
    patterns: [/\b(la quiero|lo quiero|me la quedo|me lo quedo|como avanzo|quiero avanzar|cerrar (el )?trato|quiero comprarla|quiero comprarlo|quiero alquilarla|quiero alquilarlo|firmar)\b/],
  },
];

export function detectHandoff(text: string): HandoffReason | null {
  const t = normalize(text);
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.reason;
  }
  return null;
}
