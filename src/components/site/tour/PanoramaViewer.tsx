"use client";

/**
 * Visor 360° sobre Photo Sphere Viewer 5 (WebGL/three). Este módulo SOLO se carga bajo demanda (import() al abrir el tour
 * o al editar en el CRM): nunca entra en el bundle inicial de una ficha.
 *
 * - Carga progresiva: primero el preview liviano (difuso) y enseguida la panorámica completa, sin mover la cámara.
 * - Transición entre escenas: fundido (≈420 ms) + leve desenfoque; con movimiento reducido, cambio directo.
 * - Hotspots: botones HTML reales (foco, Tab, aria-label) posicionados por el MarkersPlugin.
 * - Teclado: flechas giran, + / − acercan (lo maneja PSV); se desactiva mientras se escribe en un formulario o hay un
 *   panel abierto (prop `keyboardEnabled`).
 * - Errores (404, decodificación, sin WebGL) → `onError`: el contenedor muestra un fallback, nunca pantalla negra.
 */
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Viewer } from "@photo-sphere-viewer/core";
import type { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import type { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";
import type { TourHotspot, TourScene } from "@/server/tours/model";

export type ViewerErrorKind = "webgl" | "load";
export type ViewerHandle = {
  getPosition(): { yaw: number; pitch: number } | null;
  zoom(delta: number): void;
  /** Precarga en caché del visor (sin mostrar). */
  preload(url: string): void;
  gyroscopeSupported(): Promise<boolean>;
  startGyroscope(): Promise<boolean>;
  stopGyroscope(): void;
  retry(): void;
};

type Props = {
  scene: TourScene;
  label: string;
  reducedMotion: boolean;
  keyboardEnabled: boolean;
  /** Nombres de escenas para el aria-label de los puntos de navegación. */
  sceneNames: Record<string, string>;
  onHotspot?: (h: TourHotspot) => void;
  onShown?: (scene: TourScene, quality: "preview" | "full") => void;
  onError?: (scene: TourScene, kind: ViewerErrorKind) => void;
  selectedHotspotId?: string | null;
  className?: string;
};

const ICONS: Record<TourHotspot["kind"], string> = {
  scene: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 11v6M12 7.5v.01"/></svg>',
  cta: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
};

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

const isAbort = (e: unknown) => (e as Error | undefined)?.name === "AbortError";
const isFormField = (el: Element | null) => Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable));

function hotspotElement(h: TourHotspot, sceneNames: Record<string, string>, onClick: (h: TourHotspot) => void): HTMLElement {
  const wrap = document.createElement("div");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tour-hotspot-btn";
  btn.dataset.kind = h.kind;
  btn.dataset.hotspotId = h.id;
  const target = h.targetSceneId ? sceneNames[h.targetSceneId] : null;
  btn.setAttribute("aria-label", h.kind === "scene" ? `${h.label}${target && !h.label.toLowerCase().includes(target.toLowerCase()) ? ` (${target})` : ""}` : h.kind === "info" ? `Más información: ${h.label}` : h.label);
  const ring = document.createElement("span");
  ring.className = "tour-hotspot-ring";
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = ICONS[h.kind]; // SVG estático propio (sin datos de usuario)
  const label = document.createElement("span");
  label.className = "tour-hotspot-label";
  label.setAttribute("aria-hidden", "true");
  label.textContent = h.label;
  btn.append(ring, label);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick(h);
  });
  // Que un arrastre que empieza sobre el punto no lo "clickee" ni mueva la vista de golpe.
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  wrap.append(btn);
  return wrap;
}

