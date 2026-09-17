/**
 * Analítica first-party del tour (cliente). `track()` nunca rompe la UI: sin soporte, con Do Not Track / Global Privacy
 * Control, sin tour publicado o si el envío falla, simplemente no se registra. Sin cookies: la clave de sesión es
 * aleatoria por pestaña (sessionStorage) y no se asocia a nada más. Endpoint: POST /api/site/events.
 */
export type TourEventName =
  | "virtual_tour_opened"
  | "virtual_tour_scene_viewed"
  | "virtual_tour_hotspot_clicked"
  | "virtual_tour_floorplan_opened"
  | "virtual_tour_guided_started"
  | "virtual_tour_cta_clicked"
  | "virtual_tour_closed";

export type TrackPayload = { tourId: string; sceneSlug?: string; hotspotId?: string; props?: Record<string, string | number | boolean> };

const KEY = "llf.tour.session";
let memoryKey: string | null = null;
/** Tras un fallo del envío se deja de intentar en esta página (no se reintenta en bucle ni se ensucia la consola). */
let disabled = false;

function randomKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

function sessionKey(): string {
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const k = randomKey();
    window.sessionStorage.setItem(KEY, k);
    return k;
  } catch {
    // sessionStorage bloqueado (modo privado estricto): clave en memoria de esta pestaña.
    memoryKey ??= randomKey();
    return memoryKey;
  }
}

export function privacySignal(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === "1" || n.doNotTrack === "yes" || w.doNotTrack === "1" || n.msDoNotTrack === "1";
}

export function track(name: TourEventName, payload: TrackPayload): void {
  try {
    if (disabled || typeof window === "undefined" || privacySignal()) return;
    const body = JSON.stringify({ name, sessionKey: sessionKey(), ...payload });
    if (body.length > 2048) return;
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/site/events", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/site/events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" }, credentials: "omit" }).catch(() => {
      disabled = true;
    });
  } catch {
    // La analítica nunca interrumpe la experiencia: se apaga para esta página.
    disabled = true;
  }
}
