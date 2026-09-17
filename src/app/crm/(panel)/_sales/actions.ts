"use server";

/**
 * Acciones del CRM de la Fase 2 · Ventas: perfil del comprador, coincidencias y siguiente acción.
 * Autorización y validación en los servicios (src/server/sales); acá solo el flag `ai_matching` y el refresco.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { isEnabled } from "@/server/flags";
import { runAction } from "@/server/next/action";
import { clearPreference, confirmPreference, rejectPreference, setPreference } from "@/server/sales/profile/service";
import { PROFILE_FIELDS, type ProfileField } from "@/server/sales/profile/fields";
import { dismissMatch, DISMISS_REASONS } from "@/server/sales/matching/service";
import { acceptRecommendation, dismissRecommendation, snoozeRecommendation, NBA_ENTITY_TYPES } from "@/server/sales/nba/service";

async function requireFlag() {
  if (!(await isEnabled(getDb(), "ai_matching"))) throw new AppError("unavailable", "Las funciones de ventas con IA están apagadas. Un administrador puede encenderlas en Integraciones.");
}

const num = (v: FormDataEntryValue | null) => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** FormData del editor → valor del campo (la validación real la hace el servicio con zod). */
function valueFrom(field: ProfileField, fd: FormData): unknown {
  switch (field) {
    case "budget":
      return { min: num(fd.get("min")), max: num(fd.get("max")), currency: fd.get("currency") };
    case "surface":
      return { min: num(fd.get("min")), max: num(fd.get("max")) };
    case "bedrooms_min":
    case "bathrooms_min":
      return num(fd.get("value"));
    case "property_types":
    case "features":
      return fd.getAll("value").filter((v): v is string => typeof v === "string");
    case "locations":
      return fd
        .getAll("value")
        .filter((v): v is string => typeof v === "string")
        .flatMap((raw) => {
          try {
            return [JSON.parse(raw) as unknown];
          } catch {
            return [];
          }
        });
    default:
      return fd.get("value");
  }
}

export async function setPreferenceAction(fd: FormData) {
  const field = String(fd.get("field") ?? "") as ProfileField;
  const r = await runAction("sales.profile.set", z.object({ contactId: z.uuid(), field: z.enum(PROFILE_FIELDS) }), { contactId: fd.get("contactId"), field }, async (d, actor) => {
    await requireFlag();
    return setPreference(getDb(), actor, { ...d, value: valueFrom(d.field, fd) });
  });
  if (r.ok) refresh();
  return r;
}

export async function confirmPreferenceAction(input: { preferenceId: string }) {
  const r = await runAction("sales.profile.confirm", z.object({ preferenceId: z.uuid() }), input, async (d, actor) => {
    await requireFlag();
    return confirmPreference(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

export async function rejectPreferenceAction(input: { preferenceId: string }) {
  const r = await runAction("sales.profile.reject", z.object({ preferenceId: z.uuid() }), input, async (d, actor) => {
    await requireFlag();
    return rejectPreference(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

export async function clearPreferenceAction(input: { contactId: string; field: ProfileField }) {
  const r = await runAction("sales.profile.clear", z.object({ contactId: z.uuid(), field: z.enum(PROFILE_FIELDS) }), input, async (d, actor) => {
    await requireFlag();
    return clearPreference(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

export async function dismissMatchAction(fd: FormData) {
  const r = await runAction(
    "sales.match.dismiss",
    z.object({ contactId: z.uuid(), propertyId: z.uuid(), reason: z.enum(DISMISS_REASONS, { error: "Elegí un motivo" }) }),
    { contactId: fd.get("contactId"), propertyId: fd.get("propertyId"), reason: fd.get("reason") },
    async (d, actor) => {
      await requireFlag();
      return dismissMatch(getDb(), actor, d);
    },
  );
  if (r.ok) refresh();
  return r;
}

const decision = z.object({ entityType: z.enum(NBA_ENTITY_TYPES), entityId: z.uuid(), ruleKey: z.string().regex(/^[a-z_]{3,40}$/), fingerprint: z.string().regex(/^[0-9a-f]{16,64}$/) });

export async function acceptRecommendationAction(input: z.input<typeof decision>) {
  const r = await runAction("sales.recommendation.accept", decision, input, async (d, actor) => {
    await requireFlag();
    return acceptRecommendation(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}

export async function dismissRecommendationAction(fd: FormData) {
  const r = await runAction(
    "sales.recommendation.dismiss",
    decision.extend({ note: z.string().trim().max(300).optional() }),
    { entityType: fd.get("entityType"), entityId: fd.get("entityId"), ruleKey: fd.get("ruleKey"), fingerprint: fd.get("fingerprint"), note: (fd.get("note") as string | null) || undefined },
    async (d, actor) => {
      await requireFlag();
      return dismissRecommendation(getDb(), actor, d);
    },
  );
  if (r.ok) refresh();
  return r;
}

export async function snoozeRecommendationAction(input: z.input<typeof decision> & { days: 1 | 3 | 7 }) {
  const r = await runAction("sales.recommendation.snooze", decision.extend({ days: z.union([z.literal(1), z.literal(3), z.literal(7)]) }), input, async (d, actor) => {
    await requireFlag();
    return snoozeRecommendation(getDb(), actor, d);
  });
  if (r.ok) refresh();
  return r;
}
