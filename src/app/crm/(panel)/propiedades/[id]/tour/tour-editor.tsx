"use client";

import "@/components/site/tour/tour.css";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import { ArrowDown, ArrowUp, Crosshair, Eye, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/crm/use-action";
import type { TourEditorData } from "@/server/tours/queries";
import { externalTourDisplay, PROVIDER_LABEL, type ExternalProvider, type TourHotspotKind, type TourScene } from "@/server/tours/model";
import type { ViewerHandle } from "@/components/site/tour/PanoramaViewer";
import { FloorPlan } from "@/components/site/tour/FloorPlan";
import type { TourContext } from "@/components/site/tour/TourExperience";
import {
  addHotspotAction,
  createTourAction,
  deleteHotspotAction,
  deleteSceneAction,
  deleteTourAction,
  publishTourAction,
  removeFloorPlanAction,
  reorderScenesAction,
  unpublishTourAction,
  updateExternalTourAction,
  updateHotspotAction,
  updateSceneAction,
  updateTourSettingsAction,
} from "./actions";

// El visor (PSV + three) se carga recién al abrir el editor de un tour propio.
const PanoramaViewer = dynamic(() => import("@/components/site/tour/PanoramaViewer").then((m) => m.PanoramaViewer), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-paper/70">Cargando visor…</div>,
});

type Tour = NonNullable<TourEditorData["tour"]>;
type EditorScene = Tour["scenes"][number];
type Hotspot = EditorScene["hotspots"][number];

