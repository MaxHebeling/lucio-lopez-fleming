"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, Select } from "@/components/ui";
import type { FormState } from "@/components/rentals/form-state";
import { createContractAction } from "../actions";
import { ContractFields } from "../contract-fields";
import { PartyPicker, serializeParties, type Party } from "../party-picker";

type PropertyOption = { id: string; code: number; title: string; status: string; owners: Array<{ contactId: string; name: string; sharePct: string | null }> };

export function ContractForm({ properties, initialPropertyId }: { properties: PropertyOption[]; initialPropertyId?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createContractAction, {});
  const [propertyId, setPropertyId] = useState(initialPropertyId ?? "");
  const ownersFor = (id: string): Party[] =>
    (properties.find((p) => p.id === id)?.owners ?? []).map((o) => ({ kind: "existing", contactId: o.contactId, name: o.name, sharePct: o.sharePct ?? undefined }));
  const [owners, setOwners] = useState<Party[]>(() => ownersFor(initialPropertyId ?? ""));
  const [tenants, setTenants] = useState<Party[]>([]);
  const [guarantors, setGuarantors] = useState<Party[]>([]);
  const errors = state.fieldErrors ?? {};
  const selected = properties.find((p) => p.id === propertyId);

  return (
    <form action={action} className="flex flex-col gap-6" noValidate>
      {state.error ? (
        <Alert tone="danger">
          {state.error}
          {Object.keys(errors).length ? (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {Object.entries(errors).map(([k, v]) => (
                <li key={k}>{v.join(" · ")}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      <Field label="Propiedad" htmlFor="propertyId" error={errors.propertyId} hint={selected && selected.status !== "available" ? `Estado actual: ${selected.status}. Al activar, solo una propiedad disponible o reservada pasa a alquilada.` : undefined}>
        <Select
          id="propertyId"
          name="propertyId"
          required
          value={propertyId}
          onChange={(e) => {
            setPropertyId(e.target.value);
            setOwners(ownersFor(e.target.value));
          }}
        >
          <option value="">Elegí una propiedad</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              #{p.code} · {p.title}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PartyPicker label="Propietarios" parties={owners} onChange={setOwners} withShare error={errors.owners} />
        <PartyPicker label="Inquilinos" parties={tenants} onChange={setTenants} error={errors.tenants} />
        <PartyPicker label="Garantes" parties={guarantors} onChange={setGuarantors} error={errors.guarantors} />
      </div>
      <input type="hidden" name="owners" value={serializeParties(owners)} />
      <input type="hidden" name="tenants" value={serializeParties(tenants)} />
      <input type="hidden" name="guarantors" value={serializeParties(guarantors)} />

      <ContractFields errors={errors} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Crear contrato (borrador)"}
        </Button>
        <p className="text-xs text-stone">Se guarda como borrador. Las cuotas se generan al activarlo desde la ficha.</p>
      </div>
    </form>
  );
}
