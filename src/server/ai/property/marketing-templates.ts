/**
 * AI Marketing Director — capa DETERMINISTA (sin IA): borradores por canal armados SOLO con datos reales de la ficha.
 * Sin adjetivos sobre lo que no consta: nada de «luminoso», «vista increíble» ni «excelente ubicación» si la ficha no lo
 * dice. Instagram, Facebook, WhatsApp y email se renderizan con `content_templates` (editables por marketing);
 * SEO y guion de Reel se arman acá. Todo lo que sale de acá pasa las mismas guardas que el texto de la IA
 * (marketing-guards.ts, tests/unit/ai-property-marketing.test.ts).
 */
import { renderContentTemplate, money, type CopyVars } from "../../marketing/copy";
import { fitTitle, formatArea, headlineDetail, propertyHeadline, truncateAtWord } from "../../properties/public-helpers";
import type { RoomKey } from "./rooms";

export const MARKETING_RULES_VERSION = "2026-09-17.1";

export const MARKETING_CHANNELS = ["site_seo", "instagram", "facebook", "whatsapp", "email", "reel_script"] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];
export const CHANNEL_LABEL: Record<MarketingChannel, string> = {
  site_seo: "Sitio (SEO)",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  email: "Email",
  reel_script: "Guion de Reel",
};

export type MarketingFacts = {
  code: number;
  title: string;
  typeName: string;
  category: string;
  operations: Array<{ operation: "sale" | "rent" | "temporary_rent"; currency: "USD" | "ARS"; amount: number | null; priceHidden: boolean }>;
  /** Barrio o localidad pública (zoneLabel del sitio). */
  zone: string | null;
  /** Calle pública (sin altura si la dirección está oculta) o null. */
  street: string | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  areas: { totalM2: number | null; coveredM2: number | null; landM2: number | null };
  creditEligible: boolean | null;
  features: string[];
  /** Descripción cargada por el equipo (null si menciona la dirección oculta o no hay). */
  description: string | null;
  publicUrl: string;
  orgName: string;
  foundedYear: number | null;
  /** Ambientes etiquetados en las fotos, en el orden de la ficha. */
  photoRooms: RoomKey[];
  photoCount: number;
};

export type ReelScene = { shot: string; voiceover: string; on_screen: string };
export type MarketingDraftSet = {
  site_seo: { title: string; description: string };
  instagram: { caption: string; hashtags: string[] };
  facebook: { text: string };
  whatsapp: { text: string };
  email: { subject: string; body: string };
  reel_script: { scenes: ReelScene[] };
};

export type ChannelTemplates = Partial<Record<"instagram" | "facebook" | "whatsapp" | "email", string>>;

const OP_NOUN = { sale: "venta", rent: "alquiler", temporary_rent: "alquiler temporario" } as const;
const n = (x: number | null | undefined) => (typeof x === "number" && x > 0 ? x : null);
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

function operationText(f: MarketingFacts): string {
  return [...new Set(f.operations.map((o) => OP_NOUN[o.operation]))].join(" y ");
}

function priceText(f: MarketingFacts): string {
  const visible = f.operations.filter((o) => !o.priceHidden && o.amount !== null && o.amount > 0);
  if (!visible.length) return "";
  if (visible.length === 1 && f.operations.length === 1) return money(visible[0]!.amount!, visible[0]!.currency);
  return visible.map((o) => `${OP_NOUN[o.operation].charAt(0).toUpperCase()}${OP_NOUN[o.operation].slice(1)}: ${money(o.amount!, o.currency)}`).join(" · ");
}

function surfaceText(f: MarketingFacts): string {
  const parts: string[] = [];
  const covered = formatArea(f.areas.coveredM2);
  const land = formatArea(f.areas.landM2);
  const total = formatArea(f.areas.totalM2);
  if (f.category === "land") {
    if (land ?? total) parts.push(`${land ?? total} de terreno`);
    return parts.join(" · ");
  }
  if (covered) parts.push(`${covered} cubiertos`);
  if (land) parts.push(`${land} de terreno`);
  else if (total && total !== covered) parts.push(`${total} totales`);
  return parts.join(" · ");
}

/** Hasta 2 oraciones de la descripción cargada (dato real escrito por el equipo). */
export function descriptionSummary(description: string | null, max = 280): string {
  if (!description) return "";
  const clean = description.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if ((out + s).length > max) break;
    out += s;
    if (out.split(/[.!?]/).filter((x) => x.trim()).length >= 2) break;
  }
  return (out || truncateAtWord(clean, max)).trim();
}

