/**
 * Guardas del AI Marketing Director (código, no prompt). Aplican al texto de la IA y también a las plantillas:
 * 1. Grounding de cifras, códigos y links (reutiliza `ai/guards.ts`): toda cifra con moneda, superficie, porcentaje,
 *    código o URL tiene que salir de los datos estructurados de la ficha. La descripción NO habilita cifras (un precio
 *    escrito o inyectado en la descripción no se puede afirmar).
 * 2. Atributos no registrados: amenities, vistas, estado y superlativos solo si constan en características,
 *    descripción, tipo o título. "Vista increíble" sin dato → violación.
 */
import { emptyFacts, findViolations, normalizeUrl, type GroundingFacts, type Violation } from "../guards";
import type { MarketingFacts } from "./marketing-templates";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Afirmaciones que requieren evidencia en los datos de la ficha. `evidence` se busca en el texto registrado (normalizado). */
export const CLAIMS: Array<{ key: string; pattern: RegExp; evidence: RegExp | null }> = [
  { key: "pileta", pattern: /\b(pileta|piscina)s?\b/, evidence: /\b(pileta|piscina)/ },
  { key: "vista", pattern: /\bvistas?\b/, evidence: /\bvista/ },
  { key: "cochera", pattern: /\b(cochera|garage|garaje)s?\b/, evidence: /\b(cochera|garage|garaje)/ },
  { key: "parrilla", pattern: /\b(parrilla|quincho|asador)s?\b/, evidence: /\b(parrilla|quincho|asador)/ },
  { key: "jardin", pattern: /\b(jardin|parque)(es)?\b/, evidence: /\b(jardin|parque)/ },
  { key: "galeria", pattern: /\bgalerias?\b/, evidence: /\bgaleria/ },
  { key: "balcon", pattern: /\bbalcon(es)?\b/, evidence: /\bbalcon/ },
  { key: "terraza", pattern: /\bterrazas?\b/, evidence: /\bterraza/ },
  { key: "seguridad", pattern: /\b(seguridad|vigilancia)\b/, evidence: /\b(seguridad|vigilancia)/ },
  { key: "amenities", pattern: /\b(amenities|gimnasio|sum|solarium)\b/, evidence: /\b(amenities|gimnasio|sum|solarium)/ },
  { key: "ascensor", pattern: /\bascensor(es)?\b/, evidence: /\bascensor/ },
  { key: "luminoso", pattern: /\b(luminos[oa]s?|luz natural|soleado|soleada)\b/, evidence: /\b(luminos|luz natural|solead)/ },
  { key: "estrenar", pattern: /\b(a estrenar|reciclad[oa]|refaccionad[oa]|remodelad[oa])\b/, evidence: /\b(estrenar|reciclad|refaccionad|remodelad)/ },
  { key: "credito", pattern: /\bapt[oa] (a )?credito\b/, evidence: /\bapto credito\b/ },
  { key: "mascotas", pattern: /\bmascotas?\b/, evidence: /\bmascota/ },
  { key: "financiacion", pattern: /\b(financiacion|financiado|cuotas|permuta)\b/, evidence: /\b(financiacion|financiado|cuotas|permuta)/ },
  { key: "escritura", pattern: /\b(escritura|escriturad[oa])\b/, evidence: /\bescritur/ },
  { key: "orientacion", pattern: /\b(orientacion|orientad[oa]) (al )?(norte|sur|este|oeste)\b/, evidence: /\b(norte|sur|este|oeste)\b/ },
  // Superlativos y calificativos que ningún dato respalda: nunca.
  { key: "superlativo", pattern: /\b(increible|espectacular|impecable|unica|unico|inmejorable|excelente|exclusiv[oa]|de lujo|premium|soñad[oa]|sonad[oa]|imperdible|oportunidad unica)\b/, evidence: null },
];

/** Texto registrado que respalda afirmaciones: características, descripción, tipo, título y banderas booleanas. */
export function evidenceText(f: MarketingFacts): string {
  return norm([f.typeName, f.title, f.description ?? "", ...f.features, f.creditEligible ? "apto credito" : "", f.garages ? "cochera" : ""].join(" \n "));
}

export function unsupportedClaims(text: string, f: MarketingFacts): Violation[] {
  const t = norm(text);
  const ev = evidenceText(f);
  const out: Violation[] = [];
  for (const c of CLAIMS) {
    const m = t.match(c.pattern);
    if (!m) continue;
    if (c.evidence && c.evidence.test(ev)) continue;
    // Si el calificativo ya está en la descripción cargada por el equipo, repetirlo no es inventar.
    if (!c.evidence && ev.includes(m[0])) continue;
    out.push({ kind: `claim_${c.key}` as Violation["kind"], value: m[0] });
  }
  return out;
}

/** Hechos verificables para `findViolations`: SOLO campos estructurados (no la descripción). */
export function marketingGrounding(f: MarketingFacts): GroundingFacts {
  const facts = emptyFacts();
  facts.propertyCodes.add(f.code);
  // Un precio oculto («Consultar») no se puede afirmar en ningún canal.
  for (const o of f.operations) if (o.amount !== null && !o.priceHidden) facts.amounts.add(o.amount);
  for (const v of [f.areas.totalM2, f.areas.coveredM2, f.areas.landM2]) {
    if (v === null) continue;
    facts.areas.add(Math.round(v * 100) / 100);
    if (v >= 10_000) facts.areas.add(Math.round((v / 10_000) * 100) / 100);
  }
  // Cantidades (dormitorios, baños…) no se registran como montos: "USD 3" no se habilita por tener 3 dormitorios.
  facts.urls.add(normalizeUrl(f.publicUrl));
  return facts;
}

export function marketingViolations(text: string, f: MarketingFacts): Violation[] {
  return [...findViolations(text, marketingGrounding(f)), ...unsupportedClaims(text, f)];
}
