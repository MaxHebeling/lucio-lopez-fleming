"use client";

import { useState } from "react";
import { Badge, Card, Input, Select, Textarea } from "@/components/ui";
import { ActionButton, ActionForm, FormField, SubmitButton } from "@/components/crm/action-form";
import { DialogButton } from "@/components/crm/dialog-button";
import { clearPreferenceAction, confirmPreferenceAction, rejectPreferenceAction, setPreferenceAction } from "@/app/crm/(panel)/_sales/actions";
import type { BuyerProfile, PreferenceDTO } from "@/server/sales/profile/service";
import type { ProfileOptions } from "@/server/sales/crm-panels";
import type { ProfileField } from "@/server/sales/profile/fields";

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Argentina/Salta" });

const TRANSACTION = [
  ["sale", "Compra"],
  ["rent", "Alquiler"],
  ["temporary_rent", "Alquiler temporario"],
] as const;
const GOAL = [
  ["live", "Vivienda propia"],
  ["invest", "Inversión"],
  ["business", "Uso comercial"],
  ["other", "Otro"],
] as const;
const TIMEFRAME = [
  ["immediate", "Lo antes posible"],
  ["within_3_months", "En 3 meses"],
  ["within_6_months", "En 6 meses"],
  ["later", "Más adelante"],
] as const;
const FINANCING = [
  ["cash", "Contado"],
  ["credit", "Crédito hipotecario"],
  ["undecided", "Todavía no lo sabe"],
] as const;

function confidenceLabel(c: number): string {
  return c >= 0.8 ? "confianza alta" : c >= 0.5 ? "confianza media" : "confianza baja";
}

