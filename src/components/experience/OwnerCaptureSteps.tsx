"use client";

/**
 * «Quiero vender mi propiedad» paso a paso (flag `owner_capture_steps`): ubicación → tipo → superficie → dormitorios →
 * estado → fotos (solo con storage configurado) → contacto. Crea el MISMO lead que el formulario de siempre
 * (`submitLeadAction` → kind "owner" → `sell_my_property`) con honeypot, rate limit, idempotencia y validación en el
 * servidor.
 *
 * Mejora progresiva: sin JavaScript se ve el formulario completo (todos los pasos) y funciona igual. Con JavaScript se
 * muestra un paso por vez. Nada de tasación automática.
 */
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { submitLeadAction, type LeadFormState } from "@/app/(site)/actions";
import { clientLeadErrors } from "@/components/site/lead-form-validation";

const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
const CONDITIONS = [
  ["a_estrenar", "A estrenar"],
  ["muy_bueno", "Muy bueno"],
  ["bueno", "Bueno"],
  ["a_refaccionar", "A refaccionar"],
] as const;
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

type StepKey = "ubicacion" | "tipo" | "superficie" | "dormitorios" | "estado" | "fotos" | "contacto";
const STEP_TITLE: Record<StepKey, string> = {
  ubicacion: "¿Dónde está tu propiedad?",
  tipo: "¿Qué tipo de propiedad es?",
  superficie: "¿Cuántos metros tiene, aproximadamente?",
  dormitorios: "¿Cuántos dormitorios?",
  estado: "¿En qué estado está?",
  fotos: "¿Querés sumar fotos?",
  contacto: "¿Cómo te contactamos?",
};
/** Campos del servidor → paso donde se corrigen. */
const FIELD_STEP: Record<string, StepKey> = { appraisalZone: "ubicacion", appraisalGoal: "ubicacion", appraisalType: "tipo", ownerAreaM2: "superficie", ownerBedrooms: "dormitorios", ownerCondition: "estado", photoTokens: "fotos", name: "contacto", phone: "contacto", email: "contacto", message: "contacto" };

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

type Photo = { key: string; name: string; state: "uploading" | "done" | "error"; token?: string; error?: string };

