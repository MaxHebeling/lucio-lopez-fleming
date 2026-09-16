/** Notas internas sobre contactos, leads, oportunidades y citas. */
import { z } from "zod";
import type { Database } from "../db";
import { audit } from "../audit";
import { actorUserId, requirePermission, type Actor } from "../auth/actor";
import { assertEntityVisible } from "../crm/entities";

export const addNoteSchema = z.object({
  entityType: z.enum(["contact", "lead", "opportunity", "appointment"]),
  entityId: z.uuid(),
  body: z.string().trim().min(1, "Escribí la nota").max(10000, "Máximo 10.000 caracteres"),
  idempotencyKey: z.string().min(8).max(200).nullable().optional(),
});

const PERMISSION: Record<z.infer<typeof addNoteSchema>["entityType"], string> = {
  contact: "contacts.update",
  lead: "leads.update",
  opportunity: "opportunities.update",
  appointment: "agenda.manage",
};

export async function addNote(db: Database, actor: Actor, raw: z.input<typeof addNoteSchema>): Promise<{ id: string; replayed: boolean }> {
  const input = addNoteSchema.parse(raw);
  requirePermission(actor, PERMISSION[input.entityType]);
  return db.transaction().execute(async (trx) => {
    await assertEntityVisible(trx, actor, input.entityType, input.entityId);
    const row = await trx
      .insertInto("notes")
      .values({ entity_type: input.entityType, entity_id: input.entityId, body: input.body, author_user_id: actorUserId(actor), idempotency_key: input.idempotencyKey ?? null })
      .onConflict((oc) => oc.column("idempotency_key").where("idempotency_key", "is not", null).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!row) {
      const prev = await trx.selectFrom("notes").select("id").where("idempotency_key", "=", input.idempotencyKey!).executeTakeFirstOrThrow();
      return { id: prev.id, replayed: true };
    }
    await audit(trx, actor, { action: "NOTE_ADDED", entityType: input.entityType, entityId: input.entityId, after: { noteId: row.id, length: input.body.length } });
    return { id: row.id, replayed: false };
  });
}
