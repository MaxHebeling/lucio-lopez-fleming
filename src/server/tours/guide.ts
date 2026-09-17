/**
 * Guía del Tour 360° («Preguntá por esta casa»). Puro (servidor y navegador): interpreta la pregunta de forma
 * DETERMINISTA, busca caminos entre escenas publicadas (BFS sobre los hotspots de tipo escena) y responde SOLO con
 * escenas, puntos de información y datos públicos de la ficha. Si algo no consta: «No está registrado».
 *
 * Con clave (opcional), el modelo solo traduce la pregunta a una intención (`TourIntent`); la respuesta la arma este
 * módulo igual que sin IA. Tests: tests/unit/tours-guide.test.ts.
 */
import type { TourHotspot, TourScene } from "./model";

export type TourFact = { key: string; label: string; value: string };
export type TourIntent = { kind: "navigate"; sceneId: string } | { kind: "feature"; factKey: string | null; topic: string | null } | { kind: "unknown" };

export type GuideAnswer =
  | { kind: "route"; text: string; path: string[]; targetId: string; targetName: string }
  | { kind: "here"; text: string; targetId: string }
  | { kind: "fact"; text: string; sceneId: string | null; sceneName: string | null }
  | { kind: "not_registered"; text: string }
  | { kind: "unreachable"; text: string }
  | { kind: "unknown"; text: string };

type GraphScene = Pick<TourScene, "id" | "name" | "slug"> & { hotspots: Array<Pick<TourHotspot, "kind" | "targetSceneId" | "label" | "content">> };

