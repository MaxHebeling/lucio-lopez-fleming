"use client";

import { useId, useState } from "react";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { changePriceAction, changeStatusAction, publishAction, unpublishAction } from "../actions";

const OPERATION_LABEL: Record<string, string> = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler temporario" };

/** Cambiar estado: solo transiciones válidas (las calcula el servidor desde STATUS_TRANSITIONS). */
export function StatusForm({ propertyId, current, transitions, labels, isPublished }: { propertyId: string; current: string; transitions: string[]; labels: Record<string, string>; isPublished: boolean }) {
  const uid = useId();
  const [to, setTo] = useState(transitions[0] ?? "");
  const [reason, setReason] = useState("");
  const { run, pending, error, ok, reset } = useAction(changeStatusAction);
  // Tras cambiar de estado cambian las transiciones posibles: la selección se ajusta sin perder el aviso de éxito.
  if (transitions.length && !transitions.includes(to)) setTo(transitions[0]!);
  if (!transitions.length) return <p className="text-sm text-stone">No hay transiciones disponibles desde {labels[current]}.</p>;
  const willUnpublish = isPublished && !["available", "reserved", "sold", "rented"].includes(to);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(propertyId, to, reason);
        if (r.ok) setReason("");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <Field label="Nuevo estado" htmlFor={`${uid}-to`}>
          <Select
            id={`${uid}-to`}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              reset();
            }}
          >
            {transitions.map((t) => (
              <option key={t} value={t}>
                {labels[t] ?? t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Motivo (opcional)" htmlFor={`${uid}-reason`}>
          <Input id={`${uid}-reason`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {willUnpublish ? <Alert tone="warning">Con este estado la propiedad se despublica del sitio y de los portales.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {ok ? <Alert tone="success">Estado actualizado.</Alert> : null}
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Guardando…" : "Cambiar estado"}
      </Button>
    </form>
  );
}

type Op = { operation: string; currency: string; amount: string | null; price_hidden: boolean; expenses_amount: string | null; expenses_currency: string | null };

/** Cambiar precio de una operación existente o agregar una nueva, siempre con motivo (queda en el historial). */
export function PriceForm({ propertyId, operations }: { propertyId: string; operations: Op[] }) {
  const uid = useId();
  const all = ["sale", "rent", "temporary_rent"];
  const [operation, setOperation] = useState(operations[0]?.operation ?? "sale");
  const current = operations.find((o) => o.operation === operation);
  const [currency, setCurrency] = useState(current?.currency ?? "USD");
  const [amount, setAmount] = useState(current?.amount ? String(Number(current.amount)) : "");
  const [priceHidden, setPriceHidden] = useState(current?.price_hidden ?? false);
  const [expenses, setExpenses] = useState(current?.expenses_amount ? String(Number(current.expenses_amount)) : "");
  const [reason, setReason] = useState("");
  const { run, pending, error, fieldErrors, ok, reset } = useAction(changePriceAction);

  const selectOp = (op: string) => {
    const o = operations.find((x) => x.operation === op);
    setOperation(op);
    setCurrency(o?.currency ?? (op === "sale" ? "USD" : "ARS"));
    setAmount(o?.amount ? String(Number(o.amount)) : "");
    setPriceHidden(o?.price_hidden ?? false);
    setExpenses(o?.expenses_amount ? String(Number(o.expenses_amount)) : "");
    reset();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(propertyId, { operation, currency, amount: priceHidden && amount === "" ? null : amount, priceHidden, expensesAmount: expenses, expensesCurrency: expenses ? (current?.expenses_currency ?? "ARS") : null, reason });
        if (r.ok) setReason("");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Operación" htmlFor={`${uid}-op`}>
          <Select id={`${uid}-op`} value={operation} onChange={(e) => selectOp(e.target.value)}>
            {all.map((o) => (
              <option key={o} value={o}>
                {OPERATION_LABEL[o]}
                {operations.some((x) => x.operation === o) ? "" : " (nueva)"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Moneda" htmlFor={`${uid}-cur`}>
          <Select id={`${uid}-cur`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="ARS">ARS ($)</option>
          </Select>
        </Field>
        <Field label="Precio" htmlFor={`${uid}-amount`} error={fieldErrors?.amount}>
          <Input id={`${uid}-amount`} type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={fieldErrors?.amount ? true : undefined} />
        </Field>
        <Field label="Expensas" htmlFor={`${uid}-exp`} error={fieldErrors?.expensesAmount}>
          <Input id={`${uid}-exp`} type="number" inputMode="decimal" min={0} step="any" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
        </Field>
      </div>
      <Checkbox label="Precio a consultar (no se muestra en el sitio)" checked={priceHidden} onChange={(e) => setPriceHidden(e.target.checked)} />
      <Field label="Motivo del cambio" htmlFor={`${uid}-reason`} hint="Queda registrado en el historial de precios." error={fieldErrors?.reason}>
        <Textarea id={`${uid}-reason`} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {ok ? <Alert tone="success">Precio guardado.</Alert> : null}
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Guardando…" : current ? "Guardar precio" : "Agregar operación"}
      </Button>
    </form>
  );
}

/** Publicar / despublicar mostrando lo que falta (publishBlockers del servidor). */
export function PublishControls({ propertyId, isPublished, blockers, canPublish }: { propertyId: string; isPublished: boolean; blockers: string[]; canPublish: boolean }) {
  const publish = useAction(publishAction);
  const unpublish = useAction(unpublishAction);
  if (!canPublish) return null;
  if (isPublished) {
    return (
      <span className="inline-flex flex-col gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={unpublish.pending}
          onClick={async () => {
            const why = window.prompt("Motivo para despublicar (opcional):", "");
            if (why === null) return;
            await unpublish.run(propertyId, why);
          }}
        >
          {unpublish.pending ? "Despublicando…" : "Despublicar"}
        </Button>
        {unpublish.error ? (
          <span role="alert" className="text-xs text-danger">
            {unpublish.error}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        size="sm"
        disabled={publish.pending || blockers.length > 0}
        title={blockers.length ? `No se puede publicar: ${blockers.join(" · ")}` : undefined}
        onClick={async () => {
          await publish.run(propertyId);
        }}
      >
        {publish.pending ? "Publicando…" : "Publicar"}
      </Button>
      {publish.error ? (
        <span role="alert" className="text-xs text-danger">
          {publish.error}
        </span>
      ) : null}
    </span>
  );
}
