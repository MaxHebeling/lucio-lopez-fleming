"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Alert, Button, Checkbox, Field, Input, Select } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import { assignAgentsAction, searchOwnersAction, setOwnersAction } from "../actions";

type Staff = { id: string; full_name: string };

export function AgentsEditor({ propertyId, staff, lead, support }: { propertyId: string; staff: Staff[]; lead: string | null; support: string[] }) {
  const uid = useId();
  const [leadId, setLeadId] = useState(lead ?? "");
  const [supportIds, setSupportIds] = useState<string[]>(support);
  const { run, pending, error, ok } = useAction(assignAgentsAction);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(propertyId, leadId || null, supportIds.filter((s) => s !== leadId));
      }}
    >
      <Field label="Agente responsable" htmlFor={`${uid}-lead`} hint="Recibe los leads que llegan desde la ficha de esta propiedad.">
        <Select id={`${uid}-lead`} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
          <option value="">Sin responsable</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Apoyo</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {staff
            .filter((s) => s.id !== leadId)
            .map((s) => (
              <Checkbox
                key={s.id}
                label={s.full_name}
                checked={supportIds.includes(s.id)}
                onChange={(e) => setSupportIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
              />
            ))}
        </div>
      </fieldset>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {ok ? <Alert tone="success">Agentes actualizados.</Alert> : null}
      <Button type="submit" size="sm" className="self-start" disabled={pending}>
        {pending ? "Guardando…" : "Guardar agentes"}
      </Button>
    </form>
  );
}

type Owner = { contactId: string; name: string; email: string | null; sharePct: string; isPrimary: boolean };

export function OwnersEditor({ propertyId, initial }: { propertyId: string; initial: Owner[] }) {
  const uid = useId();
  const [owners, setOwners] = useState<Owner[]>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; display_name: string; email: string | null }>>([]);
  const search = useAction(searchOwnersAction);
  const save = useAction(setOwnersAction);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const t = setTimeout(async () => {
      const r = await search.run(term);
      if (r.ok) setResults(r.data);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- búsqueda con debounce por término
  }, [q]);

  const visibleResults = q.trim().length >= 2 ? results : [];

  const add = (c: { id: string; display_name: string; email: string | null }) => {
    setOwners((prev) => (prev.some((o) => o.contactId === c.id) ? prev : [...prev, { contactId: c.id, name: c.display_name, email: c.email, sharePct: "", isPrimary: prev.length === 0 }]));
    setQ("");
    setResults([]);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await save.run(
          propertyId,
          owners.map((o) => ({ contactId: o.contactId, sharePct: o.sharePct, isPrimary: o.isPrimary })),
        );
      }}
    >
      {owners.length === 0 ? <p className="text-sm text-stone">Sin propietarios asignados.</p> : null}
      <ul className="flex flex-col gap-2">
        {owners.map((o) => (
          <li key={o.contactId} className="grid items-end gap-2 rounded-[var(--radius-md)] border border-line p-3 sm:grid-cols-[1fr_7rem_auto_auto]">
            <div className="min-w-0">
              <Link href={`/crm/contactos/${o.contactId}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                {o.name}
              </Link>
              {o.email ? <p className="truncate text-xs text-stone">{o.email}</p> : null}
            </div>
            <Field label="% titularidad" htmlFor={`${uid}-${o.contactId}-pct`}>
              <Input
                id={`${uid}-${o.contactId}-pct`}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={o.sharePct}
                onChange={(e) => setOwners((prev) => prev.map((x) => (x.contactId === o.contactId ? { ...x, sharePct: e.target.value } : x)))}
              />
            </Field>
            <label className="inline-flex h-10 items-center gap-2 text-sm">
              <input type="radio" name={`${uid}-primary`} className="size-4 accent-[var(--ink)]" checked={o.isPrimary} onChange={() => setOwners((prev) => prev.map((x) => ({ ...x, isPrimary: x.contactId === o.contactId })))} />
              Principal
            </label>
            <Button size="sm" variant="ghost" onClick={() => setOwners((prev) => prev.filter((x) => x.contactId !== o.contactId))}>
              Quitar
            </Button>
          </li>
        ))}
      </ul>
      <div className="relative">
        <Field label="Agregar propietario (buscá por nombre, email o teléfono)" htmlFor={`${uid}-search`}>
          <Input id={`${uid}-search`} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" role="combobox" aria-expanded={visibleResults.length > 0} aria-controls={`${uid}-results`} />
        </Field>
        {search.pending ? <p className="mt-1 text-xs text-stone">Buscando…</p> : null}
        {search.error ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {search.error}
          </p>
        ) : null}
        {q.trim().length >= 2 && !search.pending && visibleResults.length === 0 && !search.error ? <p className="mt-1 text-xs text-stone">Sin coincidencias. El contacto se crea desde Contactos.</p> : null}
        {visibleResults.length ? (
          <ul id={`${uid}-results`} role="listbox" className="mt-1 max-h-64 overflow-auto rounded-[var(--radius-md)] border border-line bg-white">
            {visibleResults.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => add(c)} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-paper-2 focus:bg-paper-2">
                  <span className="font-semibold">{c.display_name}</span>
                  {c.email ? <span className="text-xs text-stone">{c.email}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {save.error ? <Alert tone="danger">{save.fieldErrors ? Object.values(save.fieldErrors).flat().join(" · ") || save.error : save.error}</Alert> : null}
      {save.ok ? <Alert tone="success">Propietarios actualizados.</Alert> : null}
      <Button type="submit" size="sm" className="self-start" disabled={save.pending}>
        {save.pending ? "Guardando…" : "Guardar propietarios"}
      </Button>
    </form>
  );
}
