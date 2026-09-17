/**
 * Comparador del sitio (puro): tabla objetiva con los datos PUBLICADOS de 2 o 3 propiedades, diferencias resaltadas y un
 * texto explicativo determinista. Sin datos inventados: lo que falta se muestra como «Sin dato».
 */
import type { PublicPropertyDetail } from "../../properties/public";
import { OPERATION_NOUN, formatArea, formatPrice } from "../../properties/public-helpers";

export type CompareColumn = {
  code: number;
  slug: string;
  headline: string;
  typeName: string;
  status: PublicPropertyDetail["status"];
  zoneLabel: string | null;
  cover: PublicPropertyDetail["cover"];
};

export type CompareRow = { key: string; label: string; group: "precio" | "espacios" | "ubicacion" | "caracteristicas"; values: Array<string | null>; differs: boolean };

export type Comparison = { columns: CompareColumn[]; rows: CompareRow[]; notes: string[] };

const nf = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const STATUS = { available: "Disponible", reserved: "Reservada", sold: "Vendida", rented: "Alquilada" } as const;

export const MAX_COMPARE = 3;

export function parseCompareCodes(raw: string | string[] | undefined): number[] {
  const s = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const codes = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d{1,7}$/.test(x))
    .map(Number)
    .filter((n) => n > 0);
  return [...new Set(codes)].slice(0, MAX_COMPARE);
}

function differs(values: Array<string | null>): boolean {
  const present = values.filter((v): v is string => v !== null);
  return present.length > 1 && new Set(present).size > 1;
}

const label = (p: PublicPropertyDetail) => `la propiedad #${p.code}`;

export function buildComparison(props: PublicPropertyDetail[]): Comparison {
  const rows: CompareRow[] = [];
  const add = (key: string, lbl: string, group: CompareRow["group"], values: Array<string | null>) => {
    if (values.every((v) => v === null)) return;
    rows.push({ key, label: lbl, group, values, differs: differs(values) });
  };
  const ops = [...new Set(props.flatMap((p) => p.prices.map((pr) => pr.operation)))];
  for (const op of ops) {
    add(`precio_${op}`, `Precio de ${OPERATION_NOUN[op]}`, "precio", props.map((p) => {
      const pr = p.prices.find((x) => x.operation === op);
      return pr ? formatPrice(pr.amount, pr.currency, pr.priceHidden) : null;
    }));
  }
  add("expensas", "Expensas", "precio", props.map((p) => {
    const e = p.prices.find((pr) => pr.expenses)?.expenses;
    return e ? formatPrice(e.amount, e.currency, false) : null;
  }));
  add("credito", "Apto crédito", "precio", props.map((p) => (p.creditEligible === null ? null : p.creditEligible ? "Sí" : "No")));
  add("estado", "Estado", "precio", props.map((p) => STATUS[p.status]));
  add("tipo", "Tipo", "espacios", props.map((p) => p.typeName));
  add("cubierta", "Superficie cubierta", "espacios", props.map((p) => formatArea(p.coveredAreaM2)));
  add("total", "Superficie total", "espacios", props.map((p) => formatArea(p.totalAreaM2)));
  add("terreno", "Terreno", "espacios", props.map((p) => formatArea(p.landAreaM2)));
  add("ambientes", "Ambientes", "espacios", props.map((p) => (p.rooms ? String(p.rooms) : null)));
  add("dormitorios", "Dormitorios", "espacios", props.map((p) => (p.bedrooms ? String(p.bedrooms) : null)));
  add("banos", "Baños", "espacios", props.map((p) => (p.bathrooms ? String(p.bathrooms) : null)));
  add("cocheras", "Cocheras", "espacios", props.map((p) => (p.garages ? String(p.garages) : null)));
  add("antiguedad", "Antigüedad", "espacios", props.map((p) => (p.ageYears === null ? null : p.ageYears === 0 ? "A estrenar" : `${p.ageYears} años`)));
  add("ubicacion", "Ubicación", "ubicacion", props.map((p) => [p.street, p.zone.label].filter(Boolean).join(" · ") || null));
  add("orientacion", "Orientación", "ubicacion", props.map((p) => p.orientation));
  const features = [...new Set(props.flatMap((p) => p.features.flatMap((g) => g.items)))].sort((a, b) => a.localeCompare(b, "es"));
  for (const f of features) {
    const values = props.map((p) => (p.features.some((g) => g.items.includes(f)) ? "Sí" : "—"));
    rows.push({ key: `feature:${f}`, label: f, group: "caracteristicas", values, differs: new Set(values).size > 1 });
  }

  return {
    columns: props.map((p) => ({ code: p.code, slug: p.slug, headline: p.headline, typeName: p.typeName, status: p.status, zoneLabel: p.zone.label, cover: p.cover })),
    rows,
    notes: comparisonNotes(props, features),
  };
}

