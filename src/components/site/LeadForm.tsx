"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef } from "react";
import { Check } from "lucide-react";
import { submitLeadAction, type LeadFormState } from "@/app/(site)/actions";

type Kind = "property" | "visit" | "contact" | "appraisal";

type Props = {
  kind: Kind;
  propertyCode?: number;
  operation?: string;
  defaultMessage?: string;
  submitLabel?: string;
  tone?: "light" | "dark";
  appraisalTypes?: string[];
  compact?: boolean;
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];

/**
 * Formulario público → CRM. Funciona sin JS (Server Action). Con JS agrega: clave de idempotencia por envío
 * (un doble click o un reintento no duplica el lead), UTM de la URL y estados accesibles (aria-live, foco en error).
 */
export function LeadForm({ kind, propertyCode, operation, defaultMessage, submitLabel, tone = "light", appraisalTypes, compact }: Props) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(submitLeadAction, { status: "idle" });
  const keyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Valores que solo existen en el navegador: se escriben directo en los inputs ocultos (sin re-render).
  useEffect(() => {
    if (keyRef.current) keyRef.current.value = newKey();
    const sp = new URLSearchParams(window.location.search);
    for (const k of UTM_FIELDS) {
      const input = formRef.current?.elements.namedItem(k);
      const v = sp.get(k);
      if (v && input instanceof HTMLInputElement) input.value = v.slice(0, 200);
    }
  }, []);

  useEffect(() => {
    if (state.status === "sent") {
      formRef.current?.reset();
      if (keyRef.current) keyRef.current.value = newKey(); // el próximo envío es otra consulta
      statusRef.current?.focus();
    } else if (state.status === "error") {
      const firstInvalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      (firstInvalid ?? statusRef.current)?.focus();
    }
  }, [state]);

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const dark = tone === "dark";
  const control = `field-control ${dark ? "!border-paper/25 !bg-paper/5 !text-paper placeholder:text-paper/50" : ""}`;
  const label = `field-label ${dark ? "!text-paper/75" : ""}`;
  const err = (name: string) => errors[name]?.[0];
  const fieldProps = (name: string) => ({
    id: `${id}-${name}`,
    name,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": err(name) ? `${id}-${name}-error` : undefined,
  });
  const errorText = (name: string) =>
    err(name) ? (
      <p id={`${id}-${name}-error`} className={`mt-1.5 text-sm ${dark ? "text-[#ffb4ad]" : "text-danger"}`}>
        {err(name)}
      </p>
    ) : null;

  return (
    <form ref={formRef} action={action} noValidate={false} className="grid gap-4" aria-describedby={`${id}-status`}>
      <input type="hidden" name="kind" value={kind} />
      <input ref={keyRef} type="hidden" name="idempotencyKey" defaultValue="" />
      {propertyCode ? <input type="hidden" name="propertyCode" value={propertyCode} /> : null}
      {operation ? <input type="hidden" name="operation" value={operation} /> : null}
      {UTM_FIELDS.map((k) => (
        <input key={k} type="hidden" name={k} defaultValue="" />
      ))}
      {/* Honeypot: invisible para personas y lectores de pantalla */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>No completar</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
        <div className={compact ? "" : "sm:col-span-2"}>
          <label htmlFor={`${id}-name`} className={label}>
            Nombre y apellido
          </label>
          <input {...fieldProps("name")} className={control} type="text" autoComplete="name" required minLength={2} maxLength={120} />
          {errorText("name")}
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className={label}>
            Teléfono / WhatsApp
          </label>
          <input {...fieldProps("phone")} className={control} type="tel" autoComplete="tel" inputMode="tel" maxLength={40} placeholder="387 ..." />
          {errorText("phone")}
        </div>
        <div>
          <label htmlFor={`${id}-email`} className={label}>
            Email
          </label>
          <input {...fieldProps("email")} className={control} type="email" autoComplete="email" maxLength={254} />
          {errorText("email")}
        </div>
      </div>

      {kind === "appraisal" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-appraisalGoal`} className={label}>
              ¿Qué querés hacer?
            </label>
            <select {...fieldProps("appraisalGoal")} className={control} defaultValue="vender">
              <option value="vender">Vender</option>
              <option value="alquilar">Alquilar</option>
              <option value="conocer">Conocer su valor</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-appraisalType`} className={label}>
              Tipo de propiedad
            </label>
            <select {...fieldProps("appraisalType")} className={control} defaultValue="">
              <option value="">Elegí</option>
              {(appraisalTypes ?? ["Casa", "Departamento", "Terreno", "Local", "Oficina", "Campo", "Otro"]).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-appraisalZone`} className={label}>
              Dirección o zona
            </label>
            <input {...fieldProps("appraisalZone")} className={control} type="text" maxLength={160} required placeholder="Barrio, localidad" />
            {errorText("appraisalZone")}
          </div>
        </div>
      ) : null}

      {kind === "visit" ? (
        <div>
          <label htmlFor={`${id}-visitWhen`} className={label}>
            ¿Qué días y horarios te quedan bien?
          </label>
          <input {...fieldProps("visitWhen")} className={control} type="text" maxLength={120} placeholder="Ej.: martes o jueves por la tarde" />
        </div>
      ) : null}

      <div>
        <label htmlFor={`${id}-message`} className={label}>
          {kind === "appraisal" ? "Contanos algo más (opcional)" : "Mensaje"}
        </label>
        <textarea {...fieldProps("message")} className={`${control} min-h-28`} maxLength={2000} rows={compact ? 3 : 4} defaultValue={defaultMessage} />
        {errorText("message")}
      </div>

      <div
        id={`${id}-status`}
        ref={statusRef}
        tabIndex={-1}
        role={state.status === "error" ? "alert" : "status"}
        aria-live="polite"
        className="outline-none empty:hidden"
      >
        {state.status === "sent" ? (
          <p className={`flex items-start gap-2 rounded-[var(--radius-md)] p-3 text-sm font-medium ${dark ? "bg-paper/10 text-paper" : "bg-success/10 text-success"}`}>
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> {state.message}
          </p>
        ) : state.status === "error" ? (
          <p className={`rounded-[var(--radius-md)] p-3 text-sm font-medium ${dark ? "bg-paper/10 text-[#ffb4ad]" : "bg-danger/10 text-danger"}`}>{state.message}</p>
        ) : null}
        {errors.propertyCode ? <p className="text-sm text-danger">{errors.propertyCode[0]}</p> : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="submit" disabled={pending} className={`btn ${dark ? "btn-primary" : "btn-ink"} disabled:opacity-60`} aria-disabled={pending}>
          {pending ? "Enviando…" : (submitLabel ?? "Enviar consulta")}
        </button>
        <p className={`text-xs ${dark ? "text-paper/70" : "text-ink-2"}`}>
          Usamos tus datos solo para responderte.{" "}
          <Link href="/privacidad" className="underline underline-offset-2">
            Privacidad
          </Link>
        </p>
      </div>
    </form>
  );
}
