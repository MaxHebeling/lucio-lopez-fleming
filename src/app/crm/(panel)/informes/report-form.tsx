"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import type { FormState } from "@/components/rentals/form-state";
import { generateReportAction } from "./actions";

type Owner = { id: string; display_name: string; properties: Array<{ id: string; code: number; title: string }> };

export function ReportForm({ owners, defaultStart, defaultEnd }: { owners: Owner[]; defaultStart: string; defaultEnd: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(generateReportAction, {});
  const [ownerId, setOwnerId] = useState("");
  const props = owners.find((o) => o.id === ownerId)?.properties ?? [];
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      {state.error ? (
        <Alert tone="danger">
          {state.error}
          {state.fieldErrors ? ` ${Object.values(state.fieldErrors).flat().join(" · ")}` : ""}
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Propietario" htmlFor="ownerContactId">
          <Select id="ownerContactId" name="ownerContactId" required value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">Elegí un propietario</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.display_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Propiedad" htmlFor="propertyId">
          <Select id="propertyId" name="propertyId" defaultValue="" key={ownerId}>
            <option value="">Todas sus propiedades</option>
            {props.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.code} · {p.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde" htmlFor="periodStart">
          <Input id="periodStart" name="periodStart" type="date" required defaultValue={defaultStart} />
        </Field>
        <Field label="Hasta" htmlFor="periodEnd">
          <Input id="periodEnd" name="periodEnd" type="date" required defaultValue={defaultEnd} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="refresh" className="size-4" /> Si ya existe y no se envió, regenerarlo con los datos de hoy
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Generando…" : "Generar informe"}
        </Button>
      </div>
    </form>
  );
}
