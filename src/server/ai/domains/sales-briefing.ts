/**
 * Dominio Ventas (Fase 2) · «Ponme al día con este cliente». Herramienta `read` del copiloto: resume con HECHOS y su
 * origen el contacto (o el lead) abierto en pantalla, dentro del alcance del usuario. Sin teléfonos, emails ni
 * documentos. El texto libre de informes de visita viaja como dato no confiable (no cuenta como evidencia).
 */
import { z } from "zod";
import { sql } from "../../db";
import { tryScope, agendaScope, taskScope } from "../../crm/access";
import { loadLead } from "../../crm/entities";
import { AppError } from "../../errors";
import type { ToolItem, ToolRegistry, ToolResult } from "../core/registry";
import { getBuyerProfile } from "../../sales/profile/service";
import { loadSalesContact } from "../../sales/scope";
import { computeIntentSignals, LEVEL_LABEL } from "../../sales/signals/rules";
import { loadSignalFacts } from "../../sales/signals/service";
import { getNextActions } from "../../sales/nba/service";
import { DISMISS_REASON_LABEL } from "../../sales/matching/service";
import { hhmm, scopeLabel } from "./shared";

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Salta" });
const INTEREST = { low: "baja", medium: "media", high: "alta" } as const;

export function registerSalesBriefingTools(registry: ToolRegistry): void {
  registry.register({
    name: "client_briefing",
    domain: "sales",
    capability: "read",
    permissions: ["leads.read_own", "leads.read_all"],
    description:
      "«Ponme al día» con el cliente abierto en pantalla (ficha de contacto o lead): perfil de búsqueda con origen y estado de cada dato, señales de interés, propiedades consultadas, visitas (próxima e informes confirmados), descartes con motivo, tareas pendientes y siguiente acción sugerida. Aplica el alcance del usuario.",
    input: z.object({}),
    quick: {
      id: "ponme_al_dia",
      label: "Ponme al día con este cliente",
      requiresEntity: ["contact", "lead"],
      flag: "ai_matching",
      keywords: [/\bponme al dia\b/, /\bpone(me)? al tanto\b/, /\bresum\w* (del|de este|de la) (cliente|contacto|lead|ficha)\b/, /\bque (hay|paso|sabemos) (con|de) (este|el) (cliente|contacto|lead)\b/],
    },
    async run({ db, actor, now, screen }) {
      const entity = screen?.entity;
      if (!entity || (entity.type !== "contact" && entity.type !== "lead")) throw new AppError("not_found", "Abrí la ficha de un contacto o de un lead para usar «Ponme al día».");
      const contactId = entity.type === "lead" ? (await loadLead(db, actor, entity.id)).contact_id : entity.id;
      const { contact, scope } = await loadSalesContact(db, actor, contactId);
      const items: ToolItem[] = [];

      // Perfil
      const profile = await getBuyerProfile(db, actor, contactId);
      for (const f of profile.fields) {
        const v = f.confirmed ?? f.suggested;
        if (!v || f.field === "notes") continue;
        items.push({ label: `${f.label}: ${v.display}`, detail: f.confirmed ? `Confirmado · ${v.sourceLabel}` : `Sugerido, sin confirmar · ${v.sourceLabel}`, badge: "Perfil", href: `/crm/contactos/${contactId}#perfil` });
      }
      if (!profile.fields.some((f) => f.confirmed || f.suggested)) items.push({ label: "Sin perfil de búsqueda cargado", detail: "No hay preferencias registradas para este cliente", badge: "Perfil", href: `/crm/contactos/${contactId}#perfil` });

      // Señales
      const signals = computeIntentSignals(await loadSignalFacts(db, contactId));
      if (signals.level) items.push({ label: `Interés ${LEVEL_LABEL[signals.level].toLowerCase()}`, detail: signals.signals.map((s) => s.label).join(" · "), badge: "Señales" });

      // Consultas por propiedades (leads visibles para el usuario)
      let leadsQ = db
        .selectFrom("leads as l")
        .innerJoin("properties as p", "p.id", "l.property_id")
        .select(["l.id", "l.created_at", "p.code", "p.title"])
        .where("l.contact_id", "=", contactId)
        .where("l.organization_id", "=", actor.organizationId)
        .where("l.deleted_at", "is", null);
      if (!scope.all) leadsQ = leadsQ.where("l.assigned_user_id", "=", actor.userId);
      for (const l of await leadsQ.orderBy("l.created_at", "desc").limit(5).execute()) {
        items.push({ label: `Consultó por #${l.code} · ${l.title}`, detail: dateFmt.format(l.created_at), badge: "Propiedades", href: `/crm/leads/${l.id}` });
      }

      // Visitas (con el alcance de Agenda)
      const agenda = tryScope(agendaScope, actor);
      const untrusted: NonNullable<ToolResult["untrusted"]> = [];
      if (agenda) {
        let visits = db
          .selectFrom("appointments as a")
          .leftJoin("properties as p", "p.id", "a.property_id")
          .leftJoin("appointment_reports as r", (j) => j.onRef("r.appointment_id", "=", "a.id").on("r.status", "=", "confirmed"))
          .select(["a.id", "a.starts_at", "a.status", "p.code", "r.interest", "r.next_step", "r.objections"])
          .where("a.contact_id", "=", contactId)
          .where("a.kind", "=", "visit");
        if (!agenda.all) visits = visits.where((eb) => eb.or([eb("a.assigned_user_id", "=", actor.userId), eb("a.created_by", "=", actor.userId)]));
        const rows = await visits.orderBy("a.starts_at", "desc").limit(8).execute();
        const next = rows.filter((v) => v.starts_at > now && ["scheduled", "confirmed", "en_route", "checked_in", "in_progress"].includes(v.status)).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime())[0];
        if (next) items.push({ label: `Próxima visita: ${dateFmt.format(next.starts_at)} ${hhmm(next.starts_at)}${next.code ? ` · #${next.code}` : ""}`, badge: "Visitas", href: `/crm/agenda/${next.id}` });
        for (const v of rows.filter((x) => x.status === "completed").slice(0, 3)) {
          items.push({ label: `Visitó${v.code ? ` #${v.code}` : ""} el ${dateFmt.format(v.starts_at)}`, detail: v.interest ? `Informe confirmado · interés ${INTEREST[v.interest as keyof typeof INTEREST] ?? v.interest}` : "Sin informe confirmado", badge: "Visitas", href: `/crm/agenda/${v.id}` });
          if (v.next_step || v.objections) untrusted.push({ source: "informe_visita", text: [v.next_step ? `Próximo paso: ${v.next_step}` : "", v.objections ? `Objeciones: ${v.objections}` : ""].filter(Boolean).join("\n") });
        }
      }

      // Descartes con motivo
      const dismissed = await sql<{ code: number; reason: string; at: Date }>`
        select p.code, m.dismiss_reason as reason, m.dismissed_at as at from property_matches m join properties p on p.id = m.property_id
         where m.contact_id = ${contactId} and m.status = 'dismissed' order by m.dismissed_at desc limit 5`.execute(db);
      for (const d of dismissed.rows) items.push({ label: `Descartó #${d.code}`, detail: `Motivo: ${DISMISS_REASON_LABEL[d.reason as keyof typeof DISMISS_REASON_LABEL] ?? d.reason}`, badge: "Descartes" });

      // Tareas pendientes (alcance de Tareas)
      const ts = tryScope(taskScope, actor);
      if (ts) {
        let tasks = db
          .selectFrom("tasks as t")
          .select(["t.id", "t.title", "t.due_at"])
          .where("t.status", "=", "open")
          .where((eb) =>
            eb.or([
              eb.and([eb("t.entity_type", "=", "contact"), eb("t.entity_id", "=", contactId)]),
              eb.and([eb("t.entity_type", "=", "lead"), eb("t.entity_id", "in", eb.selectFrom("leads").select("id").where("contact_id", "=", contactId))]),
              eb.and([eb("t.entity_type", "=", "opportunity"), eb("t.entity_id", "in", eb.selectFrom("opportunities").select("id").where("contact_id", "=", contactId))]),
            ]),
          );
        if (!ts.all) tasks = tasks.where((eb) => eb.or([eb("t.assigned_user_id", "=", actor.userId), eb("t.created_by", "=", actor.userId)]));
        for (const t of await tasks.orderBy("t.due_at").limit(5).execute()) {
          items.push({ label: t.title, detail: t.due_at ? `${t.due_at < now ? "Vencida · " : ""}${dateFmt.format(t.due_at)} ${hhmm(t.due_at)}` : "Sin fecha", badge: "Tareas", href: "/crm/tareas" });
        }
      }

      // Siguiente acción sugerida
      const nba = await getNextActions(db, actor, { entityType: entity.type, entityId: entity.id }, now);
      for (const r of nba.items.slice(0, 2)) items.push({ label: `Siguiente acción: ${r.title}`, detail: r.reason, badge: "Sugerencia" });

      const confirmed = profile.confirmedCount;
      const summary = `${contact.display_name}: ${confirmed ? `${confirmed} ${confirmed === 1 ? "dato confirmado" : "datos confirmados"} del perfil` : "perfil sin datos confirmados"}${profile.suggestedCount ? `, ${profile.suggestedCount} ${profile.suggestedCount === 1 ? "sugerido" : "sugeridos"}` : ""}${signals.level ? `, interés ${LEVEL_LABEL[signals.level].toLowerCase()}` : ""}${nba.items[0] ? `. Siguiente acción sugerida: ${nba.items[0].title.toLowerCase()}` : ""}.`;
      return {
        title: `Ponme al día · ${contact.display_name}`,
        summary,
        items: items.slice(0, 30),
        total: items.length,
        truncated: items.length > 30,
        source: { label: "Ficha del contacto", href: `/crm/contactos/${contactId}` },
        scope: scopeLabel(scope),
        untrusted,
      };
    },
  });
}