export function hashtagsFor(f: MarketingFacts): string[] {
  const tag = (s: string) => `#${s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase())}`;
  const out = ["#Salta", "#Inmobiliaria"];
  if (f.zone) out.push(tag(f.zone));
  for (const o of new Set(f.operations.map((x) => x.operation))) out.push(tag(`${f.typeName} en ${OP_NOUN[o]}`));
  return [...new Set(out.filter((h) => /^#[A-Za-z0-9]{2,40}$/.test(h)))].slice(0, 8);
}

export function marketingVars(f: MarketingFacts): CopyVars {
  const summary = descriptionSummary(f.description);
  return {
    tipo: f.typeName,
    tipo_minuscula: f.typeName.toLowerCase(),
    operacion: operationText(f),
    localidad: f.zone ?? "",
    titulo: f.title,
    ambientes: n(f.rooms) ? plural(f.rooms!, "ambiente", "ambientes") : "",
    dormitorios: n(f.bedrooms) ? plural(f.bedrooms!, "dormitorio", "dormitorios") : "",
    banos: n(f.bathrooms) ? plural(f.bathrooms!, "baño", "baños") : "",
    cocheras: n(f.garages) ? plural(f.garages!, "cochera", "cocheras") : "",
    superficie: surfaceText(f),
    destacados: f.features.slice(0, 5).join(" · "),
    resumen: summary,
    precio: priceText(f),
    codigo: String(f.code),
    link: f.publicUrl,
    saludo: "Hola,",
    hashtags: hashtagsFor(f).join(" "),
    inmobiliaria_nombre: f.orgName,
    inmobiliaria: f.foundedYear ? `${f.orgName} · desde ${f.foundedYear}` : f.orgName,
  };
}

/** Plantillas por defecto si falta una en content_templates (mismas que 0521). */
export const DEFAULT_TEMPLATES: Required<ChannelTemplates> = {
  instagram: "{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{cocheras}}\n{{destacados}}\n{{precio}}\n\nCódigo {{codigo}} · Ficha completa en el link de la bio\n\n{{inmobiliaria}}\n\n{{hashtags}}",
  facebook: "{{tipo}} en {{operacion}} · {{localidad}}\n\n{{titulo}}\n\n{{resumen}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{cocheras}}\n{{destacados}}\n{{precio}}\n\nCódigo {{codigo}}\nFicha completa: {{link}}\n\n{{inmobiliaria}}",
  whatsapp: "Hola, te comparto esta propiedad de {{inmobiliaria_nombre}}:\n\n*{{titulo}}*\n{{tipo}} en {{operacion}} · {{localidad}}\n{{ambientes}}\n{{dormitorios}}\n{{superficie}}\n{{precio}}\n\nFicha completa: {{link}}\n¿Te gustaría coordinar una visita?",
  email: "{{saludo}}\n\nTe acercamos una propiedad que puede interesarte: {{titulo}}, {{tipo_minuscula}} en {{operacion}} en {{localidad}}.\n\n{{resumen}}\n\n{{ambientes}}\n{{dormitorios}}\n{{banos}}\n{{superficie}}\n{{destacados}}\n{{precio}}\n\nVer la ficha completa: {{link}}\n\nSi querés coordinar una visita, respondé este correo.\n\n{{inmobiliaria}}",
};

function seo(f: MarketingFacts): MarketingDraftSet["site_seo"] {
  const op = f.operations[0]?.operation ?? null;
  const detail = headlineDetail({ category: f.category, bedrooms: f.bedrooms, rooms: f.rooms, coveredAreaM2: f.areas.coveredM2, landAreaM2: f.areas.landM2, totalAreaM2: f.areas.totalM2 });
  const title = fitTitle([propertyHeadline(f.typeName, op, f.zone, detail), propertyHeadline(f.typeName, op, f.zone), `${f.typeName} en ${operationText(f)}`], 60);
  const facts = [n(f.bedrooms) ? plural(f.bedrooms!, "dormitorio", "dormitorios") : "", n(f.bathrooms) ? plural(f.bathrooms!, "baño", "baños") : "", surfaceText(f)].filter(Boolean).join(", ");
  const price = priceText(f);
  const base = `${f.typeName} en ${operationText(f)}${f.zone ? ` en ${f.zone}, Salta` : " en Salta"}${facts ? `: ${facts}` : ""}.`;
  const description = truncateAtWord([base, price ? `${price}.` : "", `Código ${f.code}.`].filter(Boolean).join(" "), 155);
  return { title, description };
}

const ROOM_SHOT: Partial<Record<RoomKey, string>> = { living: "living", cocina: "cocina", comedor: "comedor", dormitorio: "dormitorio", bano: "baño", jardin: "jardín", piscina: "piscina" };

function reel(f: MarketingFacts): MarketingDraftSet["reel_script"] {
  const op = operationText(f);
  const scenes: ReelScene[] = [];
  const hasFront = f.photoRooms.includes("fachada") || f.photoRooms.includes("exterior");
  scenes.push({
    shot: hasFront ? "Foto de la fachada o del exterior (etiquetada en Multimedia)" : "Foto de portada",
    voiceover: `${f.typeName} en ${op}${f.zone ? ` en ${f.zone}` : ""}.`,
    on_screen: `${f.typeName} en ${op}`.toUpperCase().slice(0, 80),
  });
  const rooms = [...new Set(f.photoRooms)].filter((r): r is keyof typeof ROOM_SHOT => r in ROOM_SHOT).slice(0, 3);
  for (const r of rooms) {
    const vo = r === "dormitorio" && n(f.bedrooms) ? `${plural(f.bedrooms!, "dormitorio", "dormitorios")}.` : r === "bano" && n(f.bathrooms) ? `${plural(f.bathrooms!, "baño", "baños")}.` : `${ROOM_SHOT[r]!.charAt(0).toUpperCase()}${ROOM_SHOT[r]!.slice(1)}.`;
    scenes.push({ shot: `Foto del ${ROOM_SHOT[r]} (etiquetada en Multimedia)`, voiceover: vo, on_screen: "" });
  }
  if (!rooms.length && f.photoCount > 1) {
    const line = [n(f.bedrooms) ? plural(f.bedrooms!, "dormitorio", "dormitorios") : "", n(f.bathrooms) ? plural(f.bathrooms!, "baño", "baños") : ""].filter(Boolean).join(" y ");
    scenes.push({ shot: "Recorrido por las fotos de la ficha, en el orden publicado", voiceover: line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}.` : "Mirá las fotos de la ficha.", on_screen: "" });
  }
  const surface = surfaceText(f);
  if (surface) scenes.push({ shot: "Plano o toma general", voiceover: `${surface.charAt(0).toUpperCase()}${surface.slice(1)}.`, on_screen: surface.slice(0, 80) });
  const price = priceText(f);
  scenes.push({ shot: "Cierre con logo", voiceover: `${price ? `${price}. ` : ""}Código ${f.code}. Más información en la ficha.`, on_screen: `Cód. ${f.code}` });
  while (scenes.length < 3) scenes.splice(scenes.length - 1, 0, { shot: "Foto de la ficha", voiceover: `${f.title}.`, on_screen: "" });
  return { scenes: scenes.slice(0, 8) };
}

export function buildMarketingDrafts(f: MarketingFacts, templates: ChannelTemplates = {}): MarketingDraftSet {
  const vars = marketingVars(f);
  const t = { ...DEFAULT_TEMPLATES, ...templates };
  const subjectParts = [`${f.typeName} en ${operationText(f)}${f.zone ? ` en ${f.zone}` : ""}`, `Código ${f.code}`];
  return {
    site_seo: seo(f),
    instagram: { caption: renderContentTemplate(t.instagram, vars).slice(0, 2200), hashtags: hashtagsFor(f) },
    facebook: { text: renderContentTemplate(t.facebook, vars) },
    whatsapp: { text: renderContentTemplate(t.whatsapp, vars).slice(0, 900) },
    email: { subject: truncateAtWord(subjectParts.join(" · "), 120), body: renderContentTemplate(t.email, vars) },
    reel_script: reel(f),
  };
}

/** Texto plano de un canal (para guardas, copiar y comparar). */
export function channelText(channel: MarketingChannel, set: MarketingDraftSet): string {
  switch (channel) {
    case "site_seo":
      return `${set.site_seo.title}\n${set.site_seo.description}`;
    case "instagram":
      return set.instagram.caption;
    case "facebook":
      return set.facebook.text;
    case "whatsapp":
      return set.whatsapp.text;
    case "email":
      return `${set.email.subject}\n${set.email.body}`;
    case "reel_script":
      return set.reel_script.scenes.map((s) => `${s.shot}\n${s.voiceover}\n${s.on_screen}`).join("\n");
  }
}
