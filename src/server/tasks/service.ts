/**
 * Tareas del equipo. Alcance: con `tasks.read_all` se ven y gestionan todas; con `tasks.manage`, las asignadas
 * a uno o creadas por uno. Crear para otra persona requiere `tasks.read_all`.
 */
import { z } from "zod";
import type { SchemaIn } from "../crm/types";
import { sql, type Database, type Executor } from "../db";
import { audit } from "../audit";
import { actorUserId, can, requirePermission, type Actor } from "../auth/actor";
import { conflict, invalid } from "../errors";
import { notifyUser } from "../notifications";
import { taskScope } from "../crm/access";
import { assertEntityVisible, loadTask } from "../crm/entities";
import { isLocalDate, isLocalDateTime, localDayRange, localToUtc } from "../crm/time";

export const TASK_KINDS = ["task", "call", "meeting", "follow_up", "email", "whatsapp"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const createTaskSchema = z
  .object({
    title: z.string().trim().min(2, "Mínimo 2 caracteres").max(200, "Máximo 200 caracteres"),
    description: z.string().trim().max(5000).nullish().transform((v) => v || null),
    kind: z.enum(TASK_KINDS).default("task"),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    dueAt: z
      .string()
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || isLocalDateTime(v), "Fecha y hora inválidas"),
    assignedUserId: z.uuid().nullable().optional(),
    entityType: z.enum(["contact", "property", "lead", "opportunity", "appointment"]).nullable().optional(),
    entityId: z.uuid().nullable().optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine((v) => Boolean(v.entityType) === Boolean(v.entityId), { message: "Vínculo incompleto", path: ["entityId"] });

export async function createTask(db: Database, actor: Actor, raw: SchemaIn<typeof createTaskSchema>): Promise<{ id: string; replayed: boolean }> {
  requirePermission(actor, "tasks.manage");
  const input = createTaskSchema.parse(raw);
  const scope = taskScope(actor);
  const assignee = input.assignedUserId ?? actorUserId(actor);
  if (assignee !== actorUserId(actor) && !scope.all) throw invalid("No podés asignar tareas a otra persona", { assignedUserId: ["Sin permiso para asignar a otros"] });
  const dedupeKey = `form:${input.idempotencyKey}`;
  return db.transaction().execute(async (trx) => {
    if (assignee) {
      const u = await trx.selectFrom("users").select("id").where("id", "=", assignee).where("kind", "=", "staff").where("is_active", "=", true).where("deleted_at", "is", null).executeTakeFirst();
      if (!u) throw invalid("Usuario inválido", { assignedUserId: ["Elegí un usuario activo del equipo"] });
    }
    if (input.entityType && input.entityId) await assertEntityVisible(trx, actor, input.entityType, input.entityId);
    const row = await trx
      .insertInto("tasks")
      .values({
        title: input.title,
        description: input.description,
        kind: input.kind,
        priority: input.priority,
        due_at: input.dueAt ? localToUtc(input.dueAt) : null,
        assigned_user_id: assignee,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        dedupe_key: dedupeKey,
        created_by: actorUserId(actor),
      })
      .onConflict((oc) => oc.column("dedupe_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!row) {
      const prev = await trx.selectFrom("tasks").select("id").where("dedupe_key", "=", dedupeKey).executeTakeFirstOrThrow();
      return { id: prev.id, replayed: true };
    }
    await audit(trx, actor, {
      action: "TASK_CREATED",
      entityType: "task",
      entityId: row.id,
      after: { title: input.title, kind: input.kind, priority: input.priority, dueAt: input.dueAt, assignedUserId: assignee, entityType: input.entityType ?? null, entityId: input.entityId ?? null },
    });
    if (assignee && assignee !== actorUserId(actor)) {
      await notifyUser(trx, assignee, { kind: "task.assigned", title: "Nueva tarea asignada", body: input.title, link: "/crm/tareas", entityType: "task", entityId: row.id, dedupeKey: `task.assigned:${row.id}` });
    }
    return { id: row.id, replayed: false };
  });
}

export const taskActionSchema = z.object({ taskId: z.uuid(), reason: z.string().trim().max(500).nullish().transform((v) => v || null) });

export async function completeTask(db: Database, actor: Actor, raw: SchemaIn<typeof taskActionSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "tasks.manage");
  const input = taskActionSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const t = await loadTask(trx, actor, input.taskId, { forUpdate: true });
    if (t.status === "done") return { changed: false };
    if (t.status === "cancelled") throw conflict("La tarea está cancelada");
    const now = new Date();
    await trx.updateTable("tasks").set({ status: "done", completed_at: now }).where("id", "=", t.id).execute();
    await audit(trx, actor, { action: "TASK_COMPLETED", entityType: "task", entityId: t.id, before: { status: t.status }, after: { status: "done", completedAt: now.toISOString() } });
    return { changed: true };
  });
}

