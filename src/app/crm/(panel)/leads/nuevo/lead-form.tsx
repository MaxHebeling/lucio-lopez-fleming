"use client";

import { Checkbox, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { EntitySearch, type SearchOption } from "@/components/crm/entity-search";
import { INTEREST_LABEL, PRIORITY_LABEL } from "@/components/crm/labels";
import { searchPropertiesAction } from "../../_shared/actions";
import { createManualLeadAction } from "../actions";

const SOURCES = [
  ["phone", "Llamada telefónica"],
  ["walk_in", "Se acercó a la oficina"],
  ["manual", "Otra vía (carga manual)"],
] as const;

export function LeadForm({ idempotencyKey, users, canAssign, canSearchProperties, initialProperty }: { idempotencyKey: string; users: Array<{ id: string; fullName: string }>; canAssign: boolean; canSearchProperties: boolean; initialProperty: SearchOption | null }) {
  return (
    <ActionForm action={createManualLeadAction} idempotencyKey={idempotencyKey} aria-label="Nuevo lead">
      <FormField name="name" label="Nombre y apellido">
        {(p) => <Input {...p} autoComplete="off" maxLength={200} required />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <FormField name="phone" label="Teléfono" hint="Con código de área">
            {(p) => <Input {...p} type="tel" inputMode="tel" autoComplete="off" maxLength={40} />}
          </FormField>
          <Checkbox name="phoneIsWhatsapp" label="Tiene WhatsApp" defaultChecked />
        </div>
        <FormField name="email" label="Email">
          {(p) => <Input {...p} type="email" inputMode="email" autoComplete="off" maxLength={254} />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="sourceKey" label="Cómo llegó">
          {(p) => (
            <Select {...p} defaultValue="phone">
              {SOURCES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField name="operationInterest" label="Busca">
          {(p) => (
            <Select {...p} defaultValue="">
              <option value="">Sin especificar</option>
              {Object.entries(INTEREST_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      {canSearchProperties ? (
        <EntitySearch name="propertyId" label="Propiedad consultada (opcional)" search={searchPropertiesAction} initial={initialProperty} placeholder="Código, título o dirección" hint="Escribí el código o parte de la dirección" />
      ) : null}
      <FormField name="message" label="Qué consultó">
        {(p) => <Textarea {...p} rows={3} maxLength={5000} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="priority" label="Prioridad">
          {(p) => (
            <Select {...p} defaultValue="normal">
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {canAssign ? (
          <FormField name="assignedUserId" label="Asignar a">
            {(p) => (
              <Select {...p} defaultValue="">
                <option value="">Sin asignar</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : (
          <p className="self-end text-sm text-stone">Queda asignado a vos.</p>
        )}
      </div>
      <div>
        <SubmitButton pendingLabel="Guardando…">Crear lead</SubmitButton>
      </div>
    </ActionForm>
  );
}
