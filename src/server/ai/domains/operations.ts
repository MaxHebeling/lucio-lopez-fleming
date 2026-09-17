/**
 * Dominio Operaciones: visitas, agenda y tareas (solo lectura).
 * Visitas: con el núcleo operativo encendido (flag `visits_operations`) y permisos `visits.*` se REUTILIZAN sus consultas
 * y su alcance (`src/server/visits`): estados en camino / check-in / en curso, verificación del check-in e incidencias.
 * Sin ese módulo (flag apagado o rol solo con agenda) se usa la Agenda con su alcance propio/equipo.
 */
import { z } from "zod";
import { sql } from "../../db";
import { isEnabled } from "../../flags";
import { agendaScope, taskScope } from "../../crm/access";
import { localDate } from "../../crm/time";
import { PRIORITY_LABEL } from "../../../components/crm/labels";
import { formatDateTime } from "../../../components/ui/format";
import { tryVisitScope } from "../../visits/access";
import { getOpsBoard, listMyVisits } from "../../visits/queries";
import { ALERT_LABEL, ALERT_SEVERITY, type AlertKind } from "../../visits/rules";
import { VISIT_PHASE_LABEL, visitPhase } from "../../visits/state";
import type { ToolRegistry, ToolResult } from "../core/registry";
import { hhmm, MAX_ITEMS, plural, saltaDayStart, scopeLabel, scopeOf } from "./shared";

export const VISITS_FLAG = "visits_operations";

const CHECKIN_LABEL: Record<string, string> = { verified: "check-in verificado", needs_review: "check-in para revisar", no_location: "llegada sin ubicación" };
const SEVERITY_LABEL: Record<string, string> = { critical: "Crítica", warning: "Advertencia", info: "Info" };

