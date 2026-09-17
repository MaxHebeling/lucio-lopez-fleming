/**
 * Siguiente acción recomendada (Next Best Action): motor de reglas PURO, explicable y testeable.
 * La IA recomienda; la persona decide: aceptar crea una tarea real, descartar o posponer queda registrado.
 * Cada recomendación trae prioridad, motivo, evidencia (hechos, sin datos personales) y una huella de la evidencia:
 * si la situación cambia, puede volver a proponerse aunque antes se haya descartado.
 */
import { createHash } from "node:crypto";
import type { IntentLevel, IntentSignal } from "../signals/rules";

export type NbaFacts = {
  now: Date;
  lead: { id: string; status: string; createdAt: Date; firstResponseAt: Date | null; propertyCode: number | null } | null;
  opportunity: { id: string; status: string; stageName: string; stageEnteredAt: Date } | null;
  visitRequest: { at: Date; propertyCode: number | null } | null;
  upcomingVisit: { at: Date } | null;
  lastCompletedVisit: { id: string; at: Date; hasFollowUp: boolean } | null;
  signals: { level: IntentLevel | null; signals: IntentSignal[] };
  profile: { budget: "confirmed" | "suggested" | "missing"; pendingSuggestionIds: string[]; matchable: boolean };
  dismissedForPrice: number[];
  /** Compatibles publicadas en los últimos 14 días, no descartadas (ids y códigos). */
  newCompatible: Array<{ propertyId: string; code: number }>;
  lastActivityAt: Date | null;
};

export type RecommendationRule = "contact_today" | "first_response" | "schedule_visit" | "visit_followup" | "send_new_options" | "confirm_budget" | "review_profile" | "reactivate";
export type Priority = "high" | "medium" | "low";

export type Recommendation = {
  ruleKey: RecommendationRule;
  priority: Priority;
  title: string;
  reason: string;
  evidence: string[];
  fingerprint: string;
  task: { kind: "call" | "whatsapp" | "follow_up" | "task" | "meeting"; title: string; dueInHours: number; priority: "urgent" | "high" | "normal" | "low" };
};

export const PRIORITY_LABEL: Record<Priority, string> = { high: "Alta", medium: "Media", low: "Baja" };
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const OPEN_LEAD = new Set(["new", "contacted", "qualified"]);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function fingerprint(parts: Array<string | number | null>): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32);
}

const hoursAgo = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / HOUR);

