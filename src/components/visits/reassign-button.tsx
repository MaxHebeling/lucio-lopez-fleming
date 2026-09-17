"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Select } from "@/components/ui";
import { DialogButton } from "@/components/crm/dialog-button";
import { useAction } from "@/components/crm/use-action";
import { reassignVisitAction } from "@/app/crm/(panel)/mis-visitas/actions";

/** Reasignar agente (misma franja). La base valida que el nuevo agente no tenga otra cita superpuesta. */
export function ReassignButton({ appointmentId, currentUserId, label, users }: { appointmentId: string; currentUserId: string; label: string; users: Array<{ id: string; fullName: string }> }) {
  return (
    <DialogButton label="Reasignar" title={`Reasignar · ${label}`} size="sm">
      {(close) => <ReassignForm appointmentId={appointmentId} currentUserId={currentUserId} users={users} onDone={close} />}
    </DialogButton>
  );
}

function ReassignForm({ appointmentId, currentUserId, users, onDone }: { appointmentId: string; currentUserId: string; users: Array<{ id: string; fullName: string }>; onDone: () => void }) {
  const router = useRouter();
  const action = useAction(reassignVisitAction);
  const [userId, setUserId] = useState(currentUserId);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run({ appointmentId, assignedUserId: userId }).then((r) => {
          if (r.ok) {
            onDone();
            router.refresh();
          }
        });
      }}
    >
      <p className="text-sm text-stone">La visita mantiene su horario y vuelve a «Programada» para el nuevo agente, que recibe un aviso.</p>
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      <Field label="Agente" htmlFor={`reassign-${appointmentId}`}>
        <Select id={`reassign-${appointmentId}`} value={userId} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" className="h-11" disabled={action.pending || userId === currentUserId} aria-busy={action.pending}>
        {action.pending ? "Reasignando…" : "Reasignar"}
      </Button>
    </form>
  );
}