export function registerOperationsTools(registry: ToolRegistry): void {
  registry.register({
    name: "visits_today",
    domain: "operations",
    capability: "read",
    permissions: ["visits.operate", "visits.monitor", "agenda.manage", "agenda.read_all"],
    description:
      "Visitas a propiedades de hoy con horario, propiedad, agente, etapa (programada, en camino, check-in, en curso, finalizada, no se presentó) y resultado del check-in. Aplica el alcance del usuario: sus visitas o las del equipo.",
    input: z.object({}),
    quick: { id: "visitas_hoy", label: "Visitas de hoy", keywords: [/\bvisitas?\b.*\bhoy\b/, /\bhoy\b.*\bvisitas?\b/, /\bagenda de hoy\b/] },
    async run({ db, actor, now }): Promise<ToolResult> {
      const visitScope = (await isEnabled(db, VISITS_FLAG)) ? tryVisitScope(actor) : null;
      if (visitScope) {
        // Núcleo operativo: misma consulta y alcance que «Mis visitas» (Hoy; equipo si ve todas).
        const { rows } = await listMyVisits(db, actor, { view: "hoy", team: visitScope.all, now });
        const shown = rows.slice(0, MAX_ITEMS);
        const who = visitScope.all ? "del equipo" : "tuyas";
        return {
          title: "Visitas de hoy",
          summary: rows.length ? `${plural(rows.length, "visita", "visitas")} ${who} hoy.` : `No hay visitas ${who} para hoy.`,
          items: shown.map((r) => ({
            label: `${hhmm(r.starts_at)} · ${r.title}`,
            detail:
              [`Propiedad #${r.property_code}`, visitScope.all ? `Agente: ${r.agent_name}` : null, r.last_checkin ? (CHECKIN_LABEL[r.last_checkin.status] ?? null) : null].filter(Boolean).join(" · ") || null,
            badge: VISIT_PHASE_LABEL[visitPhase(r.status)],
            href: `/crm/mis-visitas/${r.id}`,
          })),
          total: rows.length,
          truncated: rows.length > shown.length,
          source: { label: "Mis visitas", href: "/crm/mis-visitas" },
          scope: visitScope.all ? "all" : "own",
        };
      }
      const scope = scopeOf(actor, agendaScope);
      if (!scope) {
        return { title: "Visitas de hoy", summary: "Tu rol no tiene acceso a la agenda de visitas.", items: [], total: 0, truncated: false, source: { label: "Agenda", href: null }, scope: null };
      }
      let q = db
        .selectFrom("appointments as a")
        .innerJoin("users as u", "u.id", "a.assigned_user_id")
        .leftJoin("properties as p", "p.id", "a.property_id")
        .where("u.organization_id", "=", actor.organizationId)
        .where("a.kind", "=", "visit")
        .where("a.status", "!=", "cancelled")
        .where("a.starts_at", ">=", saltaDayStart(0))
        .where("a.starts_at", "<", saltaDayStart(1));
      if (!scope.all) q = q.where((eb) => eb.or([eb("a.assigned_user_id", "=", actor.userId), eb("a.created_by", "=", actor.userId)]));
      const rows = await q
        .select(["a.id", "a.title", "a.starts_at", "a.status", "u.full_name as agent", "p.code as property_code"])
        .select(sql<number>`(count(*) over())::int`.as("total"))
        .orderBy("a.starts_at")
        .limit(MAX_ITEMS)
        .execute();
      const total = rows[0]?.total ?? 0;
      const who = scope.all ? "del equipo" : "tuyas";
      return {
        title: "Visitas de hoy",
        summary: total ? `${plural(total, "visita", "visitas")} ${who} hoy.` : `No hay visitas ${who} agendadas para hoy.`,
        items: rows.map((r) => ({
          label: `${hhmm(r.starts_at)} · ${r.title}`,
          detail: [r.property_code ? `Propiedad #${r.property_code}` : null, scope.all ? `Agente: ${r.agent}` : null].filter(Boolean).join(" · ") || null,
          badge: VISIT_PHASE_LABEL[visitPhase(r.status)],
          href: `/crm/agenda/${r.id}`,
        })),
        total,
        truncated: total > rows.length,
        source: { label: "Agenda", href: "/crm/agenda" },
        scope: scopeLabel(scope),
      };
    },
  });

  registry.register({
    name: "visit_incidents",
    domain: "operations",
    capability: "read",
    permissions: ["visits.monitor"],
    description:
      "Incidencias abiertas de visitas del centro operativo (sin check-in, check-in para revisar, visita pasada sin finalizar, en curso demasiado larga, sin informe o sin seguimiento, visita próxima sin agente activo) con severidad, agente y propiedad.",
    input: z.object({}),
    quick: { id: "incidencias_visitas", label: "Incidencias de visitas", flag: VISITS_FLAG, keywords: [/\b(incidencias?|alertas?|problemas?)\b.*\bvisitas?\b/, /\bvisitas?\b.*\b(incidencias?|alertas?|problemas?|sin check ?in)\b/, /\bcentro operativo\b/] },
    async run({ db, actor, now }): Promise<ToolResult> {
      if (!(await isEnabled(db, VISITS_FLAG))) {
        return { title: "Incidencias de visitas", summary: "El núcleo operativo de visitas está apagado (flag visits_operations).", items: [], total: 0, truncated: false, source: { label: "Integraciones", href: "/crm/integraciones" }, scope: null };
      }
      const { rows, openAlerts } = await getOpsBoard(db, actor, { date: localDate(now) });
      const bySeverity = { critical: 0, warning: 0, info: 0 } as Record<string, number>;
      for (const a of openAlerts) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
      const active = rows.filter((r) => ["en_route", "checked_in", "in_progress"].includes(r.status)).length;
      const shown = openAlerts.slice(0, MAX_ITEMS);
      return {
        title: "Incidencias de visitas",
        summary: openAlerts.length
          ? `${plural(openAlerts.length, "incidencia abierta", "incidencias abiertas")} (${bySeverity.critical} críticas, ${bySeverity.warning} advertencias, ${bySeverity.info} info). Hoy: ${plural(rows.length, "visita", "visitas")}, ${active} en curso o en camino.`
          : `No hay incidencias abiertas. Hoy: ${plural(rows.length, "visita", "visitas")}, ${active} en curso o en camino.`,
        items: shown.map((a) => ({
          label: `${ALERT_LABEL[a.kind as AlertKind] ?? a.kind} · Propiedad #${a.property_code}`,
          detail: `${a.agent_name} · ${formatDateTime(a.starts_at)} · ${VISIT_PHASE_LABEL[visitPhase(a.status)]}`,
          badge: SEVERITY_LABEL[a.severity] ?? SEVERITY_LABEL[ALERT_SEVERITY[a.kind as AlertKind]] ?? a.severity,
          href: `/crm/mis-visitas/${a.appointment_id}`,
        })),
        total: openAlerts.length,
        truncated: openAlerts.length > shown.length,
        source: { label: "Centro operativo", href: "/crm/centro-operativo" },
        scope: "all",
      };
    },
  });

  registry.register({
    name: "overdue_tasks",
    domain: "operations",
    capability: "read",
    permissions: ["tasks.manage", "tasks.read_all"],
    description: "Tareas pendientes con vencimiento pasado. Con alcance propio: las asignadas al usuario (o creadas por él sin responsable); con tasks.read_all: las del equipo.",
    input: z.object({}),
    quick: { id: "tareas_vencidas", label: "Tareas vencidas", keywords: [/\btareas?\b.*\b(vencid|atrasad|pendient)/, /\b(vencid|atrasad)\w*\b.*\btareas?\b/] },
    async run({ db, actor }) {
      const scope = scopeOf(actor, taskScope)!;
      let q = db
        .selectFrom("tasks as t")
        .leftJoin("users as u", "u.id", "t.assigned_user_id")
        .leftJoin("users as cu", "cu.id", "t.created_by")
        .where("t.status", "=", "open")
        .where("t.due_at", "<", sql<Date>`now()`)
        // Las tareas no tienen organization_id: se atribuyen por su responsable o su autor.
        .where((eb) => eb.or([eb("u.organization_id", "=", actor.organizationId), eb.and([eb("t.assigned_user_id", "is", null), eb("cu.organization_id", "=", actor.organizationId)]), eb.and([eb("t.assigned_user_id", "is", null), eb("t.created_by", "is", null)])]));
      if (!scope.all) q = q.where((eb) => eb.or([eb("t.assigned_user_id", "=", actor.userId), eb.and([eb("t.assigned_user_id", "is", null), eb("t.created_by", "=", actor.userId)])]));
      const rows = await q
        .select(["t.id", "t.title", "t.due_at", "t.priority", "u.full_name as assignee"])
        .select(sql<number>`(count(*) over())::int`.as("total"))
        .orderBy("t.due_at")
        .limit(MAX_ITEMS)
        .execute();
      const total = rows[0]?.total ?? 0;
      return {
        title: "Tareas vencidas",
        summary: total ? `${plural(total, "tarea vencida", "tareas vencidas")}${scope.all ? " en el equipo" : " tuyas"}.` : `No hay tareas vencidas${scope.all ? " en el equipo" : " tuyas"}.`,
        items: rows.map((r) => ({
          label: r.title,
          detail: [`Venció ${formatDateTime(r.due_at)}`, scope.all ? `Responsable: ${r.assignee ?? "sin asignar"}` : null].filter(Boolean).join(" · "),
          badge: PRIORITY_LABEL[r.priority] ?? r.priority,
          href: "/crm/tareas?status=overdue",
        })),
        total,
        truncated: total > rows.length,
        source: { label: "Tareas", href: "/crm/tareas" },
        scope: scopeLabel(scope),
      };
    },
  });
}
