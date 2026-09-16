/**
 * Acción `notify_email_internal`: encola un email interno (EMAIL_INTERNAL_TO, admite varias direcciones separadas
 * por coma) con el resumen de un lead. No incluye teléfono ni email del contacto: se ven en el CRM.
 * Idempotente por dedupeBase (+ destinatario).
 */
import { z } from "zod";
import { registerAction } from "../automation/actions";
import { queueMessage } from "./outbound";

const params = z.object({ template: z.literal("lead_internal_notice") });

export function internalRecipients(): string[] {
  return (process.env.EMAIL_INTERNAL_TO ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s))
    .slice(0, 10);
}

registerAction("notify_email_internal", async (raw, ctx) => {
  params.parse(raw);
  if (ctx.event.aggregateType !== "lead") return { skipped: "el evento no es de un lead" };
  const recipients = internalRecipients();
  if (!recipients.length) return { skipped: "EMAIL_INTERNAL_TO sin configurar" };
  const lead = await ctx.db
    .selectFrom("leads as l")
    .innerJoin("contacts as c", "c.id", "l.contact_id")
    .innerJoin("lead_sources as s", "s.key", "l.source_key")
    .leftJoin("properties as p", "p.id", "l.property_id")
    .select(["l.id", "l.message", "c.display_name", "s.name as source_name", "p.code as property_code", "p.title as property_title"])
    .where("l.id", "=", ctx.event.aggregateId)
    .executeTakeFirst();
  if (!lead) return { skipped: "lead inexistente" };
  let queued = 0;
  for (const to of recipients) {
    const id = await queueMessage(ctx.db, {
      channel: "email",
      to,
      templateKey: "lead_internal_notice",
      payload: {
        leadPath: `/crm/leads/${lead.id}`,
        contactName: lead.display_name,
        sourceName: lead.source_name,
        propertyLabel: lead.property_code ? `${lead.property_code} · ${lead.property_title}` : null,
        message: lead.message ? lead.message.slice(0, 1000) : null,
      },
      dedupeKey: `${ctx.dedupeBase}:${to}`,
      entityType: "lead",
      entityId: lead.id,
    });
    if (id) queued++;
  }
  return { queued };
});
