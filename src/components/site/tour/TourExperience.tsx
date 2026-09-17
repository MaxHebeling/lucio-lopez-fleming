"use client";

/**
 * Capa inmersiva del tour (diálogo a pantalla completa). Se carga con import() al abrir el tour: nada de esto (ni PSV ni
 * three) está en el JS inicial de la ficha.
 *
 * Accesibilidad: role="dialog" + aria-modal, foco atrapado, Escape cierra (primero el panel abierto), «× Salir del tour»
 * siempre visible, "atrás" del navegador cierra (history.pushState), foco de vuelta al disparador (lo maneja quien abre).
 * Movimiento: entrada/salida cortas con opacity/transform; con prefers-reduced-motion, sin animaciones ni desenfoque.
 */
import "./tour.css";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Compass, ExternalLink, Info, LayoutGrid, Map as MapIcon, Maximize, MessageCircleQuestionMark, Minimize, Route, Smartphone, X } from "lucide-react";
import { guidedSequence, guidedStartIndex, guidedStep, PROVIDER_LABEL, type PublicTour, type TourHotspot, type TourScene } from "@/server/tours/model";
import { answerTourQuestion, withArticle, type GuideAnswer, type TourFact, type TourIntent } from "@/server/tours/guide";
import { pauseSmoothScroll, resumeSmoothScroll } from "@/components/experience/motion/smooth-scroll";
import { LeadForm } from "@/components/site/LeadForm";
import { ShareButton } from "@/components/site/property/ShareButton";
import { WhatsAppIcon } from "@/components/site/icons";
import { FloorPlan } from "./FloorPlan";
import { PanoramaViewer, type ViewerErrorKind, type ViewerHandle } from "./PanoramaViewer";
import { track, type TourEventName } from "./track";

export type TourContext = {
  tour: PublicTour;
  propertyTitle: string;
  propertyCode: number | null;
  operation?: string;
  shareUrl: string;
  whatsappUrl: string | null;
  isDemo: boolean;
  /** false en la vista previa del CRM: no se registran eventos. */
  analytics: boolean;
  entry: "cover" | "tab" | "direct";
  /** «Preguntá por esta casa» (flag `ai_tour_guide`): datos públicos de la ficha y si hay IA para interpretar preguntas. */
  guide?: TourGuideConfig | null;
};

export type TourGuideConfig = { ai: boolean; facts: TourFact[] };

type Props = TourContext & { onClose: () => void; onShowPhotos?: () => void };
type Panel = null | "plan" | "rooms" | "cta" | "info" | "guide";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/** Diálogo con foco atrapado, Escape, bloqueo de scroll y cierre con "atrás". */
function useDialog(onRequestClose: () => void, onEscape: () => boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const pushed = useRef(false);
  const closeRef = useRef(onRequestClose);
  const escRef = useRef(onEscape);
  useEffect(() => {
    closeRef.current = onRequestClose;
    escRef.current = onEscape;
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    pauseSmoothScroll();
    if (!pushed.current) {
      window.history.pushState({ ...(window.history.state ?? {}), llfTour: true }, "");
      pushed.current = true;
    }
    const onPop = () => {
      pushed.current = false;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (!escRef.current()) closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, iframe, [tabindex]:not([tabindex='-1'])")).filter(
        (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden",
      );
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      resumeSmoothScroll();
    };
  }, []);

  /** Cierre pedido por la UI: si agregamos una entrada al historial, se vuelve atrás (y eso cierra). */
  const requestClose = useCallback(() => {
    if (pushed.current && window.history.state?.llfTour) {
      window.history.back();
    } else {
      closeRef.current();
    }
  }, []);
  return { ref, requestClose };
}

function DemoBadge() {
  return <p className="tour-demo-badge">DEMO INTERACTIVA — PROPIEDAD FICTICIA</p>;
}

