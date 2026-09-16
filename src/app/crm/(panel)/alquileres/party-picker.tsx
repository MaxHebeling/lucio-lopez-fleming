"use client";

import { useId, useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { searchContactsAction } from "./actions";

export type Party =
  | { kind: "existing"; contactId: string; name: string; email?: string | null; sharePct?: string }
  | { kind: "new"; name: string; email?: string; phone?: string; sharePct?: string };

export function serializeParties(parties: Party[]) {
  return JSON.stringify(
    parties.map((p) =>
      p.kind === "existing"
        ? { contactId: p.contactId, sharePct: p.sharePct || undefined }
        : { name: p.name, email: p.email || undefined, phone: p.phone || undefined, sharePct: p.sharePct || undefined },
    ),
  );
}

/** Selector de partes: busca contactos existentes (evita duplicados) o carga uno nuevo. */
export function PartyPicker({ label, parties, onChange, withShare, error }: { label: string; parties: Party[]; onChange: (p: Party[]) => void; withShare?: boolean; error?: string[] }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; email: string | null }>>([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ name: string; email: string; phone: string } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const search = () =>
    start(async () => {
      setSearchError(null);
      try {
        setResults(await searchContactsAction(q));
        setSearched(true);
      } catch {
        setSearchError("No se pudo buscar. Probá de nuevo.");
      }
    });

  const update = (i: number, patch: Partial<Party>) => onChange(parties.map((p, j) => (j === i ? ({ ...p, ...patch } as Party) : p)));

  return (
    <fieldset className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-2">{label}</legend>
      {parties.length === 0 ? <p className="text-sm text-stone">Sin cargar.</p> : null}
      <ul className="flex flex-col gap-2">
        {parties.map((p, i) => (
          <li key={`${p.kind}-${p.kind === "existing" ? p.contactId : i}`} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-paper px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{p.name}</span>
              <span className="ml-2 text-xs text-stone">{p.kind === "new" ? `Contacto nuevo${p.email ? ` · ${p.email}` : ""}` : (p.email ?? "")}</span>
            </span>
            {withShare ? (
              <label className="flex items-center gap-1 text-xs text-ink-2">
                %
                <input
                  aria-label={`Porcentaje de ${p.name}`}
                  className="h-8 w-20 rounded-[var(--radius-md)] border border-line bg-white px-2 text-sm"
                  inputMode="decimal"
                  value={p.sharePct ?? ""}
                  onChange={(e) => update(i, { sharePct: e.target.value })}
                  placeholder={parties.length === 1 ? "100" : ""}
                />
              </label>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onChange(parties.filter((_, j) => j !== i))}>
              Quitar
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1">
          <label htmlFor={`${id}-q`} className="sr-only">
            Buscar contacto
          </label>
          <Input
            id={`${id}-q`}
            value={q}
            placeholder="Buscar por nombre o email"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (q.trim().length >= 2) search();
              }
            }}
          />
        </div>
        <Button size="md" variant="secondary" onClick={search} disabled={pending || q.trim().length < 2}>
          {pending ? "Buscando…" : "Buscar"}
        </Button>
        <Button size="md" variant="ghost" onClick={() => setDraft({ name: q, email: "", phone: "" })}>
          Nuevo contacto
        </Button>
      </div>
      {searchError ? <p className="text-xs text-danger">{searchError}</p> : null}
      {searched ? (
        results.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-md)] border border-line">
            {results.map((r) => {
              const already = parties.some((p) => p.kind === "existing" && p.contactId === r.id);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {r.name} <span className="text-xs text-stone">{r.email ?? ""}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={already}
                    onClick={() => {
                      onChange([...parties, { kind: "existing", contactId: r.id, name: r.name, email: r.email }]);
                      setResults([]);
                      setSearched(false);
                      setQ("");
                    }}
                  >
                    {already ? "Agregado" : "Agregar"}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-stone">Sin coincidencias. Podés cargarlo como contacto nuevo.</p>
        )
      ) : null}
      {draft ? (
        <div className="grid grid-cols-1 gap-2 rounded-[var(--radius-md)] border border-dashed border-line p-3 sm:grid-cols-3">
          <Input aria-label="Nombre" placeholder="Nombre y apellido" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input aria-label="Email" type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <Input aria-label="Teléfono" type="tel" placeholder="Teléfono" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <div className="flex gap-2 sm:col-span-3">
            <Button
              size="sm"
              disabled={draft.name.trim().length < 2}
              onClick={() => {
                onChange([...parties, { kind: "new", name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim() }]);
                setDraft(null);
                setQ("");
              }}
            >
              Agregar contacto nuevo
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
          <p className="text-xs text-stone sm:col-span-3">Si el email o teléfono ya existe se reutiliza ese contacto (no se duplica).</p>
        </div>
      ) : null}
      {error?.length ? (
        <p className="text-xs text-danger" role="alert">
          {error.join(" · ")}
        </p>
      ) : null}
    </fieldset>
  );
}
