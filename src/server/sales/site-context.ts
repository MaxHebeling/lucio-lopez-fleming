/**
 * Contexto del sitio al enviar una consulta (única vía de vinculación, ver docs/ai/SALES.md › Privacidad):
 *  - Vincula la `session_key` de la pestaña con el contacto (site_session_links) si el navegador no pide Do Not Track /
 *    Global Privacy Control. Antes del envío la sesión es anónima y así queda si nunca se envía nada.
 *  - Si la persona usó el concierge en esa sesión, sus FILTROS (nunca el texto) se proponen como preferencias sugeridas.
 *  - Las preguntas opcionales del formulario (plazo, financiación) y la operación de la ficha, también como sugeridas.
 *  - Un pedido de visita queda como actividad (señal «solicitó visita»).
 * Corre después de capturar el lead: si falla, la consulta ya quedó guardada (se registra el error).
 */
import "server-only";
import { z } from "zod";
import type { Database } from "../db";
import type { Actor } from "../auth/actor";
import { intentToProposals, type ProposedItem } from "./profile/fields";
import { proposePreferences } from "./profile/service";
import { FINANCING, MOVE_TIMEFRAMES, searchIntentSchema } from "./intent/schema";
import { isEnabled } from "../flags";

export const siteContextSchema = z.object({
  sessionKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
  /** Intención del concierge guardada en la pestaña (JSON, solo filtros). Se revalida acá. */
  conciergeIntent: z.string().max(6000).optional(),
  moveTimeframe: z.enum(MOVE_TIMEFRAMES).optional(),
  financing: z.enum([...FINANCING, "undecided"]).optional(),
});
export type SiteContextInput = z.infer<typeof siteContextSchema>;

export type AttachInput = SiteContextInput & {
  leadId: string;
  contactId: string;
  kind: "property" | "visit" | "contact" | "appraisal" | "owner";
  propertyId: string | null;
  operation: "sale" | "rent" | "temporary_rent" | null;
  privacySignal: boolean;
};

export function parseConciergeIntent(raw: string | undefined) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as unknown;
    const r = searchIntentSchema.safeParse(obj);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function attachSiteContext(db: Database, actor: Actor, input: AttachInput): Promise<{ linked: boolean; proposed: number }> {
  const matching = await isEnabled(db, "ai_matching");
  return db.transaction().execute(async (trx) => {
    let linked = false;
    if (matching && input.sessionKey && !input.privacySignal) {
      const r = await trx
        .insertInto("site_session_links")
        .values({ organization_id: actor.organizationId, session_key: input.sessionKey, contact_id: input.contactId, lead_id: input.leadId })
        .onConflict((oc) => oc.columns(["session_key", "contact_id"]).doNothing())
        .executeTakeFirst();
      linked = Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
    }
    if (input.kind === "visit") {
      await trx
        .insertInto("activities")
        .values({ entity_type: "contact", entity_id: input.contactId, kind: "visit_requested", summary: "Pidió coordinar una visita desde el sitio", metadata: JSON.stringify({ leadId: input.leadId, propertyId: input.propertyId }) })
        .execute();
    }
    if (!matching || input.kind === "appraisal" || input.kind === "owner") return { linked, proposed: 0 };

    let proposed = 0;
    const intent = input.privacySignal ? null : parseConciergeIntent(input.conciergeIntent);
    if (intent) {
      const r = await proposePreferences(trx, { organizationId: actor.organizationId, contactId: input.contactId, source: "concierge", items: intentToProposals(intent), leadId: input.leadId });
      proposed += r.proposed.length;
    }
    const form: ProposedItem[] = [];
    if (input.moveTimeframe) form.push({ field: "move_timeframe", value: input.moveTimeframe, confidence: 0.9 });
    if (input.financing) form.push({ field: "financing", value: input.financing, confidence: 0.9 });
    // Consulta sobre una propiedad en venta/alquiler: la operación que le interesa (dato sugerido, confianza media).
    if (input.operation && !intent?.transactionType) form.push({ field: "transaction_type", value: input.operation, confidence: 0.6 });
    if (form.length) proposed += (await proposePreferences(trx, { organizationId: actor.organizationId, contactId: input.contactId, source: "form", items: form, leadId: input.leadId })).proposed.length;
    return { linked, proposed };
  });
}
