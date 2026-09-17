"use client";

import { Input, Select, Textarea } from "@/components/ui";
import { ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { DialogButton } from "@/components/crm/dialog-button";
import { EntitySearch, type SearchOption } from "@/components/crm/entity-search";
import { OPERATION_LABEL } from "@/components/crm/labels";
import { searchContactsAction, searchPropertiesAction } from "../_shared/actions";
import { assignOpportunityAction, createOpportunityAction, loseAction, moveStageFormAction, pauseAction, updateOpportunityAction, winAction } from "./actions";

type Users = Array<{ id: string; fullName: string }>;
type Requirements = { text?: string; zones?: string; bedroomsMin?: number | null };

function BudgetFields({ min, max, currency }: { min?: string | null; max?: string | null; currency?: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[8rem_1fr_1fr]">
      <FormField name="budgetCurrency" label="Moneda">
        {(p) => (
          <Select {...p} defaultValue={currency ?? "USD"}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </Select>
        )}
      </FormField>
      <FormField name="budgetMin" label="Presupuesto desde">
        {(p) => <Input {...p} inputMode="decimal" defaultValue={min ? String(Number(min)) : ""} />}
      </FormField>
      <FormField name="budgetMax" label="Hasta">
        {(p) => <Input {...p} inputMode="decimal" defaultValue={max ? String(Number(max)) : ""} />}
      </FormField>
    </div>
  );
}

function RequirementFields({ req }: { req?: Requirements }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <FormField name="reqZones" label="Zonas" errorKeys={["requirements.zones"]}>
          {(p) => <Input {...p} defaultValue={req?.zones ?? ""} maxLength={300} placeholder="Tres Cerritos, Grand Bourg…" />}
        </FormField>
        <FormField name="bedroomsMin" label="Dormitorios mín." errorKeys={["requirements.bedroomsMin"]}>
          {(p) => <Input {...p} type="number" min={0} max={50} inputMode="numeric" defaultValue={req?.bedroomsMin ?? ""} />}
        </FormField>
      </div>
      <FormField name="reqText" label="Qué busca" errorKeys={["requirements.text"]}>
        {(p) => <Textarea {...p} rows={3} defaultValue={req?.text ?? ""} maxLength={2000} />}
      </FormField>
    </>
  );
}

