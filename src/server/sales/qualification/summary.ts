/**
 * Resumen estructurado de un lead (puro): lo capturado + el perfil del contacto, con origen y estado de cada dato, y lo
 * que falta averiguar. Captura progresiva: los faltantes se sugieren como preguntas, nunca como interrogatorio.
 */
import { FIELD_LABEL, type ProfileField } from "../profile/fields";

export type ProfileDisplay = Partial<Record<ProfileField, { display: string; confirmed: boolean; sourceLabel: string }>>;

export type LeadSummaryInput = {
  name: string;
  channels: { phone: boolean; email: boolean; whatsapp: boolean };
  sourceName: string;
  interestLabel: string | null;
  property: { code: number; title: string } | null;
  profile: ProfileDisplay;
};

export type SummaryRow = { key: string; label: string; value: string | null; note: string | null; confirmed: boolean | null };
export type LeadSummary = { rows: SummaryRow[]; missing: string[]; completeness: number };

/** Datos clave para calificar una búsqueda (en este orden se piden). */
export const KEY_FIELDS: ProfileField[] = ["transaction_type", "budget", "locations", "property_types", "move_timeframe", "financing"];

const QUESTION: Partial<Record<ProfileField, string>> = {
  transaction_type: "¿Busca comprar o alquilar?",
  budget: "Presupuesto y moneda",
  locations: "Zonas de interés",
  property_types: "Tipo de propiedad",
  move_timeframe: "Plazo para mudarse o cerrar",
  financing: "Cómo piensa pagar (contado o crédito)",
};

export function buildLeadSummary(i: LeadSummaryInput): LeadSummary {
  const channels = [i.channels.phone ? (i.channels.whatsapp ? "teléfono (WhatsApp)" : "teléfono") : null, i.channels.email ? "email" : null].filter(Boolean);
  const rows: SummaryRow[] = [
    { key: "name", label: "Nombre", value: i.name, note: null, confirmed: null },
    { key: "channels", label: "Contacto", value: channels.length ? channels.join(" y ").replace(/^./, (c) => c.toUpperCase()) : null, note: null, confirmed: null },
    { key: "source", label: "Origen", value: i.sourceName, note: null, confirmed: null },
    { key: "property", label: "Propiedad consultada", value: i.property ? `#${i.property.code} · ${i.property.title}` : null, note: null, confirmed: null },
  ];
  const fromProfile = (field: ProfileField, label = FIELD_LABEL[field]) => {
    const p = i.profile[field];
    rows.push({ key: field, label, value: p?.display ?? null, note: p ? (p.confirmed ? "Confirmado" : `Sugerido · ${p.sourceLabel}`) : null, confirmed: p ? p.confirmed : null });
  };
  fromProfile("transaction_type", "Objetivo");
  if (!i.profile.transaction_type && i.interestLabel) rows[rows.length - 1] = { key: "transaction_type", label: "Objetivo", value: i.interestLabel, note: "Según el tipo de consulta", confirmed: false };
  fromProfile("goal", "Para qué");
  fromProfile("budget");
  fromProfile("locations", "Zona");
  fromProfile("property_types", "Tipo");
  fromProfile("bedrooms_min", "Dormitorios");
  fromProfile("move_timeframe");
  fromProfile("financing");
  fromProfile("features", "Necesidades");
  const present = KEY_FIELDS.filter((f) => rows.find((r) => r.key === f)?.value);
  const missing = KEY_FIELDS.filter((f) => !rows.find((r) => r.key === f)?.value).map((f) => QUESTION[f]!);
  return { rows: rows.filter((r) => r.value !== null || KEY_FIELDS.includes(r.key as ProfileField)), missing, completeness: Math.round((present.length / KEY_FIELDS.length) * 100) };
}
