"use server";

import { getDb } from "@/server/db";
import { getActor, getRequestMeta } from "@/server/next/context";
import { formToObject } from "@/server/next/action";
import { submitPublicLead } from "@/server/site/leads";
import { getSiteInfo } from "@/server/site/info";
import { errorFields, log } from "@/server/log";

export type LeadFormValues = Partial<Record<(typeof ECHO_FIELDS)[number], string>>;

export type LeadFormState =
  | { status: "idle" }
  | { status: "sent"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]>; values?: LeadFormValues };

const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];

/** Campos que escribe la persona: si el envío se rechaza vuelven en el estado (sin JS el formulario se re-renderiza con ellos). */
const ECHO_FIELDS = ["name", "phone", "email", "message", "appraisalGoal", "appraisalType", "appraisalZone", "visitWhen", "ownerAreaM2", "ownerBedrooms", "ownerCondition"] as const;
const ECHO_MAX = 2000;

function echoValues(raw: Record<string, unknown>): LeadFormValues {
  const out: LeadFormValues = {};
  for (const k of ECHO_FIELDS) {
    const v = raw[k];
    if (typeof v === "string" && v !== "") out[k] = v.slice(0, ECHO_MAX);
  }
  return out;
}

const SENT_MESSAGE: Record<string, string> = {
  appraisal: "Recibimos tu pedido de tasación. Te contactamos para coordinar.",
  owner: "Recibimos los datos de tu propiedad. Te contactamos para conversar los próximos pasos.",
  visit: "Recibimos tu pedido de visita. Te escribimos para confirmar día y horario.",
  contact: "Recibimos tu consulta. Te respondemos a la brevedad.",
};

/** Formularios públicos (consulta de ficha, visita, contacto, tasación) → CRM. */
export async function submitLeadAction(_prev: LeadFormState, fd: FormData): Promise<LeadFormState> {
  const raw = formToObject(fd);
  const utm: Record<string, string> = {};
  for (const k of UTM_FIELDS) {
    const v = raw[k];
    if (typeof v === "string" && v) utm[k] = v;
    delete raw[k];
  }
  const meta = await getRequestMeta();
  const contactHint = async () => {
    const info = await getSiteInfo();
    return info.mainPhone ? ` Si preferís, llamanos al ${info.mainPhone}.` : "";
  };
  try {
    const actor = await getActor();
    const res = await submitPublicLead(getDb(), actor, meta.ip, { ...raw, utm });
    switch (res.status) {
      case "sent":
        return {
          status: "sent",
          message: SENT_MESSAGE[String(raw.kind)] ?? SENT_MESSAGE.contact!,
        };
      case "disabled":
        return { status: "error", message: `En este momento no podemos recibir consultas desde la web.${await contactHint()}`, values: echoValues(raw) };
      case "rate_limited":
        return { status: "error", message: `Recibimos muchos envíos desde tu conexión. Esperá unos minutos.${await contactHint()}`, values: echoValues(raw) };
      case "invalid":
        return { status: "error", message: "Revisá los datos marcados.", fieldErrors: res.fieldErrors, values: echoValues(raw) };
    }
  } catch (e) {
    log.error("site.lead_failed", { requestId: meta.requestId, kind: raw.kind, ...errorFields(e) });
    return { status: "error", message: `No pudimos enviar tu consulta. Probá de nuevo en unos minutos.${await contactHint().catch(() => "")}`, values: echoValues(raw) };
  }
}
