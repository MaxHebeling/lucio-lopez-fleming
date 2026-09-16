/**
 * Registro de contacto saliente iniciado desde el CRM (llamada o WhatsApp abiertos desde la ficha).
 * No envía nada: el agente llama o escribe desde su teléfono; acá queda la traza en el timeline.
 */
import { z } from "zod";
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { loadContact, loadLead } from "../crm/entities";

export const outreachSchema = z.object({
  entityType: z.enum(["contact", "lead"]),
  entityId: z.uuid(),
  channel: z.enum(["call", "whatsapp"]),
});

const SUMMARY = { call: "Llamada iniciada desde el CRM", whatsapp: "WhatsApp abierto desde el CRM" } as const;

export async function logOutreach(db: Database, actor: Actor, raw: z.input<typeof outreachSchema>): Promise<{ logged: boolean }> {
  const input = outreachSchema.parse(raw);
  requirePermission(actor, "contacts.read");
  return db.transaction().execute(async (trx) => {
    let contactId: string;
    let leadId: string | null = null;
    if (input.entityType === "lead") {
      const lead = await loadLead(trx, actor, input.entityId);
      contactId = lead.contact_id;
      leadId = lead.id;
    } else {
      contactId = (await loadContact(trx, actor, input.entityId)).id;
    }
    const kind = `outreach_${input.channel}`;
    // Doble toque en el botón: una sola actividad por usuario/contacto/canal cada 60 segundos.
    await sql`select pg_advisory_xact_lock(hashtext(${`outreach:${actorUserId(actor)}:${contactId}:${kind}`}))`.execute(trx);
    const recent = await trx
      .selectFrom("activities")
      .select("id")
      .where("entity_type", "=", "contact")
      .where("entity_id", "=", contactId)
      .where("kind", "=", kind)
      .where("actor_user_id", "=", actorUserId(actor))
      .where("occurred_at", ">", new Date(Date.now() - 60_000))
      .executeTakeFirst();
    if (recent) return { logged: false };
    await trx
      .insertInto("activities")
      .values({ entity_type: "contact", entity_id: contactId, kind, summary: SUMMARY[input.channel], actor_user_id: actorUserId(actor), metadata: JSON.stringify(leadId ? { leadId } : {}) })
      .execute();
    if (leadId) {
      await trx
        .insertInto("activities")
        .values({ entity_type: "lead", entity_id: leadId, kind, summary: SUMMARY[input.channel], actor_user_id: actorUserId(actor), metadata: JSON.stringify({ contactId }) })
        .execute();
    }
    await audit(trx, actor, { action: "OUTREACH_LOGGED", entityType: input.entityType, entityId: input.entityId, after: { channel: input.channel } });
    return { logged: true };
  });
}