export function normalizeQuestion(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ───────────────────────────── Ambientes y sinónimos ─────────────────────────────

/**
 * Conceptos de ambiente. Cada uno tiene grupos de palabras en orden de preferencia: si no hay una escena del primer
 * grupo se busca en el siguiente (jardín → galería/exterior), y la respuesta lo aclara.
 */
export const ROOM_CONCEPTS: Array<{ key: string; label: string; ask: RegExp; groups: string[][] }> = [
  { key: "suite", label: "suite", ask: /\b(suite|dormitorio principal|habitacion principal|cuarto principal)\b/, groups: [["suite", "principal"], ["dormitorio", "habitacion", "cuarto"]] },
  { key: "jardin", label: "jardín", ask: /\b(jardin|parque|patio|cesped|verde)\b/, groups: [["jardin", "parque", "patio", "cesped"], ["galeria", "exterior", "terraza", "quincho"]] },
  { key: "piscina", label: "piscina", ask: /\b(piscina|pileta|solarium)\b/, groups: [["piscina", "pileta", "solarium"]] },
  { key: "galeria", label: "galería", ask: /\b(galeria|quincho|parrilla|asador)\b/, groups: [["galeria", "quincho", "parrilla"]] },
  { key: "dormitorio", label: "dormitorio", ask: /\b(dormitorios?|habitacion(es)?|cuartos?|pieza)\b/, groups: [["dormitorio", "habitacion", "cuarto", "suite"]] },
  { key: "bano", label: "baño", ask: /\b(banos?|toilette)\b/, groups: [["bano", "toilette"]] },
  { key: "cocina", label: "cocina", ask: /\bcocina\b/, groups: [["cocina"]] },
  { key: "comedor", label: "comedor", ask: /\bcomedor\b/, groups: [["comedor"]] },
  { key: "living", label: "living", ask: /\b(living|estar|sala)\b/, groups: [["living", "estar", "sala"]] },
  { key: "entrada", label: "entrada", ask: /\b(entrada|hall|recibidor|acceso|puerta)\b/, groups: [["entrada", "hall", "recibidor", "acceso"]] },
  { key: "pasillo", label: "pasillo", ask: /\bpasillo\b/, groups: [["pasillo"]] },
  { key: "cochera", label: "cochera", ask: /\b(cochera|garage|garaje)\b/, groups: [["cochera", "garage", "garaje"]] },
  { key: "lavadero", label: "lavadero", ask: /\blavadero\b/, groups: [["lavadero"]] },
  { key: "terraza", label: "terraza", ask: /\b(terraza|balcon)\b/, groups: [["terraza", "balcon"]] },
  { key: "fachada", label: "frente", ask: /\b(fachada|frente)\b/, groups: [["fachada", "frente", "exterior"]] },
];

const NAV = /\b(donde (esta|estan|queda|quedan|hay)|como (llego|voy|se llega|voy a)|ir (a|al|hasta)|llevame|mostrame|quiero ver|ver (el|la|los|las)|pasar (a|al)|vamos (a|al))\b/;
const HAS = /\b(tiene|tienen|hay|cuenta con|incluye|posee|trae)\b/;

// ───────────────────────────── Datos públicos ─────────────────────────────

/** Temas de datos: palabras que los disparan. Si el tema no tiene dato publicado, se responde «No está registrado». */
export const FACT_TOPICS: Array<{ key: string; label: string; ask: RegExp }> = [
  { key: "dormitorios", label: "dormitorios", ask: /\b(cuantos|cuantas)\b.*\b(dormitorios|habitaciones|cuartos)\b/ },
  { key: "banos", label: "baños", ask: /\b(cuantos)\b.*\bbanos\b/ },
  { key: "ambientes", label: "ambientes", ask: /\bambientes\b/ },
  { key: "cocheras", label: "cocheras", ask: /\b(cuantas cocheras|cocheras|estacionamiento|autos?)\b/ },
  { key: "superficie", label: "superficie", ask: /\b(superficie|metros|m2|mts|tamano|que tan grande|cuanto mide)\b/ },
  { key: "terreno", label: "terreno", ask: /\b(terreno|lote)\b/ },
  { key: "antiguedad", label: "antigüedad", ask: /\b(antiguedad|anos tiene|cuantos anos|estrenar|nueva)\b/ },
  { key: "orientacion", label: "orientación", ask: /\b(orientacion|orientada|norte|sol de la manana)\b/ },
  { key: "precio", label: "precio", ask: /\b(precio|cuesta|cuanto sale|valor|vale)\b/ },
  { key: "expensas", label: "expensas", ask: /\b(expensas|gastos comunes)\b/ },
  { key: "credito", label: "apta crédito", ask: /\b(credito|hipotecari)/ },
  { key: "mascotas", label: "mascotas", ask: /\b(mascotas?|perros?|gatos?)\b/ },
  { key: "escritura", label: "escritura", ask: /\b(escritura|escriturada|papeles)\b/ },
  { key: "servicios", label: "servicios", ask: /\b(gas natural|agua corriente|cloacas|luz electrica|servicios)\b/ },
  { key: "calefaccion", label: "calefacción", ask: /\b(calefaccion|aire acondicionado|losa radiante)\b/ },
  { key: "seguridad", label: "seguridad", ask: /\b(seguridad|vigilancia|alarma)\b/ },
];

// ───────────────────────────── Grafo ─────────────────────────────

/** Camino más corto (en saltos) entre dos escenas publicadas siguiendo los puntos de tipo escena. null si no hay. */
export function findRoute(scenes: GraphScene[], fromId: string, toId: string): string[] | null {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const prev = new Map<string, string | null>([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toId) break;
    for (const h of byId.get(cur)!.hotspots) {
      if (h.kind !== "scene" || !h.targetSceneId || !byId.has(h.targetSceneId) || prev.has(h.targetSceneId)) continue;
      prev.set(h.targetSceneId, cur);
      queue.push(h.targetSceneId);
    }
  }
  if (!prev.has(toId)) return null;
  const path: string[] = [];
  for (let at: string | null = toId; at; at = prev.get(at) ?? null) path.unshift(at);
  return path;
}

const FEMININE_WORD = /^(cocina|galeria|galería|piscina|pileta|entrada|suite|terraza|habitacion|habitación|toilette|sala|cochera|fachada|planta|vista|oficina|biblioteca|bodega|parrilla)$/i;

/** «el Living», «la Galería», «al Jardín», «del Pasillo». */
export function withArticle(name: string, prep: "" | "a" | "de" = ""): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const fem = FEMININE_WORD.test(first) || (/a$/i.test(first) && !/(dia|mapa|clima|sofa|sistema)$/i.test(first));
  if (fem) return `${prep ? `${prep} ` : ""}la ${name}`;
  return prep === "a" ? `al ${name}` : prep === "de" ? `del ${name}` : `el ${name}`;
}

export function describeRoute(path: string[], names: Record<string, string>): string {
  const n = (id: string) => names[id] ?? "otro ambiente";
  if (path.length <= 1) return `Ya estás en ${withArticle(n(path[0] ?? ""))}.`;
  const [first, ...rest] = path;
  const steps = rest.map((id, i) => (i === 0 ? `podés ir ${withArticle(n(id), "a")}` : `luego ${withArticle(n(id), "a")}`));
  const joined = steps.length === 1 ? steps[0] : `${steps.slice(0, -1).join(", ")} y ${steps.at(-1)}`;
  return `Desde ${withArticle(n(first!))} ${joined}.`;
}

// ───────────────────────────── Interpretación ─────────────────────────────

function sceneTokens(s: GraphScene): string {
  return ` ${normalizeQuestion(`${s.name} ${s.slug.replace(/-/g, " ")}`)} `;
}