/** Texto explicativo determinista: solo diferencias entre datos presentes en ambas fichas. */
export function comparisonNotes(props: PublicPropertyDetail[], features: string[] = []): string[] {
  const notes: string[] = [];
  if (props.length < 2) return notes;
  const byNum = (get: (p: PublicPropertyDetail) => number | null, fmt: (n: number) => string, noun: string) => {
    const withValue = props.map((p) => ({ p, v: get(p) })).filter((x): x is { p: PublicPropertyDetail; v: number } => x.v !== null && x.v > 0);
    if (withValue.length < 2) return;
    const sorted = [...withValue].sort((a, b) => b.v - a.v);
    const [max, min] = [sorted[0]!, sorted[sorted.length - 1]!];
    if (max.v === min.v) return;
    const cap = label(max.p).charAt(0).toUpperCase() + label(max.p).slice(1);
    notes.push(`${cap} tiene ${fmt(max.v - min.v)} ${noun} que ${label(min.p)}.`);
  };
  byNum((p) => p.coveredAreaM2, (n) => `${nf.format(n)} m²`, "cubiertos más");
  byNum((p) => p.landAreaM2, (n) => `${nf.format(n)} m²`, "más de terreno");
  byNum((p) => p.bedrooms, (n) => `${n} ${n === 1 ? "dormitorio" : "dormitorios"}`, "más");
  byNum((p) => p.bathrooms, (n) => `${n} ${n === 1 ? "baño" : "baños"}`, "más");

  // Precio: solo misma operación y moneda, ambos visibles.
  for (const op of ["sale", "rent"] as const) {
    const priced = props.flatMap((p) => {
      const pr = p.prices.find((x) => x.operation === op && !x.priceHidden && x.amount !== null);
      return pr ? [{ p, amount: pr.amount!, currency: pr.currency }] : [];
    });
    const currencies = new Set(priced.map((x) => x.currency));
    if (priced.length >= 2 && currencies.size === 1) {
      const sorted = [...priced].sort((a, b) => a.amount - b.amount);
      const [cheap, exp] = [sorted[0]!, sorted[sorted.length - 1]!];
      if (cheap.amount !== exp.amount) {
        const cap = label(cheap.p).charAt(0).toUpperCase() + label(cheap.p).slice(1);
        notes.push(`${cap} cuesta ${formatPrice(exp.amount - cheap.amount, cheap.currency, false)} menos que ${label(exp.p)} (${OPERATION_NOUN[op]}).`);
      }
    } else if (priced.length >= 2 && currencies.size > 1) notes.push(`Los precios de ${OPERATION_NOUN[op]} están en monedas distintas: no se comparan directamente.`);
  }
  const hidden = props.filter((p) => p.prices.length && p.prices.every((pr) => pr.priceHidden || pr.amount === null));
  if (hidden.length) notes.push(`${hidden.map((p) => label(p)).join(" y ").replace(/^./, (c) => c.toUpperCase())} ${hidden.length === 1 ? "tiene" : "tienen"} precio a consultar.`);

  for (const f of features) {
    const owners = props.filter((p) => p.features.some((g) => g.items.includes(f)));
    if (owners.length === 1) notes.push(`Solo ${label(owners[0]!)} registra «${f}».`);
  }
  return notes.slice(0, 8);
}
