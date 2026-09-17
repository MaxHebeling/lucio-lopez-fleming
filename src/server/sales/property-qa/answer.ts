/**
 * «✦ Preguntale a esta propiedad» — capa determinista (pura). Responde SOLO con datos publicados de ESA propiedad
 * (el DTO público: nunca dirección oculta, propietarios, notas ni documentos privados). La pregunta solo se usa para
 * clasificar el tema por palabras clave: nunca como instrucción. Un dato ausente NO es un «no»: «Ese dato no está
 * registrado actualmente.»
 */
import { fold } from "../intent/parse";
import type { PublicPropertyDetail } from "../../properties/public";
import { OPERATION_NOUN, formatArea, formatPrice } from "../../properties/public-helpers";

export const NOT_REGISTERED = "Ese dato no está registrado actualmente.";

export const QA_TOPIC_KEYS = ["bedrooms", "bathrooms", "rooms", "surface", "land", "garages", "feature", "price", "expenses", "credit", "age", "orientation", "condition", "pets", "location", "availability", "visit", "documents", "unknown"] as const;
export type QaTopic = (typeof QA_TOPIC_KEYS)[number];

export type QaFact = { label: string; value: string };
export type QaAnswer = {
  topic: QaTopic;
  answer: string;
  /** El dato existe en la ficha publicada. */
  registered: boolean;
  /** Hechos de la ficha que respaldan la respuesta (se muestran como fuente). */
  facts: QaFact[];
  /** CTA real: consultar a un asesor (LeadForm) o pedir visita. */
  cta: "advisor" | "visit" | null;
};

export type QaProperty = Pick<
  PublicPropertyDetail,
  | "code"
  | "status"
  | "typeCategory"
  | "prices"
  | "bedrooms"
  | "bathrooms"
  | "toilets"
  | "rooms"
  | "garages"
  | "totalAreaM2"
  | "coveredAreaM2"
  | "uncoveredAreaM2"
  | "landAreaM2"
  | "ageYears"
  | "orientation"
  | "disposition"
  | "condition"
  | "creditEligible"
  | "allowsPets"
  | "professionalUse"
  | "features"
  | "attributes"
  | "zone"
  | "street"
  | "addressHidden"
>;

/** Sinónimos de características frecuentes (se buscan en las características y atributos PUBLICADOS de la ficha). */
const FEATURE_WORDS: Array<{ words: RegExp; names: string[] }> = [
  { words: /\bjardin/, names: ["jardin", "jardin delantero", "jardin trasero", "parque", "espacios verdes"] },
  { words: /\b(pileta|piscina)/, names: ["pileta", "piscina"] },
  { words: /\b(parrilla|asador)/, names: ["parrilla", "quincho con parrilla", "patio con parrilla"] },
  { words: /\bquincho/, names: ["quincho con parrilla", "quincho techado", "quincho"] },
  { words: /\baire/, names: ["aire acondicionado"] },
  { words: /\bcalefacc/, names: ["calefaccion", "calefaccion tiro balanceado", "radiadores"] },
  { words: /\bbalcon/, names: ["balcon", "balcon terraza"] },
  { words: /\bterraza/, names: ["terraza", "balcon terraza"] },
  { words: /\bascensor/, names: ["ascensor"] },
  { words: /\b(seguridad|vigilancia)/, names: ["seguridad", "vigilancia"] },
  { words: /\blavadero/, names: ["lavadero"] },
  { words: /\bpatio/, names: ["patio", "patio con parrilla"] },
  { words: /\b(amueblad|amoblad|muebles)/, names: ["amueblado"] },
  { words: /\b(gas)\b/, names: ["gas", "gas envasado"] },
  { words: /\bcloaca/, names: ["cloacas"] },
  { words: /\b(internet|wifi)/, names: ["internet"] },
  { words: /\b(galeria)/, names: ["galeria", "galeria semicubierta"] },
  { words: /\b(suite)/, names: ["suite", "suite con vestidor"] },
  { words: /\b(sum|salon de usos)/, names: ["sum", "salon usos multiples"] },
  { words: /\bbaulera/, names: ["baulera"] },
  { words: /\b(alarma)/, names: ["alarma"] },
  { words: /\b(agua)/, names: ["agua corriente", "agua de pozo"] },
  { words: /\b(pavimento|asfalt)/, names: ["pavimento"] },
];

