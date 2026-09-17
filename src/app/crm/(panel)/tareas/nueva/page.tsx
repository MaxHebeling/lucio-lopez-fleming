import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertEntityVisible, type LinkableEntity } from "@/server/crm/entities";
import { taskScope } from "@/server/crm/access";
import { listStaffUsers } from "@/server/crm/lookups";
import { taskEntityLink } from "@/server/tasks/service";
import { Card, PageHeader } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { UUID_RE } from "../../_shared/load";
import { TaskForm } from "./task-form";

export const metadata: Metadata = { title: "Nueva tarea" };

const ENTITY_TYPES = new Set(["contact", "lead", "opportunity", "appointment", "property"]);

async function entityLabel(type: LinkableEntity, id: string): Promise<string | null> {
  const db = getDb();
  switch (type) {
    case "contact":
      return (await db.selectFrom("contacts").select("display_name").where("id", "=", id).executeTakeFirst())?.display_name ?? null;
    case "lead": {
      const r = await db.selectFrom("leads as l").innerJoin("contacts as c", "c.id", "l.contact_id").select("c.display_name").where("l.id", "=", id).executeTakeFirst();
      return r ? `Lead de ${r.display_name}` : null;
    }
    case "opportunity":
      return (await db.selectFrom("opportunities").select("title").where("id", "=", id).executeTakeFirst())?.title ?? null;
    case "appointment":
      return (await db.selectFrom("appointments").select("title").where("id", "=", id).executeTakeFirst())?.title ?? null;
    case "property": {
      const p = await db.selectFrom("properties").select(["code", "title"]).where("id", "=", id).executeTakeFirst();
      return p ? `Prop. ${p.code} · ${p.title}` : null;
    }
  }
}

export default async function NewTaskPage({ searchParams }: PageProps<"/crm/tareas/nueva">) {
  const actor = await requireStaffPage("tasks.manage");
  const sp = flatParams(await searchParams);
  const db = getDb();
  const scope = taskScope(actor);
  let entity: { type: string; id: string; label: string } | null = null;
  if (sp.entidad && ENTITY_TYPES.has(sp.entidad) && sp.id && UUID_RE.test(sp.id)) {
    const type = sp.entidad as LinkableEntity;
    try {
      // Solo se ofrece vincular a entidades que el usuario puede ver.
      await assertEntityVisible(db, actor, type, sp.id);
      const label = await entityLabel(type, sp.id);
      if (label) entity = { type, id: sp.id, label };
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nueva tarea" />
      <Card>
        <TaskForm idempotencyKey={randomUUID()} users={scope.all ? await listStaffUsers(db, actor) : []} canAssign={scope.all} entity={entity} returnTo={entity ? taskEntityLink(entity.type, entity.id) : null} />
      </Card>
    </div>
  );
}