export function NewOpportunityForm({
  idempotencyKey,
  pipelines,
  initialContact,
  users,
  canAssign,
  canSearchProperties,
}: {
  idempotencyKey: string;
  pipelines: Array<{ key: string; name: string }>;
  initialContact: SearchOption | null;
  users: Users;
  canAssign: boolean;
  canSearchProperties: boolean;
}) {
  return (
    <ActionForm action={createOpportunityAction} idempotencyKey={idempotencyKey} aria-label="Nueva oportunidad">
      <EntitySearch name="contactId" label="Contacto" search={searchContactsAction} initial={initialContact} placeholder="Nombre, email o teléfono" />
      <FormField name="pipelineKey" label="Pipeline">
        {(p) => (
          <Select {...p} defaultValue="ventas">
            {pipelines.map((pl) => (
              <option key={pl.key} value={pl.key}>
                {pl.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField name="title" label="Título (opcional)" hint="Si lo dejás vacío se arma con el contacto y la propiedad">
        {(p) => <Input {...p} maxLength={200} />}
      </FormField>
      {canSearchProperties ? <EntitySearch name="propertyId" label="Propiedad (opcional)" search={searchPropertiesAction} placeholder="Código, título o dirección" /> : null}
      <BudgetFields />
      <RequirementFields />
      {canAssign ? (
        <FormField name="assignedUserId" label="Responsable">
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
      <div>
        <SubmitButton pendingLabel="Creando…">Crear oportunidad</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditOpportunityButton({
  opp,
  property,
  canSearchProperties,
}: {
  opp: { id: string; title: string; operation: string | null; budgetMin: string | null; budgetMax: string | null; budgetCurrency: string | null; expectedCloseDate: string | null; requirements: Requirements };
  property: SearchOption | null;
  canSearchProperties: boolean;
}) {
  return (
    <DialogButton label="Editar" title="Editar oportunidad" variant="secondary">
      {(close) => (
        <ActionForm action={updateOpportunityAction} onSuccess={close}>
          <input type="hidden" name="opportunityId" value={opp.id} />
          <FormField name="title" label="Título">
            {(p) => <Input {...p} defaultValue={opp.title} maxLength={200} />}
          </FormField>
          <FormField name="operation" label="Operación">
            {(p) => (
              <Select {...p} defaultValue={opp.operation ?? ""}>
                <option value="">—</option>
                {Object.entries(OPERATION_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {canSearchProperties ? <EntitySearch name="propertyId" label="Propiedad" search={searchPropertiesAction} initial={property} placeholder="Código, título o dirección" /> : <input type="hidden" name="propertyId" value={property?.id ?? ""} />}
          <BudgetFields min={opp.budgetMin} max={opp.budgetMax} currency={opp.budgetCurrency} />
          <FormField name="expectedCloseDate" label="Cierre estimado">
            {(p) => <Input {...p} type="date" defaultValue={opp.expectedCloseDate ?? ""} />}
          </FormField>
          <RequirementFields req={opp.requirements} />
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
      )}
    </DialogButton>
  );
}

export function MoveStageForm({ opportunityId, stageId, stages }: { opportunityId: string; stageId: string; stages: Array<{ id: string; name: string; outcome: string }> }) {
  return (
    <ActionForm action={moveStageFormAction} className="gap-2" aria-label="Mover de etapa">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <FormField name="stageId" label="Mover a etapa">
        {(p) => (
          <Select {...p} defaultValue={stageId} key={stageId}>
            {stages
              .filter((s) => s.outcome !== "lost")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === stageId ? `${s.name} (actual)` : s.name}
                </option>
              ))}
          </Select>
        )}
      </FormField>
      <FormField name="note" label="Comentario (opcional)">
        {(p) => <Input {...p} maxLength={2000} />}
      </FormField>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Moviendo…">
          Mover
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CloseButtons({ opportunityId, status, currency }: { opportunityId: string; status: string; currency: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "won" ? (
        <DialogButton label="Ganada" title="Marcar como ganada" variant="primary">
          {(close) => (
            <ActionForm action={winAction} onSuccess={close}>
              <input type="hidden" name="opportunityId" value={opportunityId} />
              <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                <FormField name="valueCurrency" label="Moneda">
                  {(p) => (
                    <Select {...p} defaultValue={currency ?? "USD"}>
                      <option value="USD">USD</option>
                      <option value="ARS">ARS</option>
                    </Select>
                  )}
                </FormField>
                <FormField name="valueAmount" label="Valor de cierre (opcional)">
                  {(p) => <Input {...p} inputMode="decimal" />}
                </FormField>
              </div>
              <FormField name="note" label="Comentario (opcional)">
                {(p) => <Input {...p} maxLength={2000} />}
              </FormField>
              <SubmitButton>Confirmar</SubmitButton>
            </ActionForm>
          )}
        </DialogButton>
      ) : null}
      {status !== "lost" ? (
        <DialogButton label="Perdida" title="Marcar como perdida" variant="danger">
          {(close) => (
            <ActionForm action={loseAction} onSuccess={close}>
              <input type="hidden" name="opportunityId" value={opportunityId} />
              <FormField name="lostReason" label="Motivo (obligatorio)">
                {(p) => <Textarea {...p} rows={3} maxLength={500} autoFocus />}
              </FormField>
              <SubmitButton variant="danger">Marcar perdida</SubmitButton>
            </ActionForm>
          )}
        </DialogButton>
      ) : null}
      {status === "open" ? (
        <DialogButton label="Pausar" title="Pausar oportunidad" variant="secondary">
          {(close) => (
            <ActionForm action={pauseAction} onSuccess={close}>
              <input type="hidden" name="opportunityId" value={opportunityId} />
              <FormField name="note" label="Motivo o fecha de retome (opcional)">
                {(p) => <Input {...p} maxLength={2000} autoFocus />}
              </FormField>
              <SubmitButton>Pausar</SubmitButton>
            </ActionForm>
          )}
        </DialogButton>
      ) : null}
    </div>
  );
}

export function AssignOpportunityForm({ opportunityId, assignedUserId, users }: { opportunityId: string; assignedUserId: string | null; users: Users }) {
  return (
    <ActionForm action={assignOpportunityAction} className="gap-2" aria-label="Asignar oportunidad">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <FormField name="userId" label="Responsable">
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
