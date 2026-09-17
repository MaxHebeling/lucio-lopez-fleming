/**
 * Capa DETERMINISTA del concierge: texto libre en español rioplatense → intención estructurada, validada contra el
 * catálogo real (tipos, zonas con inventario publicado, características). Pura: sin base, sin red, sin modelo.
 *
 * Reglas:
 *  - Solo se extrae lo expresado. Una convención inequívoca (2 ambientes ≈ 1 dormitorio) queda como `inferred`.
 *  - Un monto sin moneda NO filtra (`ambiguousAmount`): la persona elige USD o pesos.
 *  - Una zona que no existe en el catálogo no filtra: queda en `unparsed` («No pude interpretar: …»).
 *  - Varias zonas o tipos a la vez se informan, pero el buscador filtra de a uno (ver filters.ts).
 */
import { parseArgentineNumber } from "../../ai/guards";
import { emptyIntent, type MoveTimeframe, type SalesCatalog, type SearchIntent, type SoftPreference, type TransactionType } from "./schema";

export const MAX_CONCIERGE_TEXT = 300;

// ───────────────────────── Texto plegado (misma longitud que el original) ─────────────────────────

/** minúsculas y sin acentos, carácter por carácter, para que las posiciones coincidan con el texto original. */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const f = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    out += f.length === ch.length ? f : ch.length === ch.toLowerCase().length ? ch.toLowerCase() : ch;
  }
  return out;
}

class Cursor {
  readonly consumed: boolean[];
  constructor(readonly original: string, readonly folded: string) {
    this.consumed = new Array<boolean>(folded.length).fill(false);
  }
  free(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.consumed[i]) return false;
    return true;
  }
  take(start: number, end: number): void {
    for (let i = start; i < end; i++) this.consumed[i] = true;
  }
  evidence(start: number, end: number): string {
    return this.original.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 80);
  }
  /** Recorre coincidencias libres de `re` (global). `fn` devuelve true si la consume. */
  each(re: RegExp, fn: (m: RegExpExecArray, start: number, end: number) => boolean | void): void {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (let m = g.exec(this.folded); m; m = g.exec(this.folded)) {
      if (m[0].length === 0) {
        g.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (!this.free(start, end)) continue;
      if (fn(m, start, end)) this.take(start, end);
    }
  }
}

const B = String.raw`(?<![\p{L}\p{N}])`; // borde izquierdo de palabra (unicode)
const E = String.raw`(?![\p{L}\p{N}])`; // borde derecho
const word = (alts: string) => new RegExp(`${B}(?:${alts})${E}`, "gu");

const NUMBER_WORDS: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };
const NUMW = String.raw`(\d{1,2}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho)`;

function smallNumber(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw] ?? null;
}

// ───────────────────────── Catálogo: sinónimos validados contra lo real ─────────────────────────

/** Grupos de tipos (clave canónica → sinónimos y claves reales candidatas, en orden de preferencia). */
const TYPE_SYNONYMS: Array<{ keys: string[]; words: string }> = [
  { keys: ["departamento"], words: "departamentos?|deptos?|dptos?|depas?|monoambientes?" },
  { keys: ["casa"], words: "casas?|chalets?|casaquintas?|casa quinta" },
  { keys: ["ph"], words: "ph|p\\.h\\." },
  { keys: ["terreno", "lote"], words: "terrenos?|lotes?|loteos?" },
  { keys: ["local"], words: "locales? comerciales?|locales?" },
  { keys: ["oficina"], words: "oficinas?|consultorios?" },
  { keys: ["galpon"], words: "galpon(?:es)?|naves? industrial(?:es)?" },
  { keys: ["deposito"], words: "depositos?" },
  { keys: ["campo"], words: "campos?|fincas?|chacras?" },
  { keys: ["hotel"], words: "hotel(?:es)?|hostels?|hosterias?" },
  { keys: ["emprendimiento"], words: "emprendimientos?|desarrollos? inmobiliarios?|en pozo|de pozo" },
];

