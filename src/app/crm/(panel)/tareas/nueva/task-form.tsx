"use client";

import { Input, Select, Textarea } from "@/components/ui";
import { ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { PRIORITY_LABEL, TASK_KIND_LABEL } from "@/components/crm/labels";
import { createTaskAction } from "../actions";

export function TaskForm({ idempotencyKey, users, canAssign, entity, returnTo }: { idempotencyKey: string; users: Array<{ id: string; fullName: string }>; canAssign: boolean; entity: { type: string; id: string; label: string } | null; returnTo: string | null }) {
  return (
    <ActionForm action={createTaskAction} idempotencyKey={idempotencyKey} aria-label="Nueva tarea">
      {entity ? (
        <>
          <input type="hidden" name="entityType" value={entity.type} />
          <input type="hidden" name="entityId" value={entity.id} />
          <p className="text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Vinculada a</span>
            <span className="block">{entity.label}</span>
          </p>
        </>
      ) : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <FormField name="title" label="Qué hay que hacer" errorKeys={["entityId"]}>
        {(p) => <Input {...p} maxLength={200} required autoFocus />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField name="kind" label="Tipo">
          {(p) => (
            <Select {...p} defaultValue="task">
              {Object.entries(TASK_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField name="priority" label="Prioridad">
          {(p) => (
            <Select {...p} defaultValue="normal">
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField name="dueAt" label="Vence" hint="Hora de Salta">
          {(p) => <Input {...p} type="datetime-local" />}
        </FormField>
      </div>
      {canAssign ? (
        <FormField name="assignedUserId" label="Responsable">
          {(p) => (
            <Select {...p} defaultValue="">
              <option value="">Yo</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}
      <FormField name="description" label="Detalle (opcional)">
        {(p) => <Textarea {...p} rows={3} maxLength={5000} />}
      </FormField>
      <div>
        <SubmitButton pendingLabel="Creando…">Crear tarea</SubmitButton>
      </div>
    </ActionForm>
  );
}