export function recommendNextActions(f: NbaFacts, max = 3): Recommendation[] {
  const out: Recommendation[] = [];
  const openLead = f.lead && OPEN_LEAD.has(f.lead.status) ? f.lead : null;
  const strong = f.signals.signals.filter((s) => s.key === "returned_to_property" || s.key === "virtual_tour" || s.key === "visit_requested" || s.key === "asked_availability");

  // 1 · Contactar hoy: consulta sin responder + señales fuertes de interés
  if (openLead && !openLead.firstResponseAt && strong.length) {
    const what = strong.map((s) => (s.label.charAt(0).toLowerCase() + s.label.slice(1)).replace(/^solicitó visitar/, "pidió visitar"));
    out.push({
      ruleKey: "contact_today",
      priority: "high",
      title: "Contactar hoy",
      reason: `Solicitó información y ${what.slice(0, 2).join(" y ")}.`,
      evidence: [`Consulta sin primer contacto hace ${hoursAgo(openLead.createdAt, f.now)} h`, ...strong.map((s) => s.label)],
      fingerprint: fingerprint(["contact_today", openLead.id]),
      task: { kind: "call", title: "Llamar hoy: consulta con señales de interés", dueInHours: 4, priority: "urgent" },
    });
  } else if (openLead && !openLead.firstResponseAt) {
    // 2 · Responder la consulta
    const h = hoursAgo(openLead.createdAt, f.now);
    out.push({
      ruleKey: "first_response",
      priority: h >= 2 ? "high" : "medium",
      title: "Responder la consulta",
      reason: h >= 1 ? `La consulta espera primer contacto hace ${h} h.` : "Llegó una consulta nueva: responder rápido aumenta las chances.",
      evidence: [`Lead ${openLead.status === "new" ? "nuevo" : "abierto"} sin primer contacto`, ...(openLead.propertyCode ? [`Consultó por la propiedad #${openLead.propertyCode}`] : [])],
      fingerprint: fingerprint(["first_response", openLead.id]),
      task: { kind: "whatsapp", title: "Responder la consulta", dueInHours: 2, priority: "high" },
    });
  }

  // 3 · Coordinar visita
  if (f.visitRequest && !f.upcomingVisit && f.now.getTime() - f.visitRequest.at.getTime() < 30 * DAY) {
    out.push({
      ruleKey: "schedule_visit",
      priority: "high",
      title: "Coordinar visita",
      reason: f.visitRequest.propertyCode ? `Pidió visitar la propiedad #${f.visitRequest.propertyCode} y no hay una visita agendada.` : "Pidió una visita y no hay una agendada.",
      evidence: ["Pedido de visita desde el sitio", "Sin visitas próximas en la agenda"],
      fingerprint: fingerprint(["schedule_visit", f.visitRequest.at.toISOString()]),
      task: { kind: "call", title: f.visitRequest.propertyCode ? `Coordinar visita a la propiedad #${f.visitRequest.propertyCode}` : "Coordinar visita", dueInHours: 24, priority: "high" },
    });
  }

  // 4 · Seguimiento de la visita
  if (f.lastCompletedVisit && !f.lastCompletedVisit.hasFollowUp && f.now.getTime() - f.lastCompletedVisit.at.getTime() < 7 * DAY) {
    out.push({
      ruleKey: "visit_followup",
      priority: "medium",
      title: "Hacer el seguimiento de la visita",
      reason: "Visitó una propiedad en los últimos días y no hay un seguimiento registrado.",
      evidence: ["Visita realizada", "Sin tarea de seguimiento"],
      fingerprint: fingerprint(["visit_followup", f.lastCompletedVisit.id]),
      task: { kind: "follow_up", title: "Seguimiento después de la visita", dueInHours: 24, priority: "normal" },
    });
  }

  // 5 · Enviar nuevas opciones
  if (f.newCompatible.length) {
    const codes = f.newCompatible.slice(0, 5).map((p) => `#${p.code}`);
    out.push({
      ruleKey: "send_new_options",
      priority: "medium",
      title: "Enviar nuevas opciones",
      reason: f.dismissedForPrice.length
        ? `Descartó por presupuesto; hay ${f.newCompatible.length === 1 ? "una propiedad compatible nueva" : `${f.newCompatible.length} propiedades compatibles nuevas`} (${codes.join(", ")}).`
        : `${f.newCompatible.length === 1 ? "Se publicó una propiedad compatible" : `Se publicaron ${f.newCompatible.length} propiedades compatibles`} en los últimos 14 días (${codes.join(", ")}).`,
      evidence: [...(f.dismissedForPrice.length ? [`Descartó por presupuesto: ${f.dismissedForPrice.map((c) => `#${c}`).join(", ")}`] : []), "Coincidencia estimada según su perfil"],
      fingerprint: fingerprint(["send_new_options", ...f.newCompatible.map((p) => p.propertyId).sort()]),
      task: { kind: "whatsapp", title: `Enviar opciones compatibles (${codes.join(", ")})`, dueInHours: 48, priority: "normal" },
    });
  }

  // 6 · Pedir confirmación de presupuesto
  if (f.profile.budget !== "confirmed" && (openLead || f.opportunity?.status === "open")) {
    out.push({
      ruleKey: "confirm_budget",
      priority: f.profile.budget === "missing" ? "medium" : "low",
      title: "Pedir confirmación de presupuesto",
      reason: f.profile.budget === "missing" ? "El perfil no tiene presupuesto: sin ese dato no se pueden cruzar propiedades." : "El presupuesto es un dato sugerido: confirmalo con el cliente.",
      evidence: [f.profile.budget === "missing" ? "Presupuesto sin cargar" : "Presupuesto sugerido, sin confirmar"],
      fingerprint: fingerprint(["confirm_budget", f.profile.budget]),
      task: { kind: "call", title: "Confirmar presupuesto y moneda", dueInHours: 48, priority: "normal" },
    });
  }

  // 7 · Revisar datos sugeridos del perfil
  if (f.profile.pendingSuggestionIds.length) {
    const n = f.profile.pendingSuggestionIds.length;
    out.push({
      ruleKey: "review_profile",
      priority: "low",
      title: "Revisar datos sugeridos del perfil",
      reason: `${n === 1 ? "Hay un dato sugerido" : `Hay ${n} datos sugeridos`} (sitio o consulta) pendiente${n === 1 ? "" : "s"} de confirmar.`,
      evidence: [`${n} sugerencia${n === 1 ? "" : "s"} sin confirmar`],
      fingerprint: fingerprint(["review_profile", ...[...f.profile.pendingSuggestionIds].sort()]),
      task: { kind: "task", title: "Revisar y confirmar el perfil del cliente", dueInHours: 72, priority: "low" },
    });
  }

  // 8 · Retomar el contacto
  if (f.opportunity?.status === "open") {
    const idle = f.lastActivityAt ? f.now.getTime() - f.lastActivityAt.getTime() : Number.POSITIVE_INFINITY;
    const stageDays = Math.floor((f.now.getTime() - f.opportunity.stageEnteredAt.getTime()) / DAY);
    if (stageDays >= 14 && idle >= 14 * DAY) {
      out.push({
        ruleKey: "reactivate",
        priority: "low",
        title: "Retomar el contacto",
        reason: `La oportunidad está en «${f.opportunity.stageName}» hace ${stageDays} días sin actividad reciente.`,
        evidence: [`${stageDays} días en la etapa`, f.lastActivityAt ? "Sin actividad en 14 días o más" : "Sin actividad registrada"],
        fingerprint: fingerprint(["reactivate", f.opportunity.id, f.opportunity.stageEnteredAt.toISOString()]),
        task: { kind: "call", title: "Retomar el contacto con el cliente", dueInHours: 48, priority: "normal" },
      });
    }
  }

  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice(0, max);
}
