"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, ButtonLink, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import type { LocationNode, PropertyFormOptions } from "@/server/properties/queries";
import type { FieldSchemaEntry } from "@/server/properties/schema";
import { createPropertyAction, updatePropertyAction } from "../actions";
import { LocationPicker } from "./location-picker";

const OPERATION_LABEL = { sale: "Venta", rent: "Alquiler", temporary_rent: "Alquiler temporario" } as const;
type OperationKey = keyof typeof OPERATION_LABEL;

export type PropertyFormInitial = {
  title: string;
  description: string | null;
  type_key: string;
  branch_id: string | null;
  featured: boolean;
  address_street: string | null;
  address_number: string | null;
  address_floor: string | null;
  address_unit: string | null;
  hide_exact_address: boolean;
  latitude: string | null;
  longitude: string | null;
  total_area_m2: string | null;
  covered_area_m2: string | null;
  uncovered_area_m2: string | null;
  land_area_m2: string | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  toilets: number | null;
  garages: number | null;
  age_years: number | null;
  orientation: string | null;
  disposition: string | null;
  condition: string | null;
  credit_eligible: boolean | null;
  professional_use: boolean | null;
  allows_pets: boolean | null;
  attributes: Record<string, string | number | boolean | null>;
  seo_title: string | null;
  seo_description: string | null;
  featureKeys: string[];
};

type OpRow = { key: number; operation: OperationKey; currency: "USD" | "ARS"; amount: string; priceHidden: boolean; expensesAmount: string; expensesCurrency: "USD" | "ARS" };

type Props = {
  mode: "create" | "edit";
  propertyId?: string;
  options: PropertyFormOptions;
  initial?: PropertyFormInitial;
  initialChain?: LocationNode[];
  canCreateLocation: boolean;
};

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)));
const tri = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : v ? "true" : "false");

