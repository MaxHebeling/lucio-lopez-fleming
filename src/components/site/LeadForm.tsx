"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { submitLeadAction, type LeadFormState } from "@/app/(site)/actions";
import { clientLeadErrors } from "./lead-form-validation";
import { readConcierge, siteSessionKey, trackSite } from "./sales/site-track";

type Kind = "property" | "visit" | "contact" | "appraisal" | "owner";

type Props = {
  kind: Kind;
  propertyCode?: number;
  operation?: string;
  defaultMessage?: string;
  submitLabel?: string;
  tone?: "light" | "dark";
  appraisalTypes?: string[];
  compact?: boolean;
  /** "lg": controles más altos y texto más grande (captación de propietarios en el home). */
  size?: "md" | "lg";
};

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];

/** Consultas de búsqueda (no de propietarios): llevan la sesión de la pestaña y, si se usó, los filtros del concierge. */
const SEARCH_KINDS = new Set<Kind>(["property", "visit", "contact"]);

/** Filtros del concierge sin los fragmentos de texto (evidencia): al servidor viajan solo datos estructurados. */
function conciergeIntentJson(): string {
  const stored = readConcierge();
  const intent = (stored?.response as { intent?: Record<string, unknown> } | undefined)?.intent;
  if (!intent) return "";
  const clean = Object.fromEntries(Object.entries(intent).map(([k, v]) => [k, v && typeof v === "object" && "evidence" in v ? { ...(v as object), evidence: null } : v]));
  const json = JSON.stringify(clean);
  return json.length <= 6000 ? json : "";
}

/**
 * Formulario público → CRM. Funciona sin JS (Server Action; si el servidor rechaza, vuelve con lo escrito).
 * Con JS: se envía con onSubmit + transición (React no resetea el formulario, así un rechazo no borra lo escrito),
 * valida "teléfono o email" antes de enviar, y usa una clave de idempotencia por consulta: la misma en los reintentos
 * de ese envío (un doble click o un reintento tras un error no duplica el lead) y una nueva recién después de un éxito.
 * Suma UTM de la URL y estados accesibles (aria-live, foco en el primer error).
 */
