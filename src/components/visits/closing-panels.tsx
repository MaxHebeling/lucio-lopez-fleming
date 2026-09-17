"use client";

/** Seguimiento (tarea confirmada por una persona) y agradecimiento (plantilla editable, envío manual). */
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Field, Input, Textarea, formatDateTime } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { createFollowUpAction, markThanksSentAction, saveThanksAction } from "@/app/crm/(panel)/mis-visitas/actions";
import { CopyButton } from "./copy-button";

export function FollowUpPanel({
  appointmentId,
  reportConfirmed,
  suggestedLocal,
  suggestionHint,
  task,
  canCreate,
}: {
  appointmentId: string;
  reportConfirmed: boolean;
  suggestedLocal: string;
  suggestionHint: string;
  task: { id: string; title: string; dueAt: string | null; status: string } | null;
  canCreate: boolean;
}) {
  const action = useAction(createFollowUpAction);
  const [dueAt, setDueAt] = useState(suggestedLocal);
  if (task) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="rounded-[var(--radius-md)] border border-success/30 bg-[#eef6f0] px-3 py-2 font-semibold text-success">Tarea de seguimiento creada</p>
        <p>
          <span className="font-semibold">{task.title}</span>
          <span className="block text-stone">
            {task.dueAt ? `Vence ${formatDateTime(task.dueAt)}` : "Sin vencimiento"} · {task.status === "open" ? "Pendiente" : task.status === "done" ? "Completada" : "Cancelada"}
          </span>
        </p>
        <Link href="/crm/tareas" className="self-start font-semibold underline underline-offset-4">
          Ver mis tareas
        </Link>
      </div>
    );
  }
  if (!reportConfirmed) return <p className="text-sm text-stone">Confirmá el informe para crear el seguimiento.</p>;
  if (!canCreate) return <p className="text-sm text-stone">Sin permiso para crear tareas.</p>;
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Crear tarea de seguimiento"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({ appointmentId, dueAt });
      }}
    >
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <Field label="Fecha y hora del seguimiento" htmlFor="followup-due" hint={suggestionHint} error={action.fieldErrors?.dueAt}>
        <Input id="followup-due" type="datetime-local" step={300} value={dueAt} onChange={(e) => setDueAt(e.target.value)} required />
      </Field>
      <Button type="submit" className="h-12" disabled={action.pending || !dueAt} aria-busy={action.pending}>
        {action.pending ? "Creando…" : "Crear tarea de seguimiento"}
      </Button>
    </form>
  );
}

export function ThanksPanel({
  appointmentId,
  initialMessage,
  saved,
  markedSentAt,
  clientWhatsappE164,
  canManage,
}: {
  appointmentId: string;
  initialMessage: string;
  saved: boolean;
  markedSentAt: string | null;
  clientWhatsappE164: string | null;
  canManage: boolean;
}) {
  const save = useAction(saveThanksAction);
  const sent = useAction(markThanksSentAction);
  const [message, setMessage] = useState(initialMessage);
  const [savedMessage, setSavedMessage] = useState(saved ? initialMessage : null);
  const [channel, setChannel] = useState<"whatsapp" | "copy" | "other">("other");
  const dirty = message.trim() !== (savedMessage ?? "").trim();
  const waUrl = `https://wa.me/${clientWhatsappE164 ? clientWhatsappE164.replace(/\D/g, "") : ""}?text=${encodeURIComponent(message.trim())}`;

  const persist = async (): Promise<boolean> => {
    if (!dirty) return true;
    const r = await save.run({ appointmentId, message });
    if (r.ok) setSavedMessage(message);
    return r.ok;
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-stone">Texto por plantilla, editable. Nada se envía solo: copialo o abrilo en WhatsApp y después marcalo como enviado. Guardado, también aparece en la tarjeta del link del cliente.</p>
      {save.error || sent.error ? <Alert tone="danger">{save.error ?? sent.error}</Alert> : null}
      {markedSentAt ? <p className="rounded-[var(--radius-md)] border border-success/30 bg-[#eef6f0] px-3 py-2 font-semibold text-success">Marcado como enviado · {formatDateTime(markedSentAt)}</p> : null}
      <Field label="Mensaje de agradecimiento" htmlFor="thanks-message" error={save.fieldErrors?.message}>
        <Textarea id="thanks-message" rows={5} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!canManage} />
      </Field>
      {canManage ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="secondary" className="h-11" disabled={save.pending || !dirty} onClick={() => void persist()}>
              {save.pending ? "Guardando…" : dirty ? "Guardar mensaje" : "Mensaje guardado"}
            </Button>
            <CopyButton text={message.trim()} label="Copiar mensaje" className="h-11" onCopied={() => setChannel("copy")} />
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setChannel("whatsapp")}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-2"
            >
              Abrir WhatsApp con el mensaje
            </a>
          </div>
          {!markedSentAt ? (
            <Button
              className="h-12"
              disabled={sent.pending || save.pending}
              aria-busy={sent.pending}
              onClick={async () => {
                if (await persist()) await sent.run({ appointmentId, channel });
              }}
            >
              {sent.pending ? "Registrando…" : "Marcar como enviado"}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
