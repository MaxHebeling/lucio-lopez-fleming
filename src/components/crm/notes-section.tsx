import { Card, formatDateTime } from "@/components/ui";
import { NoteForm } from "./note-form";

type Note = { id: string; body: string; created_at: Date; author_name: string | null };

export function NotesSection({ notes, entityType, entityId, canWrite, idempotencyKey }: { notes: Note[]; entityType: "contact" | "lead" | "opportunity" | "appointment"; entityId: string; canWrite: boolean; idempotencyKey: string }) {
  return (
    <Card title={`Notas (${notes.length})`}>
      {canWrite ? <NoteForm entityType={entityType} entityId={entityId} idempotencyKey={idempotencyKey} /> : null}
      {notes.length === 0 ? (
        <p className="mt-3 text-sm text-stone">Todavía no hay notas.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {notes.map((n) => (
            <li key={n.id} className="py-3">
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{n.body}</p>
              <p className="mt-1 text-xs text-stone">
                {n.author_name ?? "Sistema"} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
