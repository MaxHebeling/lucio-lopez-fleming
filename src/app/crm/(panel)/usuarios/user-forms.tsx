"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Checkbox, Field, Input } from "@/components/ui";
import { formValues, useAction } from "@/components/crm/use-action";
import type { RoleOption } from "@/server/users/queries";
import { inviteUserAction, setUserBranchesAction, setUserRolesAction, updateUserProfileAction } from "./actions";

type Branch = { id: string; name: string };

function RoleChecks({ roles, selected, onToggle, error }: { roles: RoleOption[]; selected: string[]; onToggle: (key: string, on: boolean) => void; error?: string[] }) {
  return (
    <fieldset aria-describedby={error ? "roles-error" : undefined}>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Roles</legend>
      <ul className="grid gap-2 sm:grid-cols-2">
        {roles.map((r) => {
          const checked = selected.includes(r.key);
          // Un rol no asignable igual se muestra marcado si ya lo tiene (no se puede quitar sin permiso).
          return (
            <li key={r.key} className="rounded-[var(--radius-md)] border border-line bg-white p-2.5">
              <Checkbox label={r.name} checked={checked} disabled={!r.assignable} onChange={(e) => onToggle(r.key, e.target.checked)} />
              {r.description ? <p className="mt-1 pl-6 text-xs text-stone">{r.description}</p> : null}
              {!r.assignable ? <p className="mt-1 pl-6 text-xs text-stone">Solo lo asigna quien gestiona roles.</p> : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p id="roles-error" role="alert" className="mt-1 text-xs text-danger">
          {error.join(" · ")}
        </p>
      ) : null}
    </fieldset>
  );
}

function BranchChecks({ branches, selected, onToggle }: { branches: Branch[]; selected: string[]; onToggle: (id: string, on: boolean) => void }) {
  if (!branches.length) return <p className="text-sm text-stone">No hay sucursales activas.</p>;
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Sucursales</legend>
      <div className="flex flex-wrap gap-4">
        {branches.map((b) => (
          <Checkbox key={b.id} label={b.name} checked={selected.includes(b.id)} onChange={(e) => onToggle(b.id, e.target.checked)} />
        ))}
      </div>
    </fieldset>
  );
}

const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

export function InviteForm({ roles, branches }: { roles: RoleOption[]; branches: Branch[] }) {
  const router = useRouter();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const { run, pending, error, fieldErrors } = useAction(inviteUserAction);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        const r = await run({ email: v.email, fullName: v.fullName, phone: v.phone, whatsapp: v.whatsapp, roles: selectedRoles, branchIds: selectedBranches });
        if (r.ok) router.push(`/crm/usuarios/${r.data.id}?invitado=1`);
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nombre completo *" htmlFor="fullName" error={fieldErrors?.fullName}>
          <Input id="fullName" name="fullName" required maxLength={200} autoComplete="off" aria-invalid={fieldErrors?.fullName ? true : undefined} />
        </Field>
        <Field label="Email *" htmlFor="email" error={fieldErrors?.email}>
          <Input id="email" name="email" type="email" required maxLength={254} autoComplete="off" aria-invalid={fieldErrors?.email ? true : undefined} />
        </Field>
        <Field label="Teléfono" htmlFor="phone" error={fieldErrors?.phone}>
          <Input id="phone" name="phone" type="tel" maxLength={40} />
        </Field>
        <Field label="WhatsApp" htmlFor="whatsapp" hint="Ej.: 387 5123456" error={fieldErrors?.whatsapp}>
          <Input id="whatsapp" name="whatsapp" type="tel" maxLength={40} aria-invalid={fieldErrors?.whatsapp ? true : undefined} />
        </Field>
      </div>
      <RoleChecks roles={roles} selected={selectedRoles} onToggle={(k, on) => setSelectedRoles((p) => toggle(p, k, on))} error={fieldErrors?.roles} />
      <BranchChecks branches={branches} selected={selectedBranches} onToggle={(b, on) => setSelectedBranches((p) => toggle(p, b, on))} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Invitando…" : "Enviar invitación"}
      </Button>
    </form>
  );
}

type Profile = { full_name: string; phone: string | null; whatsapp_e164: string | null; public_profile: boolean };

export function ProfileForm({ userId, profile }: { userId: string; profile: Profile }) {
  const { run, pending, error, fieldErrors, ok } = useAction(updateUserProfileAction);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = formValues(e.currentTarget);
        await run(userId, { fullName: v.fullName, phone: v.phone, whatsapp: v.whatsapp, publicProfile: v.publicProfile === "on" });
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {ok ? <Alert tone="success">Datos guardados.</Alert> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Nombre completo" htmlFor="fullName" error={fieldErrors?.fullName}>
          <Input id="fullName" name="fullName" defaultValue={profile.full_name} maxLength={200} aria-invalid={fieldErrors?.fullName ? true : undefined} />
        </Field>
        <Field label="Teléfono" htmlFor="phone" error={fieldErrors?.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} maxLength={40} />
        </Field>
        <Field label="WhatsApp" htmlFor="whatsapp" error={fieldErrors?.whatsapp}>
          <Input id="whatsapp" name="whatsapp" type="tel" defaultValue={profile.whatsapp_e164 ?? ""} maxLength={40} aria-invalid={fieldErrors?.whatsapp ? true : undefined} />
        </Field>
      </div>
      <Checkbox name="publicProfile" label="Mostrar como asesor en el sitio público" defaultChecked={profile.public_profile} />
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? "Guardando…" : "Guardar datos"}
      </Button>
    </form>
  );
}

export function AccessForm({ userId, roles, branches, roleKeys, branchIds }: { userId: string; roles: RoleOption[]; branches: Branch[]; roleKeys: string[]; branchIds: string[] }) {
  const [selectedRoles, setSelectedRoles] = useState(roleKeys);
  const [selectedBranches, setSelectedBranches] = useState(branchIds);
  const saveRoles = useAction(setUserRolesAction);
  const saveBranches = useAction(setUserBranchesAction);
  const rolesDirty = [...selectedRoles].sort().join() !== [...roleKeys].sort().join();
  const branchesDirty = [...selectedBranches].sort().join() !== [...branchIds].sort().join();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <RoleChecks roles={roles} selected={selectedRoles} onToggle={(k, on) => setSelectedRoles((p) => toggle(p, k, on))} />
        {saveRoles.error ? <Alert tone="danger">{saveRoles.error}</Alert> : null}
        {saveRoles.ok ? <Alert tone="success">Roles actualizados.</Alert> : null}
        <Button size="sm" className="self-start" disabled={!rolesDirty || saveRoles.pending || selectedRoles.length === 0} onClick={() => void saveRoles.run(userId, selectedRoles)}>
          {saveRoles.pending ? "Guardando…" : "Guardar roles"}
        </Button>
      </div>
      <div className="flex flex-col gap-3">
        <BranchChecks branches={branches} selected={selectedBranches} onToggle={(b, on) => setSelectedBranches((p) => toggle(p, b, on))} />
        {saveBranches.error ? <Alert tone="danger">{saveBranches.error}</Alert> : null}
        {saveBranches.ok ? <Alert tone="success">Sucursales actualizadas.</Alert> : null}
        <Button size="sm" className="self-start" disabled={!branchesDirty || saveBranches.pending} onClick={() => void saveBranches.run(userId, selectedBranches)}>
          {saveBranches.pending ? "Guardando…" : "Guardar sucursales"}
        </Button>
      </div>
    </div>
  );
}
