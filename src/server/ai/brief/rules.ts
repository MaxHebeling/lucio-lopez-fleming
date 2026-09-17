/**
 * «Resumen de hoy»: reglas PURAS (saludo, ítems visibles, textos, huella y verificación de la redacción con IA).
 * Todo número que se muestra sale de un conteo real con su definición y su link a la lista filtrada.
 */
import { createHash } from "node:crypto";

export const BRIEF_KEYS = [
  "visits_today",
  "high_intent_leads",
  "clients_follow_up",
  "new_matches",
  "overdue_followups",
  "unassigned_visits",
  "open_incidents",
  "anomalies",
  "low_quality",
] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];

export type BriefCount = { key: BriefKey; count: number; href: string; scope: "own" | "all" };

export type BriefItem = BriefCount & { label: string; definition: string; tone: "danger" | "warning" | "info" };

export type BriefFacts = { day: string; items: BriefItem[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const SPEC: Record<BriefKey, { tone: BriefItem["tone"]; label: (n: number, own: boolean) => string; definition: (own: boolean) => string }> = {
  visits_today: {
    tone: "info",
    label: (n, own) => `${plural(n, "visita programada", "visitas programadas")} para hoy${own ? "" : " en el equipo"}`,
    definition: (own) => `Visitas con inicio hoy (hora de Salta), sin canceladas${own ? ", asignadas a vos" : ""}.`,
  },
  high_intent_leads: {
    tone: "danger",
    label: (n) => `${plural(n, "lead nuevo", "leads nuevos")} con señales de alta intención sin contactar`,
    definition: () => "Consultas abiertas sin primer contacto con señales fuertes (volvió a la propiedad, hizo el tour, pidió visita o preguntó disponibilidad). Regla «Contactar hoy».",
  },
  clients_follow_up: {
    tone: "warning",
    label: (n) => `${plural(n, "cliente necesita", "clientes necesitan")} seguimiento`,
    definition: () => "Contactos con una siguiente acción sugerida pendiente o cuyo aplazamiento ya venció (Ventas).",
  },
  new_matches: {
    tone: "info",
    label: (n) => `${plural(n, "propiedad nueva coincide", "propiedades nuevas coinciden")} con compradores activos`,
    definition: () => "Propiedades publicadas en los últimos 7 días con clientes compatibles vigentes (coincidencia estimada, sin descartar) en tu alcance.",
  },
  overdue_followups: {
    tone: "danger",
    label: (n) => `${plural(n, "seguimiento vencido", "seguimientos vencidos")}`,
    definition: (own) => `Tareas abiertas de tipo seguimiento con vencimiento anterior a ahora${own ? ", asignadas a vos" : ""}.`,
  },
  unassigned_visits: {
    tone: "danger",
    label: (n) => `${plural(n, "visita próxima", "visitas próximas")} sin agente activo`,
    definition: () => "Alertas abiertas del centro operativo: visita dentro de las próximas horas cuyo agente está inactivo.",
  },
  open_incidents: {
    tone: "warning",
    label: (n) => `${plural(n, "incidencia abierta", "incidencias abiertas")} en visitas`,
    definition: (own) => `Alertas críticas o de advertencia sin resolver (sin check-in, check-in para revisar, visita sin finalizar o demasiado larga)${own ? " de tus visitas" : ""}.`,
  },
  anomalies: {
    tone: "warning",
    label: (n) => `${plural(n, "anomalía detectada", "anomalías detectadas")}`,
    definition: () => "Situaciones fuera de lo normal detectadas con reglas y umbrales documentados (leads sin contactar más de 24 h, visitas sin seguimiento, caídas de consultas, fallas). Cada una trae su evidencia.",
  },
  low_quality: {
    tone: "info",
    label: (n, own) => `${plural(n, "publicación", "publicaciones")} con calidad baja${own ? " a tu cargo" : ""}`,
    definition: () => "Propiedades publicadas con informe de calidad menor a 55/100 (mismo corte que el filtro «Calidad baja»).",
  },
};

/** Ítems a mostrar: solo conteos mayores a cero, en el orden de BRIEF_KEYS (lo urgente primero). */
export function buildBriefItems(counts: BriefCount[]): BriefItem[] {
  const byKey = new Map(counts.map((c) => [c.key, c]));
  return BRIEF_KEYS.flatMap((key) => {
    const c = byKey.get(key);
    if (!c || !Number.isFinite(c.count) || c.count <= 0) return [];
    const s = SPEC[key];
    return [{ ...c, label: s.label(c.count, c.scope === "own"), definition: s.definition(c.scope === "own"), tone: s.tone }];
  });
}

/** Saludo según la hora de Salta. */
export function greeting(hourSalta: number): string {
  if (hourSalta >= 5 && hourSalta < 12) return "Buen día";
  if (hourSalta >= 12 && hourSalta < 20) return "Buenas tardes";
  return "Buenas noches";
}

const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Salta", hour: "2-digit", hourCycle: "h23" });
export function saltaHour(now: Date): number {
  return Number(hourFmt.format(now)) % 24;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export function factsHash(facts: BriefFacts): string {
  const stable = facts.items.map((i) => `${i.key}:${i.count}:${i.scope}:${i.href}`).join("|");
  return createHash("sha256").update(`${facts.day}|${stable}`).digest("hex").slice(0, 32);
}

/**
 * Verificación de la redacción con IA (además de zod): toda cifra tiene que ser uno de los conteos del resumen, sin
 * links, rutas, emails ni teléfonos. Devuelve las violaciones (vacío = OK). Nada de «≈», porcentajes ni montos.
 */
export function narrativeViolations(texts: string[], items: BriefItem[]): Array<{ kind: string; value: string }> {
  const allowed = new Set(items.map((i) => String(i.count)));
  const out: Array<{ kind: string; value: string }> = [];
  for (const t of texts) {
    for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) if (!allowed.has(m[0])) out.push({ kind: "number", value: m[0] });
    if (/https?:\/\/|www\.|\/crm\b/i.test(t)) out.push({ kind: "link", value: "" });
    if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t)) out.push({ kind: "email", value: "" });
    if (/%|\$|usd|u\$s/i.test(t)) out.push({ kind: "amount", value: "" });
  }
  return out;
}