/** Características con sinónimos coloquiales (la clave tiene que existir en el catálogo real). */
const FEATURE_SYNONYMS: Array<{ key: string; words: string; inferred?: boolean }> = [
  { key: "jardin", words: "jardin(?:es)?|verde propio" },
  { key: "pileta", words: "piletas?|piscinas?|pileton" },
  { key: "parrilla", words: "parrillas?|asador" },
  { key: "quincho_con_parrilla", words: "quinchos?", inferred: true },
  { key: "aire_acondicionado", words: "aires? acondicionados?|split|aire frio calor" },
  { key: "calefaccion", words: "calefaccion(?: central)?|calefaccionad[oa]" },
  { key: "seguridad", words: "seguridad(?: privada)?|vigilancia" },
  { key: "balcon", words: "balcon(?:es)?" },
  { key: "terraza", words: "terrazas?" },
  { key: "lavadero", words: "lavaderos?" },
  { key: "ascensor", words: "ascensor(?:es)?" },
  { key: "amueblado", words: "amueblad[oa]s?|amoblad[oa]s?|con muebles" },
  { key: "sum", words: "sum|salon de usos multiples" },
  { key: "gas", words: "gas natural|gas de red" },
  { key: "patio", words: "patios?" },
  { key: "galeria", words: "galerias?" },
  { key: "suite", words: "suites?" },
  { key: "vestidor", words: "vestidor(?:es)?" },
  { key: "internet", words: "internet|wifi" },
  { key: "alarma", words: "alarmas?" },
  { key: "cloacas", words: "cloacas?" },
  { key: "pavimento", words: "pavimento|calle asfaltada" },
];

const SOFT: Array<{ pref: SoftPreference; words: string }> = [
  { pref: "quiet", words: "tranquil[oa]s?|silencios[oa]s?|sin ruido" },
  { pref: "bright", words: "luminos[oa]s?|mucha luz|buena luz" },
  { pref: "near_city", words: "cerca (?:del|de la) (?:centro|ciudad)|centric[oa]s?|cerca de todo" },
  { pref: "brand_new", words: "a estrenar|recien construid[oa]s?" },
  { pref: "view", words: "con vistas?(?: (?:a|al|a los) (?:cerros?|montanas?|valle))?|vista a los cerros" },
  { pref: "gated_community", words: "barrios? cerrados?|barrios? privados?|countr(?:y|ies)|condominios?" },
  { pref: "spacious", words: "ampli[oa]s?|espacios[oa]s?|grandes?" },
  { pref: "investment", words: "para invertir|invertir|inversion(?:es)?" },
  { pref: "pets", words: "mascotas?|perros?|gatos?" },
];

const TIMEFRAME: Array<{ value: MoveTimeframe; words: string }> = [
  { value: "immediate", words: "urgente|con urgencia|lo antes posible|cuanto antes|ya mismo|inmediat[oa]|para ya|este mes" },
  { value: "within_3_months", words: "en (?:1|2|3|un|uno|dos|tres) mes(?:es)?|(?:los )?proximos? (?:2|3|dos|tres) meses" },
  { value: "within_6_months", words: "en (?:4|5|6|cuatro|cinco|seis) meses|(?:los )?proximos? (?:4|5|6|cuatro|cinco|seis) meses|antes de fin de ano" },
  { value: "later", words: "el ano que viene|el proximo ano|mas adelante|sin apuro|sin prisa" },
];

/** Nombres del catálogo demasiado genéricos para reconocerlos sueltos en una búsqueda («busco vivienda» no pide esa característica). */
const GENERIC_FEATURE_DENYLIST = new Set(["vivienda", "vivienda multifamiliar", "oficina", "cocina", "living", "comedor", "hall", "estudio", "escritorio", "toilette", "dependencia", "medianera", "telefono", "electricidad", "recepcion", "seguridad"]);

const STOPWORDS = new Set(
  (
    "busco buscamos buscando estoy estamos quiero queremos quisiera quisieramos necesito necesitamos me nos gustaria interesa interesaria " +
    "algo una un uno unos unas el la los las lo le de del en con y o u a al que para por mi mis su sus tenga tengan tener tiene " +
    "zona zonas barrio barrios cerca sobre ubicado ubicada ubicacion preferentemente preferencia ideal idealmente tipo si es posible " +
    "mas muy bien buen buena hola gracias favor precio presupuesto valor total propiedad propiedades inmueble inmuebles lugar donde " +
    "vivir algun alguna esta este ser sea como tambien e ni ya hay pero cual unidad opcion opciones dispuesto dispuesta pagar " +
    "salta capital provincia ciudad aprox tenemos tengo cuanto"
  ).split(" "),
);

