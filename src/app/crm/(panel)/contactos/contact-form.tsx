"use client";

import { useState } from "react";
import { Checkbox, Input, Select } from "@/components/ui";
import { ActionForm, FormField, SubmitButton, type ClientActionResult } from "@/components/crm/action-form";
import { CONTACT_ROLE_LABEL, DOCUMENT_TYPE_LABEL } from "@/components/crm/labels";

type Initial = {
  id?: string;
  kind: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  assignedUserId: string | null;
  documentType: string | null;
  documentNumber: string | null;
};

export function ContactForm({
  mode,
  action,
  users,
  canPrivate,
  initial,
  idempotencyKey,
}: {
  mode: "create" | "edit";
  action: (fd: FormData) => Promise<ClientActionResult<unknown> | undefined>;
  users: Array<{ id: string; fullName: string }>;
  canPrivate: boolean;
  initial?: Initial;
  idempotencyKey?: string;
}) {
  const [kind, setKind] = useState(initial?.kind ?? "person");
  return (
    <ActionForm action={action} idempotencyKey={idempotencyKey} aria-label={mode === "create" ? "Nuevo contacto" : "Editar contacto"}>
      {initial?.id ? <input type="hidden" name="contactId" value={initial.id} /> : null}
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Tipo</legend>
        {[
          ["person", "Persona"],
          ["company", "Empresa"],
        ].map(([v, l]) => (
          <label key={v} className="inline-flex items-center gap-2 text-sm">
            <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v!)} className="size-4 accent-[var(--ink)]" />
            {l}
          </label>
        ))}
      </fieldset>
      {kind === "person" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="firstName" label="Nombre">
            {(p) => <Input {...p} defaultValue={initial?.firstName ?? ""} autoComplete="off" maxLength={100} />}
          </FormField>
          <FormField name="lastName" label="Apellido">
            {(p) => <Input {...p} defaultValue={initial?.lastName ?? ""} autoComplete="off" maxLength={100} />}
          </FormField>
        </div>
      ) : null}
      <FormField name="companyName" label={kind === "company" ? "Razón social" : "Empresa (opcional)"}>
        {(p) => <Input {...p} defaultValue={initial?.companyName ?? ""} maxLength={200} />}
      </FormField>
      {mode === "create" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField name="email" label="Email" errorKeys={["emails.0.email", "emails"]}>
              {(p) => <Input {...p} type="email" inputMode="email" autoComplete="off" maxLength={254} />}
            </FormField>
            <div className="flex flex-col gap-2">
              <FormField name="phone" label="Teléfono" hint="Con código de área, ej. 387 5123456" errorKeys={["phones.0.phone", "phones"]}>
                {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="off" maxLength={40} />}
              </FormField>
              <Checkbox name="phoneIsWhatsapp" label="Tiene WhatsApp" defaultChecked />
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Roles</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {Object.entries(CONTACT_ROLE_LABEL).map(([v, l]) => (
                <Checkbox key={v} name="roles" value={v} label={l} />
              ))}
            </div>
          </fieldset>
          <FormField name="tags" label="Etiquetas" hint="Separadas por coma, ej. Inversor, Barrio Norte">
            {(p) => <Input {...p} maxLength={600} />}
          </FormField>
        </>
      ) : null}
      <FormField name="assignedUserId" label="Responsable">
        {(p) => (
          <Select {...p} defaultValue={initial?.assignedUserId ?? ""}>
            <option value="">Sin responsable</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {canPrivate ? (
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <FormField name="documentType" label="Documento">
            {(p) => (
              <Select {...p} defaultValue={initial?.documentType ?? ""}>
                <option value="">—</option>
                {Object.entries(DOCUMENT_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField name="documentNumber" label="Número" hint="Dato sensible: solo lo ve quien tiene permiso">
            {(p) => <Input {...p} defaultValue={initial?.documentNumber ?? ""} maxLength={40} autoComplete="off" />}
          </FormField>
        </div>
      ) : null}
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Guardando…">{mode === "create" ? "Crear contacto" : "Guardar cambios"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