const KIND_LABEL: Record<TourHotspotKind, string> = { scene: "Navegación (lleva a otra escena)", info: "Información (tarjeta con texto)", cta: "Contacto (abre «Agendar visita»)" };
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";
const MAX_BYTES = 15 * 1024 * 1024;
const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`;

function errorMessage(text: string, fallback: string): string {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? fallback;
  } catch {
    return fallback; // respuesta no JSON (límite del proxy)
  }
}

/** Sube una panorámica o un plano: directo al bucket si hay S3 (URL firmada), si no por la ruta del servidor. */
async function uploadTourFile(propertyId: string, file: File, meta: { target: "scene" | "floor_plan"; name?: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = `/api/crm/propiedades/${propertyId}/tour/subida`;
  const intentRes = await fetch(`${base}/intent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentType: file.type, size: file.size }) });
  const intentText = await intentRes.text();
  if (!intentRes.ok) return { ok: false, error: errorMessage(intentText, "No se pudo preparar la subida.") };
  const intent = (JSON.parse(intentText) as { data: { mode: "direct"; uploadUrl: string; token: string } | { mode: "proxy" } }).data;
  if (intent.mode === "direct") {
    const put = await fetch(intent.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } }).catch(() => null);
    if (!put?.ok) return { ok: false, error: put ? "El almacenamiento rechazó el archivo." : "Error de red al subir. Probá de nuevo." };
    const done = await fetch(`${base}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: intent.token, ...meta, fileName: file.name }) });
    return done.ok ? { ok: true } : { ok: false, error: errorMessage(await done.text(), "No se pudo procesar el archivo.") };
  }
  const fd = new FormData();
  fd.append("file", file);
  fd.append("target", meta.target);
  if (meta.name) fd.append("name", meta.name);
  const r = await fetch(base, { method: "POST", body: fd }).catch(() => null);
  if (!r) return { ok: false, error: "Error de red al subir. Probá de nuevo." };
  return r.ok ? { ok: true } : { ok: false, error: errorMessage(await r.text(), "No se pudo subir el archivo.") };
}

export function TourEditor({ data, shareUrl, whatsappUrl }: { data: TourEditorData; shareUrl: string; whatsappUrl: string | null }) {
  const { tour, permissions, property } = data;
  if (!tour) {
    return permissions.canEdit ? (
      <CreateTour propertyId={property.id} />
    ) : (
      <Card>
        <p className="text-sm text-stone">Esta propiedad no tiene tour virtual.</p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <TourStatus data={data} tour={tour} shareUrl={shareUrl} whatsappUrl={whatsappUrl} />
      {tour.kind === "external" ? <ExternalTourForm tour={tour} canEdit={permissions.canEdit} /> : <InternalEditor data={data} tour={tour} />}
    </div>
  );
}

// ───────────────────────── Alta ─────────────────────────

function CreateTour({ propertyId }: { propertyId: string }) {
  const uid = useId();
  const [kind, setKind] = useState<"internal" | "external">("internal");
  const [provider, setProvider] = useState<ExternalProvider>("matterport");
  const [externalUrl, setExternalUrl] = useState("");
  const [embedUrl, setEmbedUrl] = useState("");
  const { run, pending, error, fieldErrors } = useAction(createTourAction);
  return (
    <Card title="Crear tour virtual">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(propertyId, kind === "internal" ? { kind } : { kind, provider, externalUrl, embedUrl });
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">Tipo de tour</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name={`${uid}-kind`} checked={kind === "internal"} onChange={() => setKind("internal")} className="mt-1 accent-[var(--ink)]" />
            <span>
              <span className="font-semibold">Propio</span> — subís panorámicas 360° (equirectangulares 2:1), ubicás puntos de navegación y el plano.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name={`${uid}-kind`} checked={kind === "external"} onChange={() => setKind("external")} className="mt-1 accent-[var(--ink)]" />
            <span>
              <span className="font-semibold">Externo</span> — ya está hecho en Matterport, Kuula, 3DVista u otro servicio.
            </span>
          </label>
        </fieldset>
        {kind === "external" ? <ExternalFields uid={uid} provider={provider} setProvider={setProvider} externalUrl={externalUrl} setExternalUrl={setExternalUrl} embedUrl={embedUrl} setEmbedUrl={setEmbedUrl} fieldErrors={fieldErrors} /> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" className="self-start" disabled={pending}>
          {pending ? "Creando…" : "Crear tour"}
        </Button>
      </form>
    </Card>
  );
}

function ExternalFields(p: {
  uid: string;
  provider: ExternalProvider;
  setProvider: (v: ExternalProvider) => void;
  externalUrl: string;
  setExternalUrl: (v: string) => void;
  embedUrl: string;
  setEmbedUrl: (v: string) => void;
  fieldErrors?: Record<string, string[]>;
  disabled?: boolean;
}) {
  const display = externalTourDisplay(p.provider, p.externalUrl || null, p.embedUrl || null);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Field label="Proveedor" htmlFor={`${p.uid}-provider`}>
        <Select id={`${p.uid}-provider`} value={p.provider} onChange={(e) => p.setProvider(e.target.value as ExternalProvider)} disabled={p.disabled}>
          {(Object.keys(PROVIDER_LABEL) as ExternalProvider[]).map((k) => (
            <option key={k} value={k}>
              {PROVIDER_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="URL del tour" htmlFor={`${p.uid}-url`} error={p.fieldErrors?.["input.externalUrl"] ?? p.fieldErrors?.externalUrl} hint="La que se comparte (https://…)">
        <Input id={`${p.uid}-url`} type="url" inputMode="url" required placeholder="https://" value={p.externalUrl} onChange={(e) => p.setExternalUrl(e.target.value)} disabled={p.disabled} />
      </Field>
      <Field label="URL de inserción (opcional)" htmlFor={`${p.uid}-embed`} error={p.fieldErrors?.["input.embedUrl"] ?? p.fieldErrors?.embedUrl} hint="La del código «embed» del proveedor">
        <Input id={`${p.uid}-embed`} type="url" inputMode="url" placeholder="https://" value={p.embedUrl} onChange={(e) => p.setEmbedUrl(e.target.value)} disabled={p.disabled} />
      </Field>
      <p className="text-xs text-stone md:col-span-3">
        {display?.mode === "embed"
          ? "Se va a mostrar dentro del sitio (host verificado del proveedor)."
          : display?.mode === "link"
            ? "Se va a abrir en una pestaña nueva: por seguridad solo se insertan tours de my.matterport.com, kuula.co y storage.net-fs.com (3DVista)."
            : "Cargá una URL https:// válida."}
      </p>
    </div>
  );
}

function ExternalTourForm({ tour, canEdit }: { tour: Tour; canEdit: boolean }) {
  const uid = useId();
  const [provider, setProvider] = useState<ExternalProvider>(tour.provider ?? "other");
  const [externalUrl, setExternalUrl] = useState(tour.externalUrl ?? "");
  const [embedUrl, setEmbedUrl] = useState(tour.embedUrl ?? "");
  const { run, pending, error, ok, fieldErrors } = useAction(updateExternalTourAction);
  return (
    <Card title="Tour externo">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(tour.id, { provider, externalUrl, embedUrl });
        }}
      >
        <ExternalFields uid={uid} provider={provider} setProvider={setProvider} externalUrl={externalUrl} setExternalUrl={setExternalUrl} embedUrl={embedUrl} setEmbedUrl={setEmbedUrl} fieldErrors={fieldErrors} disabled={!canEdit} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {ok ? <Alert tone="success">Tour externo guardado.</Alert> : null}
        {canEdit ? (
          <Button type="submit" size="sm" className="self-start" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        ) : null}
      </form>
    </Card>
  );
}

// ───────────────────────── Estado, publicación y vista previa ─────────────────────────

function TourStatus({ data, tour, shareUrl, whatsappUrl }: { data: TourEditorData; tour: Tour; shareUrl: string; whatsappUrl: string | null }) {
  const router = useRouter();
  const publish = useAction(publishTourAction);
  const unpublish = useAction(unpublishTourAction);
  const remove = useAction(deleteTourAction);
  const [Preview, setPreview] = useState<ComponentType<TourContext & { onClose: () => void }> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { permissions, property } = data;
  const openPreview = async () => {
    setPreviewError(null);
    try {
      const m = await import("@/components/site/tour/TourExperience");
      setPreview(() => m.default);
    } catch (e) {
      console.error("[tour] vista previa", e);
      setPreviewError("No se pudo abrir la vista previa. Revisá la conexión.");
    }
  };
  return (
    <Card title="Estado y publicación">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tour.status === "published" ? "success" : "warning"}>{tour.status === "published" ? "PUBLICADO" : "BORRADOR"}</Badge>
          <span className="text-sm text-ink-2">{tour.kind === "internal" ? `Tour propio · ${tour.scenes.length} ${tour.scenes.length === 1 ? "escena" : "escenas"}` : `Tour externo · ${PROVIDER_LABEL[tour.provider ?? "other"]}`}</span>
        </div>
        {tour.blockers.length && tour.status !== "published" ? (
          <Alert tone="warning">
            <span className="font-semibold">Para publicar falta:</span>
            <ul className="mt-1 list-disc pl-5">
              {tour.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {tour.preview ? (
            <Button variant="secondary" size="sm" onClick={openPreview}>
              <Eye aria-hidden className="size-4" /> Previsualizar
            </Button>
          ) : null}
          {permissions.canPublish ? (
            tour.status === "published" ? (
              <Button variant="secondary" size="sm" disabled={unpublish.pending} onClick={() => unpublish.run(tour.id)}>
                {unpublish.pending ? "Despublicando…" : "Despublicar tour"}
              </Button>
            ) : (
              <Button size="sm" disabled={publish.pending || tour.blockers.length > 0} onClick={() => publish.run(tour.id)}>
                {publish.pending ? "Publicando…" : "Publicar tour"}
              </Button>
            )
          ) : null}
          {permissions.canEdit && (tour.status !== "published" || permissions.canPublish) ? (
            <Button
              variant="danger"
              size="sm"
              disabled={remove.pending}
              onClick={async () => {
                if (!window.confirm("¿Borrar el tour completo? Se eliminan sus escenas, puntos y plano. No se puede deshacer.")) return;
                const r = await remove.run(tour.id);
                if (r.ok) router.refresh();
              }}
            >
              <Trash2 aria-hidden className="size-4" /> Borrar tour
            </Button>
          ) : null}
        </div>
        {[publish.error, unpublish.error, remove.error, previewError].filter(Boolean).map((e) => (
          <Alert key={e} tone="danger">
            {e}
          </Alert>
        ))}
        {publish.ok ? <Alert tone="success">Tour publicado{property.is_published ? ": ya se ve en la ficha." : ". Se va a ver cuando la propiedad esté publicada."}</Alert> : null}
      </div>
      {Preview && tour.preview ? (
        <Preview tour={tour.preview} propertyTitle={`${property.title} (vista previa)`} propertyCode={null} shareUrl={shareUrl} whatsappUrl={whatsappUrl} isDemo={property.is_demo} analytics={false} entry="direct" onClose={() => setPreview(null)} />
      ) : null}
    </Card>
  );
}

// ───────────────────────── Tour propio ─────────────────────────

function InternalEditor({ data, tour }: { data: TourEditorData; tour: Tour }) {
  const canEdit = data.permissions.canEdit;
  const [selectedId, setSelectedId] = useState<string | null>(tour.startSceneId ?? tour.scenes[0]?.id ?? null);
  const selected = tour.scenes.find((s) => s.id === selectedId) ?? tour.scenes[0] ?? null;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        {canEdit ? <SceneUploader propertyId={data.property.id} storageOk={data.storage.configured} /> : null}
        <ScenesList tour={tour} selectedId={selected?.id ?? null} onSelect={setSelectedId} canEdit={canEdit} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        {selected ? <SceneWorkspace key={selected.id} tour={tour} scene={selected} canEdit={canEdit} /> : <Card><p className="text-sm text-stone">Subí la primera panorámica para empezar.</p></Card>}
        <FloorPlanEditor propertyId={data.property.id} tour={tour} selected={selected} canEdit={canEdit} storageOk={data.storage.configured} isDemo={data.property.is_demo} />
        <GuidedEditor tour={tour} canEdit={canEdit} />
      </div>
    </div>
  );
}

function SceneUploader({ propertyId, storageOk }: { propertyId: string; storageOk: boolean }) {
  const uid = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<{ busy: boolean; error?: string; ok?: string }>({ busy: false });
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Card title="Agregar escena">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return setState({ busy: false, error: "Elegí la panorámica." });
          if (file.size > MAX_BYTES) return setState({ busy: false, error: "La panorámica supera 15 MB. Exportala en JPG con calidad 85–90." });
          setState({ busy: true });
          const r = await uploadTourFile(propertyId, file, { target: "scene", name });
          if (r.ok) {
            setState({ busy: false, ok: `«${name}» agregada.` });
            setName("");
            setFile(null);
            if (inputRef.current) inputRef.current.value = "";
            router.refresh();
          } else setState({ busy: false, error: r.error });
        }}
      >
        <Field label="Nombre del ambiente" htmlFor={`${uid}-name`}>
          <Input id={`${uid}-name`} required maxLength={80} placeholder="Living, Cocina, Jardín…" value={name} onChange={(e) => setName(e.target.value)} disabled={!storageOk} />
        </Field>
        <Field label="Panorámica 360°" htmlFor={`${uid}-file`} hint="Equirectangular 2:1 (ideal 8192 × 4096), JPG/PNG/WebP/AVIF, hasta 15 MB. Se quitan los datos de ubicación.">
          <input
            ref={inputRef}
            id={`${uid}-file`}
            type="file"
            accept={ACCEPT}
            required
            disabled={!storageOk}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
          />
        </Field>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        {state.ok ? <Alert tone="success">{state.ok}</Alert> : null}
        <Button type="submit" size="sm" className="self-start" disabled={state.busy || !storageOk}>
          {state.busy ? "Subiendo y procesando…" : "Subir escena"}
        </Button>
      </form>
    </Card>
  );
}

function ScenesList({ tour, selectedId, onSelect, canEdit }: { tour: Tour; selectedId: string | null; onSelect: (id: string) => void; canEdit: boolean }) {
  const reorder = useAction(reorderScenesAction);
  const settings = useAction(updateTourSettingsAction);
  const update = useAction(updateSceneAction);
  const remove = useAction(deleteSceneAction);
  const move = (i: number, delta: number) => {
    const ids = tour.scenes.map((s) => s.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void reorder.run(tour.id, ids);
  };
  const error = reorder.error ?? settings.error ?? update.error ?? remove.error;
  return (
    <Card title={`Escenas (${tour.scenes.length})`}>
      {tour.scenes.length ? (
        <ol className="flex flex-col gap-2" aria-label="Escenas del tour">
          {tour.scenes.map((s, i) => (
            <li key={s.id} className={`rounded-[var(--radius-md)] border p-2 ${s.id === selectedId ? "border-ink bg-paper" : "border-line bg-white"}`}>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => onSelect(s.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-current={s.id === selectedId ? "true" : undefined}>
                  {s.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- miniatura 640×400 ya procesada
                    <img src={s.thumbnailUrl} alt="" width={64} height={40} className="h-10 w-16 shrink-0 rounded object-cover" />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{s.name}</span>
                    <span className="block text-xs text-stone">
                      {s.hotspots.length} {s.hotspots.length === 1 ? "punto" : "puntos"} · {s.width}×{s.height}
                      {tour.startSceneId === s.id ? " · inicial" : ""}
                    </span>
                  </span>
                </button>
                {!s.isPublished ? <Badge>Oculta</Badge> : null}
              </div>
              {canEdit ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <Button variant="ghost" size="sm" aria-label={`Subir ${s.name}`} disabled={i === 0 || reorder.pending} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Bajar ${s.name}`} disabled={i === tour.scenes.length - 1 || reorder.pending} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={tour.startSceneId === s.id || settings.pending} onClick={() => settings.run(tour.id, { startSceneId: s.id })}>
                    Inicial
                  </Button>
                  <Button variant="ghost" size="sm" disabled={update.pending} onClick={() => update.run(s.id, { isPublished: !s.isPublished })}>
                    {s.isPublished ? "Ocultar" : "Publicar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    aria-label={`Borrar ${s.name}`}
                    disabled={remove.pending}
                    onClick={() => {
                      if (window.confirm(`¿Borrar «${s.name}»? También se borran sus puntos y los que llevan a esta escena.`)) void remove.run(s.id);
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-stone">Todavía no hay escenas.</p>
      )}
      {error ? (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function toTourScene(s: EditorScene): TourScene | null {
  if (!s.panoramaUrl) return null;
  return { id: s.id, slug: s.slug, name: s.name, panoramaUrl: s.panoramaUrl, previewUrl: s.previewUrl, thumbnailUrl: s.thumbnailUrl, width: s.width, height: s.height, initialYaw: s.initialYaw, initialPitch: s.initialPitch, plan: s.plan, hotspots: s.hotspots };
}

function SceneWorkspace({ tour, scene, canEdit }: { tour: Tour; scene: EditorScene; canEdit: boolean }) {
  const uid = useId();
  const viewer = useRef<ViewerHandle>(null);
  const tourScene = useMemo(() => toTourScene(scene), [scene]);
  const sceneNames = useMemo(() => Object.fromEntries(tour.scenes.map((s) => [s.id, s.name])), [tour.scenes]);
  const [selectedHotspot, setSelectedHotspot] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    mq.addEventListener("change", sync);
    sync();
    return () => mq.removeEventListener("change", sync);
  }, []);
  const initial = useAction(updateSceneAction);
  const rename = useAction(updateSceneAction);
  const [name, setName] = useState(scene.name);
  const current = () => viewer.current?.getPosition() ?? null;
  const editing = scene.hotspots.find((h) => h.id === selectedHotspot) ?? null;

  return (
    <Card title={`Escena: ${scene.name}`}>
      <div className="flex flex-col gap-4">
        <div className="relative aspect-[16/9] overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-ink)]">
          {tourScene && !viewerError ? (
            <PanoramaViewer
              ref={viewer}
              scene={tourScene}
              label={`Vista 360° de ${scene.name} (editor)`}
              reducedMotion={reduced}
              keyboardEnabled
              sceneNames={sceneNames}
              selectedHotspotId={selectedHotspot}
              onHotspot={(h) => setSelectedHotspot(h.id)}
              onError={(_s, kind) => setViewerError(kind === "webgl" ? "Este navegador no puede mostrar la vista 360° (WebGL no disponible)." : "No se pudo cargar la panorámica.")}
            />
          ) : (
            <div className="grid h-full place-items-center p-4 text-center text-sm text-paper/80">{viewerError ?? "La panorámica no se puede servir (revisá el almacenamiento)."}</div>
          )}
          <Crosshair aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20 size-8 -translate-x-1/2 -translate-y-1/2 text-paper/90 drop-shadow" strokeWidth={1.25} />
        </div>
        <p className="text-xs text-stone">Arrastrá la vista para apuntar: la cruz marca dónde se ubican los puntos nuevos. Hacé clic en un punto para editarlo.</p>

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Nombre" htmlFor={`${uid}-name`} className="min-w-48 flex-1">
              <Input id={`${uid}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button variant="secondary" size="sm" disabled={rename.pending || name.trim() === scene.name} onClick={() => rename.run(scene.id, { name })}>
              Guardar nombre
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={initial.pending}
              onClick={() => {
                const p = current();
                if (p) void initial.run(scene.id, { initialYaw: p.yaw, initialPitch: p.pitch });
              }}
            >
              Usar vista actual como vista inicial
            </Button>
            <span className="text-xs text-stone">
              Inicial: {deg(scene.initialYaw)} / {deg(scene.initialPitch)}
            </span>
          </div>
        ) : null}
        {initial.ok ? <Alert tone="success">Vista inicial guardada.</Alert> : null}
        {[initial.error, rename.error].filter(Boolean).map((e) => (
          <Alert key={e} tone="danger">
            {e}
          </Alert>
        ))}

        {canEdit ? <HotspotForm key={`${editing?.id ?? "nuevo"}-${tour.scenes.length}`} tour={tour} scene={scene} hotspot={editing} getPosition={current} onDone={() => setSelectedHotspot(null)} /> : null}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Puntos de esta escena</h3>
          {scene.hotspots.length ? (
            <ul className="flex flex-col divide-y divide-line text-sm">
              {scene.hotspots.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{h.label}</span>{" "}
                    <span className="text-stone">
                      · {h.kind === "scene" ? `lleva a ${sceneNames[h.targetSceneId ?? ""] ?? "—"}` : h.kind === "info" ? "información" : "contacto"} · {deg(h.yaw)} / {deg(h.pitch)}
                    </span>
                  </span>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedHotspot(h.id)} aria-pressed={selectedHotspot === h.id}>
                      Editar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Sin puntos todavía.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function HotspotForm({ tour, scene, hotspot, getPosition, onDone }: { tour: Tour; scene: EditorScene; hotspot: Hotspot | null; getPosition: () => { yaw: number; pitch: number } | null; onDone: () => void }) {
  const uid = useId();
  const others = tour.scenes.filter((s) => s.id !== scene.id);
  const [kind, setKind] = useState<TourHotspotKind>(hotspot?.kind ?? (others.length ? "scene" : "info"));
  const [target, setTarget] = useState(hotspot?.targetSceneId ?? others[0]?.id ?? "");
  const [label, setLabel] = useState(hotspot?.label ?? "");
  const [content, setContent] = useState(hotspot?.content ?? "");
  const add = useAction(addHotspotAction);
  const update = useAction(updateHotspotAction);
  const remove = useAction(deleteHotspotAction);
  const suggested = kind === "scene" ? `Ir a ${others.find((o) => o.id === target)?.name.toLowerCase() ?? ""}`.trim() : "";
  const payload = (pos: { yaw: number; pitch: number }) => ({ kind, targetSceneId: kind === "scene" ? target : null, label: label.trim() || suggested, content: kind === "scene" ? null : content, yaw: pos.yaw, pitch: pos.pitch });
  const fieldErrors = add.fieldErrors ?? update.fieldErrors;
  const fe = (k: string) => fieldErrors?.[`input.${k}`] ?? fieldErrors?.[k];
  const error = add.error ?? update.error ?? remove.error;
  const noPos = "Esperá a que cargue la vista para ubicar el punto.";
  const [posError, setPosError] = useState<string | null>(null);

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-line bg-paper p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPosError(null);
        if (hotspot) {
          await update.run(hotspot.id, payload({ yaw: hotspot.yaw, pitch: hotspot.pitch }));
          return;
        }
        const pos = getPosition();
        if (!pos) return setPosError(noPos);
        const r = await add.run(scene.id, payload(pos));
        if (r.ok) {
          setLabel("");
          setContent("");
        }
      }}
    >
      <p className="text-sm font-semibold">{hotspot ? `Editar punto «${hotspot.label}»` : "+ Hotspot en el centro de la vista"}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Tipo" htmlFor={`${uid}-kind`}>
          <Select id={`${uid}-kind`} value={kind} onChange={(e) => setKind(e.target.value as TourHotspotKind)}>
            {(Object.keys(KIND_LABEL) as TourHotspotKind[]).map((k) => (
              <option key={k} value={k} disabled={k === "scene" && !others.length}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {kind === "scene" ? (
          <Field label="Destino" htmlFor={`${uid}-target`} error={fe("targetSceneId")}>
            <Select id={`${uid}-target`} value={target} onChange={(e) => setTarget(e.target.value)}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.isPublished ? "" : " (oculta)"}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Texto del punto" htmlFor={`${uid}-label`} error={fe("label")} hint={suggested && !label ? `Si lo dejás vacío: «${suggested}»` : undefined}>
          <Input id={`${uid}-label`} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
      </div>
      {kind !== "scene" ? (
        <Field label={kind === "info" ? "Texto de la tarjeta" : "Texto (opcional)"} htmlFor={`${uid}-content`} error={fe("content")}>
          <Textarea id={`${uid}-content`} rows={2} maxLength={600} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
      ) : null}
      {posError ? <Alert tone="warning">{posError}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={add.pending || update.pending}>
          {hotspot ? (update.pending ? "Guardando…" : "Guardar punto") : add.pending ? "Agregando…" : "Agregar en el centro de la vista"}
        </Button>
        {hotspot ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={update.pending}
              onClick={async () => {
                const pos = getPosition();
                if (!pos) return setPosError(noPos);
                await update.run(hotspot.id, payload(pos));
              }}
            >
              Mover al centro de la vista
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              disabled={remove.pending}
              onClick={async () => {
                if (!window.confirm(`¿Borrar el punto «${hotspot.label}»?`)) return;
                const r = await remove.run(hotspot.id);
                if (r.ok) onDone();
              }}
            >
              Borrar
            </Button>
            <Button variant="ghost" size="sm" onClick={onDone}>
              Cancelar
            </Button>
          </>
        ) : null}
      </div>
    </form>
  );
}

function FloorPlanEditor({ propertyId, tour, selected, canEdit, storageOk, isDemo }: { propertyId: string; tour: Tour; selected: EditorScene | null; canEdit: boolean; storageOk: boolean; isDemo: boolean }) {
  const uid = useId();
  const router = useRouter();
  const place = useAction(updateSceneAction);
  const removePlan = useAction(removeFloorPlanAction);
  const [upload, setUpload] = useState<{ busy: boolean; error?: string }>({ busy: false });
  return (
    <Card title="Plano">
      <div className="flex flex-col gap-3">
        {tour.floorPlan ? (
          <>
            <p className="text-sm text-ink-2">{canEdit && selected ? `Hacé clic en el plano para ubicar «${selected.name}».` : "Ambientes ubicados en el plano."}</p>
            <div className="max-w-3xl">
              <FloorPlan
                plan={tour.floorPlan}
                scenes={tour.scenes}
                currentSceneId={selected?.id ?? null}
                isDemo={isDemo}
                tone="light"
                onPick={canEdit && selected ? (pt) => void place.run(selected.id, { plan: { x: Math.round(pt.x * 1000) / 1000, y: Math.round(pt.y * 1000) / 1000 } }) : undefined}
              />
            </div>
            {canEdit && selected?.plan ? (
              <Button variant="ghost" size="sm" className="self-start" onClick={() => place.run(selected.id, { plan: null })}>
                Quitar a «{selected.name}» del plano
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-stone">Sin plano. Con plano, el visitante ve «Estás aquí» y salta de ambiente tocándolo.</p>
        )}
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label={tour.floorPlan ? "Reemplazar plano" : "Subir plano"} htmlFor={`${uid}-plan`} hint="Imagen JPG, PNG o WebP (los SVG no se aceptan).">
              <input
                id={`${uid}-plan`}
                type="file"
                accept={ACCEPT}
                disabled={upload.busy || !storageOk}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUpload({ busy: true });
                  const r = await uploadTourFile(propertyId, f, { target: "floor_plan" });
                  setUpload(r.ok ? { busy: false } : { busy: false, error: r.error });
                  e.target.value = "";
                  if (r.ok) router.refresh();
                }}
                className="text-sm file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-ink file:px-3 file:py-2 file:text-sm file:font-semibold file:text-paper"
              />
            </Field>
            {tour.floorPlan ? (
              <Button variant="ghost" size="sm" disabled={removePlan.pending} onClick={() => window.confirm("¿Quitar el plano?") && removePlan.run(tour.id)}>
                Quitar plano
              </Button>
            ) : null}
          </div>
        ) : null}
        {upload.busy ? <p className="text-sm text-stone" role="status">Subiendo plano…</p> : null}
        {[upload.error, place.error, removePlan.error].filter(Boolean).map((e) => (
          <Alert key={e} tone="danger">
            {e}
          </Alert>
        ))}
      </div>
    </Card>
  );
}

function GuidedEditor({ tour, canEdit }: { tour: Tour; canEdit: boolean }) {
  const [ids, setIds] = useState<string[]>(tour.guidedSceneIds);
  const save = useAction(updateTourSettingsAction);
  const names = Object.fromEntries(tour.scenes.map((s) => [s.id, s.name]));
  const move = (i: number, d: number) => {
    const next = [...ids];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setIds(next);
  };
  const dirty = JSON.stringify(ids) !== JSON.stringify(tour.guidedSceneIds);
  return (
    <Card title="Recorrido guiado">
      <p className="mb-3 text-sm text-ink-2">Orden de «Recorrido guiado» (Anterior / Siguiente). Sin escenas elegidas, se usa el orden de la lista.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone">Incluir</legend>
          {tour.scenes.map((s) => (
            <Checkbox key={s.id} label={s.name} checked={ids.includes(s.id)} disabled={!canEdit} onChange={(e) => setIds(e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id))} />
          ))}
        </fieldset>
        <ol className="flex flex-col gap-1 text-sm" aria-label="Orden del recorrido">
          {ids.map((id, i) => (
            <li key={id} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-line bg-white px-2 py-1">
              <span>
                <span className="tabular mr-2 text-stone">{i + 1}.</span>
                {names[id] ?? "—"}
              </span>
              {canEdit ? (
                <span className="flex">
                  <Button variant="ghost" size="sm" aria-label={`Antes: ${names[id]}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Después: ${names[id]}`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      {save.error ? (
        <div className="mt-3">
          <Alert tone="danger">{save.error}</Alert>
        </div>
      ) : null}
      {canEdit ? (
        <Button size="sm" className="mt-3" disabled={!dirty || save.pending} onClick={() => save.run(tour.id, { guidedSceneIds: ids })}>
          {save.pending ? "Guardando…" : "Guardar recorrido"}
        </Button>
      ) : null}
    </Card>
  );
}