function Editor({ contactId, field, current, options, close }: { contactId: string; field: ProfileField; current: PreferenceDTO | null; options: ProfileOptions; close: () => void }) {
  const v = current?.value as Record<string, unknown> | string | number | string[] | Array<{ slug: string; kind: string; localitySlug: string | null }> | undefined;
  const [filter, setFilter] = useState("");
  const selected = (key: string) => Array.isArray(v) && (v as unknown[]).some((x) => (typeof x === "string" ? x === key : JSON.stringify({ kind: (x as { kind: string }).kind, slug: (x as { slug: string }).slug, localitySlug: (x as { localitySlug: string | null }).localitySlug }) === key));
  const checks = (items: Array<{ value: string; label: string; key?: string }>, name = "value") => (
    <div className="max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-line bg-white p-2">
      {items
        .filter((i) => !filter || i.label.toLowerCase().includes(filter.toLowerCase()))
        .map((i) => (
          <label key={i.key ?? i.value} className="flex min-h-9 items-center gap-2 rounded px-2 text-sm hover:bg-paper-2">
            <input type="checkbox" name={name} value={i.value} defaultChecked={selected(i.key ?? i.value)} className="size-4 accent-[var(--ink)]" />
            {i.label}
          </label>
        ))}
    </div>
  );
  return (
    <ActionForm action={setPreferenceAction} onSuccess={close} aria-label="Editar dato del perfil">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="field" value={field} />
      {field === "transaction_type" || field === "goal" || field === "move_timeframe" || field === "financing" ? (
        <FormField name="value" label="Valor">
          {(p) => (
            <Select {...p} defaultValue={typeof v === "string" ? v : ""} required>
              <option value="">Elegí</option>
              {(field === "transaction_type" ? TRANSACTION : field === "goal" ? GOAL : field === "move_timeframe" ? TIMEFRAME : FINANCING).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}
      {field === "budget" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField name="currency" label="Moneda" errorKeys={["value"]}>
            {(p) => (
              <Select {...p} defaultValue={(v as { currency?: string } | undefined)?.currency ?? "USD"}>
                <option value="USD">USD</option>
                <option value="ARS">Pesos</option>
              </Select>
            )}
          </FormField>
          <FormField name="min" label="Desde">
            {(p) => <Input {...p} inputMode="numeric" defaultValue={(v as { min?: number | null } | undefined)?.min ?? ""} />}
          </FormField>
          <FormField name="max" label="Hasta">
            {(p) => <Input {...p} inputMode="numeric" defaultValue={(v as { max?: number | null } | undefined)?.max ?? ""} />}
          </FormField>
        </div>
      ) : null}
      {field === "surface" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField name="min" label="Desde (m²)" errorKeys={["value"]}>
            {(p) => <Input {...p} inputMode="numeric" defaultValue={(v as { min?: number | null } | undefined)?.min ?? ""} />}
          </FormField>
          <FormField name="max" label="Hasta (m²)">
            {(p) => <Input {...p} inputMode="numeric" defaultValue={(v as { max?: number | null } | undefined)?.max ?? ""} />}
          </FormField>
        </div>
      ) : null}
      {field === "bedrooms_min" || field === "bathrooms_min" ? (
        <FormField name="value" label={field === "bedrooms_min" ? "Dormitorios (mínimo)" : "Baños (mínimo)"}>
          {(p) => <Input {...p} type="number" min={field === "bedrooms_min" ? 0 : 1} max={20} defaultValue={typeof v === "number" ? v : ""} required />}
        </FormField>
      ) : null}
      {field === "notes" ? (
        <FormField name="value" label="Notas de la búsqueda" hint="Solo sobre la propiedad que busca. No registres datos sensibles (salud, religión, situación familiar, ingresos, documentos).">
          {(p) => <Textarea {...p} maxLength={1000} defaultValue={typeof v === "string" ? v : ""} required />}
        </FormField>
      ) : null}
      {field === "property_types" ? checks(options.types.map((t) => ({ value: t.key, label: t.name }))) : null}
      {field === "locations" || field === "features" ? (
        <div className="flex flex-col gap-2">
          <Input aria-label="Filtrar opciones" placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {field === "locations"
            ? checks(options.locations.map((l) => ({ value: JSON.stringify(l), key: JSON.stringify({ kind: l.kind, slug: l.slug, localitySlug: l.localitySlug }), label: l.name })))
            : checks(options.features.map((f) => ({ value: f.key, label: f.name })))}
        </div>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton>Guardar como confirmado</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Perfil de búsqueda del cliente: cada dato con origen, confianza y estado; el equipo confirma o corrige. */
export function BuyerProfileCard({ contactId, profile, options }: { contactId: string; profile: BuyerProfile; options: ProfileOptions | null }) {
  const [showHistory, setShowHistory] = useState(false);
  const filled = profile.fields.filter((f) => f.confirmed || f.suggested);
  const empty = profile.fields.filter((f) => !f.confirmed && !f.suggested);
  return (
    <Card title="Perfil de búsqueda" className="scroll-mt-24" actions={<Badge tone={profile.suggestedCount ? "warning" : "neutral"}>{profile.suggestedCount ? `${profile.suggestedCount} por confirmar` : `${profile.confirmedCount} confirmados`}</Badge>}>
      <div id="perfil" />
      {filled.length === 0 ? <p className="mb-3 text-sm text-stone">Todavía no hay datos de lo que busca. Se completa con las consultas del sitio o cargándolos acá.</p> : null}
      <ul className="flex flex-col divide-y divide-line">
        {filled.map((f) => (
          <li key={f.field} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone">{f.label}</p>
              {f.confirmed ? (
                <p className="break-words text-sm font-semibold text-ink">
                  {f.confirmed.display} <Badge tone="success">Confirmado</Badge>
                </p>
              ) : null}
              {f.suggested ? (
                <p className="mt-0.5 break-words text-sm text-ink-2">
                  {f.confirmed ? "Sugerido: " : ""}
                  <span className="font-semibold text-ink">{f.suggested.display}</span> <Badge tone="warning">Sugerido</Badge>
                  <span className="block text-xs text-stone">
                    {f.suggested.sourceLabel} · {confidenceLabel(f.suggested.confidence)} · {dateFmt.format(new Date(f.suggested.createdAt))}
                  </span>
                </p>
              ) : f.confirmed ? (
                <p className="text-xs text-stone">
                  {f.confirmed.sourceLabel}
                  {f.confirmed.decidedBy ? ` · ${f.confirmed.decidedBy}` : ""} · {dateFmt.format(new Date(f.confirmed.decidedAt ?? f.confirmed.createdAt))}
                </p>
              ) : null}
            </div>
            {profile.canEdit && options ? (
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                {f.suggested ? (
                  <>
                    <ActionButton action={confirmPreferenceAction} input={{ preferenceId: f.suggested.id }} variant="primary" pendingLabel="Confirmando…">
                      Confirmar
                    </ActionButton>
                    <ActionButton action={rejectPreferenceAction} input={{ preferenceId: f.suggested.id }} variant="ghost" pendingLabel="Descartando…">
                      Descartar
                    </ActionButton>
                  </>
                ) : null}
                <DialogButton label="Editar" title={`Editar: ${f.label}`} variant="ghost">
                  {(close) => <Editor contactId={contactId} field={f.field} current={f.confirmed ?? f.suggested} options={options} close={close} />}
                </DialogButton>
                {f.confirmed && !f.suggested ? (
                  <ActionButton action={clearPreferenceAction} input={{ contactId, field: f.field }} variant="ghost" confirm={`¿Quitar «${f.label}» del perfil? Queda en el historial.`}>
                    Quitar
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {profile.canEdit && options && empty.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Agregar dato</p>
          <div className="flex flex-wrap gap-1.5">
            {empty.map((f) => (
              <DialogButton key={f.field} label={`+ ${f.label}`} title={`Agregar: ${f.label}`} variant="secondary">
                {(close) => <Editor contactId={contactId} field={f.field} current={null} options={options} close={close} />}
              </DialogButton>
            ))}
          </div>
        </div>
      ) : null}
      {profile.history.length ? (
        <div className="mt-3 border-t border-line pt-3">
          <button type="button" className="text-sm font-semibold underline-offset-4 hover:underline" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)}>
            {showHistory ? "Ocultar historial" : `Ver historial (${profile.history.length})`}
          </button>
          {showHistory ? (
            <ol className="mt-2 flex flex-col gap-1.5 text-sm">
              {profile.history.map((h) => (
                <li key={h.id} className="border-l-2 border-line pl-2">
                  <span className="font-semibold">{profile.fields.find((f) => f.field === h.field)?.label}:</span> {h.display}{" "}
                  <span className="text-xs text-stone">
                    · {{ suggested: "sugerido", confirmed: "confirmado", rejected: "descartado", superseded: "reemplazado" }[h.status]} · {h.sourceLabel} · {dateFmt.format(new Date(h.createdAt))}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