function ToolButton({ label, icon, onClick, pressed, className }: { label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; className?: string }) {
  return (
    <button type="button" className={`tour-tool ${className ?? ""}`} onClick={onClick} aria-pressed={pressed}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
  }, []);
  return (
    <section ref={ref} className={`tour-sheet ${wide ? "tour-sheet--wide" : ""}`} aria-labelledby={headingId}>
      <header className="tour-sheet-head">
        <h3 id={headingId}>{title}</h3>
        <button type="button" data-sheet-close className="tour-icon-btn" onClick={onClose} aria-label={`Cerrar: ${title}`}>
          <X aria-hidden className="size-5" />
        </button>
      </header>
      <div className="tour-sheet-body">{children}</div>
    </section>
  );
}

export default function TourExperience(props: Props) {
  if (props.tour.kind === "external") return <ExternalTour {...props} tour={props.tour} />;
  return <InternalTour {...props} tour={props.tour} />;
}

// ───────────────────────── Tour propio ─────────────────────────

function InternalTour({ tour, propertyTitle, propertyCode, operation, shareUrl, whatsappUrl, isDemo, analytics, entry, guide, onClose, onShowPhotos }: Props & { tour: Extract<PublicTour, { kind: "internal" }> }) {
  const reduced = useReducedMotion();
  const byId = useMemo(() => new Map(tour.scenes.map((s) => [s.id, s])), [tour.scenes]);
  const sceneNames = useMemo(() => Object.fromEntries(tour.scenes.map((s) => [s.id, s.name])), [tour.scenes]);
  const sequence = useMemo(() => guidedSequence(tour.guidedSceneIds, tour.scenes), [tour.guidedSceneIds, tour.scenes]);
  const [currentId, setCurrentId] = useState(tour.startSceneId);
  const [history, setHistory] = useState<string[]>([]);
  const [mode, setMode] = useState<"free" | "guided">("free");
  const [guidedIndex, setGuidedIndex] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [info, setInfo] = useState<TourHotspot | null>(null);
  const [error, setError] = useState<ViewerErrorKind | null>(null);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const [gyro, setGyro] = useState<"unsupported" | "off" | "on" | "denied">("unsupported");
  const [fullscreen, setFullscreen] = useState(false);
  // Este módulo solo se monta en el navegador (se carga al abrir el tour): se puede leer `document` al inicializar.
  const [canFullscreen, setCanFullscreen] = useState(() => typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function");
  const [announce, setAnnounce] = useState("");
  const viewer = useRef<ViewerHandle>(null);
  const openedAt = useRef(0);
  const viewed = useRef(new Set<string>());
  const scene = byId.get(currentId) ?? tour.scenes[0]!;
  const step = mode === "guided" ? guidedStep(sequence, guidedIndex) : null;

  const emit = useCallback(
    (name: TourEventName, extra: { sceneSlug?: string; hotspotId?: string; props?: Record<string, string | number | boolean> } = {}) => {
      if (analytics) track(name, { tourId: tour.id, ...extra });
    },
    [analytics, tour.id],
  );

  const finishClose = useCallback(() => {
    emit("virtual_tour_closed", { props: { durationMs: Date.now() - openedAt.current, scenesViewed: viewed.current.size } });
    viewer.current?.stopGyroscope();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => setFullscreen(false));
    if (reduced) onClose();
    else {
      setClosing(true);
      window.setTimeout(onClose, 240);
    }
  }, [emit, onClose, reduced]);

  const { ref: dialogRef, requestClose } = useDialog(finishClose, () => {
    if (panel) {
      setPanel(null);
      return true;
    }
    return false;
  });

  useEffect(() => {
    emit("virtual_tour_opened", { sceneSlug: scene.slug, props: { entry } });
    viewed.current.add(scene.id);
    emit("virtual_tour_scene_viewed", { sceneSlug: scene.slug, props: { source: "start" } });
    openedAt.current = Date.now();
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => document.removeEventListener("fullscreenchange", onFs);
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback(
    (id: string, source: "hotspot" | "bar" | "list" | "plan" | "guided" | "history") => {
      if (id === currentId || !byId.has(id)) return;
      if (source !== "history") setHistory((h) => [...h.slice(-30), currentId]);
      setCurrentId(id);
      setError(null);
      setInfo(null);
      if (source === "plan" || source === "list") setPanel(null);
      viewed.current.add(id);
      const target = byId.get(id)!;
      setAnnounce(`Ambiente: ${target.name}`);
      emit("virtual_tour_scene_viewed", { sceneSlug: target.slug, props: { source } });
      if (mode === "guided" && source !== "guided") {
        const i = sequence.indexOf(id);
        if (i >= 0) setGuidedIndex(i);
      }
    },
    [byId, currentId, emit, mode, sequence],
  );

  // Precarga SOLO de los destinos de la escena actual, en idle y respetando conexiones lentas / ahorro de datos.
  useEffect(() => {
    if (!shown) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const slow = Boolean(conn?.saveData || (conn?.effectiveType && /(^|-)2g|3g/.test(conn.effectiveType)));
    const targets = [...new Set(scene.hotspots.filter((h) => h.kind === "scene" && h.targetSceneId).map((h) => h.targetSceneId!))].map((id) => byId.get(id)).filter((s): s is TourScene => Boolean(s));
    const run = () => {
      for (const t of targets) {
        if (t.previewUrl) viewer.current?.preload(t.previewUrl);
        if (!slow) viewer.current?.preload(t.panoramaUrl);
      }
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const idle = w.requestIdleCallback(run, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(idle);
    }
    const t = window.setTimeout(run, 1200);
    return () => window.clearTimeout(t);
  }, [scene, shown, byId]);

  const onHotspot = useCallback(
    (h: TourHotspot) => {
      emit("virtual_tour_hotspot_clicked", { sceneSlug: scene.slug, hotspotId: h.id, props: { kind: h.kind } });
      if (h.kind === "scene" && h.targetSceneId) go(h.targetSceneId, "hotspot");
      else if (h.kind === "info") {
        setInfo(h);
        setPanel("info");
      } else {
        setPanel("cta");
      }
    },
    [emit, go, scene.slug],
  );

  // Guía: recorrido paso a paso por la transición existente (una escena por vez, esperando que se muestre cada una).
  const walk = useRef<string[]>([]);
  const walkedFrom = useRef<string | null>(null);
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  const startWalk = useCallback(
    (path: string[]) => {
      if (path.length < 2) return;
      walk.current = path.slice(2);
      walkedFrom.current = null;
      setPanel(null);
      go(path[1]!, "list");
    },
    [go],
  );

  const onShown = useCallback(
    (shownScene: TourScene) => {
      setShown(true);
      setError(null);
      // El visor avisa dos veces por escena (vista previa y completa): se avanza una sola vez por escena.
      if (!walk.current.length || walkedFrom.current === shownScene.id) return;
      walkedFrom.current = shownScene.id;
      const next = walk.current.shift()!;
      window.setTimeout(() => goRef.current(next, "list"), reduced ? 0 : 450);
    },
    [reduced],
  );

  useEffect(() => {
    if (!shown || gyro !== "unsupported") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let alive = true;
    viewer.current?.gyroscopeSupported().then((ok) => {
      if (alive && ok) setGyro("off");
    });
    return () => {
      alive = false;
    };
  }, [shown, gyro]);

  const startGuided = () => {
    const i = guidedStartIndex(sequence, currentId);
    setMode("guided");
    setGuidedIndex(i);
    setPanel(null);
    emit("virtual_tour_guided_started");
    if (sequence[i] && sequence[i] !== currentId) go(sequence[i]!, "guided");
    setAnnounce(`Recorrido guiado: ${i + 1} de ${sequence.length}`);
  };
  const guidedMove = (delta: number) => {
    const next = guidedStep(sequence, guidedIndex + delta);
    if (!next || next.index === guidedIndex) return;
    setGuidedIndex(next.index);
    go(next.sceneId, "guided");
  };

  const openPanel = (p: Exclude<Panel, null>) => {
    setPanel((cur) => (cur === p ? null : p));
    if (p === "plan" && panel !== "plan") emit("virtual_tour_floorplan_opened", { sceneSlug: scene.slug });
  };

  const openVisit = (source: "bar" | "hotspot") => {
    setPanel("cta");
    if (source === "bar") emit("virtual_tour_cta_clicked", { sceneSlug: scene.slug, props: { cta: "visit" } });
  };

  const toggleGyro = async () => {
    if (gyro === "on") {
      viewer.current?.stopGyroscope();
      setGyro("off");
      return;
    }
    const ok = await viewer.current?.startGyroscope();
    setGyro(ok ? "on" : "denied");
  };

  const toggleFullscreen = () => {
    const el = dialogRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => setFullscreen(false));
    else void el.requestFullscreen().catch(() => setCanFullscreen(false));
  };

  const previous = history.length ? byId.get(history[history.length - 1]!) : undefined;
  const backToPrevious = () => {
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    go(previous.id, "history");
  };

  const cta = (
    <div className="tour-cta">
      <p className="tour-cta-q">¿Te interesa esta propiedad?</p>
      <div className="tour-cta-actions">
        <button type="button" className="btn btn-primary tour-btn" onClick={() => openVisit("bar")}>
          Agendar visita
        </button>
        {whatsappUrl && !isDemo ? (
          <a
            className="btn tour-btn tour-btn-ghost"
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Consultar por WhatsApp"
            onClick={() => emit("virtual_tour_cta_clicked", { sceneSlug: scene.slug, props: { cta: "whatsapp" } })}
          >
            <WhatsAppIcon className="size-5" /> <span className="tour-hide-sm">Consultar por WhatsApp</span>
          </a>
        ) : null}
      </div>
    </div>
  );

  return createPortal(
    <div
      ref={dialogRef}
      className="tour-root"
      data-state={closing ? "closing" : shown || error ? "open" : "entering"}
      data-reduced={reduced || undefined}
      data-mode={mode}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="tour-dialog"
    >
      {tour.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- capa de transición: la misma portada ya cargada en la ficha
        <img className="tour-entry-cover" src={tour.coverUrl} alt="" aria-hidden="true" />
      ) : null}

      {error ? null : (
        <PanoramaViewer
          ref={viewer}
          scene={scene}
          label={`Vista 360° de ${scene.name}. Arrastrá o usá las flechas para mirar alrededor; + y − para acercar o alejar.`}
          reducedMotion={reduced}
          keyboardEnabled={panel === null}
          sceneNames={sceneNames}
          onHotspot={onHotspot}
          onShown={onShown}
          onError={(_s, kind) => setError(kind)}
        />
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <div className="tour-top">
        <div className="tour-title-block">
          <p className="tour-eyebrow">Tour 360° · {propertyTitle}</p>
          <h2 id="tour-title" className="tour-scene-name">
            {scene.name}
          </h2>
          {isDemo ? <DemoBadge /> : null}
        </div>
        <button type="button" data-autofocus className="tour-exit" onClick={requestClose}>
          <X aria-hidden className="size-5" /> Salir del tour
        </button>
      </div>

      <nav className="tour-tools" aria-label="Herramientas del tour">
        {tour.floorPlan ? <ToolButton label="Plano" icon={<MapIcon aria-hidden className="size-4" />} onClick={() => openPanel("plan")} pressed={panel === "plan"} /> : null}
        <ToolButton label="Ambientes" icon={<LayoutGrid aria-hidden className="size-4" />} onClick={() => openPanel("rooms")} pressed={panel === "rooms"} />
        {guide ? <ToolButton label="Preguntá" icon={<MessageCircleQuestionMark aria-hidden className="size-4" />} onClick={() => openPanel("guide")} pressed={panel === "guide"} /> : null}
        {sequence.length > 1 ? (
          mode === "guided" ? (
            <ToolButton label="Explorar libremente" icon={<Compass aria-hidden className="size-4" />} onClick={() => setMode("free")} />
          ) : (
            <ToolButton label="Recorrido guiado" icon={<Route aria-hidden className="size-4" />} onClick={startGuided} />
          )
        ) : null}
        {gyro !== "unsupported" ? (
          <ToolButton label={gyro === "on" ? "Dejar de mover con el teléfono" : gyro === "denied" ? "Movimiento no permitido" : "Mover con el teléfono"} icon={<Smartphone aria-hidden className="size-4" />} onClick={toggleGyro} pressed={gyro === "on"} />
        ) : null}
        {canFullscreen ? <ToolButton className="tour-hide-sm" label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"} icon={fullscreen ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />} onClick={toggleFullscreen} pressed={fullscreen} /> : null}
        <span className="tour-share">
          <ShareButton url={shareUrl} title={propertyTitle} />
        </span>
      </nav>

      {error ? (
        <div className="tour-fallback" role="alert">
          {error === "webgl" ? (
            <>
              <h3 className="tour-fallback-title">Tu navegador no puede mostrar la vista 360°.</h3>
              <p>Igual podés recorrer los ambientes en imágenes{tour.floorPlan ? " y ver el plano" : ""}.</p>
              <ul className="tour-fallback-grid" aria-label="Ambientes">
                {tour.scenes.map((s) => (
                  <li key={s.id}>
                    {s.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniatura ya optimizada (640×400)
                      <img src={s.thumbnailUrl} alt={`${s.name}: vista de frente`} width={640} height={400} loading="lazy" />
                    ) : null}
                    <span>{s.name}</span>
                  </li>
                ))}
              </ul>
              {tour.floorPlan ? <FloorPlan plan={tour.floorPlan} scenes={tour.scenes} currentSceneId={null} isDemo={isDemo} /> : null}
            </>
          ) : (
            <>
              <h3 className="tour-fallback-title">No pudimos cargar «{scene.name}».</h3>
              <p>Puede ser la conexión. Probá de nuevo o seguí por otro camino.</p>
            </>
          )}
          <div className="tour-fallback-actions">
            {error === "load" ? (
              <button type="button" className="btn btn-primary tour-btn" onClick={() => setError(null)}>
                Reintentar
              </button>
            ) : null}
            {error === "load" && previous ? (
              <button type="button" className="btn tour-btn tour-btn-ghost" onClick={backToPrevious}>
                <ArrowLeft aria-hidden className="size-4" /> Volver a {previous.name}
              </button>
            ) : null}
            {onShowPhotos ? (
              <button
                type="button"
                className="btn tour-btn tour-btn-ghost"
                onClick={() => {
                  onShowPhotos();
                  requestClose();
                }}
              >
                Ver fotos
              </button>
            ) : null}
            <button type="button" className="btn tour-btn tour-btn-ghost" onClick={requestClose}>
              Cerrar tour
            </button>
          </div>
        </div>
      ) : null}

      <div className="tour-bottom">
        {mode === "guided" && step ? (
          <div className="tour-guided" role="group" aria-label="Recorrido guiado">
            <button type="button" className="tour-icon-btn tour-icon-btn--label" onClick={() => guidedMove(-1)} disabled={!step.hasPrev}>
              <ArrowLeft aria-hidden className="size-4" /> Anterior
            </button>
            <p className="tour-guided-count" aria-live="polite">
              <span className="tabular">{step.label}</span> · {scene.name}
            </p>
            <button type="button" className="tour-icon-btn tour-icon-btn--label" onClick={() => guidedMove(1)} disabled={!step.hasNext}>
              Siguiente <ArrowRight aria-hidden className="size-4" />
            </button>
            <button type="button" className="tour-guided-exit" onClick={() => setMode("free")}>
              Salir del recorrido
            </button>
          </div>
        ) : null}
        <div className="tour-bottom-row">
          {cta}
          <nav className="tour-rooms" aria-label="Ambientes">
            <ul>
              {tour.scenes.map((s) => (
                <li key={s.id}>
                  <button type="button" className="tour-room" aria-current={s.id === scene.id ? "true" : undefined} onClick={() => go(s.id, "bar")}>
                    {s.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniatura 640×400 ya optimizada; next/image sumaría peticiones al optimizador por cada ambiente
                      <img src={s.thumbnailUrl} alt="" width={120} height={75} loading="lazy" decoding="async" />
                    ) : null}
                    <span>{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>

      {panel === "plan" && tour.floorPlan ? (
        <Sheet title="Plano" onClose={() => setPanel(null)} wide>
          <FloorPlan plan={tour.floorPlan} scenes={tour.scenes} currentSceneId={scene.id} isDemo={isDemo} onSelect={(id) => go(id, "plan")} />
        </Sheet>
      ) : null}
      {panel === "rooms" ? (
        <Sheet title="Ambientes" onClose={() => setPanel(null)}>
          <ol className="tour-room-list">
            {tour.scenes.map((s, i) => (
              <li key={s.id}>
                <button type="button" aria-current={s.id === scene.id ? "true" : undefined} onClick={() => go(s.id, "list")}>
                  <span className="tabular tour-room-n">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s.name}</span>
                  {s.id === scene.id ? <span className="tour-room-here">Estás aquí</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </Sheet>
      ) : null}
      {panel === "guide" && guide ? (
        <Sheet title="Preguntá por esta casa" onClose={() => setPanel(null)}>
          <TourGuidePanel
            tourId={tour.id}
            scenes={tour.scenes}
            currentSceneId={scene.id}
            guide={guide}
            onWalk={startWalk}
            onGo={(id) => go(id, "list")}
            onContact={() => openVisit("bar")}
          />
        </Sheet>
      ) : null}
      {panel === "info" && info ? (
        <Sheet title={info.label} onClose={() => setPanel(null)}>
          <p className="tour-info-text">
            <Info aria-hidden className="mr-2 inline size-4 align-[-2px] text-[#e7a29d]" />
            {info.content}
          </p>
        </Sheet>
      ) : null}
      {panel === "cta" ? (
        <Sheet title={isDemo ? "Así se agenda una visita" : "Agendar visita"} onClose={() => setPanel(null)} wide>
          {isDemo ? (
            <div className="tour-demo-cta">
              <p>
                Esta es una <strong>propiedad ficticia</strong>: acá no se envía ninguna consulta. En una propiedad real, este botón abre «Agendar visita» y tu pedido le llega
                directo al asesor a cargo, que te escribe para coordinar día y horario.
              </p>
              <div className="tour-fallback-actions">
                <Link href="/propiedades" className="btn btn-primary tour-btn" onClick={() => emit("virtual_tour_cta_clicked", { sceneSlug: scene.slug, props: { cta: "properties" } })}>
                  Ver propiedades reales
                </Link>
                <Link href="/contacto" className="btn tour-btn tour-btn-ghost" onClick={() => emit("virtual_tour_cta_clicked", { sceneSlug: scene.slug, props: { cta: "contact" } })}>
                  Contactanos
                </Link>
              </div>
            </div>
          ) : propertyCode ? (
            <div className="tour-form">
              <p className="tour-form-lead">Dejanos tus datos y el asesor te escribe para coordinar la visita.</p>
              <LeadForm kind="visit" propertyCode={propertyCode} operation={operation} compact submitLabel="Pedir visita" />
            </div>
          ) : null}
        </Sheet>
      ) : null}
    </div>,
    document.body,
  );
}

// ───────────────────────── Guía «Preguntá por esta casa» ─────────────────────────

/**
 * Pregunta libre → respuesta determinista (caminos entre escenas, puntos de información y datos públicos). Con IA
 * configurada y una pregunta no entendida, el servidor solo devuelve una intención que se valida contra el tour.
 */
function TourGuidePanel({ tourId, scenes, currentSceneId, guide, onWalk, onGo, onContact }: { tourId: string; scenes: TourScene[]; currentSceneId: string; guide: TourGuideConfig; onWalk: (path: string[]) => void; onGo: (id: string) => void; onContact: () => void }) {
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<GuideAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const suggestions = scenes.filter((s) => s.id !== currentSceneId).slice(-2).map((s) => `¿Dónde está ${withArticle(s.name)}?`);

  const ask = async (q: string) => {
    const text = q.trim().slice(0, 200);
    if (!text) return;
    let a = answerTourQuestion({ question: text, scenes, currentSceneId, facts: guide.facts });
    if (a.kind === "unknown" && guide.ai) {
      setAsking(true);
      try {
        const res = await fetch("/api/site/tour-guide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tourId, question: text }), credentials: "omit" });
        const body = (await res.json().catch(() => null)) as { intent?: TourIntent | null } | null;
        if (res.ok && body?.intent) a = answerTourQuestion({ question: text, scenes, currentSceneId, facts: guide.facts, intent: body.intent });
      } catch {
        // Sin conexión o IA no disponible: queda la respuesta determinista.
      } finally {
        setAsking(false);
      }
    }
    setAnswer(a);
  };

  return (
    <div className="tour-guide">
      <form
        className="tour-guide-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor={inputId} className="tour-guide-label">
          Preguntá por un ambiente o un dato
        </label>
        <div className="tour-guide-row">
          <input id={inputId} className="tour-guide-input" value={question} maxLength={200} autoComplete="off" placeholder="¿Dónde está el jardín?" onChange={(e) => setQuestion(e.target.value)} />
          <button type="submit" className="btn btn-primary tour-btn" disabled={asking || !question.trim()}>
            {asking ? "Pensando…" : "Preguntar"}
          </button>
        </div>
      </form>
      {!answer ? (
        <ul className="tour-guide-suggestions" aria-label="Ejemplos de preguntas">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(s);
                  void ask(s);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div role="status" aria-live="polite" className="tour-guide-answer">
        {answer ? (
          <>
            <p>{answer.text}</p>
            <div className="tour-guide-actions">
              {answer.kind === "route" ? (
                <button type="button" className="btn btn-primary tour-btn" onClick={() => onWalk(answer.path)}>
                  Ir {withArticle(answer.targetName, "a")}
                </button>
              ) : null}
              {answer.kind === "fact" && answer.sceneId && answer.sceneId !== currentSceneId && answer.sceneName ? (
                <button type="button" className="btn tour-btn tour-btn-ghost" onClick={() => onGo(answer.sceneId!)}>
                  Ver {withArticle(answer.sceneName)}
                </button>
              ) : null}
              {answer.kind === "not_registered" || answer.kind === "fact" ? (
                <button type="button" className="btn tour-btn tour-btn-ghost" onClick={onContact}>
                  Consultar al asesor
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      <p className="tour-guide-note">Las respuestas salen de los ambientes del tour y de los datos publicados en la ficha.</p>
    </div>
  );
}

// ───────────────────────── Tour externo ─────────────────────────

function ExternalTour({ tour, propertyTitle, shareUrl, analytics, entry, onClose }: Props & { tour: Extract<PublicTour, { kind: "external" }> }) {
  const reduced = useReducedMotion();
  const openedAt = useRef(0);
  const emit = useCallback((name: TourEventName, props?: Record<string, number | string>) => analytics && track(name, { tourId: tour.id, props }), [analytics, tour.id]);
  const finishClose = useCallback(() => {
    emit("virtual_tour_closed", { durationMs: Date.now() - openedAt.current });
    onClose();
  }, [emit, onClose]);
  const { ref, requestClose } = useDialog(finishClose, () => false);
  useEffect(() => {
    openedAt.current = Date.now();
    emit("virtual_tour_opened", { entry });
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const provider = PROVIDER_LABEL[tour.provider];
  return createPortal(
    <div ref={ref} className="tour-root tour-root--external" data-state="open" data-reduced={reduced || undefined} role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-top">
        <div className="tour-title-block">
          <p className="tour-eyebrow">Tour 360° · {provider}</p>
          <h2 id="tour-title" className="tour-scene-name">
            {propertyTitle}
          </h2>
        </div>
        <button type="button" data-autofocus className="tour-exit" onClick={requestClose}>
          <X aria-hidden className="size-5" /> Salir del tour
        </button>
      </div>
      {tour.display.mode === "embed" ? (
        <iframe
          className="tour-iframe"
          src={tour.display.src}
          title={`Tour virtual de ${propertyTitle} (${provider})`}
          allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
          loading="lazy"
        />
      ) : (
        <div className="tour-fallback">
          <h3 className="tour-fallback-title">Este tour se abre en el sitio de {provider}.</h3>
          <p>Por seguridad no lo mostramos dentro de nuestra página.</p>
        </div>
      )}
      <div className="tour-bottom">
        <div className="tour-fallback-actions">
          <a className="btn btn-primary tour-btn" href={tour.display.href} target="_blank" rel="noopener noreferrer">
            Abrir en {provider} <ExternalLink aria-hidden className="size-4" />
          </a>
          <span className="tour-share">
            <ShareButton url={shareUrl} title={propertyTitle} />
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
