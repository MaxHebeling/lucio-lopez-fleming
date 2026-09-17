"use client";

import { useState } from "react";
import { Input, Select, Textarea } from "@/components/ui";
import {
  ActionButton,
  ActionForm,
  FormField,
  SubmitButton,
} from "@/components/crm/action-form";
import { DialogButton } from "@/components/crm/dialog-button";
import {
  EntitySearch,
  type SearchOption,
} from "@/components/crm/entity-search";
import { APPOINTMENT_KIND_LABEL } from "@/components/crm/labels";
import { canTransition, isActive } from "@/server/visits/state";
import {
  searchContactsAction,
  searchPropertiesAction,
} from "../_shared/actions";
import {
  cancelAppointmentAction,
  completeAppointmentAction,
  confirmAppointmentAction,
  createAppointmentAction,
  noShowAction,
  rescheduleAction,
} from "./actions";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];
type Users = Array<{ id: string; fullName: string }>;

function DurationField({ defaultValue = 60 }: { defaultValue?: number }) {
  const options = DURATIONS.includes(defaultValue)
    ? DURATIONS
    : [...DURATIONS, defaultValue].sort((a, b) => a - b);
  return (
    <FormField name="durationMinutes" label="Duración">
      {(p) => (
        <Select {...p} defaultValue={String(defaultValue)}>
          {options.map((m) => (
            <option key={m} value={m}>
              {m < 60
                ? `${m} min`
                : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

export function NewAppointmentForm({
  idempotencyKey,
  defaultKind,
  defaultStart,
  users,
  canAssignOthers,
  canSearchProperties,
  initialProperty,
  initialContact,
  opportunity,
  lead,
}: {
  idempotencyKey: string;
  defaultKind: string;
  defaultStart: string;
  users: Users;
  canAssignOthers: boolean;
  canSearchProperties: boolean;
  initialProperty: SearchOption | null;
  initialContact: SearchOption | null;
  opportunity: SearchOption | null;
  lead: SearchOption | null;
}) {
  const [kind, setKind] = useState(defaultKind);
  return (
    <ActionForm
      action={createAppointmentAction}
      idempotencyKey={idempotencyKey}
      aria-label="Agendar"
    >
      {opportunity ? (
        <input type="hidden" name="opportunityId" value={opportunity.id} />
      ) : null}
      {lead ? <input type="hidden" name="leadId" value={lead.id} /> : null}
      {opportunity || lead ? (
        <p className="text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            Vinculada a
          </span>
          <span className="block">{opportunity?.label ?? lead?.label}</span>
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="kind" label="Tipo">
          {(p) => (
            <Select
              {...p}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {Object.entries(APPOINTMENT_KIND_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {canAssignOthers ? (
          <FormField name="assignedUserId" label="Agente">
            {(p) => (
              <Select {...p} defaultValue="">
                <option value="">Yo</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <FormField name="startsAt" label="Fecha y hora" hint="Hora de Salta">
          {(p) => (
            <Input
              {...p}
              type="datetime-local"
              defaultValue={defaultStart}
              required
              step={300}
            />
          )}
        </FormField>
        <DurationField />
      </div>
      {canSearchProperties ? (
        <EntitySearch
          name="propertyId"
          label={
            kind === "visit" ? "Propiedad a visitar" : "Propiedad (opcional)"
          }
          search={searchPropertiesAction}
          initial={initialProperty}
          placeholder="Código, título o dirección"
          hint={
            opportunity || lead
              ? "Si la dejás vacía se usa la de la oportunidad o el lead"
              : undefined
          }
        />
      ) : null}
      <EntitySearch
        name="contactId"
        label="Contacto"
        search={searchContactsAction}
        initial={initialContact}
        placeholder="Nombre, email o teléfono"
      />
      <FormField
        name="title"
        label="Título (opcional)"
        hint="Si lo dejás vacío: tipo · propiedad · contacto"
      >
        {(p) => <Input {...p} maxLength={200} />}
      </FormField>
      <FormField
        name="location"
        label="Lugar (opcional)"
        hint="Para visitas se usa la dirección de la propiedad"
      >
        {(p) => <Input {...p} maxLength={300} />}
      </FormField>
      <FormField name="notes" label="Notas (opcional)">
        {(p) => <Textarea {...p} rows={2} maxLength={5000} />}
      </FormField>
      <div>
        <SubmitButton pendingLabel="Agendando…">Agendar</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AppointmentActions({
  id,
  status,
  started,
  startLocal,
  durationMinutes,
  users,
  assignedUserId,
  canAssignOthers,
}: {
  id: string;
  status: string;
  started: boolean;
  startLocal: string;
  durationMinutes: number;
  users: Users;
  assignedUserId: string;
  canAssignOthers: boolean;
}) {
  if (!isActive(status))
    return <p className="text-sm text-stone">La cita ya no está activa.</p>;
  // En camino / check-in / en curso (portal de visitas): se puede cerrar o cancelar; reprogramar solo antes de llegar.
  const canReschedule =
    status === "scheduled" || status === "confirmed" || status === "en_route";
  return (
    <div className="flex flex-wrap gap-2">
      {status === "scheduled" ? (
        <ActionButton
          action={confirmAppointmentAction}
          input={{ appointmentId: id }}
          variant="secondary"
          size="md"
          pendingLabel="Confirmando…"
        >
          Confirmar
        </ActionButton>
      ) : null}
      {started && canTransition(status, "completed") ? (
        <>
          <DialogButton
            label="Marcar realizada"
            title="Resultado de la cita"
            variant="primary"
            size="md"
          >
            {(close) => (
              <ActionForm action={completeAppointmentAction} onSuccess={close}>
                <input type="hidden" name="appointmentId" value={id} />
                <FormField name="result" label="¿Cómo fue? (obligatorio)">
                  {(p) => (
                    <Textarea
                      {...p}
                      rows={4}
                      maxLength={5000}
                      autoFocus
                      placeholder="Interés, objeciones, próximos pasos…"
                    />
                  )}
                </FormField>
                <SubmitButton>Guardar resultado</SubmitButton>
              </ActionForm>
            )}
          </DialogButton>
          {canTransition(status, "no_show") ? (
            <ActionButton
              action={noShowAction}
              input={{ appointmentId: id }}
              variant="secondary"
              size="md"
              confirm="¿Marcar que el contacto no asistió?"
              pendingLabel="Guardando…"
            >
              No asistió
            </ActionButton>
          ) : null}
        </>
      ) : null}
      {canReschedule ? (
        <DialogButton
          label="Reprogramar"
          title="Reprogramar"
          variant="secondary"
          size="md"
        >
          {(close) => (
            <ActionForm action={rescheduleAction} onSuccess={close}>
              <input type="hidden" name="appointmentId" value={id} />
              <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <FormField
                  name="startsAt"
                  label="Nueva fecha y hora"
                  hint="Hora de Salta"
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="datetime-local"
                      defaultValue={startLocal}
                      step={300}
                    />
                  )}
                </FormField>
                <DurationField defaultValue={durationMinutes} />
              </div>
              {canAssignOthers ? (
                <FormField name="assignedUserId" label="Agente">
                  {(p) => (
                    <Select {...p} defaultValue={assignedUserId}>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.fullName}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              ) : null}
              <FormField name="reason" label="Motivo (opcional)">
                {(p) => <Input {...p} maxLength={500} />}
              </FormField>
              <SubmitButton>Reprogramar</SubmitButton>
            </ActionForm>
          )}
        </DialogButton>
      ) : null}
      <DialogButton
        label="Cancelar cita"
        title="Cancelar cita"
        variant="danger"
        size="md"
      >
        {(close) => (
          <ActionForm action={cancelAppointmentAction} onSuccess={close}>
            <input type="hidden" name="appointmentId" value={id} />
            <FormField name="reason" label="Motivo (obligatorio)">
              {(p) => <Textarea {...p} rows={3} maxLength={500} autoFocus />}
            </FormField>
            <SubmitButton variant="danger">Cancelar cita</SubmitButton>
          </ActionForm>
        )}
      </DialogButton>
    </div>
  );
}
