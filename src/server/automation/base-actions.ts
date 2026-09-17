/** Acciones genéricas: notificar y crear tareas. Los módulos registran las suyas (redes, portales, alquileres). */
import { z } from "zod";
import { notifyRole, notifyUser } from "../notifications";
import { registerAction } from "./actions";

const TASK_ENTITY_TYPES = new Set(["contact", "property", "lead", "opportunity", "rental_contract", "appointment"]);
const AGGREGATE_TO_ENTITY: Record<string, string> = {
  lead: "lead",
  property: "property",
  contact: "contact",
  opportunity: "opportunity",
  appointment: "appointment",
  rental_contract: "rental_contract",
};

const notifyParams = z.object({
  to: z.enum(["assignee_or_role", "role", "assignee"]),
  role: z.string().optional(),
  title: z.string().min(2).max(200),
});

registerAction("notify", async (raw, ctx) => {
  const p = notifyParams.parse(raw);
  const assignee = typeof ctx.event.payload.assignedUserId === "string" ? ctx.event.payload.assignedUserId : null;
  const summary = typeof ctx.event.payload.summary === "string" ? ctx.event.payload.summary : null;
  const link = typeof ctx.event.payload.link === "string" && ctx.event.payload.link.startsWith("/") ? ctx.event.payload.link : null;
  const n = {
    kind: ctx.event.type,
    title: p.title,
    body: summary,
    link,
    entityType: ctx.event.aggregateType,
    entityId: ctx.event.aggregateId,
    dedupeKey: ctx.dedupeBase,
  };
  if ((p.to === "assignee" || p.to === "assignee_or_role") && assignee) {
    await notifyUser(ctx.db, assignee, n);
    return { notified: 1 };
  }
  if (p.to === "assignee") return { notified: 0, reason: "sin asignado" };
  if (!p.role) throw new Error("notify: falta role");
  return { notified: await notifyRole(ctx.db, p.role, n) };
});

const taskParams = z.object({
  title: z.string().min(2).max(200),
  due_in_minutes: z.number().int().min(0).max(60 * 24 * 365),
  kind: z.enum(["task", "call", "meeting", "follow_up", "email", "whatsapp"]).default("task"),
});

registerAction("create_task", async (raw, ctx) => {
  const p = taskParams.parse(raw);
  const entityType = AGGREGATE_TO_ENTITY[ctx.event.aggregateType];
  const assignee = typeof ctx.event.payload.assignedUserId === "string" ? ctx.event.payload.assignedUserId : null;
  const r = await ctx.db
    .insertInto("tasks")
    .values({
      title: p.title,
      kind: p.kind,
      due_at: new Date(Date.now() + p.due_in_minutes * 60_000),
      assigned_user_id: assignee,
      entity_type: entityType && TASK_ENTITY_TYPES.has(entityType) ? entityType : null,
      entity_id: entityType && TASK_ENTITY_TYPES.has(entityType) ? ctx.event.aggregateId : null,
      dedupe_key: ctx.dedupeBase,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
  return { taskId: r?.id ?? null, duplicate: !r };
});
