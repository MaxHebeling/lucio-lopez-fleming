/**
 * IA de visitas (Fase 4b) — reglas deterministas y puras: brief previo con hechos numerados y «NO REGISTRADO»,
 * sugerencia de seguimiento con motivo desde el informe confirmado. Tests: tests/unit/ai-visits-rules.test.ts.
 */
import type { Interest } from "../../visits/rules";
import { FOLLOW_UP_DELAY_HOURS, suggestFollowUpAt } from "../../visits/rules";

export const VISIT_BRIEF_RULES_VERSION = "2026-09-17.1";

export type BriefOperation = { operation: "sale" | "rent" | "temporary_rent"; currency: "USD" | "ARS"; amount: number | null; priceHidden: boolean; expensesAmount: number | null; expensesCurrency: "USD" | "ARS" | null };

export type BriefInput = {
  startsAt: Date;
  agentName: string;
  client: { name: string } | null;
  property: {
    code: number;
    title: string;
    typeName: string;
    category: string;
    zone: string | null;
    operations: BriefOperation[];
    rooms: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    garages: number | null;
    areas: { totalM2: number | null; coveredM2: number | null; landM2: number | null };
    ageYears: number | null;
    orientation: string | null;
    condition: string | null;
    creditEligible: boolean | null;
    allowsPets: boolean | null;
    features: string[];
    hasDeedDocument: boolean;
    tourPublished: boolean;
  };
  /** Qué busca: lead/oportunidad/notas. `buyerProfile` = punto de integración del perfil del comprador (otra rama). */
  seeking: {
    operationInterest: string | null;
    opportunity: { title: string; stage: string | null; budgetMin: number | null; budgetMax: number | null; budgetCurrency: string | null } | null;
    notes: string[];
    buyerProfile?: string[] | null;
  };
  /** Qué preguntó: mensajes del contacto (consultas web y conversaciones entrantes), más recientes primero. */
  asked: Array<{ at: Date; source: string; text: string }>;
};

export type BriefFact = { id: string; section: "cliente" | "busca" | "pregunto" | "propiedad"; text: string };
export type DeterministicBrief = { headline: string; facts: BriefFact[]; notRegistered: string[] };

const OP = { sale: "venta", rent: "alquiler", temporary_rent: "alquiler temporario" } as const;
const INTEREST_TEXT: Record<string, string> = { sale: "comprar", rent: "alquilar", temporary_rent: "alquiler temporario", appraisal: "tasar", sell_my_property: "vender su propiedad", other: "otra consulta" };
const num = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const money = (n: number, c: string) => `${c === "USD" ? "USD" : "$"} ${num.format(n)}`;
const pos = (n: number | null | undefined): n is number => typeof n === "number" && n > 0;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Salta" });

/** Datos que un cliente suele preguntar en una visita: si no constan, se listan explícitamente como NO REGISTRADO. */
export function notRegisteredItems(p: BriefInput["property"]): string[] {
  const out: string[] = [];
  const featuresText = p.features.join(" ").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (!p.operations.some((o) => o.amount !== null && o.amount > 0)) out.push("Precio");
  if (!p.operations.some((o) => o.expensesAmount !== null)) out.push("Gastos / expensas");
  if (!p.hasDeedDocument) out.push("Escritura (no hay documento cargado)");
  if (!p.orientation?.trim()) out.push("Orientación");
  if (p.ageYears === null) out.push("Antigüedad");
  if (!p.condition?.trim()) out.push("Estado de conservación");
  if (p.creditEligible === null) out.push("Apta crédito");
  if (p.allowsPets === null && p.category === "residential") out.push("Acepta mascotas");
  if (!pos(p.areas.coveredM2) && !pos(p.areas.totalM2) && !pos(p.areas.landM2)) out.push("Superficie");
  if (p.garages === null && p.category !== "land") out.push("Cocheras");
  if (!/\b(gas|agua|cloaca|luz|electricidad)\b/.test(featuresText)) out.push("Servicios (gas, agua, cloacas)");
  return out;
}

