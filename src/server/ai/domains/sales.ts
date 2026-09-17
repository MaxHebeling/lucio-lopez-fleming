/** Dominio Ventas: leads y oportunidades (solo lectura, alcance propio/todos igual que Leads y Pipeline). */
import { z } from "zod";
import { sql } from "../../db";
import { leadScope, opportunityScope } from "../../crm/access";
import { LEAD_STATUS_LABEL } from "../../../components/crm/labels";
import type { ToolRegistry } from "../core/registry";
import { hoursSince, MAX_ITEMS, plural, scopeLabel, scopeOf } from "./shared";

export const DEFAULT_STALE_OPPORTUNITY_DAYS = 14;

export function registerSalesTools(registry: ToolRegistry): void {
  registry.register({
    name: "uncontacted_leads",
    domain: "sales",
    capability: "read",
    permissions: ["leads.read_own", "leads.read_all"],
    description: "Leads abiertos (nuevo, contactado o calificado) SIN primer contacto registrado y creados hace más de N horas (24 por defecto). Aplica el alcance del usuario.",
    input: z.object({ hours: z.number().int().min(1).max(720).default(24) }),
    quick: { id: "leads_sin_contacto", label: "Leads sin contacto (+24 h)", keywords: [/\bleads?\b.*\bsin (contact|respuest|atender)/, /\bsin (contactar|responder|atender)\b.*\bleads?\b/, /\bleads?\b.*\b(pendientes|sin atender)\b/] },
    async run({ db, actor, now }, input) {
      const scope = scopeOf(actor, leadScope)!;
      let q = db
        .selectFrom("leads as l")
        .innerJoin("contacts as c", "c.id", "l.contact_id")
        .innerJoin("lead_sources as s", "s.key", "l.source_key")
        .leftJoin("users as u", "u.id", "l.assigned_user_id")
        .where("l.organization_id", "=", actor.organizationId)
        .where("l.deleted_at", "is", null)
        .where("l.first_response_at", "is", null)
        .where("l.status", "in", ["new", "contacted", "qualified"])
        .where("l.created_at", "<", sql<Date>`now() - make_interval(hours => ${input.hours})`);
      if (!scope.all) q = q.where("l.assigned_user_id", "=", actor.userId);
      const rows = await q
        .select(["l.id", "l.created_at", "l.status", "c.display_name", "s.name as source", "u.full_name as assignee"])
        .select(sql<number>`(count(*) over())::int`.as("total"))
        .orderBy("l.created_at")
        .limit(MAX_ITEMS)
        .execute();
      const total = rows[0]?.total ?? 0;
      const whose = scope.all ? "" : " asignados a vos";
      return {
        title: `Leads sin contacto (+${input.hours} h)`,
        summary: total ? `${plural(total, "lead", "leads")}${whose} sin primer contacto hace más de ${input.hours} h.` : `No hay leads${whose} sin primer contacto hace más de ${input.hours} h.`,
        items: rows.map((r) => ({
          label: r.display_name,
          detail: [`Hace ${hoursSince(r.created_at, now)} h`, r.source, scope.all ? (r.assignee ? `Asignado a ${r.assignee}` : "Sin asignar") : null].filter(Boolean).join(" · "),
          badge: LEAD_STATUS_LABEL[r.status] ?? r.status,
          href: `/crm/leads/${r.id}`,
        })),
        total,
        truncated: total > rows.length,
        source: { label: "Leads", href: "/crm/leads" },
        scope: scopeLabel(scope),
      };
    },
  });

  registry.register({
    name: "stale_opportunities",
    domain: "sales",
    capability: "read",
    permissions: ["opportunities.read_own", "opportunities.read_all"],
    description: "Oportunidades abiertas que no cambian de etapa hace N días o más (setting ai.analyst.stale_opportunity_days, 14 por defecto). Aplica el alcance del usuario.",
    input: z.object({ days: z.number().int().min(1).max(365).optional() }),
    quick: { id: "oportunidades_estancadas", label: "Oportunidades estancadas", keywords: [/\boportunidad\w*\b.*\b(estancad|frenad|parad|sin movimiento)/, /\b(estancad|frenad|parad)\w*\b.*\b(oportunidad|pipeline)/, /\bpipeline\b.*\bsin movimiento\b/] },
    async run({ db, actor, now }, input) {
      const scope = scopeOf(actor, opportunityScope)!;
      let days = input.days;
      if (days === undefined) {
        const s = await db.selectFrom("settings").select("value").where("key", "=", "ai.analyst.stale_opportunity_days").executeTakeFirst();
        const n = Number(s?.value);
        days = Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_STALE_OPPORTUNITY_DAYS;
      }
      let q = db
        .selectFrom("opportunities as o")
        .innerJoin("pipeline_stages as st", "st.id", "o.stage_id")
        .leftJoin("users as u", "u.id", "o.assigned_user_id")
        .where("o.organization_id", "=", actor.organizationId)
        .where("o.deleted_at", "is", null)
        .where("o.status", "=", "open")
        .where("o.stage_entered_at", "<", sql<Date>`now() - make_interval(days => ${days})`);
      if (!scope.all) q = q.where("o.assigned_user_id", "=", actor.userId);
      const rows = await q
        .select(["o.id", "o.title", "o.stage_entered_at", "st.name as stage", "u.full_name as assignee"])
        .select(sql<number>`(count(*) over())::int`.as("total"))
        .orderBy("o.stage_entered_at")
        .limit(MAX_ITEMS)
        .execute();
      const total = rows[0]?.total ?? 0;
      return {
        title: `Oportunidades sin movimiento (${days}+ días)`,
        summary: total ? `${plural(total, "oportunidad abierta", "oportunidades abiertas")} sin cambiar de etapa hace ${days} días o más.` : `No hay oportunidades abiertas sin movimiento hace ${days} días o más.`,
        items: rows.map((r) => ({
          label: r.title,
          detail: [`${r.stage} · ${Math.floor(hoursSince(r.stage_entered_at, now) / 24)} días en la etapa`, scope.all ? (r.assignee ? `Agente: ${r.assignee}` : "Sin asignar") : null].filter(Boolean).join(" · "),
          href: `/crm/pipeline/${r.id}`,
        })),
        total,
        truncated: total > rows.length,
        source: { label: "Pipeline", href: "/crm/pipeline" },
        scope: scopeLabel(scope),
      };
    },
  });
}