export function LeadForm({ kind, propertyCode, operation, defaultMessage, submitLabel, tone = "light", appraisalTypes, compact, size = "md" }: Props) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(submitLeadAction, { status: "idle" });
  const keyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [clientErrors, setClientErrors] = useState<Record<string, string[]> | null>(null);
  const inFlight = useRef(false);
  const [ownerGoal, setOwnerGoal] = useState<"vender" | "alquilar">("vender");

  // Valores que solo existen en el navegador: se escriben directo en los inputs ocultos (sin re-render).
  useEffect(() => {
    if (keyRef.current) keyRef.current.value = newKey();
    if (SEARCH_KINDS.has(kind)) {
      // Solo se vincula si la persona envía la consulta (y sin Do Not Track / GPC: siteSessionKey devuelve null).
      const session = formRef.current?.elements.namedItem("sessionKey");
      const intent = formRef.current?.elements.namedItem("conciergeIntent");
      if (session instanceof HTMLInputElement) session.value = siteSessionKey() ?? "";
      if (intent instanceof HTMLInputElement) intent.value = siteSessionKey() ? conciergeIntentJson() : "";
    }
    const sp = new URLSearchParams(window.location.search);
    for (const k of UTM_FIELDS) {
      const input = formRef.current?.elements.namedItem(k);
      const v = sp.get(k);
      if (v && input instanceof HTMLInputElement) input.value = v.slice(0, 200);
    }
  }, [kind]);

  const openedRef = useRef(false);
  const onFirstFocus = () => {
    if (openedRef.current) return;
    openedRef.current = true;
    trackSite("lead_form_opened", { ...(propertyCode ? { propertyCode } : {}), props: { kind } });
  };

  useEffect(() => {
    inFlight.current = false;
    if (state.status === "sent") {
      formRef.current?.reset();
      if (keyRef.current) keyRef.current.value = newKey(); // el próximo envío es otra consulta
      statusRef.current?.focus();
    } else if (state.status === "error") {
      const firstInvalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      (firstInvalid ?? statusRef.current)?.focus();
    }
  }, [state]);

  useEffect(() => {
    if (!clientErrors) return;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [clientErrors]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current || pending) return;
    const fd = new FormData(e.currentTarget);
    const invalid = clientLeadErrors(fd);
    setClientErrors(invalid);
    if (invalid) return;
    inFlight.current = true;
    startTransition(() => action(fd));
  };

  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = clientErrors ?? (state.status === "error" ? (state.fieldErrors ?? {}) : {});
  const dark = tone === "dark";
  const control = `field-control ${size === "lg" ? "field-lg" : ""} ${dark ? "!border-paper/25 !bg-paper/5 !text-paper placeholder:text-paper/50" : ""}`;
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

  const typeOptions = (appraisalTypes ?? ["Casa", "Departamento", "Terreno", "Local", "Oficina", "Campo", "Otro"]).map((t) => (
    <option key={t} value={t}>
      {t}
    </option>
  ));
  const ownerLabel = submitLabel && ownerGoal === "vender" ? submitLabel : ownerGoal === "alquilar" ? "Quiero alquilar mi propiedad" : "Quiero vender mi propiedad";

  return (
    <form ref={formRef} action={action} onSubmit={onSubmit} onFocus={onFirstFocus} onReset={() => setOwnerGoal("vender")} className={`grid ${size === "lg" ? "gap-5" : "gap-4"}`} aria-describedby={`${id}-status`}>
      <input type="hidden" name="kind" value={kind} />
      {/* Sin value/defaultValue: los escribe el efecto de montaje y React no debe tocarlos al re-renderizar (en un input
          hidden, reasignar defaultValue pisa el valor: se perdían la clave y los UTM después de un error). */}
      <input ref={keyRef} type="hidden" name="idempotencyKey" />
      {propertyCode ? <input type="hidden" name="propertyCode" value={propertyCode} /> : null}
      {operation ? <input type="hidden" name="operation" value={operation} /> : null}
      {UTM_FIELDS.map((k) => (
        <input key={k} type="hidden" name={k} />
      ))}
      {SEARCH_KINDS.has(kind) ? (
        <>
          <input type="hidden" name="sessionKey" />
          <input type="hidden" name="conciergeIntent" />
        </>
      ) : null}
      {/* Honeypot: invisible para personas y lectores de pantalla */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>No completar</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {kind === "owner" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="sm:col-span-2">
            <legend className={label}>¿Qué querés hacer con tu propiedad?</legend>
            <div className="segmented" role="presentation">
              {(["vender", "alquilar"] as const).map((g) => (
                <label key={g} className="segmented-option">
                  <input
                    type="radio"
                    name="appraisalGoal"
                    value={g}
                    defaultChecked={(values.appraisalGoal ?? "vender") === g}
                    onChange={() => setOwnerGoal(g)}
                  />
                  <span>{g === "vender" ? "Vender" : "Alquilar"}</span>
                </label>
              ))}
            </div>
            {errorText("appraisalGoal")}
          </fieldset>
          <div>
            <label htmlFor={`${id}-appraisalType`} className={label}>
              Tipo de propiedad
            </label>
            <select {...fieldProps("appraisalType")} className={control} defaultValue={values.appraisalType ?? ""}>
              <option value="">Elegí</option>
              {typeOptions}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-appraisalZone`} className={label}>
              ¿Dónde está?
            </label>
            <input {...fieldProps("appraisalZone")} className={control} type="text" maxLength={160} required placeholder="Barrio, localidad" defaultValue={values.appraisalZone} />
            {errorText("appraisalZone")}
          </div>
        </div>
      ) : null}

      <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
        <div className={compact ? "" : "sm:col-span-2"}>
          <label htmlFor={`${id}-name`} className={label}>
            Nombre y apellido
          </label>
          <input {...fieldProps("name")} className={control} type="text" autoComplete="name" required minLength={2} maxLength={120} defaultValue={values.name} />
          {errorText("name")}
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className={label}>
            Teléfono / WhatsApp
          </label>
          <input {...fieldProps("phone")} className={control} type="tel" autoComplete="tel" inputMode="tel" maxLength={40} placeholder="387 ..." defaultValue={values.phone} />
          {errorText("phone")}
        </div>
        <div>
          <label htmlFor={`${id}-email`} className={label}>
            Email
          </label>
          <input {...fieldProps("email")} className={control} type="email" autoComplete="email" maxLength={254} defaultValue={values.email} />
          {errorText("email")}
        </div>
      </div>

      {kind === "appraisal" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-appraisalGoal`} className={label}>
              ¿Qué querés hacer?
            </label>
            <select {...fieldProps("appraisalGoal")} className={control} defaultValue={values.appraisalGoal ?? "vender"}>
              <option value="vender">Vender</option>
              <option value="alquilar">Alquilar</option>
              <option value="conocer">Conocer su valor</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-appraisalType`} className={label}>
              Tipo de propiedad
            </label>
            <select {...fieldProps("appraisalType")} className={control} defaultValue={values.appraisalType ?? ""}>
              <option value="">Elegí</option>
              {typeOptions}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-appraisalZone`} className={label}>
              Dirección o zona
            </label>
            <input {...fieldProps("appraisalZone")} className={control} type="text" maxLength={160} required placeholder="Barrio, localidad" defaultValue={values.appraisalZone} />
            {errorText("appraisalZone")}
          </div>
        </div>
      ) : null}

      {kind === "visit" ? (
        <div>
          <label htmlFor={`${id}-visitWhen`} className={label}>
            ¿Qué días y horarios te quedan bien?
          </label>
          <input {...fieldProps("visitWhen")} className={control} type="text" maxLength={120} placeholder="Ej.: martes o jueves por la tarde" defaultValue={values.visitWhen} />
        </div>
      ) : null}

      <div>
        <label htmlFor={`${id}-message`} className={label}>
          {kind === "appraisal" || kind === "owner" ? "Contanos algo más (opcional)" : "Mensaje"}
        </label>
        <textarea {...fieldProps("message")} className={`${control} min-h-28`} maxLength={2000} rows={compact ? 3 : 4} defaultValue={values.message ?? defaultMessage} />
        {errorText("message")}
      </div>

      {SEARCH_KINDS.has(kind) ? (
        // Captura progresiva: 1–2 preguntas opcionales, nunca obligatorias (sugieren datos del perfil que confirma el equipo).
        <details className="group rounded-[var(--radius-md)]" open={Boolean(values.moveTimeframe || values.financing)}>
          <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold ${dark ? "text-paper" : "text-ink"}`}>
            Contanos un poco más (opcional)
            <span aria-hidden className="text-lg transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className={`grid gap-4 pt-2 ${compact ? "" : "sm:grid-cols-2"}`}>
            <div>
              <label htmlFor={`${id}-moveTimeframe`} className={label}>
                ¿Para cuándo lo buscás?
              </label>
              <select {...fieldProps("moveTimeframe")} className={control} defaultValue={values.moveTimeframe ?? ""}>
                <option value="">Prefiero no decirlo</option>
                <option value="immediate">Lo antes posible</option>
                <option value="within_3_months">En los próximos 3 meses</option>
                <option value="within_6_months">En los próximos 6 meses</option>
                <option value="later">Más adelante</option>
              </select>
            </div>
            {operation !== "rent" && operation !== "temporary_rent" ? (
              <div>
                <label htmlFor={`${id}-financing`} className={label}>
                  ¿Cómo pensás pagar?
                </label>
                <select {...fieldProps("financing")} className={control} defaultValue={values.financing ?? ""}>
                  <option value="">Prefiero no decirlo</option>
                  <option value="cash">Contado</option>
                  <option value="credit">Con crédito hipotecario</option>
                  <option value="undecided">Todavía no lo sé</option>
                </select>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <div
        id={`${id}-status`}
        ref={statusRef}
        tabIndex={-1}
        role={state.status === "error" || clientErrors ? "alert" : "status"}
        aria-live="polite"
        className="outline-none empty:hidden"
      >
        {clientErrors ? (
          <p className={`rounded-[var(--radius-md)] p-3 text-sm font-medium ${dark ? "bg-paper/10 text-[#ffb4ad]" : "bg-danger/10 text-danger"}`}>Revisá los datos marcados.</p>
        ) : state.status === "sent" ? (
          <p className={`flex items-start gap-2 rounded-[var(--radius-md)] p-3 text-sm font-medium ${dark ? "bg-paper/10 text-paper" : "bg-success/10 text-success"}`}>
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> {state.message}
          </p>
        ) : state.status === "error" ? (
          <p className={`rounded-[var(--radius-md)] p-3 text-sm font-medium ${dark ? "bg-paper/10 text-[#ffb4ad]" : "bg-danger/10 text-danger"}`}>{state.message}</p>
        ) : null}
        {errors.propertyCode ? <p className="text-sm text-danger">{errors.propertyCode[0]}</p> : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="submit" disabled={pending} className={`btn ${dark || kind === "owner" ? "btn-primary" : "btn-ink"} ${size === "lg" ? "btn-lg" : ""} disabled:opacity-60`} aria-disabled={pending}>
          {pending ? "Enviando…" : kind === "owner" ? ownerLabel : (submitLabel ?? "Enviar consulta")}
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
