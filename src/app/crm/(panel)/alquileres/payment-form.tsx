"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Input, Select } from "@/components/ui";
import type { FormState } from "@/components/rentals/form-state";
import { registerPaymentAction } from "./actions";

/**
 * Cobro rápido. La clave de idempotencia viene del servidor al renderizar y solo cambia tras un cobro confirmado
 * (el servidor devuelve un nonce nuevo): un doble clic o un reenvío del mismo formulario nunca registra dos pagos.
 */
export function PaymentForm({ obligationId, remaining, currency, today, initialKey }: { obligationId: string; remaining: string; currency: string; today: string; initialKey: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(registerPaymentAction, {});
  const key = state.nonce ?? initialKey;
  // Tras un cobro confirmado el formulario se oculta: registrar otro requiere un clic explícito
  // (evita un segundo cobro accidental por el saldo restante).
  const [reopenedFor, setReopenedFor] = useState<string | undefined>();
  if (state.ok && reopenedFor !== state.nonce) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Alert tone="success">{state.message}</Alert>
        <Button variant="secondary" size="sm" onClick={() => setReopenedFor(state.nonce)}>
          Registrar otro cobro
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="obligationId" value={obligationId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
        Monto ({currency})
        <Input name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue={remaining} key={`${remaining}-${state.nonce ?? ""}`} className="w-36" required />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
        Fecha
        <Input name="paidOn" type="date" max={today} defaultValue={today} className="w-40" required />
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
        Medio
        <Select name="method" defaultValue="transfer" className="w-36">
          <option value="transfer">Transferencia</option>
          <option value="cash">Efectivo</option>
          <option value="deposit">Depósito</option>
          <option value="check">Cheque</option>
          <option value="other">Otro</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
        Referencia
        <Input name="reference" maxLength={200} className="w-40" placeholder="Opcional" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Registrando…" : "Registrar cobro"}
      </Button>
      {state.error ? (
        <div className="basis-full">
          <Alert tone="danger">
            {state.error}
            {state.fieldErrors ? ` ${Object.values(state.fieldErrors).flat().join(" · ")}` : ""}
          </Alert>
        </div>
      ) : null}
    </form>
  );
}