/** Escena para un concepto: primer grupo con coincidencia (y si piden «principal», la que lo diga). */
export function scenesForConcept(concept: (typeof ROOM_CONCEPTS)[number], scenes: GraphScene[], q = ""): { scene: GraphScene; exact: boolean } | null {
  for (const [gi, group] of concept.groups.entries()) {
    const matches = scenes.filter((s) => group.some((w) => sceneTokens(s).includes(` ${w}`)));
    if (!matches.length) continue;
    const wantsMain = /\bprincipal\b/.test(q);
    const pick = (wantsMain && matches.find((s) => sceneTokens(s).includes(" principal"))) || matches[0]!;
    return { scene: pick, exact: gi === 0 };
  }
  return null;
}

export function parseTourQuestion(question: string, scenes: GraphScene[]): TourIntent {
  const q = normalizeQuestion(question);
  if (q.length < 2) return { kind: "unknown" };
  const words = q.split(" ").length;
  // Nombre de escena escrito tal cual ("¿dónde está el comedor diario?").
  const direct = [...scenes].sort((a, b) => b.name.length - a.name.length).find((s) => normalizeQuestion(s.name).length >= 3 && ` ${q} `.includes(` ${normalizeQuestion(s.name)} `));
  const nav = NAV.test(q);
  const has = HAS.test(q);
  const topic = FACT_TOPICS.find((t) => t.ask.test(q));
  if (direct && (nav || (!has && !topic && words <= 4))) return { kind: "navigate", sceneId: direct.id };
  const concept = ROOM_CONCEPTS.find((c) => c.ask.test(q));
  if (concept && (nav || (!has && !topic && words <= 4))) {
    const found = scenesForConcept(concept, scenes, q);
    return found ? { kind: "navigate", sceneId: found.scene.id } : { kind: "feature", factKey: null, topic: concept.key };
  }
  if (topic) return { kind: "feature", factKey: topic.key, topic: topic.key };
  if (concept) return { kind: "feature", factKey: null, topic: concept.key };
  if (has || /\?$/.test(question.trim()) || words >= 2) return { kind: "feature", factKey: null, topic: null };
  return { kind: "unknown" };
}

// ───────────────────────────── Respuesta ─────────────────────────────

export const NOT_REGISTERED = "No está registrado en la ficha ni en el tour. Consultalo con el asesor.";
export const UNKNOWN_HELP = "No entendí la pregunta. Probá con «¿Dónde está la cocina?» o «¿Tiene cochera?».";

function infoMatch(q: string, scenes: GraphScene[]): { scene: GraphScene; label: string; content: string } | null {
  const tokens = q.split(" ").filter((w) => w.length >= 4 && !["donde", "tiene", "tienen", "esta", "como", "cuanto", "cuantos", "casa", "propiedad", "hay"].includes(w));
  if (!tokens.length) return null;
  let best: { scene: GraphScene; label: string; content: string; score: number } | null = null;
  for (const s of scenes) {
    for (const h of s.hotspots) {
      if (h.kind !== "info" || !h.content) continue;
      const hay = normalizeQuestion(`${h.label} ${h.content}`);
      const score = tokens.filter((t) => hay.includes(t)).length;
      if (score > 0 && (!best || score > best.score)) best = { scene: s, label: h.label, content: h.content, score };
    }
  }
  return best;
}