export function buildDeterministicBrief(input: BriefInput): DeterministicBrief {
  const facts: BriefFact[] = [];
  const add = (section: BriefFact["section"], text: string) => facts.push({ id: `H${facts.length + 1}`, section, text });
  const p = input.property;

  add("cliente", input.client ? `Cliente: ${input.client.name}.` : "La visita no tiene cliente cargado.");
  add("cliente", `Visita a las ${timeFmt.format(input.startsAt)} con ${input.agentName}.`);

  if (input.seeking.operationInterest) add("busca", `En su consulta indicó que busca ${INTEREST_TEXT[input.seeking.operationInterest] ?? input.seeking.operationInterest}.`);
  const o = input.seeking.opportunity;
  if (o) {
    add("busca", `Oportunidad: «${clip(o.title, 120)}»${o.stage ? ` (etapa ${o.stage})` : ""}.`);
    if (o.budgetMin !== null || o.budgetMax !== null) {
      const c = o.budgetCurrency ?? "USD";
      add("busca", `Presupuesto registrado: ${o.budgetMin !== null && o.budgetMax !== null ? `entre ${money(o.budgetMin, c)} y ${money(o.budgetMax, c)}` : o.budgetMax !== null ? `hasta ${money(o.budgetMax, c)}` : `desde ${money(o.budgetMin!, c)}`}.`);
    }
  }
  for (const b of input.seeking.buyerProfile ?? []) add("busca", clip(b, 200));
  for (const n of input.seeking.notes.slice(0, 3)) add("busca", `Nota del equipo: «${clip(n, 200)}»`);

  for (const a of input.asked.slice(0, 4)) add("pregunto", `${dayFmt.format(a.at)} · ${a.source}: «${clip(a.text, 220)}»`);

  const op = p.operations.find((x) => x.amount !== null && x.amount > 0) ?? p.operations[0];
  add("propiedad", `#${p.code} · ${p.typeName}${op ? ` en ${OP[op.operation]}` : ""}${p.zone ? ` en ${p.zone}` : ""}.`);
  if (op?.amount) add("propiedad", `Precio ${op.priceHidden ? "(oculto en el sitio) " : ""}${money(op.amount, op.currency)}${op.expensesAmount !== null ? ` · expensas ${money(op.expensesAmount, op.expensesCurrency ?? op.currency)}` : ""}.`);
  const counts = [pos(p.rooms) ? `${p.rooms} ambientes` : null, pos(p.bedrooms) ? `${p.bedrooms} dormitorios` : null, pos(p.bathrooms) ? `${p.bathrooms} baños` : null, pos(p.garages) ? `${p.garages} cocheras` : null].filter(Boolean);
  if (counts.length) add("propiedad", `${counts.join(", ")}.`);
  const areas = [pos(p.areas.coveredM2) ? `${num.format(p.areas.coveredM2)} m² cubiertos` : null, pos(p.areas.totalM2) ? `${num.format(p.areas.totalM2)} m² totales` : null, pos(p.areas.landM2) ? `terreno de ${num.format(p.areas.landM2)} m²` : null].filter(Boolean);
  if (areas.length) add("propiedad", `${areas.join(", ")}.`);
  const extras = [p.ageYears !== null ? (p.ageYears === 0 ? "a estrenar" : `${p.ageYears} años de antigüedad`) : null, p.orientation ? `orientación ${p.orientation}` : null, p.condition ? `estado: ${p.condition}` : null, p.creditEligible === true ? "apta crédito" : p.creditEligible === false ? "no apta crédito" : null].filter(Boolean);
  if (extras.length) add("propiedad", `${extras.join(" · ")}.`);
  if (p.features.length) add("propiedad", `Características: ${p.features.slice(0, 12).join(", ")}.`);
  if (p.tourPublished) add("propiedad", "Tiene tour 360° publicado (podés mostrarlo antes o después de la visita).");

  const headline = `${input.client ? `${input.client.name} · ` : ""}${p.typeName} #${p.code}${p.zone ? ` en ${p.zone}` : ""}`;
  return { headline, facts, notRegistered: notRegisteredItems(p) };
}

// ───────────────────────────── Seguimiento sugerido ─────────────────────────────

export type ConfirmedReport = { interest: Interest | null; positives: string | null; objections: string | null; nextStep: string | null; followUpAt: Date | null };
export type FollowUpSuggestion = { dueAt: Date; title: string; reason: string };

const norm = (s: string | null) => (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function suggestVisitFollowUp(r: ConfirmedReport, finishedAt: Date, ctx: { propertyCode: number | null; clientName: string | null }): FollowUpSuggestion {
  const next = norm(r.nextStep);
  const objections = norm(r.objections);
  const reasons: string[] = [];
  let dueAt: Date;
  // Al confirmar sin fecha, el informe guarda la sugerida por interés: esa no cuenta como "indicada por el agente".
  if (r.followUpAt && r.followUpAt.getTime() !== suggestFollowUpAt(r.interest, finishedAt).getTime()) {
    dueAt = r.followUpAt;
    reasons.push("Fecha indicada en el informe confirmado");
  } else {
    dueAt = suggestFollowUpAt(r.interest, finishedAt);
    const h = FOLLOW_UP_DELAY_HOURS[r.interest ?? "medium"];
    reasons.push(r.interest === "high" ? `Interés alto: contacto dentro de las ${h} h` : r.interest === "low" ? "Interés bajo: seguimiento suave en una semana" : r.interest === "medium" ? `Interés medio: ${h / 24} días para resolver dudas` : `Sin interés indicado: ${h / 24} días por defecto`);
  }
  let action = "Seguimiento de visita";
  if (/segunda visita|volver a ver|otra visita/.test(next)) action = "Coordinar segunda visita";
  else if (/oferta|reserva|sena|contraoferta/.test(next)) action = "Seguimiento de oferta";
  else if (/documenta|papeles|escritura|plano/.test(next)) action = "Enviar documentación pedida";
  else if (/comparab|otras propiedades|opciones/.test(next)) action = "Enviar opciones comparables";
  else if (r.nextStep?.trim()) action = clip(r.nextStep.trim(), 80);
  if (r.nextStep?.trim()) reasons.push(`Siguiente paso del informe: «${clip(r.nextStep.trim(), 80)}»`);
  if (/precio|caro|valor/.test(objections)) reasons.push("Objeción de precio registrada: preparar la respuesta antes de llamar");
  else if (r.objections?.trim()) reasons.push(`Objeción registrada: «${clip(r.objections.trim(), 80)}»`);
  const title = [action, ctx.propertyCode ? `Prop. ${ctx.propertyCode}` : null, ctx.clientName].filter(Boolean).join(" · ").slice(0, 200);
  return { dueAt, title, reason: reasons.join(" · ") };
}
