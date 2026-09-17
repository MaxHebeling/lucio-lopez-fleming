"use client";

import { Input, Textarea } from "@/components/ui";
import { ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { ActionButton } from "@/components/crm/action-button";
import { DialogButton } from "@/components/crm/dialog-button";
import { acceptSuggestionAction, dismissSuggestionAction, snoozeSuggestionAction } from "@/app/crm/(panel)/_management/actions";

/** Aceptar (crea la tarea real), Posponer (hasta una fecha) y Descartar (motivo opcional) de una tarea sugerida. */
export function SuggestionDecisions({ id, title, minDate, maxDate, defaultDate, returnQuery }: { id: string; title: string; minDate: string; maxDate: string; defaultDate: string; returnQuery: string }) {
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <ActionButton
        action={async () => {
          const r = await acceptSuggestionAction({ id });
          return r.ok ? { ok: true as const, data: { id: r.data.taskId } } : r;
        }}
        variant="primary"
        pendingLabel="Creando tarea…"
        successHref={`/crm/tareas-sugeridas?${returnQuery}${returnQuery ? "&" : ""}tarea=aceptada`}
      >
        Aceptar y crear tarea
      </ActionButton>
      <DialogButton label="Posponer" title="Posponer la sugerencia" variant="ghost">
        {(close) => (
          <ActionForm action={snoozeSuggestionAction} onSuccess={close} aria-label="Posponer sugerencia">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm text-ink-2">«{title}» vuelve a aparecer desde la fecha elegida (8:00). Queda registrado.</p>
            <FormField name="until" label="Posponer hasta">
              {(p) => <Input {...p} type="date" min={minDate} max={maxDate} defaultValue={defaultDate} required />}
            </FormField>
            <div className="flex justify-end">
              <SubmitButton>Posponer</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogButton>
      <DialogButton label="Descartar" title="Descartar la sugerencia" variant="ghost">
        {(close) => (
          <ActionForm action={dismissSuggestionAction} onSuccess={close} aria-label="Descartar sugerencia">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm text-ink-2">«{title}» no vuelve a sugerirse mientras la situación no cambie. Queda registrado.</p>
            <FormField name="note" label="Motivo (opcional)">
              {(p) => <Textarea {...p} maxLength={300} placeholder="Ej.: ya lo resolvimos por teléfono" />}
            </FormField>
            <div className="flex justify-end">
              <SubmitButton variant="danger">Descartar</SubmitButton>
            </div>
          </ActionForm>
        )}
      </DialogButton>
    </div>
  );
}