export function OwnerCaptureSteps({ types, photosEnabled, stepByStep = true }: { types: string[]; photosEnabled: boolean; /** Flag `owner_capture_steps` apagado: formulario completo en una sola vista (mismo envío). */ stepByStep?: boolean }) {
  const [state, action, pending] = useActionState<LeadFormState, FormData>(submitLeadAction, { status: "idle" });
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const headingRefs = useRef<Partial<Record<StepKey, HTMLElement | null>>>({});
  const inFlight = useRef(false);
  const [enhanced, setEnhanced] = useState(false);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<"vender" | "alquilar">("vender");
  const [clientErrors, setClientErrors] = useState<Record<string, string[]> | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const steps: StepKey[] = ["ubicacion", "tipo", "superficie", "dormitorios", "estado", ...(photosEnabled ? (["fotos"] as const) : []), "contacto"];
  const current = steps[step]!;

  useEffect(() => {
    if (stepByStep) setEnhanced(true);
    if (keyRef.current) keyRef.current.value = newKey();
    const sp = new URLSearchParams(window.location.search);
    for (const k of UTM_FIELDS) {
      const input = formRef.current?.elements.namedItem(k);
      const v = sp.get(k);
      if (v && input instanceof HTMLInputElement) input.value = v.slice(0, 200);
    }
  }, [stepByStep]);

  useEffect(() => {
    inFlight.current = false;
    if (state.status === "sent") {
      formRef.current?.reset();
      setPhotos([]);
      setGoal("vender");
      setStep(steps.indexOf("contacto"));
      if (keyRef.current) keyRef.current.value = newKey();
      statusRef.current?.focus();
    } else if (state.status === "error") {
      const firstField = Object.keys(state.fieldErrors ?? {})[0];
      const target = firstField ? steps.indexOf(FIELD_STEP[firstField] ?? "contacto") : -1;
      if (target >= 0) setStep(target);
      requestAnimationFrame(() => (formRef.current?.querySelector<HTMLElement>("fieldset:not([hidden]) [aria-invalid='true']") ?? statusRef.current)?.focus());
    }
    // Solo cuando cambia el resultado del envío.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = clientErrors ?? (state.status === "error" ? (state.fieldErrors ?? {}) : {});
  const err = (name: string) => errors[name]?.[0];
  const field = (name: string) => ({ id: `${id}-${name}`, name, "aria-invalid": err(name) ? true : undefined, "aria-describedby": err(name) ? `${id}-${name}-error` : undefined });
  const errorText = (name: string) =>
    err(name) ? (
      <p id={`${id}-${name}-error`} className="mt-1.5 text-sm text-danger">
        {err(name)}
      </p>
    ) : null;

  const goTo = (i: number) => {
    setStep(i);
    requestAnimationFrame(() => headingRefs.current[steps[i]!]?.focus());
  };

  const next = () => {
    if (current === "ubicacion") {
      const zone = formRef.current?.elements.namedItem("appraisalZone");
      if (zone instanceof HTMLInputElement && !zone.value.trim()) {
        setClientErrors({ appraisalZone: ["Contanos dónde está la propiedad"] });
        requestAnimationFrame(() => zone.focus());
        return;
      }
    }
    if (current === "fotos" && photos.some((p) => p.state === "uploading")) return;
    setClientErrors(null);
    goTo(Math.min(step + 1, steps.length - 1));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (inFlight.current || pending) return;
    if (enhanced && current !== "contacto") {
      next();
      return;
    }
    const fd = new FormData(e.currentTarget);
    const invalid = clientLeadErrors(fd) ?? (String(fd.get("appraisalZone") ?? "").trim() ? null : { appraisalZone: ["Contanos dónde está la propiedad"] });
    setClientErrors(invalid);
    if (invalid) {
      const target = steps.indexOf(FIELD_STEP[Object.keys(invalid)[0]!] ?? "contacto");
      if (target >= 0 && target !== step) setStep(target);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("fieldset:not([hidden]) [aria-invalid='true']")?.focus());
      return;
    }
    inFlight.current = true;
    startTransition(() => action(fd));
  };

  const addPhotos = async (files: FileList) => {
    const room = MAX_PHOTOS - photos.filter((p) => p.state !== "error").length;
    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      const key = `${Date.now()}-${file.name}`;
      if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type) || file.size > MAX_PHOTO_BYTES) {
        setPhotos((p) => [...p, { key, name: file.name, state: "error", error: file.size > MAX_PHOTO_BYTES ? "Supera 4 MB" : "Formato no admitido" }]);
        continue;
      }
      setPhotos((p) => [...p, { key, name: file.name, state: "uploading" }]);
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/site/propietarios/fotos", { method: "POST", body: fd }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { data?: { token: string }; error?: { message?: string } } | null;
      setPhotos((p) => p.map((x) => (x.key === key ? (res?.ok && body?.data ? { ...x, state: "done", token: body.data.token } : { ...x, state: "error", error: body?.error?.message ?? "No se pudo subir" }) : x)));
    }
  };

  const hidden = (k: StepKey) => enhanced && current !== k;
  const legend = (k: StepKey) => (
    <legend
      ref={(el) => {
        headingRefs.current[k] = el;
      }}
      tabIndex={-1}
      className="owner-step-title outline-none"
    >
      {STEP_TITLE[k]}
    </legend>
  );
  const typeOptions = types.length ? types : ["Casa", "Departamento", "Terreno", "Local", "Oficina", "Campo", "Otro"];

  return (
    <form ref={formRef} action={action} onSubmit={onSubmit} onReset={() => setGoal("vender")} className="owner-steps" aria-describedby={`${id}-status`} data-enhanced={enhanced || undefined} noValidate={enhanced}>
      <input type="hidden" name="kind" value="owner" />
      <input ref={keyRef} type="hidden" name="idempotencyKey" />
      {UTM_FIELDS.map((k) => (
        <input key={k} type="hidden" name={k} />
      ))}
      {photos.filter((p) => p.token).map((p) => (
        <input key={p.key} type="hidden" name="photoTokens" value={p.token} />
      ))}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>No completar</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {enhanced ? (
        <div className="owner-progress">
          <p aria-live="polite" className="owner-progress-label">
            Paso {step + 1} de {steps.length}
          </p>
          <ol className="owner-progress-bar" aria-hidden="true">
            {steps.map((k, i) => (
              <li key={k} data-done={i < step || undefined} data-current={i === step || undefined} />
            ))}
          </ol>
        </div>
      ) : null}

      <fieldset hidden={hidden("ubicacion")} className="owner-step">
        {legend("ubicacion")}
        <div className="segmented" role="radiogroup" aria-label="¿Qué querés hacer con tu propiedad?">
          {(["vender", "alquilar"] as const).map((g) => (
            <label key={g} className="segmented-option">
              <input type="radio" name="appraisalGoal" value={g} defaultChecked={(values.appraisalGoal ?? "vender") === g} onChange={() => setGoal(g)} />
              <span>{g === "vender" ? "Vender" : "Alquilar"}</span>
            </label>
          ))}
        </div>
        <div className="mt-4">
          <label htmlFor={`${id}-appraisalZone`} className="field-label">
            Barrio o localidad
          </label>
          <input {...field("appraisalZone")} className="field-control field-lg" type="text" maxLength={160} required placeholder="Ej.: Tres Cerritos, Salta" defaultValue={values.appraisalZone} />
          {errorText("appraisalZone")}
        </div>
      </fieldset>

      <fieldset hidden={hidden("tipo")} className="owner-step">
        {legend("tipo")}
        <div className="owner-chips" role="radiogroup" aria-label="Tipo de propiedad">
          {typeOptions.map((t) => (
            <label key={t} className="segmented-option">
              <input type="radio" name="appraisalType" value={t} defaultChecked={values.appraisalType === t} />
              <span>{t}</span>
            </label>
          ))}
        </div>
        <p className="owner-hint">Si no está en la lista, elegí la más parecida o seguí: lo conversamos.</p>
      </fieldset>

      <fieldset hidden={hidden("superficie")} className="owner-step">
        {legend("superficie")}
        <label htmlFor={`${id}-ownerAreaM2`} className="field-label">
          Superficie aproximada (m²) · opcional
        </label>
        <input {...field("ownerAreaM2")} className="field-control field-lg" type="number" inputMode="numeric" min={1} max={10000000} step="any" placeholder="Ej.: 180" defaultValue={values.ownerAreaM2} />
        {errorText("ownerAreaM2")}
        <p className="owner-hint">Un número aproximado alcanza. Si no lo sabés, seguí.</p>
      </fieldset>

      <fieldset hidden={hidden("dormitorios")} className="owner-step">
        {legend("dormitorios")}
        <label htmlFor={`${id}-ownerBedrooms`} className="field-label">
          Dormitorios · opcional
        </label>
        <input {...field("ownerBedrooms")} className="field-control field-lg" type="number" inputMode="numeric" min={0} max={50} step={1} placeholder="Ej.: 3" defaultValue={values.ownerBedrooms} />
        {errorText("ownerBedrooms")}
        <p className="owner-hint">Para terrenos, locales u oficinas dejalo vacío.</p>
      </fieldset>

      <fieldset hidden={hidden("estado")} className="owner-step">
        {legend("estado")}
        <div className="owner-chips" role="radiogroup" aria-label="Estado de la propiedad">
          {CONDITIONS.map(([v, label]) => (
            <label key={v} className="segmented-option">
              <input type="radio" name="ownerCondition" value={v} defaultChecked={values.ownerCondition === v} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="owner-hint">Opcional: sirve para preparar la primera conversación.</p>
      </fieldset>

      {photosEnabled ? (
        <fieldset hidden={hidden("fotos")} className="owner-step">
          {legend("fotos")}
          <label htmlFor={`${id}-photos`} className="btn btn-ink owner-file">
            Elegir fotos (hasta {MAX_PHOTOS})
            <input
              id={`${id}-photos`}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              multiple
              className="sr-only"
              disabled={photos.filter((p) => p.state !== "error").length >= MAX_PHOTOS}
              onChange={(e) => {
                if (e.target.files) void addPhotos(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {photos.length ? (
            <ul className="owner-photos" aria-label="Fotos elegidas">
              {photos.map((p) => (
                <li key={p.key}>
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className={p.state === "error" ? "text-danger" : "text-ink-2"}>{p.state === "uploading" ? "Subiendo…" : p.state === "done" ? "Lista" : p.error}</span>
                  <button type="button" aria-label={`Quitar ${p.name}`} onClick={() => setPhotos((all) => all.filter((x) => x.key !== p.key))}>
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="owner-hint">Opcional. JPG, PNG o WebP de hasta 4 MB. Las fotos solo las ve el equipo.</p>
        </fieldset>
      ) : null}

      <fieldset hidden={hidden("contacto")} className="owner-step">
        {legend("contacto")}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-name`} className="field-label">
              Nombre y apellido
            </label>
            <input {...field("name")} className="field-control field-lg" type="text" autoComplete="name" required minLength={2} maxLength={120} defaultValue={values.name} />
            {errorText("name")}
          </div>
          <div>
            <label htmlFor={`${id}-phone`} className="field-label">
              Teléfono / WhatsApp
            </label>
            <input {...field("phone")} className="field-control field-lg" type="tel" autoComplete="tel" inputMode="tel" maxLength={40} placeholder="387 ..." defaultValue={values.phone} />
            {errorText("phone")}
          </div>
          <div>
            <label htmlFor={`${id}-email`} className="field-label">
              Email
            </label>
            <input {...field("email")} className="field-control field-lg" type="email" autoComplete="email" maxLength={254} defaultValue={values.email} />
            {errorText("email")}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-message`} className="field-label">
              Contanos algo más (opcional)
            </label>
            <textarea {...field("message")} className="field-control field-lg" maxLength={2000} rows={3} defaultValue={values.message} />
            {errorText("message")}
          </div>
        </div>
        <p className="owner-hint">No damos valores automáticos: un asesor te va a contactar para una tasación profesional.</p>
      </fieldset>

      <div id={`${id}-status`} ref={statusRef} tabIndex={-1} role={state.status === "error" || clientErrors ? "alert" : "status"} aria-live="polite" className="outline-none empty:hidden">
        {clientErrors ? (
          <p className="rounded-[var(--radius-md)] bg-danger/10 p-3 text-sm font-medium text-danger">Revisá los datos marcados.</p>
        ) : state.status === "sent" ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] bg-success/10 p-3 text-sm font-medium text-success">
            <Check aria-hidden className="mt-0.5 size-4 shrink-0" /> {state.message}
          </p>
        ) : state.status === "error" ? (
          <p className="rounded-[var(--radius-md)] bg-danger/10 p-3 text-sm font-medium text-danger">{state.message}</p>
        ) : null}
      </div>

      <div className="owner-nav">
        {enhanced && step > 0 ? (
          <button type="button" className="btn btn-outline" onClick={() => goTo(step - 1)}>
            <ArrowLeft aria-hidden className="size-4" /> Atrás
          </button>
        ) : (
          <span />
        )}
        {enhanced && current !== "contacto" ? (
          <button type="button" className="btn btn-ink btn-lg" onClick={next} disabled={current === "fotos" && photos.some((p) => p.state === "uploading")}>
            Siguiente <ArrowRight aria-hidden className="size-4" />
          </button>
        ) : (
          <button type="submit" disabled={pending} className="btn btn-primary btn-lg disabled:opacity-60" aria-disabled={pending}>
            {pending ? "Enviando…" : goal === "alquilar" ? "Quiero alquilar mi propiedad" : "Quiero vender mi propiedad"}
          </button>
        )}
      </div>
      <p className="text-xs text-ink-2">
        Usamos tus datos solo para responderte.{" "}
        <Link href="/privacidad" className="underline underline-offset-2">
          Privacidad
        </Link>
      </p>
    </form>
  );
}
