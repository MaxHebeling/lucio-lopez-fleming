"use client";

import { Select, Textarea } from "@/components/ui";
import { ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { DialogButton } from "@/components/crm/dialog-button";
import { FIRST_CONTACT_CHANNEL_LABEL, LEAD_STATUS_LABEL, PRIORITY_LABEL } from "@/components/crm/labels";
import { assignLeadAction, changeLeadPriorityAction, changeLeadStatusAction, convertLeadAction, registerFirstContactAction } from "../actions";

export function StatusForm({ leadId, status }: { leadId: string; status: string }) {
  return (
    <ActionForm action={changeLeadStatusAction} className="gap-2" aria-label="Cambiar estado">
      <input type="hidden" name="leadId" value={leadId} />
      <FormField name="status" label="Estado">
        {(p) => (
          <div className="flex gap-2">
            <Select {...p} defaultValue={status}>
              {Object.entries(LEAD_STATUS_LABEL)
                .filter(([v]) => v !== "converted")
                .map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
            </Select>
            <SubmitButton variant="secondary" pendingLabel="…">
              Guardar
            </SubmitButton>
          </div>
        )}
      </FormField>
    </ActionForm>
  );
}

export function PriorityForm({ leadId, priority }: { leadId: string; priority: string }) {
  return (
    <ActionForm action={changeLeadPriorityAction} className="gap-2" aria-label="Cambiar prioridad">
      <input type="hidden" name="leadId" value={leadId} />
      <FormField name="priority" label="Prioridad">
        {(p) => (
          <div className="flex gap-2">
            <Select {...p} defaultValue={priority}>
              {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <SubmitButton variant="secondary" pendingLabel="…">
              Guardar
            </SubmitButton>
          </div>
        )}
      </FormField>
    </ActionForm>
  );
}

export function AssignForm({ leadId, assignedUserId, users }: { leadId: string; assignedUserId: string | null; users: Array<{ id: string; fullName: string }> }) {
  return (
    <ActionForm action={assignLeadAction} className="gap-2" aria-label="Asignar lead">
      <input type="hidden" name="leadId" value={leadId} />
      <FormField name="userId" label="Asignado a">
        {(p) => (
          <div className="flex gap-2">
            <Select {...p} defaultValue={assignedUserId ?? ""}>
              <option value="">Sin asignar</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
            <SubmitButton variant="secondary" pendingLabel="…">
              Asignar
            </SubmitButton>
          </div>
        )}
      </FormField>
    </ActionForm>
  );
}

export function FirstContactButton({ leadId }: { leadId: string }) {
  return (
    <DialogButton label="Registrar primer contacto" title="Primer contacto" variant="primary" size="md">
      {(close) => (
        <ActionForm action={registerFirstContactAction} onSuccess={close}>
          <input type="hidden" name="leadId" value={leadId} />
          <FormField name="channel" label="Medio">
            {(p) => (
              <Select {...p} defaultValue="call">
                {Object.entries(FIRST_CONTACT_CHANNEL_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField name="note" label="Comentario (opcional)">
            {(p) => <Textarea {...p} rows={3} maxLength={2000} />}
          </FormField>
          <SubmitButton pendingLabel="Registrando…">Registrar</SubmitButton>
        </ActionForm>
      )}
    </DialogButton>
  );
}

export function ConvertButton({ leadId, idempotencyKey, defaultPipeline, pipelines }: { leadId: string; idempotencyKey: string; defaultPipeline: string; pipelines: Array<{ key: string; name: string }> }) {
  return (
    <DialogButton label="Convertir en oportunidad" title="Convertir en oportunidad" variant="secondary" size="md">
      {() => (
        <ActionForm action={convertLeadAction} idempotencyKey={idempotencyKey}>
          <input type="hidden" name="leadId" value={leadId} />
          <FormField name="pipelineKey" label="Pipeline" hint="Toma contacto, propiedad y responsable del lead">
            {(p) => (
              <Select {...p} defaultValue={defaultPipeline}>
                {pipelines.map((pl) => (
                  <option key={pl.key} value={pl.key}>
                    {pl.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <SubmitButton pendingLabel="Creando…">Crear oportunidad</SubmitButton>
        </ActionForm>
      )}
    </DialogButton>
  );
}