// ───────────────────────── Montos ─────────────────────────

const USD_WORDS = new Set(["u$s", "us$", "u$d", "usd", "dolares", "dolar", "verdes", "u$"]);
const ARS_WORDS = new Set(["$", "ars", "pesos", "peso"]);
const MULTIPLIER: Record<string, number> = { mil: 1e3, k: 1e3, lucas: 1e3, luca: 1e3, millon: 1e6, millones: 1e6, mill: 1e6, palo: 1e6, palos: 1e6 };

const CUR = String.raw`u\$s|us\$|u\$d|u\$|usd|dolares|dolar|ars|pesos|peso|\$`;
const MONEY_RE = new RegExp(
  String.raw`(?:(${CUR})\s*)?(\d{1,3}(?:[.,]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(millones|millon|mill|palos|palo|lucas|luca|mil|k)?(?![\p{L}\p{N}])(?:\s*(?:de\s+)?(u\$s|usd|dolares|dolar|verdes|pesos|ars))?(?![\p{L}])`,
  "gu",
);

type Amount = { start: number; end: number; value: number; currency: "USD" | "ARS" | null; hasMultiplier: boolean; raw: string };

function readAmount(m: RegExpExecArray): Omit<Amount, "start" | "end"> | null {
  const n = parseArgentineNumber(m[2]!);
  if (n === null) return null;
  const mult = m[3] ? (MULTIPLIER[m[3]] ?? 1) : 1;
  const curRaw = m[1] ?? m[4] ?? null;
  const currency = curRaw ? (USD_WORDS.has(curRaw) ? "USD" : ARS_WORDS.has(curRaw) ? "ARS" : null) : null;
  return { value: Math.round(n * mult * 100) / 100, currency, hasMultiplier: Boolean(m[3]), raw: m[0] };
}

const QUAL_MAX = /(?:hasta|menos de|no mas de|no mas que|maximo(?: de)?|max\.?|tope(?: de)?|como mucho|que no pase(?: de)?|no superior a|presupuesto(?: maximo)?(?: de)?|dispongo de|tengo)\s*$/u;
const QUAL_MIN = /(?:desde|mas de|minimo(?: de)?|min\.?|a partir de|arriba de|superior a|al menos)\s*$/u;
const QUAL_APPROX = /(?:alrededor de|unos|aprox\.?|aproximadamente|cerca de|rondando|en torno a)\s*$/u;

// ───────────────────────── Parser ─────────────────────────

export type ParseResult = SearchIntent & { ownerHint: boolean };

