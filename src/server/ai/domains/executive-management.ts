/**
 * Dominio Dirección · Executive AI (Fase 5, flag `ai_executive`, permiso `ai.executive`). Herramientas `read` para el
 * modo Analista: cada ítem es un HECHO con cifra, definición, período y origen (link a la pantalla del CRM). La
 * interpretación la agrega el modelo aparte (con clave); sin clave, los chips muestran estos reportes deterministas.
 *
 * Todas: organización del actor, sin datos de ubicación de agentes, sin texto libre de clientes, sin PII.
 */
import { z } from "zod";
import type { Executor } from "../../db";
import { AppError } from "../../errors";
import { isEnabled } from "../../flags";
import type { ToolItem, ToolRegistry, ToolResult } from "../core/registry";
import { saltaToday } from "../management-settings";
import { bottlenecks, firstContactHours, leadFunnel, leadsBySource, opportunityCounts, overdueByAgent, propertyInterest, visitCounts } from "../executive/queries";
import { compareCounts, EXEC_PERIODS, formatComparison, formatHours, formatRate, periodRange, rate, robustMedian, type ExecPeriod, type PeriodRange } from "../executive/metrics";

export const EXECUTIVE_FLAG = "ai_executive";
const PERMISSIONS = ["ai.executive"];
const periodInput = (def: ExecPeriod) => z.object({ period: z.enum(EXEC_PERIODS).default(def) });

async function assertExecutive(db: Executor): Promise<void> {
  // El flag se verifica también en la ejecución: el modelo nunca puede usar una herramienta de un módulo apagado.
  if (!(await isEnabled(db, EXECUTIVE_FLAG))) throw new AppError("forbidden", "Las preguntas de dirección están desactivadas");
}

const day = (d: Date) => saltaToday(d);
const lastDay = (d: Date) => saltaToday(new Date(d.getTime() - 1));
const leadsHref = (r: { from: Date; to: Date }) => `/crm/leads?from=${day(r.from)}&to=${lastDay(r.to)}`;
const periodText = (p: PeriodRange) => `${p.label} · comparado con: ${p.previous.label} · hora de Salta`;

function result(title: string, summary: string, items: ToolItem[], source: ToolResult["source"], period: string | null): ToolResult {
  return { title, summary, items, total: items.length, truncated: false, source, scope: "all", period };
}