export function answerTourQuestion(input: { question: string; scenes: GraphScene[]; currentSceneId: string; facts: TourFact[]; intent?: TourIntent | null }): GuideAnswer {
  const { scenes, currentSceneId, facts } = input;
  const names = Object.fromEntries(scenes.map((s) => [s.id, s.name]));
  const q = normalizeQuestion(input.question);
  const intent = input.intent ?? parseTourQuestion(input.question, scenes);
  if (intent.kind === "unknown") return { kind: "unknown", text: UNKNOWN_HELP };

  if (intent.kind === "navigate") {
    const target = scenes.find((s) => s.id === intent.sceneId);
    if (!target) return { kind: "unknown", text: UNKNOWN_HELP };
    const concept = ROOM_CONCEPTS.find((c) => c.ask.test(q));
    const approx = concept ? scenesForConcept(concept, scenes, q) : null;
    const note = approx && !approx.exact && approx.scene.id === target.id ? `No hay una escena de ${concept!.label} en el tour; lo más cercano es ${withArticle(target.name)}. ` : "";
    if (target.id === currentSceneId) return { kind: "here", text: `${note}Ya estás en ${withArticle(target.name)}.`, targetId: target.id };
    const path = findRoute(scenes, currentSceneId, target.id);
    if (!path) return { kind: "unreachable", text: `${note}${withArticle(target.name).replace(/^./, (c) => c.toUpperCase())} está en el tour, pero no hay un camino desde acá: abrila desde «Ambientes».` };
    return { kind: "route", text: `${note}${describeRoute(path, names)}`, path, targetId: target.id, targetName: target.name };
  }

  // Datos: primero el dato publicado del tema; después presencia de un ambiente; después puntos de información.
  if (intent.factKey) {
    const fact = facts.find((f) => f.key === intent.factKey);
    if (fact) return { kind: "fact", text: `${fact.label}: ${fact.value}.`, sceneId: null, sceneName: null };
  }
  const concept = intent.topic ? ROOM_CONCEPTS.find((c) => c.key === intent.topic) : ROOM_CONCEPTS.find((c) => c.ask.test(q));
  if (concept) {
    const found = scenesForConcept(concept, scenes, q);
    const featureName = facts
      .find((f) => f.key === "caracteristicas")
      ?.value.split(" · ")
      .find((name) => concept.groups[0]!.some((w) => normalizeQuestion(name).includes(w)));
    if (found?.exact) return { kind: "fact", text: `Sí: en el tour podés recorrer ${withArticle(found.scene.name)}.`, sceneId: found.scene.id, sceneName: found.scene.name };
    if (featureName) return { kind: "fact", text: `Sí: figura entre las características (${featureName}).`, sceneId: null, sceneName: null };
  }
  const info = infoMatch(q, scenes);
  if (info) return { kind: "fact", text: `En ${withArticle(info.scene.name)}: ${info.label}. ${info.content}`, sceneId: info.scene.id, sceneName: info.scene.name };
  const feature = facts.find((f) => f.key === "caracteristicas");
  if (feature) {
    const tokens = q.split(" ").filter((w) => w.length >= 4);
    const hit = feature.value.split(" · ").find((name) => tokens.some((t) => normalizeQuestion(name).includes(t)));
    if (hit) return { kind: "fact", text: `Sí: figura entre las características (${hit}).`, sceneId: null, sceneName: null };
  }
  return { kind: "not_registered", text: NOT_REGISTERED };
}

// ───────────────────────────── Datos públicos → hechos ─────────────────────────────

export type PublicFactsInput = {
  bedrooms?: number | null;
  bathrooms?: number | null;
  toilets?: number | null;
  rooms?: number | null;
  garages?: number | null;
  coveredAreaM2?: number | null;
  totalAreaM2?: number | null;
  landAreaM2?: number | null;
  ageYears?: number | null;
  orientation?: string | null;
  creditEligible?: boolean | null;
  allowsPets?: boolean | null;
  price?: string | null;
  expenses?: string | null;
  features?: string[];
};

const area = (n: number) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)} m²`;

/** Solo datos que el sitio ya publica en la ficha. Lo que no está no se agrega (la guía responde «No está registrado»). */
export function buildTourFacts(p: PublicFactsInput): TourFact[] {
  const out: TourFact[] = [];
  const pos = (n: number | null | undefined): n is number => typeof n === "number" && n > 0;
  if (pos(p.bedrooms)) out.push({ key: "dormitorios", label: "Dormitorios", value: String(p.bedrooms) });
  if (pos(p.bathrooms)) out.push({ key: "banos", label: "Baños", value: `${p.bathrooms}${pos(p.toilets) ? ` (más ${p.toilets} toilette${p.toilets === 1 ? "" : "s"})` : ""}` });
  if (pos(p.rooms)) out.push({ key: "ambientes", label: "Ambientes", value: String(p.rooms) });
  if (pos(p.garages)) out.push({ key: "cocheras", label: "Cocheras", value: String(p.garages) });
  const sup = [pos(p.coveredAreaM2) ? `${area(p.coveredAreaM2)} cubiertos` : null, pos(p.totalAreaM2) ? `${area(p.totalAreaM2)} totales` : null].filter(Boolean);
  if (sup.length) out.push({ key: "superficie", label: "Superficie", value: sup.join(" · ") });
  if (pos(p.landAreaM2)) out.push({ key: "terreno", label: "Terreno", value: area(p.landAreaM2) });
  if (typeof p.ageYears === "number") out.push({ key: "antiguedad", label: "Antigüedad", value: p.ageYears === 0 ? "a estrenar" : `${p.ageYears} años` });
  if (p.orientation?.trim()) out.push({ key: "orientacion", label: "Orientación", value: p.orientation.trim() });
  if (p.price?.trim()) out.push({ key: "precio", label: "Precio", value: p.price.trim() });
  if (p.expenses?.trim()) out.push({ key: "expensas", label: "Expensas", value: p.expenses.trim() });
  if (typeof p.creditEligible === "boolean") out.push({ key: "credito", label: "Apta crédito", value: p.creditEligible ? "sí" : "no" });
  if (typeof p.allowsPets === "boolean") out.push({ key: "mascotas", label: "Acepta mascotas", value: p.allowsPets ? "sí" : "no" });
  if (p.features?.length) out.push({ key: "caracteristicas", label: "Características", value: p.features.join(" · ") });
  return out;
}
