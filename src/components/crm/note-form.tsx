"use client";

import { Textarea } from "@/components/ui";
import { addNoteAction } from "@/app/crm/(panel)/_shared/actions";
import { ActionForm, FormField, SubmitButton } from "./action-form";

export function NoteForm({ entityType, entityId, idempotencyKey }: { entityType: string; entityId: string; idempotencyKey: string }) {
  return (
    <ActionForm action={addNoteAction} idempotencyKey={idempotencyKey} resetOnSuccess aria-label="Agregar nota" className="gap-2">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <FormField name="body" label="Nueva nota">
        {(p) => <Textarea {...p} rows={3} maxLength={10000} placeholder="Qué pasó, qué pidió, próximos pasos…" />}
      </FormField>
      <div>
        <SubmitButton size="sm" pendingLabel="Guardando…">
          Agregar nota
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
