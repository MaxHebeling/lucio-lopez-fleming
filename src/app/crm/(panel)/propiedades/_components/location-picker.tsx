"use client";

import { useEffect, useId, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import type { LocationNode } from "@/server/properties/queries";
import { createLocationAction, locationChildrenAction } from "../actions";

type Level = "province" | "locality" | "neighborhood";
const LABEL: Record<Level, string> = { province: "Provincia", locality: "Localidad", neighborhood: "Barrio" };

type Props = {
  provinces: LocationNode[];
  initialChain: LocationNode[];
  canCreate: boolean;
  onChange: (locationId: string | null) => void;
  error?: string[];
};

/** Selector jerárquico provincia → localidad → barrio, con alta inline (properties.update). */
export function LocationPicker({ provinces: initialProvinces, initialChain, canCreate, onChange, error }: Props) {
  const byKind = (k: string[]) => initialChain.find((n) => k.includes(n.kind))?.id ?? "";
  const [provinces, setProvinces] = useState(initialProvinces);
  const [province, setProvince] = useState(byKind(["province"]));
  const [locality, setLocality] = useState(byKind(["locality"]));
  const [hood, setHood] = useState(byKind(["neighborhood", "gated_community"]));
  const [localities, setLocalities] = useState<LocationNode[]>([]);
  const [hoods, setHoods] = useState<LocationNode[]>([]);
  const children = useAction(locationChildrenAction);

  useEffect(() => {
    let cancelled = false;
    if (!province) return;
    children.run(province).then((r) => {
      if (!cancelled && r.ok) setLocalities(r.data);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar la provincia
  }, [province]);

  useEffect(() => {
    let cancelled = false;
    if (!locality) return;
    children.run(locality).then((r) => {
      if (!cancelled && r.ok) setHoods(r.data);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar la localidad
  }, [locality]);

  useEffect(() => {
    onChange(hood || locality || province || null);
  }, [hood, locality, province, onChange]);

  const selectProvince = (v: string) => {
    setProvince(v);
    setLocality("");
    setHood("");
    setLocalities([]);
    setHoods([]);
  };
  const selectLocality = (v: string) => {
    setLocality(v);
    setHood("");
    setHoods([]);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <LevelSelect
        level="province"
        value={province}
        options={provinces}
        onSelect={selectProvince}
        disabled={false}
        canCreate={canCreate}
        parentId={null}
        onCreated={(n) => {
          setProvinces((p) => (p.some((x) => x.id === n.id) ? p : [...p, n].sort((a, b) => a.name.localeCompare(b.name, "es"))));
          selectProvince(n.id);
        }}
        error={error}
      />
      <LevelSelect
        level="locality"
        value={locality}
        options={localities}
        onSelect={selectLocality}
        disabled={!province}
        canCreate={canCreate}
        parentId={province || null}
        onCreated={(n) => {
          setLocalities((p) => (p.some((x) => x.id === n.id) ? p : [...p, n].sort((a, b) => a.name.localeCompare(b.name, "es"))));
          selectLocality(n.id);
        }}
      />
      <LevelSelect
        level="neighborhood"
        value={hood}
        options={hoods}
        onSelect={setHood}
        disabled={!locality}
        canCreate={canCreate}
        parentId={locality || null}
        onCreated={(n) => {
          setHoods((p) => (p.some((x) => x.id === n.id) ? p : [...p, n].sort((a, b) => a.name.localeCompare(b.name, "es"))));
          setHood(n.id);
        }}
      />
      {children.error ? (
        <p role="alert" className="text-xs text-danger sm:col-span-3">
          {children.error}
        </p>
      ) : null}
    </div>
  );
}

function LevelSelect(props: {
  level: Level;
  value: string;
  options: LocationNode[];
  onSelect: (id: string) => void;
  disabled: boolean;
  canCreate: boolean;
  parentId: string | null;
  onCreated: (n: LocationNode) => void;
  error?: string[];
}) {
  const uid = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = useAction(createLocationAction);
  const selectId = `${uid}-select`;
  const inputId = `${uid}-new`;

  const submit = async () => {
    const r = await create.run({ parentId: props.parentId, kind: props.level, name });
    if (r.ok) {
      props.onCreated({ id: r.data.id, parent_id: props.parentId, kind: r.data.kind, name: r.data.name });
      setName("");
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Field label={LABEL[props.level]} htmlFor={selectId} error={props.error}>
        <Select id={selectId} value={props.value} disabled={props.disabled} onChange={(e) => props.onSelect(e.target.value)} aria-invalid={props.error ? true : undefined}>
          <option value="">{props.disabled ? "—" : "Sin especificar"}</option>
          {props.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.kind === "gated_community" ? " (barrio cerrado)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {props.canCreate && !props.disabled ? (
        adding ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-paper p-2">
            <label htmlFor={inputId} className="text-xs font-semibold text-ink-2">
              Nueva {LABEL[props.level].toLowerCase()}
            </label>
            <Input
              id={inputId}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              aria-invalid={create.fieldErrors?.name ? true : undefined}
            />
            {create.error ? (
              <p role="alert" className="text-xs text-danger">
                {create.fieldErrors?.name?.[0] ?? create.error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void submit()} disabled={create.pending || name.trim().length < 2}>
                {create.pending ? "Guardando…" : "Agregar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" className="self-start text-xs font-semibold text-ink-2 underline underline-offset-4 hover:text-ink" onClick={() => setAdding(true)}>
            + Agregar {LABEL[props.level].toLowerCase()}
          </button>
        )
      ) : null}
    </div>
  );
}
