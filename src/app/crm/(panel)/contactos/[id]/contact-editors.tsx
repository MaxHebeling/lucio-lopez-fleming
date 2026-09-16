"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Checkbox, Input } from "@/components/ui";
import { ActionButton, ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { DialogButton } from "@/components/crm/dialog-button";
import { CONTACT_ROLE_LABEL } from "@/components/crm/labels";
import { addEmailAction, addPhoneAction, removeEmailAction, removePhoneAction, setRolesAndTagsAction } from "../actions";

type Dup = { contactId: string; displayName: string; by: "email" | "phone" };

function DuplicatesNotice({ dups }: { dups: Dup[] }) {
  if (!dups.length) return null;
  return (
    <Alert tone="warning">
      Coincide con{" "}
      {dups.map((d, i) => (
        <span key={`${d.contactId}-${d.by}`}>
          {i > 0 ? ", " : ""}
          <Link className="underline" href={`/crm/contactos/${d.contactId}`}>
            {d.displayName}
          </Link>{" "}
          ({d.by === "email" ? "mismo email" : "mismo teléfono"})
        </span>
      ))}
      . Quedó para revisar en duplicados; no se fusionó.
    </Alert>
  );
}

export function AddEmailButton({ contactId }: { contactId: string }) {
  const [dups, setDups] = useState<Dup[]>([]);
  return (
    <>
      <DialogButton label="Agregar email" title="Agregar email" size="sm" variant="ghost">
        {(close) => (
          <ActionForm
            action={addEmailAction}
            onSuccess={(d) => {
              setDups((d as { duplicates: Dup[] }).duplicates);
              close();
            }}
          >
            <input type="hidden" name="contactId" value={contactId} />
            <FormField name="email" label="Email">
              {(p) => <Input {...p} type="email" inputMode="email" autoFocus maxLength={254} />}
            </FormField>
            <SubmitButton>Agregar</SubmitButton>
          </ActionForm>
        )}
      </DialogButton>
      <DuplicatesNotice dups={dups} />
    </>
  );
}

export function AddPhoneButton({ contactId }: { contactId: string }) {
  const [dups, setDups] = useState<Dup[]>([]);
  return (
    <>
      <DialogButton label="Agregar teléfono" title="Agregar teléfono" size="sm" variant="ghost">
        {(close) => (
          <ActionForm
            action={addPhoneAction}
            onSuccess={(d) => {
              setDups((d as { duplicates: Dup[] }).duplicates);
              close();
            }}
          >
            <input type="hidden" name="contactId" value={contactId} />
            <FormField name="phone" label="Teléfono" hint="Con código de área, ej. 387 5123456">
              {(p) => <Input {...p} type="tel" inputMode="tel" autoFocus maxLength={40} />}
            </FormField>
            <FormField name="label" label="Etiqueta (opcional)">
              {(p) => <Input {...p} placeholder="Trabajo, casa…" maxLength={40} />}
            </FormField>
            <Checkbox name="isWhatsapp" label="Tiene WhatsApp" defaultChecked />
            <SubmitButton>Agregar</SubmitButton>
          </ActionForm>
        )}
      </DialogButton>
      <DuplicatesNotice dups={dups} />
    </>
  );
}

export function RemoveEmailButton({ contactId, emailId }: { contactId: string; emailId: string }) {
  return (
    <ActionButton action={removeEmailAction} input={{ contactId, emailId }} variant="ghost" confirm="¿Quitar este email del contacto?" pendingLabel="Quitando…">
      Quitar
    </ActionButton>
  );
}

export function RemovePhoneButton({ contactId, phoneId }: { contactId: string; phoneId: string }) {
  return (
    <ActionButton action={removePhoneAction} input={{ contactId, phoneId }} variant="ghost" confirm="¿Quitar este teléfono del contacto?" pendingLabel="Quitando…">
      Quitar
    </ActionButton>
  );
}

export function RolesTagsButton({ contactId, roles, tags }: { contactId: string; roles: string[]; tags: string[] }) {
  return (
    <DialogButton label="Editar" title="Roles y etiquetas" size="sm" variant="ghost">
      {(close) => (
        <ActionForm action={setRolesAndTagsAction} onSuccess={close}>
          <input type="hidden" name="contactId" value={contactId} />
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">Roles</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CONTACT_ROLE_LABEL).map(([v, l]) => (
                <Checkbox key={v} name="roles" value={v} label={l} defaultChecked={roles.includes(v)} />
              ))}
            </div>
          </fieldset>
          <FormField name="tags" label="Etiquetas" hint="Separadas por coma">
            {(p) => <Input {...p} defaultValue={tags.join(", ")} maxLength={1200} />}
          </FormField>
          <SubmitButton>Guardar</SubmitButton>
        </ActionForm>
      )}
    </DialogButton>
  );
}