export async function cancelTask(db: Database, actor: Actor, raw: SchemaIn<typeof taskActionSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "tasks.manage");
  const input = taskActionSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const t = await loadTask(trx, actor, input.taskId, { forUpdate: true });
    if (t.status === "cancelled") return { changed: false };
    if (t.status === "done") throw conflict("La tarea ya está completada");
    await trx.updateTable("tasks").set({ status: "cancelled" }).where("id", "=", t.id).execute();
    await audit(trx, actor, { action: "TASK_CANCELLED", entityType: "task", entityId: t.id, before: { status: t.status }, after: { status: "cancelled", reason: input.reason } });
    return { changed: true };
  });
}

export async function reopenTask(db: Database, actor: Actor, raw: SchemaIn<typeof taskActionSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "tasks.manage");
  const input = taskActionSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const t = await loadTask(trx, actor, input.taskId, { forUpdate: true });
    if (t.status === "open") return { changed: false };
    await trx.updateTable("tasks").set({ status: "open", completed_at: null }).where("id", "=", t.id).execute();
    await audit(trx, actor, { action: "TASK_REOPENED", entityType: "task", entityId: t.id, before: { status: t.status }, after: { status: "open" } });
    return { changed: true };
  });
}

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const taskFiltersSchema = z.object({
  view: z.preprocess(emptyToUndef, z.enum(["mine", "team"]).optional()),
  status: z.preprocess(emptyToUndef, z.enum(["open", "done", "cancelled", "overdue", "today"]).optional()),
  assignee: z.preprocess(emptyToUndef, z.union([z.literal("none"), z.uuid()]).optional()),
  kind: z.preprocess(emptyToUndef, z.enum(TASK_KINDS).optional()),
  day: z.preprocess(emptyToUndef, z.string().refine(isLocalDate).optional()),
});

const ENTITY_LINK: Record<string, (id: string) => string> = {
  contact: (id) => `/crm/contactos/${id}`,
  lead: (id) => `/crm/leads/${id}`,
  opportunity: (id) => `/crm/pipeline/${id}`,
  appointment: (id) => `/crm/agenda/${id}`,
  property: (id) => `/crm/propiedades/${id}`,
};

export function taskEntityLink(type: string | null, id: string | null): string | null {
  return type && id && ENTITY_LINK[type] ? ENTITY_LINK[type](id) : null;
}

export async function listTasks(db: Executor, actor: Actor, raw: unknown, today: string) {
  const scope = taskScope(actor);
  const parsed = taskFiltersSchema.safeParse(raw);
  const f = parsed.success ? parsed.data : {};
  // Quien solo puede consultar (tasks.read_all sin tasks.manage) ve el equipo por defecto.
  const view = scope.all && (f.view === "team" || !can(actor, "tasks.manage")) ? "team" : "mine";
  let q = db
    .selectFrom("tasks as t")
    .leftJoin("users as u", "u.id", "t.assigned_user_id")
    .select([
      "t.id",
      "t.title",
      "t.description",
      "t.kind",
      "t.status",
      "t.priority",
      "t.due_at",
      "t.entity_type",
      "t.entity_id",
      "t.completed_at",
      "t.created_at",
      "u.full_name as assigned_name",
      sql<string | null>`case t.entity_type
        when 'contact' then (select display_name from contacts where id = t.entity_id)
        when 'lead' then (select c.display_name from leads l join contacts c on c.id = l.contact_id where l.id = t.entity_id)
        when 'opportunity' then (select title from opportunities where id = t.entity_id)
        when 'appointment' then (select title from appointments where id = t.entity_id)
        when 'property' then (select 'Prop. ' || code || ' · ' || title from properties where id = t.entity_id)
      end`.as("entity_label"),
    ]);
  if (view === "mine" || !scope.all) {
    q = q.where((eb) => eb.or([eb("t.assigned_user_id", "=", scope.userId), eb.and([eb("t.assigned_user_id", "is", null), eb("t.created_by", "=", scope.userId)])]));
  } else if (f.assignee === "none") q = q.where("t.assigned_user_id", "is", null);
  else if (f.assignee) q = q.where("t.assigned_user_id", "=", f.assignee);
  if (f.kind) q = q.where("t.kind", "=", f.kind);
  const status = f.status ?? "open";
  if (status === "overdue") q = q.where("t.status", "=", "open").where("t.due_at", "<", new Date());
  else if (status === "today") {
    const r = localDayRange(today);
    q = q.where("t.status", "=", "open").where("t.due_at", "<", r.to);
  } else q = q.where("t.status", "=", status);
  const rows = await q
    .orderBy(sql`t.due_at is null`)
    .orderBy("t.due_at", status === "open" || status === "overdue" || status === "today" ? "asc" : "desc")
    .orderBy("t.created_at", "desc")
    .limit(200)
    .execute();
  return { rows, view, status, scopeAll: scope.all, filters: f };
}