export function parseSearchText(rawText: string, catalog: SalesCatalog): ParseResult {
  const original = rawText.normalize("NFC").slice(0, MAX_CONCIERGE_TEXT);
  const c = new Cursor(original, fold(original));
  const intent: ParseResult = { ...emptyIntent(), ownerHint: false };
  const typeKeys = new Set(catalog.types.map((t) => t.key));
  const typeCount = new Map(catalog.types.map((t) => [t.key, t.count]));
  const featureKeys = new Set(catalog.features.map((f) => f.key));
  const src = (start: number, end: number, confidence = 1, origin: "text" | "inferred" = "text") => ({ origin, confidence, evidence: c.evidence(start, end) });

  // Propietario que quiere vender/tasar: no es una búsqueda (se sugiere el camino correcto).
  c.each(word("quiero vender|vender mi|vendo mi|vendo|tasar|tasacion|tasen"), () => {
    intent.ownerHint = true;
    return true;
  });

  // Zonas (catálogo real: barrios primero, más largos primero)
  type ZoneEntry = { folded: string; loc: NonNullable<SearchIntent["locations"]>["value"][number] };
  const zones: ZoneEntry[] = [];
  for (const a of catalog.areas) {
    if (fold(a.name) === fold(a.localityName)) continue; // barrio comodín con el nombre de la localidad
    zones.push({ folded: fold(a.name), loc: { kind: "area", slug: a.slug, name: `${a.name}, ${a.localityName}`, localitySlug: a.localitySlug } });
  }
  for (const l of catalog.localities) {
    const f = fold(l.name);
    if (f === "salta") continue; // «Salta» a secas es la provincia entera: no filtra (ver alias explícitos)
    zones.push({ folded: f, loc: { kind: "locality", slug: l.slug, name: l.name, localitySlug: null } });
    // «San Lorenzo» → Villa San Lorenzo (nombre corto de uso habitual)
    if (f.startsWith("villa ")) zones.push({ folded: f.slice(6), loc: { kind: "locality", slug: l.slug, name: l.name, localitySlug: null } });
  }
  const city = catalog.localities.find((l) => fold(l.name) === "salta");
  if (city) for (const alias of ["salta capital", "ciudad de salta", "capital salten[ao]", "salta ciudad"]) zones.push({ folded: alias, loc: { kind: "locality", slug: city.slug, name: `${city.name} (ciudad)`, localitySlug: null } });
  // Barrios homónimos («La Aguada» en Salta y en Villa San Lorenzo): el mismo texto aporta todas sus ubicaciones.
  const byText = new Map<string, ZoneEntry["loc"][]>();
  for (const z of zones) byText.set(z.folded, [...(byText.get(z.folded) ?? []), z.loc]);
  const found: ZoneEntry["loc"][] = [];
  let zoneSpan: [number, number] | null = null;
  for (const [text, locs] of [...byText.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const pattern = /salten\[ao\]/.test(text) ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    c.each(new RegExp(`${B}${pattern}${E}`, "gu"), (_m, s, e) => {
      for (const loc of locs) if (!found.some((f) => f.slug === loc.slug && f.kind === loc.kind && f.localitySlug === loc.localitySlug)) found.push(loc);
      zoneSpan = zoneSpan ? [Math.min(zoneSpan[0], s), Math.max(zoneSpan[1], e)] : [s, e];
      return true;
    });
  }
  if (found.length) {
    const span = zoneSpan as [number, number] | null;
    intent.locations = { value: found.slice(0, 4), ...src(span?.[0] ?? 0, span?.[1] ?? 0) };
  }

  // Superficie (antes que montos: «200 m2» no es plata).
  const AREA_UNIT = String.raw`\s*(?:m2|m²|mts2|mts|mt2|metros cuadrados|metros)`;
  const AREA_NUM = String.raw`(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)`;
  c.each(new RegExp(`${B}entre\\s+${AREA_NUM}(?:${AREA_UNIT})?\\s+y\\s+${AREA_NUM}${AREA_UNIT}${E}`, "gu"), (m, s, e) => {
    const a = parseArgentineNumber(m[1]!);
    const b = parseArgentineNumber(m[2]!);
    if (a === null || b === null || a >= b) return false;
    intent.surface = { value: { min: a, max: b }, ...src(s, e) };
    return true;
  });
  c.each(new RegExp(`(?:(mas de|desde|minimo|al menos|de al menos|hasta|menos de|maximo)\\s+)?${AREA_NUM}${AREA_UNIT}${E}(?:\\s+(cubiertos?|de terreno|totales?))?`, "gu"), (m, s, e) => {
    const n = parseArgentineNumber(m[2]!);
    if (n === null || n <= 0) return false;
    const upper = m[1] === "hasta" || m[1] === "menos de" || m[1] === "maximo";
    const prev = intent.surface?.value ?? { min: null, max: null };
    intent.surface = { value: upper ? { min: prev.min, max: n } : { min: n, max: prev.max }, ...src(s, e) };
    return true;
  });
  c.each(new RegExp(`${B}(\\d+(?:,\\d+)?)\\s*(?:hectareas|ha)${E}`, "gu"), (m, s, e) => {
    const n = parseArgentineNumber(m[1]!);
    if (n === null || n <= 0) return false;
    intent.surface = { value: { min: n * 10_000, max: null }, ...src(s, e) };
    return true;
  });

  // Dormitorios / ambientes / baños / cocheras
  c.each(new RegExp(`${B}(?:(al menos|minimo|mas de|de)\\s+)?${NUMW}\\s*(\\+|o mas)?\\s*(?:dormitorios?|dorm\\.?|dormis?|habitaciones?|cuartos?|piezas?|recamaras?)${E}`, "gu"), (m, s, e) => {
    const n = smallNumber(m[2]!);
    if (n === null || n > 20) return false;
    intent.bedrooms = { value: m[1] === "mas de" ? n + 1 : n, ...src(s, e) };
    return true;
  });
  c.each(word("monoambientes?"), (_m, s, e) => {
    if (!intent.propertyTypes && typeKeys.has("departamento")) intent.propertyTypes = { value: ["departamento"], ...src(s, e, 0.9) };
    return true;
  });
  c.each(new RegExp(`${B}(?:(al menos|minimo|mas de|de)\\s+)?${NUMW}\\s*(\\+|o mas)?\\s*amb(?:ientes?|\\.)?${E}`, "gu"), (m, s, e) => {
    const n = smallNumber(m[2]!);
    if (n === null || n < 1 || n > 20) return false;
    // Convención argentina: N ambientes = living + (N − 1) dormitorios. Inferencia explícita, no dato dicho.
    if (!intent.bedrooms && n >= 2) intent.bedrooms = { value: (m[1] === "mas de" ? n + 1 : n) - 1, ...src(s, e, 0.8, "inferred") };
    return true;
  });
  c.each(new RegExp(`${B}(?:(al menos|minimo|de)\\s+)?${NUMW}\\s*(?:\\+|o mas)?\\s*banos?${E}`, "gu"), (m, s, e) => {
    const n = smallNumber(m[2]!);
    if (n === null || n < 1 || n > 20) return false;
    intent.bathrooms = { value: n, ...src(s, e) };
    return true;
  });
  c.each(new RegExp(`${B}${NUMW}\\s*cocheras?${E}`, "gu"), (m, s, e) => {
    const n = smallNumber(m[1]!);
    if (n === null || n < 1 || n > 20) return false;
    intent.garages = { value: n, ...src(s, e) };
    return true;
  });
  c.each(word("(?:con|y|que tenga|tenga) (?:cochera|garage|garaje|estacionamiento)"), (_m, s, e) => {
    intent.garages ??= { value: 1, ...src(s, e) };
    return true;
  });

  // Montos: rangos «entre X y Y» / «de X a Y», después montos sueltos con su calificador.
  const amounts: Amount[] = [];
  c.each(MONEY_RE, (m, start, end) => {
    const a = readAmount(m);
    if (a) amounts.push({ ...a, start, end });
    return false; // se consumen recién al aceptarlos
  });
  const used = new Set<number>();
  type Bound = { value: number; s: number; e: number; conf: number; origin: "text" | "inferred" };
  let min = null as Bound | null;
  let max = null as Bound | null;
  let currency: { value: "USD" | "ARS"; s: number; e: number } | null = null;
  const setCurrency = (a: Amount) => {
    if (a.currency && !currency) currency = { value: a.currency, s: a.start, e: a.end };
  };
  for (let i = 0; i + 1 < amounts.length; i++) {
    const a = amounts[i]!;
    const b = amounts[i + 1]!;
    const between = c.folded.slice(a.end, b.start);
    const before = c.folded.slice(Math.max(0, a.start - 12), a.start);
    if (!/^\s*(?:y|a|hasta|-)\s*$/.test(between) || !(/(?:entre|de)\s*$/.test(before) || /^\s*-\s*$/.test(between))) continue;
    // «entre 100 y 150 mil»: el multiplicador y la moneda del segundo valen para el primero.
    let av = a.value;
    if (!a.hasMultiplier && b.hasMultiplier) {
      const mult = b.value / (parseArgentineNumber(b.raw.match(/\d[\d.,]*/)?.[0] ?? "") ?? b.value);
      if (Number.isFinite(mult) && mult > 1 && av * mult <= b.value) av = av * mult;
    }
    if (!(av < b.value)) continue;
    if (!(a.currency || b.currency || b.hasMultiplier || b.value >= 10_000)) continue;
    const qualStart = before.search(/(?:entre|de)\s*$/);
    const s = qualStart >= 0 ? a.start - (before.length - qualStart) : a.start;
    min = { value: av, s, e: b.end, conf: 1, origin: "text" };
    max = { value: b.value, s, e: b.end, conf: 1, origin: "text" };
    setCurrency(a);
    setCurrency(b);
    if (a.currency && b.currency && a.currency !== b.currency) currency = null;
    used.add(i).add(i + 1);
    c.take(s, b.end);
    break;
  }
  for (const [i, a] of amounts.entries()) {
    if (used.has(i) || !c.free(a.start, a.end)) continue;
    const moneyLike = Boolean(a.currency) || a.hasMultiplier || a.value >= 10_000;
    if (!moneyLike || a.value < 1) continue;
    const before = c.folded.slice(Math.max(0, a.start - 30), a.start);
    const qMax = QUAL_MAX.exec(before);
    const qMin = QUAL_MIN.exec(before);
    const qApprox = QUAL_APPROX.exec(before);
    const q = qMax ?? qMin ?? qApprox;
    const s = q ? a.start - (before.length - q.index) : a.start;
    if (qMin) min ??= { value: a.value, s, e: a.end, conf: 1, origin: "text" };
    else if (qApprox) {
      // «alrededor de X»: rango ±10 %, marcado como inferido.
      min ??= { value: Math.round(a.value * 0.9), s, e: a.end, conf: 0.6, origin: "inferred" };
      max ??= { value: Math.round(a.value * 1.1), s, e: a.end, conf: 0.6, origin: "inferred" };
    } else if (qMax) max ??= { value: a.value, s, e: a.end, conf: 1, origin: "text" };
    // Monto suelto («casa 180 mil dólares»): se toma como tope, con confianza menor.
    else max ??= { value: a.value, s, e: a.end, conf: 0.7, origin: "inferred" };
    setCurrency(a);
    c.take(s, a.end);
  }
  if (min && max && min.value > max.value) min = null;
  const cur = currency as { value: "USD" | "ARS"; s: number; e: number } | null;
  if (cur) {
    intent.currency = { value: cur.value, ...src(cur.s, cur.e) };
    if (min) intent.budgetMin = { value: min.value, ...src(min.s, min.e, min.conf, min.origin) };
    if (max) intent.budgetMax = { value: max.value, ...src(max.s, max.e, max.conf, max.origin) };
  } else if (min || max) {
    intent.ambiguousAmount = { min: min?.value ?? null, max: max?.value ?? null };
  }

  // Operación
  const op = (value: TransactionType, words: string, confidence = 1) =>
    c.each(word(words), (_m, s, e) => {
      intent.transactionType ??= { value, ...src(s, e, confidence) };
      return true;
    });
  op("temporary_rent", "alquiler temporario|alquileres temporarios|temporari[oa]s?|por temporada|por dias?|por semanas?|alquiler turistico");
  op("rent", "alquil\\p{L}*|arriend\\p{L}*|en alquiler");
  op("sale", "compr\\p{L}*|en venta|a la venta|venta|adquirir");

  // Tipos
  for (const t of TYPE_SYNONYMS) {
    c.each(word(t.words), (_m, s, e) => {
      const real = t.keys.filter((k) => typeKeys.has(k));
      if (!real.length) return false;
      const withStock = real.filter((k) => (typeCount.get(k) ?? 0) > 0);
      const keys = withStock.length ? withStock : real.slice(0, 1);
      const prev = intent.propertyTypes?.value ?? [];
      const merged = [...new Set([...prev, ...keys])].slice(0, 4);
      intent.propertyTypes = { value: merged, ...src(s, e, keys.length === real.length ? 1 : 0.9) };
      return true;
    });
  }
  // «cochera» sola (sin «con»): tipo cochera si existe.
  c.each(word("cocheras?|garages?"), (_m, s, e) => {
    if (typeKeys.has("cochera") && !intent.propertyTypes) {
      intent.propertyTypes = { value: ["cochera"], ...src(s, e) };
      return true;
    }
    intent.garages ??= { value: 1, ...src(s, e, 0.8, "inferred") };
    return true;
  });

  // Características: negadas («sin pileta») se consumen sin filtrar.
  const addFeature = (key: string, s: number, e: number, confidence: number, origin: "text" | "inferred") => {
    const prev = intent.features?.value ?? [];
    if (prev.includes(key) || prev.length >= 12) return;
    intent.features = { value: [...prev, key], ...src(s, e, Math.min(confidence, intent.features?.confidence ?? 1), intent.features?.origin === "inferred" ? "inferred" : origin) };
  };
  const negated = (s: number) => /(?:sin|no (?:quiero|necesito|hace falta))\s*(?:\p{L}+\s+)?$/u.test(c.folded.slice(Math.max(0, s - 22), s));
  for (const f of FEATURE_SYNONYMS) {
    if (!featureKeys.has(f.key)) continue;
    c.each(word(f.words), (_m, s, e) => {
      if (!negated(s)) addFeature(f.key, s, e, f.inferred ? 0.7 : 1, f.inferred ? "inferred" : "text");
      return true;
    });
  }
  // Resto del catálogo por nombre exacto («aire acondicionado», «cancha de tenis»…)
  for (const f of [...catalog.features].sort((a, b) => b.name.length - a.name.length)) {
    const name = fold(f.name).replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    if (name.length < 4 || GENERIC_FEATURE_DENYLIST.has(name)) continue;
    c.each(new RegExp(`${B}${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${E}`, "gu"), (_m, s, e) => {
      if (!negated(s)) addFeature(f.key, s, e, 1, "text");
      return true;
    });
  }

  // Financiación
  c.each(word("apt[oa]s? (?:para )?credito(?: hipotecario)?|credito hipotecario|con credito|acepta(?:n)? credito|financiacion bancaria|hipotecario|procrear"), (_m, s, e) => {
    intent.financing = { value: "credit", ...src(s, e) };
    return true;
  });
  c.each(word("de contado|al contado|contado|efectivo"), (_m, s, e) => {
    intent.financing ??= { value: "cash", ...src(s, e) };
    return true;
  });

  // Plazo
  for (const t of TIMEFRAME) {
    c.each(word(t.words), (_m, s, e) => {
      intent.moveTimeframe ??= { value: t.value, ...src(s, e) };
      return true;
    });
  }

  // Preferencias blandas (no filtran)
  for (const p of SOFT) {
    c.each(word(p.words), () => {
      if (!intent.preferences.includes(p.pref)) intent.preferences.push(p.pref);
      return true;
    });
  }
  if (intent.preferences.includes("investment") && !intent.transactionType) {
    // Invertir en un inmueble es comprar: inferencia explícita.
    intent.transactionType = { value: "sale", origin: "inferred", confidence: 0.8, evidence: "invertir" };
  }

  // Lo que queda sin interpretar
  intent.unparsed = unparsedFragments(c);
  return intent;
}

function unparsedFragments(c: Cursor): string[] {
  const tokens: Array<{ s: number; e: number; stop: boolean }> = [];
  const re = /[\p{L}\p{N}$]+/gu;
  for (let m = re.exec(c.folded); m; m = re.exec(c.folded)) {
    const s = m.index;
    const e = s + m[0].length;
    if (!c.free(s, e)) continue;
    // Tokens parcialmente consumidos: se ignoran (su parte útil ya se interpretó).
    const partial = c.consumed.slice(s, e).some(Boolean);
    if (partial) continue;
    const w = m[0];
    tokens.push({ s, e, stop: STOPWORDS.has(w) || (w.length < 2 && !/\d/.test(w)) });
  }
  const groups: Array<Array<{ s: number; e: number; stop: boolean }>> = [];
  let cur: Array<{ s: number; e: number; stop: boolean }> = [];
  let last = -1;
  for (const t of tokens) {
    const gap = last < 0 ? "" : c.folded.slice(last, t.s);
    const contiguous = last >= 0 && c.free(last, t.s) && /^[\s,.;:!?¿¡()'"-]*$/.test(gap);
    if (!contiguous && cur.length) {
      groups.push(cur);
      cur = [];
    }
    cur.push(t);
    last = t.e;
  }
  if (cur.length) groups.push(cur);
  const out: string[] = [];
  for (const g of groups) {
    let i = 0;
    let j = g.length - 1;
    while (i <= j && g[i]!.stop) i++;
    while (j >= i && g[j]!.stop) j--;
    if (i > j) continue;
    const text = c.evidence(g[i]!.s, g[j]!.e);
    if (text && !out.includes(text)) out.push(text.slice(0, 60));
    if (out.length >= 5) break;
  }
  return out;
}