export const PanoramaViewer = forwardRef<ViewerHandle, Props>(function PanoramaViewer(
  { scene, label, reducedMotion, keyboardEnabled, sceneNames, onHotspot, onShown, onError, selectedHotspotId, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const markersRef = useRef<MarkersPlugin | null>(null);
  const gyroRef = useRef<GyroscopePlugin | null>(null);
  const loaded = useRef(new Set<string>());
  const token = useRef(0);
  const [ready, setReady] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const cb = useRef({ onHotspot, onShown, onError, keyboardEnabled, reducedMotion, sceneNames });
  cb.current = { onHotspot, onShown, onError, keyboardEnabled, reducedMotion, sceneNames };
  const shownScene = useRef<string | null>(null);
  const everShown = useRef(false);
  const [retries, setRetries] = useState(0);

  // Crear el visor una sola vez (carga diferida de PSV y plugins).
  useEffect(() => {
    let cancelled = false;
    let viewer: Viewer | null = null;
    const container = containerRef.current;
    if (!container) return;
    if (!webglAvailable()) {
      cb.current.onError?.(scene, "webgl");
      return;
    }
    (async () => {
      const [core, markers, gyro] = await Promise.all([import("@photo-sphere-viewer/core"), import("@photo-sphere-viewer/markers-plugin"), import("@photo-sphere-viewer/gyroscope-plugin")]);
      if (cancelled) return;
      core.Cache.maxItems = 8;
      try {
        viewer = new core.Viewer({
          container,
          adapter: core.EquirectangularAdapter.withConfig({ useXmpData: false }),
          navbar: false,
          loadingTxt: "",
          defaultYaw: scene.initialYaw,
          defaultPitch: scene.initialPitch,
          defaultZoomLvl: 25,
          minFov: 35,
          maxFov: 95,
          moveInertia: !cb.current.reducedMotion,
          mousewheel: true,
          mousewheelCtrlKey: false,
          touchmoveTwoFingers: false,
          keyboard: "always",
          lang: { loadError: "", webglError: "" },
          plugins: [markers.MarkersPlugin.withConfig({ markers: [] }), gyro.GyroscopePlugin.withConfig({ touchmove: true, absolutePosition: false })],
        });
      } catch (e) {
        console.error("[tour] no se pudo crear el visor", e);
        cb.current.onError?.(scene, "webgl");
        return;
      }
      viewerRef.current = viewer;
      markersRef.current = viewer.getPlugin(markers.MarkersPlugin) as MarkersPlugin;
      gyroRef.current = viewer.getPlugin(gyro.GyroscopePlugin) as GyroscopePlugin;
      viewer.addEventListener("key-press", (e) => {
        if (!cb.current.keyboardEnabled || isFormField(document.activeElement)) e.preventDefault();
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
      viewerRef.current = null;
      markersRef.current = null;
      gyroRef.current = null;
      viewer?.destroy();
    };
    // El visor se crea una sola vez; la escena inicial la toma el efecto de abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mostrar la escena actual: preview → completa, con fundido.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    const my = ++token.current;
    const first = !everShown.current;
    const reduced = cb.current.reducedMotion;
    const fade = (speed: number) => (reduced || first ? false : { speed, rotation: false, effect: "fade" as const });
    const position = { yaw: scene.initialYaw, pitch: scene.initialPitch };
    const markers = markersRef.current;

    const setMarkers = () => {
      if (my !== token.current || !markers) return;
      markers.setMarkers(
        scene.hotspots.map((h) => ({
          id: h.id,
          position: { yaw: h.yaw, pitch: h.pitch },
          element: hotspotElement(h, cb.current.sceneNames, (hs) => cb.current.onHotspot?.(hs)),
          anchor: "center center",
          size: { width: 44, height: 44 },
          className: `tour-hotspot tour-hotspot--${h.kind}`,
          data: { kind: h.kind },
        })),
      );
    };

    // Misma escena ya visible (p. ej. el editor agregó un punto): solo se actualizan los marcadores.
    if (shownScene.current === scene.id) {
      setMarkers();
      return;
    }

    (async () => {
      setTransitioning(!reduced && !first);
      markers?.clearMarkers();
      const fullCached = loaded.current.has(scene.panoramaUrl);
      try {
        if (!fullCached && scene.previewUrl) {
          try {
            await viewer.setPanorama(scene.previewUrl, { position, transition: fade(420), showLoader: false });
            if (my !== token.current) return;
            shownScene.current = scene.id;
            everShown.current = true;
            setMarkers();
            setTransitioning(false);
            cb.current.onShown?.(scene, "preview");
          } catch (e) {
            if (isAbort(e) || my !== token.current) return;
            console.warn("[tour] preview no disponible; se carga la panorámica completa", scene.slug);
          }
        }
        const alreadyShown = shownScene.current === scene.id;
        await viewer.setPanorama(scene.panoramaUrl, { position: alreadyShown ? undefined : position, transition: alreadyShown ? (reduced ? false : { speed: 260, rotation: false, effect: "fade" }) : fade(420), showLoader: false });
        if (my !== token.current) return;
        loaded.current.add(scene.panoramaUrl);
        if (!alreadyShown) setMarkers();
        shownScene.current = scene.id;
        everShown.current = true;
        setTransitioning(false);
        cb.current.onShown?.(scene, "full");
      } catch (e) {
        if (isAbort(e) || my !== token.current) return;
        setTransitioning(false);
        shownScene.current = null;
        cb.current.onError?.(scene, "load");
      }
    })();
  }, [ready, scene, retries]);

  // Punto seleccionado (editor): se resalta sin recrear los marcadores.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>(".tour-hotspot-btn").forEach((b) => b.toggleAttribute("data-selected", b.dataset.hotspotId === selectedHotspotId));
  });

  useImperativeHandle(
    ref,
    () => ({
      getPosition() {
        const v = viewerRef.current;
        if (!v) return null;
        const p = v.getPosition();
        return { yaw: p.yaw, pitch: p.pitch };
      },
      zoom(delta) {
        const v = viewerRef.current;
        if (v) v.zoom(Math.max(0, Math.min(100, v.getZoomLevel() + delta)));
      },
      preload(url) {
        const v = viewerRef.current;
        if (!v || loaded.current.has(url)) return;
        v.textureLoader.loadFile(url, undefined, url).then(
          () => loaded.current.add(url),
          (e: unknown) => {
            if (!isAbort(e)) console.warn("[tour] precarga fallida", url);
          },
        );
      },
      async gyroscopeSupported() {
        const g = gyroRef.current;
        return g ? g.isSupported() : false;
      },
      async startGyroscope() {
        const g = gyroRef.current;
        if (!g) return false;
        try {
          await g.start();
          return g.isEnabled();
        } catch (e) {
          console.info("[tour] giroscopio no disponible o permiso denegado", e);
          return false;
        }
      },
      stopGyroscope() {
        gyroRef.current?.stop();
      },
      retry() {
        setRetries((n) => n + 1);
      },
    }),
    [],
  );

  return <div ref={containerRef} className={`tour-viewer ${transitioning ? "is-transitioning" : ""} ${className ?? ""}`} role="region" aria-roledescription="vista 360°" aria-label={label} />;
});
