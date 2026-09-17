/**
 * Jobs y acciones de automatización de la Fase 2 · Ventas (registrados en src/server/jobs/handlers.ts).
 * Todos idempotentes; ninguno contacta al cliente ni reacciona a eventos de IA (sin loops).
 */
import { registerAction } from "../automation/actions";
import { registerJobHandler } from "../jobs/registry";
import { isEnabled } from "../flags";
import { computeMatchesForContact, computeMatchesForProperty, type MatchTrigger } from "./matching/service";
import { qualifyLead } from "./qualification/service";

// lead.created → resumen, sugerencias del perfil y siguiente acción propuesta
registerAction("sales_qualify_lead", async (_params, ctx) => {
  if (ctx.event.aggregateType !== "lead") return { skipped: "no es un lead" };
  return qualifyLead(ctx.db, ctx.actor, ctx.event.aggregateId);
});

// property.published / property.price_changed → match inverso (candidatos + aviso al agente, sin contactar)
registerAction("sales_match_property", async (params, ctx) => {
  if (!(await isEnabled(ctx.db, "ai_matching"))) return { skipped: "flag" };
  const trigger: MatchTrigger = params.trigger === "price_changed" ? "price_changed" : "property_published";
  return computeMatchesForProperty(ctx.db, ctx.actor, ctx.event.aggregateId, trigger, ctx.event.id);
});

// Preferencias cambiadas → recalcular coincidencias guardadas del contacto
registerJobHandler("sales.match_contact", async (payload, { db }) => {
  if (!(await isEnabled(db, "ai_matching"))) return { skipped: "flag" };
  const contactId = String(payload.contactId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) return { skipped: "contacto inválido" };
  return computeMatchesForContact(db, contactId);
});