export function PropertyForm({ mode, propertyId, options, initial, initialChain = [], canCreateLocation }: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [typeKey, setTypeKey] = useState(initial?.type_key ?? "");
  const [locationId, setLocationId] = useState<string | null>(initialChain.at(-1)?.id ?? null);
  const [ops, setOps] = useState<OpRow[]>([{ key: 1, operation: "sale", currency: "USD", amount: "", priceHidden: false, expensesAmount: "", expensesCurrency: "ARS" }]);
  const [notice, setNotice] = useState<string | null>(null);
  const baseline = useRef<Record<string, string> | null>(null);
  const create = useAction(createPropertyAction);
  const update = useAction(updatePropertyAction);
  const action = mode === "create" ? create : update;
  const fe = action.fieldErrors ?? {};

  const schema: FieldSchemaEntry[] = useMemo(() => options.types.find((t) => t.key === typeKey)?.field_schema ?? [], [options.types, typeKey]);
  const onLocation = useCallback((id: string | null) => setLocationId(id), []);

  const build = useCallback((): Record<string, unknown> => {
    const form = formRef.current!;
    const fd = new FormData(form);
    const s = (k: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : "";
    };
    const attributes: Record<string, string | boolean> = {};
    for (const f of schema) {
      const v = s(`attr.${f.key}`);
      if (v === "") continue;
      attributes[f.key] = f.type === "boolean" ? v === "true" : v;
    }
    return {
      title: s("title"),
      description: s("description"),
      typeKey,
      branchId: s("branchId") || null,
      featured: fd.get("featured") === "on",
      locationId,
      addressStreet: s("addressStreet"),
      addressNumber: s("addressNumber"),
      addressFloor: s("addressFloor"),
      addressUnit: s("addressUnit"),
      hideExactAddress: fd.get("hideExactAddress") === "on",
      latitude: s("latitude"),
      longitude: s("longitude"),
      totalAreaM2: s("totalAreaM2"),
      coveredAreaM2: s("coveredAreaM2"),
      uncoveredAreaM2: s("uncoveredAreaM2"),
      landAreaM2: s("landAreaM2"),
      rooms: s("rooms"),
      bedrooms: s("bedrooms"),
      bathrooms: s("bathrooms"),
      toilets: s("toilets"),
      garages: s("garages"),
      ageYears: s("ageYears"),
      orientation: s("orientation"),
      disposition: s("disposition"),
      condition: s("condition"),
      creditEligible: s("creditEligible"),
      professionalUse: s("professionalUse"),
      allowsPets: s("allowsPets"),
      attributes,
      featureKeys: fd.getAll("featureKeys").filter((x): x is string => typeof x === "string").sort(),
      seoTitle: s("seoTitle"),
      seoDescription: s("seoDescription"),
    };
  }, [schema, typeKey, locationId]);

  // Edición: se envían solo los campos modificados (el servidor protege lo editado a mano en propiedades migradas).
  useEffect(() => {
    if (mode !== "edit" || baseline.current || !formRef.current) return;
    const data = build();
    baseline.current = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]));
  }, [mode, build]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotice(null);
    const data = build();
    if (mode === "create") {
      const operations = ops.map((o) => ({
        operation: o.operation,
        currency: o.currency,
        amount: o.priceHidden && o.amount === "" ? null : o.amount,
        priceHidden: o.priceHidden,
        expensesAmount: o.expensesAmount,
        expensesCurrency: o.expensesAmount ? o.expensesCurrency : null,
      }));
      const r = await create.run({ ...data, operations });
      if (r.ok) router.push(`/crm/propiedades/${r.data.id}?creada=1`);
      else focusFirstError();
      return;
    }
    const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => baseline.current?.[k] !== JSON.stringify(v)));
    if (!Object.keys(changed).length) {
      setNotice("No hay cambios para guardar.");
      return;
    }
    const r = await update.run(propertyId!, changed);
    if (r.ok) router.push(`/crm/propiedades/${propertyId}?guardada=1`);
    else focusFirstError();
  };

  const focusFirstError = () => {
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
  };

  const usedOps = new Set(ops.map((o) => o.operation));
  const featureGroups = [...new Set(options.features.map((f) => f.grp))];
  const GROUP_LABEL: Record<string, string> = { service: "Servicios", amenity: "Amenities", characteristic: "Características", building_service: "Servicios del edificio", building_amenity: "Amenities del edificio", ambient: "Ambientes" };

  const text = (name: string, label: string, def: string | null | undefined, extra: React.ComponentProps<"input"> = {}) => (
    <Field key={name} label={label} htmlFor={name} error={fe[name]}>
      <Input id={name} name={name} defaultValue={def ?? ""} aria-invalid={fe[name] ? true : undefined} {...extra} />
    </Field>
  );
  const number = (name: string, label: string, def: string | number | null | undefined, step = "any") => text(name, label, num(def), { type: "number", inputMode: "decimal", min: 0, step });
  const triSelect = (name: string, label: string, def: boolean | null | undefined) => (
    <Field key={name} label={label} htmlFor={name} error={fe[name]}>
      <Select id={name} name={name} defaultValue={tri(def)}>
        <option value="">Sin dato</option>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </Select>
    </Field>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <Card title="Datos principales">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">{text("title", "Título *", initial?.title, { required: true, maxLength: 200 })}</div>
          <Field label="Tipo *" htmlFor="typeKey" error={fe.typeKey}>
            <Select id="typeKey" value={typeKey} onChange={(e) => setTypeKey(e.target.value)} required aria-invalid={fe.typeKey ? true : undefined}>
              <option value="">Elegí un tipo</option>
              {options.types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sucursal" htmlFor="branchId" error={fe.branchId}>
            <Select id="branchId" name="branchId" defaultValue={initial?.branch_id ?? ""}>
              <option value="">Sin sucursal</option>
              {options.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Descripción" htmlFor="description" error={fe.description} className="md:col-span-2">
            <Textarea id="description" name="description" rows={6} maxLength={20000} defaultValue={initial?.description ?? ""} />
          </Field>
          <Checkbox name="featured" label="Destacada en el sitio" defaultChecked={initial?.featured ?? false} />
        </div>
      </Card>

      <Card title="Ubicación">
        <div className="flex flex-col gap-4">
          <LocationPicker provinces={options.provinces} initialChain={initialChain} canCreate={canCreateLocation} onChange={onLocation} error={fe.locationId} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {text("addressStreet", "Calle", initial?.address_street, { maxLength: 200 })}
            {text("addressNumber", "Número", initial?.address_number, { maxLength: 20 })}
            {text("addressFloor", "Piso", initial?.address_floor, { maxLength: 20 })}
            {text("addressUnit", "Depto / unidad", initial?.address_unit, { maxLength: 20 })}
            {number("latitude", "Latitud", initial?.latitude)}
            {number("longitude", "Longitud", initial?.longitude)}
          </div>
          <Checkbox name="hideExactAddress" label="Ocultar la dirección exacta en el sitio" defaultChecked={initial?.hide_exact_address ?? true} />
        </div>
      </Card>

      <Card title="Superficies y ambientes">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {number("totalAreaM2", "Sup. total (m²)", initial?.total_area_m2)}
          {number("coveredAreaM2", "Sup. cubierta (m²)", initial?.covered_area_m2)}
          {number("uncoveredAreaM2", "Sup. descubierta (m²)", initial?.uncovered_area_m2)}
          {number("landAreaM2", "Terreno (m²)", initial?.land_area_m2)}
          {number("rooms", "Ambientes", initial?.rooms, "1")}
          {number("bedrooms", "Dormitorios", initial?.bedrooms, "1")}
          {number("bathrooms", "Baños", initial?.bathrooms, "1")}
          {number("toilets", "Toilettes", initial?.toilets, "1")}
          {number("garages", "Cocheras", initial?.garages, "1")}
          {number("ageYears", "Antigüedad (años)", initial?.age_years, "1")}
          {text("orientation", "Orientación", initial?.orientation, { maxLength: 40 })}
          {text("disposition", "Disposición", initial?.disposition, { maxLength: 40 })}
          {text("condition", "Estado de conservación", initial?.condition, { maxLength: 60 })}
          {triSelect("creditEligible", "Apta crédito", initial?.credit_eligible)}
          {triSelect("professionalUse", "Apta profesional", initial?.professional_use)}
          {triSelect("allowsPets", "Acepta mascotas", initial?.allows_pets)}
        </div>
      </Card>

      {schema.length ? (
        <Card title={`Campos de ${options.types.find((t) => t.key === typeKey)?.name ?? "tipo"}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" key={typeKey}>
            {schema.map((f) => {
              const name = `attr.${f.key}`;
              const def = initial && initial.type_key === typeKey ? initial.attributes[f.key] : undefined;
              const err = fe[`attributes.${f.key}`];
              const label = f.unit ? `${f.label} (${f.unit})` : f.label;
              if (f.type === "boolean") return triSelect(name, label, typeof def === "boolean" ? def : null);
              if (f.type === "date") return text(name, label, typeof def === "string" ? def : "", { type: "date" });
              if (f.type === "number" || f.type === "integer")
                return (
                  <Field key={name} label={label} htmlFor={name} error={err}>
                    <Input id={name} name={name} type="number" inputMode="decimal" min={0} step={f.type === "integer" ? 1 : "any"} defaultValue={def === undefined || def === null ? "" : String(def)} aria-invalid={err ? true : undefined} />
                  </Field>
                );
              return (
                <Field key={name} label={label} htmlFor={name} error={err}>
                  <Input id={name} name={name} maxLength={500} defaultValue={def === undefined || def === null ? "" : String(def)} />
                </Field>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card title="Características">
        {options.features.length === 0 ? (
          <p className="text-sm text-stone">Todavía no hay un catálogo de características cargado en el sistema.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {featureGroups.map((g) => (
              <fieldset key={g}>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">{GROUP_LABEL[g] ?? g}</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {options.features
                    .filter((f) => f.grp === g)
                    .map((f) => (
                      <Checkbox key={f.key} name="featureKeys" value={f.key} label={f.name} defaultChecked={initial?.featureKeys.includes(f.key) ?? false} />
                    ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}
      </Card>

      {mode === "create" ? (
        <Card title="Operaciones y precio *">
          <div className="flex flex-col gap-4">
            {fe.operations ? (
              <p role="alert" className="text-xs text-danger">
                {fe.operations.join(" · ")}
              </p>
            ) : null}
            {ops.map((o, i) => {
              const set = (patch: Partial<OpRow>) => setOps((prev) => prev.map((x) => (x.key === o.key ? { ...x, ...patch } : x)));
              const id = (f: string) => `op-${o.key}-${f}`;
              const err = (f: string) => fe[`operations.${i}.${f}`];
              return (
                <fieldset key={o.key} className="grid gap-3 rounded-[var(--radius-md)] border border-line p-3 sm:grid-cols-2 lg:grid-cols-6">
                  <legend className="px-1 text-xs font-semibold text-ink-2">Operación {i + 1}</legend>
                  <Field label="Operación" htmlFor={id("operation")} error={err("operation")}>
                    <Select id={id("operation")} value={o.operation} onChange={(e) => set({ operation: e.target.value as OperationKey })}>
                      {(Object.keys(OPERATION_LABEL) as OperationKey[]).map((k) => (
                        <option key={k} value={k} disabled={k !== o.operation && usedOps.has(k)}>
                          {OPERATION_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Moneda" htmlFor={id("currency")}>
                    <Select id={id("currency")} value={o.currency} onChange={(e) => set({ currency: e.target.value as "USD" | "ARS" })}>
                      <option value="USD">USD</option>
                      <option value="ARS">ARS ($)</option>
                    </Select>
                  </Field>
                  <Field label="Precio" htmlFor={id("amount")} error={err("amount")}>
                    <Input id={id("amount")} type="number" inputMode="decimal" min={0} step="any" value={o.amount} onChange={(e) => set({ amount: e.target.value })} aria-invalid={err("amount") ? true : undefined} />
                  </Field>
                  <Field label="Expensas" htmlFor={id("expenses")} error={err("expensesAmount")}>
                    <Input id={id("expenses")} type="number" inputMode="decimal" min={0} step="any" value={o.expensesAmount} onChange={(e) => set({ expensesAmount: e.target.value })} />
                  </Field>
                  <Field label="Moneda expensas" htmlFor={id("expcur")}>
                    <Select id={id("expcur")} value={o.expensesCurrency} onChange={(e) => set({ expensesCurrency: e.target.value as "USD" | "ARS" })}>
                      <option value="ARS">ARS ($)</option>
                      <option value="USD">USD</option>
                    </Select>
                  </Field>
                  <div className="flex flex-col justify-end gap-2">
                    <Checkbox label="Precio a consultar" checked={o.priceHidden} onChange={(e) => set({ priceHidden: e.target.checked })} />
                    {ops.length > 1 ? (
                      <Button size="sm" variant="ghost" onClick={() => setOps((prev) => prev.filter((x) => x.key !== o.key))}>
                        Quitar
                      </Button>
                    ) : null}
                  </div>
                </fieldset>
              );
            })}
            {ops.length < 3 ? (
              <Button
                size="sm"
                variant="secondary"
                className="self-start"
                onClick={() => {
                  const free = (Object.keys(OPERATION_LABEL) as OperationKey[]).find((k) => !usedOps.has(k))!;
                  setOps((prev) => [...prev, { key: Math.max(...prev.map((p) => p.key)) + 1, operation: free, currency: free === "sale" ? "USD" : "ARS", amount: "", priceHidden: false, expensesAmount: "", expensesCurrency: "ARS" }]);
                }}
              >
                + Agregar operación
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="SEO (opcional)">
        <div className="grid gap-4 md:grid-cols-2">
          {text("seoTitle", "Título SEO (máx. 70)", initial?.seo_title, { maxLength: 70 })}
          {text("seoDescription", "Descripción SEO (máx. 170)", initial?.seo_description, { maxLength: 170 })}
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-[var(--radius-lg)] sm:border">
        {action.error ? <span className="mr-auto text-sm text-danger">Revisá los errores marcados.</span> : null}
        <ButtonLink href={mode === "edit" ? `/crm/propiedades/${propertyId}` : "/crm/propiedades"} variant="ghost">
          Cancelar
        </ButtonLink>
        <Button type="submit" disabled={action.pending}>
          {action.pending ? "Guardando…" : mode === "create" ? "Crear propiedad" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
