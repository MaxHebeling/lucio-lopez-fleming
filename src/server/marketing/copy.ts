/**
 * Copy de redes a partir de plantillas (content_templates) y datos REALES de la propiedad.
 * Regla de la plantilla: `{{marcador}}`; una línea cuyos marcadores quedan TODOS vacíos se omite
 * (sin dormitorios cargados no aparece esa línea; con precio oculto no aparece el precio). Nada se inventa.
 */
import type { PortalProperty } from "../integrations/portals/types";

export type CopyVars = Record<string, string>;

const OP_LABEL = { sale: "venta", rent: "alquiler", temporary_rent: "alquiler temporario" } as const;

const intFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function money(amount: number, currency: "USD" | "ARS"): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  const num = new Intl.NumberFormat("es-AR", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 }).format(amount);
  return currency === "USD" ? `USD ${num}` : `$ ${num}`;
}

export function buildCopyVars(p: PortalProperty, org: { name: string; foundedYear: number | null }): CopyVars {
  const ops = p.operations;
  const operacion = [...new Set(ops.map((o) => OP_LABEL[o.operation]))].join(" y ");
  const localities = p.locationChain.filter((l) => ["neighborhood", "gated_community", "locality", "zone"].includes(l.kind)).slice(0, 2).map((l) => l.name);
  const visiblePrices = ops.filter((o) => !o.priceHidden && o.amount !== null);
  const precio =
    visiblePrices.length === 1 && ops.length === 1
      ? money(visiblePrices[0]!.amount!, visiblePrices[0]!.currency)
      : visiblePrices.map((o) => `${OP_LABEL[o.operation][0]!.toUpperCase()}${OP_LABEL[o.operation].slice(1)}: ${money(o.amount!, o.currency)}`).join(" · ");
  const surfaces: string[] = [];
  if (p.areas.coveredM2) surfaces.push(`${intFmt.format(p.areas.coveredM2)} m² cubiertos`);
  if (p.areas.landM2) surfaces.push(`${intFmt.format(p.areas.landM2)} m² de terreno`);
  else if (p.areas.totalM2 && p.areas.totalM2 !== p.areas.coveredM2) surfaces.push(`${intFmt.format(p.areas.totalM2)} m² totales`);
  return {
    tipo: p.typeName,
    operacion,
    localidad: localities.join(", "),
    titulo: p.title,
    ambientes: p.rooms ? plural(p.rooms, "ambiente", "ambientes") : "",
    dormitorios: p.bedrooms ? plural(p.bedrooms, "dormitorio", "dormitorios") : "",
    banos: p.bathrooms ? plural(p.bathrooms, "baño", "baños") : "",
    superficie: surfaces.join(" · "),
    precio,
    codigo: String(p.code),
    link: p.publicUrl,
    inmobiliaria: org.foundedYear ? `${org.name} · desde ${org.foundedYear}` : org.name,
  };
}

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function renderContentTemplate(body: string, vars: CopyVars): string {
  const lines = body.split("\n").flatMap((line) => {
    const keys = [...line.matchAll(PLACEHOLDER)].map((m) => m[1]!);
    if (!keys.length) return [line];
    if (keys.every((k) => !(vars[k] ?? "").trim())) return [];
    return [line.replace(PLACEHOLDER, (_, k: string) => vars[k] ?? "").replace(/\s+·\s*$|^\s*·\s+/g, "").replace(/ {2,}/g, " ").trimEnd()];
  });
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const CAPTION_MAX = { instagram: 2200, facebook: 63_206 } as const;