const TOPICS: Array<{ topic: QaTopic; re: RegExp }> = [
  { topic: "visit", re: /\b(visitar|visita|verla|verlo|conocerla|recorrerla|ir a ver|agendar|coordinar)/ },
  { topic: "availability", re: /\b(disponible|disponibilidad|sigue (en venta|en alquiler|disponible)|esta vendida|se vendio|reservada|todavia esta|esta libre)/ },
  { topic: "documents", re: /\b(escritura|papeles|documentacion|titulo|planos aprobados|final de obra|sucesion|boleto|mensura)/ },
  { topic: "expenses", re: /\b(expensas|gastos comunes|gastos del edificio)/ },
  { topic: "credit", re: /\b(credito|hipotecari|apta? credito|financiacion|financian|cuotas|procrear)/ },
  { topic: "price", re: /\b(precio|cuanto (sale|cuesta|piden|vale)|valor|cotizacion|usd|dolares|pesos)/ },
  { topic: "bedrooms", re: /\b(dormitorios?|habitaciones?|cuartos?|piezas?|dorm)\b/ },
  { topic: "bathrooms", re: /\b(banos?|toilettes?)\b/ },
  { topic: "rooms", re: /\bambientes?\b/ },
  { topic: "garages", re: /\b(cocheras?|garages?|garaje|estacionamiento)/ },
  { topic: "land", re: /\b(terreno|lote)\b/ },
  { topic: "surface", re: /\b(metros|m2|mts|superficie|cubiert|tamano|que tan grande|cuanto mide)/ },
  { topic: "age", re: /\b(antiguedad|anos tiene|a estrenar|cuando se construyo|construccion)/ },
  { topic: "orientation", re: /\b(orientacion|orientada|da al (norte|sur|este|oeste)|al frente|contrafrente)/ },
  { topic: "condition", re: /\b(estado|reciclad|refaccion|mantenimiento)/ },
  { topic: "pets", re: /\b(mascotas?|perros?|gatos?)\b/ },
  { topic: "location", re: /\b(donde (queda|esta)|direccion|ubicacion|ubicada|calle|altura|barrio|zona)\b/ },
];

export function classifyQuestion(question: string): { topic: QaTopic; featureNames: string[] } {
  const q = fold(question);
  for (const f of FEATURE_WORDS) if (f.words.test(q)) return { topic: "feature", featureNames: f.names };
  for (const t of TOPICS) if (t.re.test(q)) return { topic: t.topic, featureNames: [] };
  return { topic: "unknown", featureNames: [] };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Hechos publicados de la ficha como pares etiqueta/valor (para la fuente y para la capa con IA). */
export function publicFacts(p: QaProperty): QaFact[] {
  const out: QaFact[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) out.push({ label, value });
  };
  for (const pr of p.prices) {
    push(`Precio de ${OPERATION_NOUN[pr.operation]}`, formatPrice(pr.amount, pr.currency, pr.priceHidden));
    if (pr.expenses) push("Expensas", formatPrice(pr.expenses.amount, pr.expenses.currency, false));
  }
  push("Estado", { available: "Disponible", reserved: "Reservada", sold: "Vendida", rented: "Alquilada" }[p.status]);
  push("Dormitorios", p.bedrooms ? String(p.bedrooms) : null);
  push("Baños", p.bathrooms ? String(p.bathrooms) : null);
  push("Toilettes", p.toilets ? String(p.toilets) : null);
  push("Ambientes", p.rooms ? String(p.rooms) : null);
  push("Cocheras", p.garages ? String(p.garages) : null);
  push("Superficie total", formatArea(p.totalAreaM2));
  push("Superficie cubierta", formatArea(p.coveredAreaM2));
  push("Superficie descubierta", formatArea(p.uncoveredAreaM2));
  push("Terreno", formatArea(p.landAreaM2));
  push("Antigüedad", p.ageYears === null ? null : p.ageYears === 0 ? "A estrenar" : plural(p.ageYears, "año", "años"));
  push("Orientación", p.orientation);
  push("Disposición", p.disposition);
  push("Estado de conservación", p.condition);
  push("Apto crédito", p.creditEligible === null ? null : p.creditEligible ? "Sí" : "No");
  push("Acepta mascotas", p.typeCategory === "residential" && p.allowsPets !== null ? (p.allowsPets ? "Sí" : "No") : null);
  push("Ubicación", [p.street, p.zone.label].filter(Boolean).join(" · ") || null);
  for (const a of p.attributes) push(a.label, a.value);
  for (const g of p.features) push(g.label, g.items.join(", "));
  return out;
}

