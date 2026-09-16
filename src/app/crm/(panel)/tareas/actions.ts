"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { runAction } from "@/server/next/action";
import { cancelTask, completeTask, createTask, createTaskSchema, reopenTask, taskActionSchema } from "@/server/tasks/service";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};

export async function createTaskAction(fd: FormData) {
  const r = await runAction(
    "tasks.create",
    createTaskSchema,
    {
      title: str(fd, "title") ?? "",
      description: str(fd, "description"),
      kind: str(fd, "kind") || "task",
      priority: str(fd, "priority") || "normal",
      dueAt: str(fd, "dueAt"),
      assignedUserId: str(fd, "assignedUserId") || null,
      entityType: str(fd, "entityType") || null,
      entityId: str(fd, "entityId") || null,
      idempotencyKey: str(fd, "idempotencyKey"),
    },
    (d, actor) => createTask(getDb(), actor, d),
  );
  if (!r.ok) return r;
  const back = str(fd, "returnTo");
  redirect(back && /^\/crm\/[\w\-/]*$/.test(back) ? back : "/crm/tareas");
}

export async function completeTaskAction(input: z.input<typeof taskActionSchema>) {
  const r = await runAction("tasks.complete", taskActionSchema, input, (d, actor) => completeTask(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function cancelTaskAction(input: z.input<typeof taskActionSchema>) {
  const r = await runAction("tasks.cancel", taskActionSchema, input, (d, actor) => cancelTask(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}

export async function reopenTaskAction(input: z.input<typeof taskActionSchema>) {
  const r = await runAction("tasks.reopen", taskActionSchema, input, (d, actor) => reopenTask(getDb(), actor, d));
  if (r.ok) refresh();
  return r;
}
