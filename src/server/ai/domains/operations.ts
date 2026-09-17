/** Dominio Operaciones: agenda y tareas (solo lectura, alcance propio/equipo como en las pantallas del CRM). */
import { z } from "zod";
import { sql } from "../../db";
import { agendaScope, taskScope } from "../../crm/access";
import { APPOINTMENT_STATUS_LABEL, PRIORITY_LABEL } from "../../../components/crm/labels";
import { formatDateTime } from "../../../components/ui/format";
import type { ToolRegistry } from "../core/registry";
import { hhmm, MAX_ITEMS, plural, saltaDayStart, scopeLabel, scopeOf } from "./shared";

export function registerOperationsTools(registry: ToolRegistry): void {
  registry.register({
    name: "visits_today",
    domain: "operations",
    capability: "read",
    permissions: ["agenda.manage", "agenda.read_all"],
    description: "Visitas a propiedades de hoy (o de mañana) en la agenda, con horario, propiedad, agente y estado. Aplica el alcance del usuario: sus visitas o las del equipo.",
    input: z.object({ day: z.enum(["today", "tomorrow"]).default("today") }),
    quick: { id: "visitas_hoy", label: "Visitas de hoy", keywords: [/\bvisitas?\b.*\bhoy\b/, /\bhoy\b.*\bvisitas?\b/, /\bagenda de hoy\b/] },
    async run({ db, actor }, input) {
      const scope = scopeOf(actor, agendaScope)!;
      const offset = input.day === "tomorrow" ? 1 : 0;
      let q = db
        .selectFrom("appointments as a")
        .innerJoin("users as u", "u.id", "a.assigned_user_id")
        .leftJoin("properties as p", "p.id", "a.property_id")
        .where("u.organization_id", "=", actor.organizationId)
        .where("a.kind", "=", "visit")
        .where("a.status", "!=", "cancelled")
        .where("a.starts_at", ">=", saltaDayStart(offset))
        .where("a.starts_at", "<", saltaDayStart(offset + 1));
      if (!scope.all) q = q.where((eb) => eb.or([eb("a.assigned_user_id", "=", actor.userId), eb("a.created_by", "=", actor.userId)]));
      const rows = await q
        .select(["a.id", "a.title", "a.starts_at", "a.status", "u.full_name as agent", "p.code as property_code"])
        .select(sql<number>`(count(*) over())::int`.as("total"))
        .orderBy("a.starts_at")
        .limit(MAX_ITEMS)
        .execute();
      const total = rows[0]?.total ?? 0;
      const when = input.day === "tomorrow" ? "mañana" : "hoy";
      const who = scope.all ? "del equipo" : "tuyas";
      return {
        title: input.day === "tomorrow" ? "Visitas de mañana" : "Visitas de hoy",
        summary: total ? `${plural(total, "visita", "visitas")} ${who} ${when}.` : `No hay visitas ${who} agendadas para ${when}.`,
        items: rows.map((r) => ({
          label: `${hhmm(r.starts_at)} · ${r.title}`,
          detail: [r.property_code ? `Propiedad #${r.property_code}` : null, scope.all ? `Agente: ${r.agent}` : null].filter(Boolean).join(" · ") || null,
          badge: APPOINTMENT_STATUS_LABEL[r.status] ?? r.status,
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