export function answerFromFacts(p: QaProperty, question: string): QaAnswer {
  const { topic, featureNames } = classifyQuestion(question);
  const notRegistered = (facts: QaFact[] = []): QaAnswer => ({ topic, answer: NOT_REGISTERED, registered: false, facts, cta: "advisor" });
  const ok = (answer: string, facts: QaFact[], cta: QaAnswer["cta"] = null): QaAnswer => ({ topic, answer, registered: true, facts, cta });

  switch (topic) {
    case "bedrooms":
      return p.bedrooms ? ok(`Tiene ${plural(p.bedrooms, "dormitorio", "dormitorios")}.`, [{ label: "Dormitorios", value: String(p.bedrooms) }]) : notRegistered();
    case "bathrooms": {
      if (!p.bathrooms) return notRegistered();
      const facts = [{ label: "Baños", value: String(p.bathrooms) }, ...(p.toilets ? [{ label: "Toilettes", value: String(p.toilets) }] : [])];
      return ok(`Tiene ${plural(p.bathrooms, "baño", "baños")}${p.toilets ? ` y ${plural(p.toilets, "toilette", "toilettes")}` : ""}.`, facts);
    }
    case "rooms":
      return p.rooms ? ok(`Tiene ${plural(p.rooms, "ambiente", "ambientes")}.`, [{ label: "Ambientes", value: String(p.rooms) }]) : notRegistered();
    case "surface": {
      const facts = [
        ["Superficie cubierta", formatArea(p.coveredAreaM2)],
        ["Superficie total", formatArea(p.totalAreaM2)],
        ["Superficie descubierta", formatArea(p.uncoveredAreaM2)],
        ["Terreno", formatArea(p.landAreaM2)],
      ]
        .filter(([, v]) => v)
        .map(([label, value]) => ({ label: label!, value: value! }));
      return facts.length ? ok(facts.map((f) => `${f.label}: ${f.value}`).join(" · ") + ".", facts) : notRegistered();
    }
    case "land":
      return p.landAreaM2 ? ok(`El terreno tiene ${formatArea(p.landAreaM2)}.`, [{ label: "Terreno", value: formatArea(p.landAreaM2)! }]) : notRegistered();
    case "garages": {
      if (p.garages) return ok(`Tiene ${plural(p.garages, "cochera", "cocheras")}.`, [{ label: "Cocheras", value: String(p.garages) }]);
      const f = p.features.flatMap((g) => g.items.map((i) => ({ g, i }))).find((x) => /cochera|garage|entrada de auto/.test(fold(x.i)));
      return f ? ok(`Figura «${f.i}» entre sus características.`, [{ label: f.g.label, value: f.i }]) : notRegistered();
    }
    case "feature": {
      const hits = p.features.flatMap((g) => g.items.filter((i) => featureNames.includes(fold(i).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim())).map((i) => ({ label: g.label, value: i })));
      const attrs = p.attributes.filter((a) => featureNames.some((n) => fold(a.label).includes(n)));
      const facts = [...hits, ...attrs.map((a) => ({ label: a.label, value: a.value }))];
      if (!facts.length) return notRegistered();
      return ok(`Sí: figura${facts.length > 1 ? "n" : ""} ${facts.map((f) => `«${f.value === "Sí" ? f.label : f.value}»`).join(" y ")} en los datos publicados.`, facts);
    }
    case "price": {
      if (!p.prices.length) return notRegistered();
      const facts = p.prices.map((pr) => ({ label: `Precio de ${OPERATION_NOUN[pr.operation]}`, value: formatPrice(pr.amount, pr.currency, pr.priceHidden) }));
      if (p.prices.every((pr) => pr.priceHidden || pr.amount === null)) return { topic, answer: "El precio es a consultar: te lo informa un asesor.", registered: true, facts, cta: "advisor" };
      return ok(facts.map((f) => `${f.label}: ${f.value}`).join(" · ") + ".", facts);
    }
    case "expenses": {
      const e = p.prices.find((pr) => pr.expenses)?.expenses;
      return e ? ok(`Expensas: ${formatPrice(e.amount, e.currency, false)}.`, [{ label: "Expensas", value: formatPrice(e.amount, e.currency, false) }]) : notRegistered();
    }
    case "credit":
      if (p.creditEligible === null) return notRegistered();
      return ok(p.creditEligible ? "Sí, figura como apta crédito." : "Según la ficha, no figura como apta crédito.", [{ label: "Apto crédito", value: p.creditEligible ? "Sí" : "No" }], "advisor");
    case "age":
      if (p.ageYears === null) return notRegistered();
      return ok(p.ageYears === 0 ? "Es a estrenar." : `Tiene ${plural(p.ageYears, "año", "años")} de antigüedad.`, [{ label: "Antigüedad", value: p.ageYears === 0 ? "A estrenar" : plural(p.ageYears, "año", "años") }]);
    case "orientation": {
      const facts = [
        ["Orientación", p.orientation],
        ["Disposición", p.disposition],
      ]
        .filter(([, v]) => v)
        .map(([label, value]) => ({ label: label!, value: value! }));
      return facts.length ? ok(facts.map((f) => `${f.label}: ${f.value}`).join(" · ") + ".", facts) : notRegistered();
    }
    case "condition":
      return p.condition ? ok(`Estado de conservación: ${p.condition}.`, [{ label: "Estado de conservación", value: p.condition }]) : notRegistered();
    case "pets":
      if (p.typeCategory !== "residential" || p.allowsPets === null) return notRegistered();
      return ok(p.allowsPets ? "Sí, acepta mascotas." : "Según la ficha, no acepta mascotas.", [{ label: "Acepta mascotas", value: p.allowsPets ? "Sí" : "No" }]);
    case "location": {
      const place = [p.street, p.zone.label].filter(Boolean).join(" · ");
      if (!place) return notRegistered();
      const hidden = p.addressHidden ? " La dirección exacta se comparte al coordinar la visita." : "";
      return ok(`Está en ${place}.${hidden}`, [{ label: "Ubicación", value: place }], p.addressHidden ? "visit" : null);
    }
    case "availability": {
      const label = { available: "Disponible", reserved: "Reservada", sold: "Vendida", rented: "Alquilada" }[p.status];
      const answer =
        p.status === "available" ? "Sí, figura como disponible. Si querés verla, pedí una visita." : p.status === "reserved" ? "Figura como reservada. Un asesor te puede contar si hay novedades." : `Ya fue ${p.status === "sold" ? "vendida" : "alquilada"}. Un asesor te puede mostrar opciones parecidas.`;
      return ok(answer, [{ label: "Estado", value: label }], p.status === "available" ? "visit" : "advisor");
    }
    case "visit":
      if (p.status === "sold" || p.status === "rented") return ok(`Ya fue ${p.status === "sold" ? "vendida" : "alquilada"}: no se puede visitar. Un asesor te puede mostrar opciones parecidas.`, [], "advisor");
      return ok("Pedí una visita y te contactamos para coordinar el día y el horario.", [], "visit");
    case "documents":
      return notRegistered();
    case "unknown":
      return { topic, answer: `Solo puedo responder con los datos publicados de esta ficha. ${NOT_REGISTERED}`, registered: false, facts: [], cta: "advisor" };
  }
}

/** Preguntas sugeridas SOLO sobre datos que la ficha tiene (sin botones que respondan «no registrado»). */
export function suggestedQuestions(p: QaProperty): string[] {
  const out: string[] = [];
  if (p.coveredAreaM2 || p.totalAreaM2) out.push("¿Cuántos metros tiene?");
  if (p.prices.some((pr) => pr.expenses)) out.push("¿Cuánto son las expensas?");
  if (p.creditEligible !== null) out.push("¿Es apta crédito?");
  if (p.features.some((g) => g.items.some((i) => /jardin|parque/.test(fold(i))))) out.push("¿Tiene jardín?");
  else if (p.features.some((g) => g.items.some((i) => /pileta/.test(fold(i))))) out.push("¿Tiene pileta?");
  if (p.ageYears !== null) out.push("¿Qué antigüedad tiene?");
  if (p.status === "available") out.push("¿Cuándo puedo visitarla?");
  return out.slice(0, 4);
}
