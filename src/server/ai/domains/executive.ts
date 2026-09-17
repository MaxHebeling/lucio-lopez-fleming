/**
 * Dominio Dirección: conteos de la semana en curso (lunes 00:00 de Salta → ahora). Cada conteo aparece solo si el
 * actor puede ver ese módulo y respeta su alcance. La Fase 5 (reporte ejecutivo) parte de acá.
 */
import { z } from "zod";
import { sql } from "../../db";
import { can } from "../../auth/actor";
import { agendaScope, leadScope, opportunityScope } from "../../crm/access";
import type { ToolItem, ToolRegistry } from "../core/registry";
import { saltaWeekStart, scopeOf } from "./shared";

export function registerExecutiveTools(registry: ToolRegistry): void {
  registry.register({
    name: "week_summary",
    domain: "executive",
    capability: "read",
    permissions: ["dashboard.read"],
    description:
      "Conteos de la semana en curso (desde el lunes, hora de Salta): leads nuevos, visitas agendadas y realizadas, oportunidades ganadas y perdidas, propiedades publicadas. Solo los módulos que el usuario puede ver, con su alcance.",
    input: z.object({}),
    quick: { id: "resumen_semana", label: "Números de la semana", keywords: [/\b(resumen|numeros|conteos?|como venimos)\b.*\bsemana\b/, /\bsemana\b.*\b(resumen|numeros)\b/, /\besta semana\b/] },
    async run({ db, actor }) {
      const since = saltaWeekStart();
      const items: ToolItem[] = [];
      const own = new Set<string>();

      const leads = scopeOf(actor, leadScope);
      if (leads) {
        const r = await db
          .selectFrom("leads")
          .select(sql<number>`count(*)::int`.as("n"))
          .where("organization_id", "=", actor.organizationId)
          .where("deleted_at", "is", null)
          .where("created_at", ">=", since)
          .$if(!leads.all, (q) => q.where("assigned_user_id", "=", actor.userId))
          .executeTakeFirst();
        if (!leads.all) own.add("leads");
        items.push({ label: "Leads nuevos", detail: String(r?.n ?? 0), href: "/crm/leads" });
      }

      const agenda = scopeOf(actor, agendaScope);
      if (agenda) {
        const r = await db
          .selectFrom("appointments as a")
          .innerJoin("users as u", "u.id", "a.assigned_user_id")
          .select([sql<number>`count(*) filter (where a.status in ('scheduled', 'confirmed', 'completed', 'no_show'))::int`.as("scheduled"), sql<number>`count(*) filter (where a.status = 'completed')::int`.as("completed")])
          .where("u.organization_id", "=", actor.organizationId)
          .where("a.kind", "=", "visit")
          .where("a.starts_at", ">=", since)
          .where("a.starts_at", "<", sql<Date>`${since} + interval '7 days'`)
          .$if(!agenda.all, (q) => q.where((eb) => eb.or([eb("a.assigned_user_id", "=", actor.userId), eb("a.created_by", "=", actor.userId)])))
          .executeTakeFirst();
        if (!agenda.all) own.add("visitas");
        items.push({ label: "Visitas de la semana (sin canceladas)", detail: String(r?.scheduled ?? 0), href: "/crm/agenda" });
        items.push({ label: "Visitas realizadas", detail: String(r?.completed ?? 0), href: "/crm/agenda" });
      }

      const opps = scopeOf(actor, opportunityScope);
      if (opps) {
        const r = await db
          .selectFrom("opportunities")
          .select([sql<number>`count(*) filter (where status = 'won')::int`.as("won"), sql<number>`count(*) filter (where status = 'lost')::int`.as("lost")])
          .where("organization_id", "=", actor.organizationId)
          .where("deleted_at", "is", null)
          .where("closed_at", ">=", since)
          .$if(!opps.all, (q) => q.where("assigned_user_id", "=", actor.userId))
          .executeTakeFirst();
        if (!opps.all) own.add("oportunidades");
        items.push({ label: "Oportunidades ganadas", detail: String(r?.won ?? 0), href: "/crm/pipeline" });
        items.push({ label: "Oportunidades perdidas", detail: String(r?.lost ?? 0), href: "/crm/pipeline" });
      }

      if (can(actor, "properties.read")) {
        const r = await db
          .selectFrom("properties")
          .select(sql<number>`count(*)::int`.as("n"))
          .where("organization_id", "=", actor.organizationId)
          .where("deleted_at", "is", null)
          .where("is_demo", "=", false)
          .where("is_published", "=", true)
          .where("published_at", ">=", since)
          .executeTakeFirst();
        items.push({ label: "Propiedades publicadas esta semana", detail: String(r?.n ?? 0), href: "/crm/propiedades" });
      }

      return {
        title: "Números de la semana",
        summary: items.length
          ? `Semana en curso (desde el lunes).${own.size ? ` En ${[...own].join(", ")} se cuenta solo lo asignado a vos.` : ""}`
          : "Tu rol no tiene acceso a los módulos que se resumen acá.",
        items,
        total: items.length,
        truncated: false,
        source: { label: "Tablero", href: "/crm" },
        scope: own.size ? "own" : "all",
      };
    },
  });
}