export function registerExecutiveManagementTools(registry: ToolRegistry): void {
  // ───────────── ¿Cómo estuvo la semana? ─────────────
  registry.register({
    name: "executive_week_review",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description:
      "Balance de los últimos 7 días contra los 7 anteriores para dirección: leads nuevos, tiempo mediano a primer contacto, visitas realizadas y no show, oportunidades creadas, ganadas y perdidas, y seguimientos vencidos hoy. Cada cifra con su definición. Toda la organización.",
    input: z.object({}),
    quick: { id: "exec_semana", label: "¿Cómo estuvo la semana?", keywords: [/\bcomo (estuvo|fue|nos fue|anduvo)\b.*\bsemana\b/, /\bbalance\b.*\bsemana\b/], flag: EXECUTIVE_FLAG },
    async run({ db, actor, now }) {
      await assertExecutive(db);
      const org = actor.organizationId;
      const p = periodRange("last_7_days", now);
      const [leadsCur, fcCur, fcPrev, vCur, vPrev, oCur, oPrev, overdue] = await Promise.all([
        leadsBySource(db, org, p, p.previous),
        firstContactHours(db, org, p),
        firstContactHours(db, org, p.previous),
        visitCounts(db, org, p),
        visitCounts(db, org, p.previous),
        opportunityCounts(db, org, p),
        opportunityCounts(db, org, p.previous),
        overdueByAgent(db, org),
      ]);
      const leads = compareCounts(leadsCur.reduce((a, r) => a + r.cur, 0), leadsCur.reduce((a, r) => a + r.prev, 0));
      const medCur = robustMedian(fcCur.hours.map((h) => h.hours));
      const medPrev = robustMedian(fcPrev.hours.map((h) => h.hours));
      const overdueFollowUps = overdue.tasks.reduce((a, t) => a + t.follow_ups, 0);
      const items: ToolItem[] = [
        { label: "Leads nuevos", detail: formatComparison(leads), definition: "Consultas creadas en el período (cualquier origen, sin borradas).", href: leadsHref(p) },
        {
          label: "Tiempo mediano a primer contacto",
          detail: `${formatHours(medCur)} (n=${fcCur.hours.length}; período anterior: ${formatHours(medPrev)}, n=${fcPrev.hours.length})`,
          definition: "Mediana de horas entre la consulta y su primer contacto registrado, para leads creados en el período que ya tienen primer contacto. Con menos de 3 casos no se calcula.",
          href: leadsHref(p),
        },
        { label: "Leads del período todavía sin contactar", detail: String(fcCur.uncontacted), definition: "Leads creados en el período, abiertos y sin primer contacto a hoy.", href: `${leadsHref(p)}&unanswered=1` },
        { label: "Visitas realizadas", detail: formatComparison(compareCounts(vCur.completed, vPrev.completed)), definition: "Visitas con inicio en el período y estado finalizada.", href: "/crm/agenda" },
        { label: "Visitas «no se presentó»", detail: formatComparison(compareCounts(vCur.no_show, vPrev.no_show)), definition: "Visitas con inicio en el período marcadas como «no se presentó».", href: "/crm/agenda" },
        { label: "Oportunidades creadas", detail: formatComparison(compareCounts(oCur.created, oPrev.created)), definition: "Oportunidades dadas de alta en el período.", href: "/crm/pipeline" },
        { label: "Oportunidades ganadas", detail: formatComparison(compareCounts(oCur.won, oPrev.won)), definition: "Oportunidades cerradas como ganadas en el período (fecha de cierre).", href: "/crm/pipeline" },
        { label: "Oportunidades perdidas", detail: formatComparison(compareCounts(oCur.lost, oPrev.lost)), definition: "Oportunidades cerradas como perdidas en el período (fecha de cierre).", href: "/crm/pipeline" },
        { label: "Seguimientos vencidos hoy", detail: String(overdueFollowUps), definition: "Foto de ahora (no del período): tareas abiertas de tipo seguimiento con vencimiento pasado, de todo el equipo.", href: "/crm/tareas?status=overdue&kind=follow_up&view=team" },
      ];
      return result("¿Cómo estuvo la semana?", "Últimos 7 días contra los 7 anteriores, toda la organización. Con muestras chicas no se informan variaciones porcentuales.", items, { label: "Tablero y Leads", href: "/crm" }, periodText(p));
    },
  });

  // ───────────── Leads por período y origen ─────────────
  registry.register({
    name: "executive_leads_by_source",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Leads nuevos por origen (web, WhatsApp, portales, etc.) en un período, comparados con el período anterior equivalente. Períodos: last_7_days, this_week, this_month, last_month, last_30_days.",
    input: periodInput("this_month"),
    quick: { id: "exec_leads_mes", label: "Leads del mes", keywords: [/\b(leads?|consultas)\b.*\bmes\b/, /\bmes\b.*\b(leads?|consultas)\b/, /\bleads? por (origen|fuente)\b/], flag: EXECUTIVE_FLAG },
    async run({ db, actor, now }, input) {
      await assertExecutive(db);
      const p = periodRange(input.period, now);
      const rows = await leadsBySource(db, actor.organizationId, p, p.previous);
      const total = compareCounts(rows.reduce((a, r) => a + r.cur, 0), rows.reduce((a, r) => a + r.prev, 0));
      const items: ToolItem[] = [
        { label: "Total de leads nuevos", detail: formatComparison(total), definition: "Consultas creadas en el período, cualquier origen, sin borradas.", href: leadsHref(p) },
        ...rows.map((r) => ({ label: `Origen: ${r.source}`, detail: formatComparison(compareCounts(r.cur, r.prev)), definition: "Consultas creadas en el período con ese origen.", href: leadsHref(p) })),
      ];
      return result("Leads por origen", total.current || total.previous ? `${p.label}. Comparación con ${p.previous.label.toLowerCase()}.` : `${p.label}: no hubo leads en ninguno de los dos períodos.`, items, { label: "Leads", href: leadsHref(p) }, periodText(p));
    },
  });

  // ───────────── Tiempo a primer contacto ─────────────
  registry.register({
    name: "executive_first_contact",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Tiempo a primer contacto de los leads de un período: mediana general y por agente (solo con 3 casos o más), leads sin contactar y sin contactar hace más de 24 h.",
    input: periodInput("last_30_days"),
    quick: { id: "exec_primer_contacto", label: "Tiempo a primer contacto", keywords: [/\btiempo (a|al|de|hasta el) primer contacto\b/, /\bcuanto (tardamos|tardan)\b.*\b(contact|respond)/], flag: EXECUTIVE_FLAG, chip: false },
    async run({ db, actor, now }, input) {
      await assertExecutive(db);
      const p = periodRange(input.period, now);
      const [cur, prev] = await Promise.all([firstContactHours(db, actor.organizationId, p), firstContactHours(db, actor.organizationId, p.previous)]);
      const byAgent = new Map<string, number[]>();
      for (const h of cur.hours) if (h.agent) byAgent.set(h.agent, [...(byAgent.get(h.agent) ?? []), h.hours]);
      const items: ToolItem[] = [
        { label: "Mediana a primer contacto", detail: `${formatHours(robustMedian(cur.hours.map((h) => h.hours)))} (n=${cur.hours.length}; período anterior: ${formatHours(robustMedian(prev.hours.map((h) => h.hours)))}, n=${prev.hours.length})`, definition: "Horas entre la consulta y el primer contacto registrado, leads creados en el período con primer contacto. Menos de 3 casos: sin cálculo.", href: leadsHref(p) },
        { label: "Leads creados", detail: String(cur.created), definition: "Consultas creadas en el período.", href: leadsHref(p) },
        { label: "Sin primer contacto", detail: String(cur.uncontacted), definition: "Leads del período abiertos y sin primer contacto a hoy.", href: `${leadsHref(p)}&unanswered=1` },
        { label: "Sin primer contacto hace más de 24 h", detail: String(cur.over24), definition: "De los anteriores, los creados hace más de 24 horas.", href: `${leadsHref(p)}&unanswered=1` },
        ...[...byAgent.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 12)
          .map(([agent, hs]) => ({ label: `Agente: ${agent}`, detail: `${formatHours(robustMedian(hs))} (n=${hs.length})`, definition: "Mediana del agente asignado; con menos de 3 casos no se calcula." })),
      ];
      return result("Tiempo a primer contacto", p.label, items, { label: "Leads", href: leadsHref(p) }, periodText(p));
    },
  });

  // ───────────── Visitas ─────────────
  registry.register({
    name: "executive_visits",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Visitas de un período: programadas (sin canceladas), finalizadas, no show, canceladas y finalizadas sin informe confirmado, comparadas con el período anterior.",
    input: periodInput("last_7_days"),
    quick: { id: "exec_visitas", label: "Visitas del período", keywords: [/\bvisitas\b.*\b(no show|no se presento|realizadas|finalizadas|canceladas)\b/], flag: EXECUTIVE_FLAG, chip: false },
    async run({ db, actor, now }, input) {
      await assertExecutive(db);
      const p = periodRange(input.period, now);
      const [cur, prev] = await Promise.all([visitCounts(db, actor.organizationId, p), visitCounts(db, actor.organizationId, p.previous)]);
      const def = (what: string) => `Visitas con inicio en el período ${what}.`;
      const items: ToolItem[] = [
        { label: "Programadas", detail: formatComparison(compareCounts(cur.scheduled, prev.scheduled)), definition: def("(todas salvo canceladas)"), href: "/crm/agenda" },
        { label: "Finalizadas", detail: formatComparison(compareCounts(cur.completed, prev.completed)), definition: def("en estado finalizada"), href: "/crm/agenda" },
        { label: "No se presentó", detail: formatComparison(compareCounts(cur.no_show, prev.no_show)), definition: def("marcadas «no se presentó»"), href: "/crm/agenda" },
        { label: "Canceladas", detail: formatComparison(compareCounts(cur.cancelled, prev.cancelled)), definition: def("canceladas"), href: "/crm/agenda" },
        { label: "Finalizadas sin informe confirmado", detail: String(cur.without_report), definition: def("finalizadas cuyo informe no está confirmado a hoy"), href: "/crm/centro-operativo" },
        { label: "Tasa de no show", detail: formatRate(rate(cur.no_show, cur.completed + cur.no_show)), definition: "No se presentó ÷ (finalizadas + no se presentó). Con menos de 5 visitas no se calcula." },
      ];
      return result("Visitas", p.label, items, { label: "Agenda", href: "/crm/agenda" }, periodText(p));
    },
  });

  // ───────────── Conversión lead → visita → oportunidad ─────────────
  registry.register({
    name: "executive_funnel",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Conversión de la cohorte de leads de un período (sin tasaciones ni captación): cuántos tuvieron visita agendada y cuántos oportunidad, a la fecha de hoy. Porcentajes solo con 5 casos o más.",
    input: periodInput("last_30_days"),
    quick: { id: "exec_conversion", label: "Conversión de leads", keywords: [/\bconversion\b/, /\bembudo\b/, /\blead\b.*\bvisita\b.*\boportunidad\b/], flag: EXECUTIVE_FLAG, chip: false },
    async run({ db, actor, now }, input) {
      await assertExecutive(db);
      const p = periodRange(input.period, now);
      const f = await leadFunnel(db, actor.organizationId, p);
      const items: ToolItem[] = [
        { label: "Leads de la cohorte", detail: String(f.leads), definition: "Consultas creadas en el período, sin tasaciones ni captación de propietarios.", href: leadsHref(p) },
        { label: "Lead → visita", detail: formatRate(rate(f.with_visit, f.leads)), definition: "Leads cuyo contacto tiene una visita (no cancelada) agendada después de la consulta, a hoy." },
        { label: "Lead → oportunidad", detail: formatRate(rate(f.with_opportunity, f.leads)), definition: "Leads con una oportunidad creada desde la consulta (del lead o del mismo contacto), a hoy.", href: "/crm/pipeline" },
        { label: "Visita → oportunidad", detail: formatRate(rate(f.visit_and_opportunity, f.with_visit)), definition: "De los leads con visita, cuántos tienen oportunidad." },
      ];
      return result("Conversión lead → visita → oportunidad", `${p.label}. Es una cohorte: los leads recientes pueden convertir más adelante.`, items, { label: "Leads y Pipeline", href: "/crm/pipeline" }, `${p.label} · hora de Salta`);
    },
  });

  // ───────────── Propiedades con más interés ─────────────
  registry.register({
    name: "executive_property_interest",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Propiedades con más interés en un período: consultas (leads), sesiones que vieron la ficha y sesiones que abrieron el tour 360° (analítica first-party sin datos personales). Top 10.",
    input: periodInput("last_30_days"),
    quick: { id: "exec_interes_propiedades", label: "Propiedades con más interés", keywords: [/\bpropiedades?\b.*\b(mas interes|mas vistas|mas consultadas|mas buscadas)\b/, /\bque propiedades\b.*\binteres/], flag: EXECUTIVE_FLAG, chip: false },
    async run({ db, actor, now }, input) {
      await assertExecutive(db);
      const p = periodRange(input.period, now);
      const rows = await propertyInterest(db, actor.organizationId, p);
      const items: ToolItem[] = rows.map((r) => ({
        label: `#${r.code} · ${r.title}`,
        detail: `${r.inquiries} ${r.inquiries === 1 ? "consulta" : "consultas"} · ${r.views} ${r.views === 1 ? "sesión vio la ficha" : "sesiones vieron la ficha"} · ${r.tours} ${r.tours === 1 ? "sesión abrió el tour" : "sesiones abrieron el tour"}`,
        definition: "Consultas = leads creados en el período para la propiedad. Vistas y tours = sesiones distintas del sitio (sin cookies ni datos personales; no cuenta a quien pide Do Not Track).",
        href: `/crm/propiedades/${r.id}`,
      }));
      return result("Propiedades con más interés", rows.length ? `${p.label}, ordenadas por consultas y después por vistas.` : `${p.label}: sin consultas, vistas ni tours registrados.`, items, { label: "Propiedades", href: "/crm/propiedades" }, `${p.label} · hora de Salta`);
    },
  });

  // ───────────── Seguimientos atrasados por agente ─────────────
  registry.register({
    name: "executive_overdue_by_agent",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Foto de ahora: tareas vencidas por agente (cuántas son seguimientos y la más vieja) y visitas finalizadas sin seguimiento en los últimos 14 días, por agente.",
    input: z.object({}),
    quick: { id: "exec_seguimientos", label: "Seguimientos atrasados", keywords: [/\bseguimientos? (atrasados|vencidos|pendientes)\b/, /\b(atrasad|vencid)\w*\b.*\bagentes?\b/], flag: EXECUTIVE_FLAG },
    async run({ db, actor, now }) {
      await assertExecutive(db);
      const r = await overdueByAgent(db, actor.organizationId);
      const days = (d: Date) => Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000));
      const items: ToolItem[] = [
        ...r.tasks.map((t) => ({
          label: `Agente: ${t.agent}`,
          detail: `${t.total} ${t.total === 1 ? "tarea vencida" : "tareas vencidas"} (${t.follow_ups} de seguimiento) · la más vieja venció hace ${days(t.oldest)} ${days(t.oldest) === 1 ? "día" : "días"}`,
          definition: "Tareas abiertas asignadas al agente con vencimiento anterior a ahora.",
          href: `/crm/tareas?status=overdue&view=team&assignee=${t.id}`,
        })),
        ...r.visits.map((v) => ({ label: `Visitas sin seguimiento: ${v.agent}`, detail: String(v.n), definition: "Visitas finalizadas en los últimos 14 días (hace más de 24 h) sin tarea de seguimiento.", href: "/crm/centro-operativo" })),
        ...(r.unassigned ? [{ label: "Tareas vencidas sin asignar", detail: String(r.unassigned), definition: "Tareas abiertas vencidas sin responsable.", href: "/crm/tareas?status=overdue&view=team&assignee=none" }] : []),
      ];
      return result("Seguimientos atrasados por agente", items.length ? "Foto de este momento, toda la organización." : "No hay tareas vencidas ni visitas sin seguimiento.", items, { label: "Tareas", href: "/crm/tareas?status=overdue&view=team" }, "Foto de ahora (no es un período)");
    },
  });

  // ───────────── Cuellos de botella ─────────────
  registry.register({
    name: "executive_bottlenecks",
    domain: "executive",
    capability: "read",
    permissions: PERMISSIONS,
    description: "Cuellos de botella de hoy: etapas del pipeline donde las oportunidades abiertas llevan más tiempo (mediana solo con 3 o más), visitas finalizadas sin informe, leads sin contactar hace más de 24 h y sugerencias pendientes hace más de 3 días.",
    input: z.object({}),
    quick: { id: "exec_cuellos", label: "Cuellos de botella", keywords: [/\bcuellos? de botella\b/, /\bdonde (se traba|se frena|estamos trabados)\b/, /\betapas?\b.*\b(trabad|demora|mas tiempo)\b/], flag: EXECUTIVE_FLAG },
    async run({ db, actor, now }) {
      await assertExecutive(db);
      const b = await bottlenecks(db, actor.organizationId);
      const d1 = (n: number) => `${Math.round(n * 10) / 10}`.replace(".", ",");
      const items: ToolItem[] = [
        ...b.stages.map((s) => ({
          label: `Etapa «${s.stage}»`,
          detail: s.n >= 3 ? `${s.n} oportunidades abiertas · mediana ${d1(s.median_days)} días en la etapa · máximo ${d1(s.max_days)}` : `${s.n} ${s.n === 1 ? "oportunidad abierta" : "oportunidades abiertas"} · máximo ${d1(s.max_days)} días (muestra chica: sin mediana)`,
          definition: "Días desde que cada oportunidad abierta entró a su etapa actual. Ordenadas por mediana.",
          href: "/crm/pipeline",
        })),
        { label: "Visitas finalizadas sin informe confirmado (30 días)", detail: String(b.visitsWithoutReport.n) + (b.visitsWithoutReport.oldest ? ` · la más vieja hace ${Math.floor((now.getTime() - new Date(b.visitsWithoutReport.oldest).getTime()) / 86_400_000)} días` : ""), definition: "Visitas finalizadas en los últimos 30 días cuyo informe no está confirmado.", href: "/crm/centro-operativo" },
        { label: "Leads sin primer contacto hace más de 24 h", detail: String(b.leadsUncontacted24h), definition: "Leads abiertos sin primer contacto creados hace más de 24 horas.", href: "/crm/leads?unanswered=1" },
        { label: "Tareas sugeridas pendientes hace más de 3 días", detail: String(b.staleSuggestions), definition: "Sugerencias abiertas (sin aceptar, descartar ni posponer) creadas hace más de 3 días.", href: "/crm/tareas-sugeridas?vista=equipo" },
      ];
      return result("Cuellos de botella", "Foto de este momento. Muestra dónde se acumula tiempo; no indica la causa.", items, { label: "Pipeline", href: "/crm/pipeline" }, `Foto de ahora (${saltaToday(now)})`);
    },
  });
}
