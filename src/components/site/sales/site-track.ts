/**
 * Analítica first-party de señales de interés (cliente). Misma clave de sesión por pestaña que el tour
 * (sessionStorage `llf.tour.session`): aleatoria, sin cookies y sin vínculo con nadie hasta que la persona envía una
 * consulta. Con Do Not Track / Global Privacy Control no se envía nada. Nunca texto libre: solo categorías.
 */
export type SiteEventName = "property_viewed" | "property_gallery_opened" | "property_qa_asked" | "property_compared" | "concierge_searched" | "lead_form_opened";

const KEY = "llf.tour.session";
let memoryKey: string | null = null;
let disabled = false;

function randomKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

export function privacySignal(): boolean {
  if (typeof navigator === "undefined") return true;
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const w = window as Window & { doNotTrack?: string };
  return n.globalPrivacyControl === true || n.doNotTrack === "1" || n.doNotTrack === "yes" || w.doNotTrack === "1" || n.msDoNotTrack === "1";
}

/** Clave de la pestaña (null con señal de privacidad: no hay nada que vincular). */
export function siteSessionKey(): string | null {
  if (typeof window === "undefined" || privacySignal()) return null;
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const k = randomKey();
    window.sessionStorage.setItem(KEY, k);
    return k;
  } catch {
    memoryKey ??= randomKey();
    return memoryKey;
  }
}

export function trackSite(name: SiteEventName, payload: { propertyCode?: number; props?: Record<string, string | number | boolean> } = {}): void {
  try {
    if (disabled) return;
    const sessionKey = siteSessionKey();
    if (!sessionKey) return;
    const body = JSON.stringify({ name, sessionKey, ...payload });
    if (body.length > 2048) return;
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/site/events", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/site/events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" }, credentials: "omit" }).catch(() => {
      disabled = true;
    });
  } catch {
    disabled = true;
  }
}

// ───────── Concierge: última interpretación de la pestaña (solo filtros; el texto queda en esta pestaña) ─────────

export const CONCIERGE_KEY = "llf.concierge";

export type StoredConcierge = { text: string; href: string; response: unknown; at: number };

export function readConcierge(): StoredConcierge | null {
  try {
    const raw = window.sessionStorage.getItem(CONCIERGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredConcierge;
    return v && typeof v.href === "string" && typeof v.text === "string" ? v : null;
  } catch {
    return null;
  }
}

export function writeConcierge(v: StoredConcierge): void {
  try {
    window.sessionStorage.setItem(CONCIERGE_KEY, JSON.stringify(v));
  } catch {
    // Sin sessionStorage el concierge funciona igual; solo no se recuerda la interpretación.
  }
}

// ───────── Comparador: selección de la pestaña ─────────

export const COMPARE_KEY = "llf.compare";
export const COMPARE_EVENT = "llf:compare";
export const COMPARE_MAX = 3;
export type CompareItem = { code: number; label: string };

export function readCompare(): CompareItem[] {
  try {
    const raw = window.sessionStorage.getItem(COMPARE_KEY);
    const list = raw ? (JSON.parse(raw) as CompareItem[]) : [];
    return Array.isArray(list) ? list.filter((x) => Number.isInteger(x?.code) && typeof x.label === "string").slice(0, COMPARE_MAX) : [];
  } catch {
    return [];
  }
}

export function writeCompare(list: CompareItem[]): void {
  try {
    window.sessionStorage.setItem(COMPARE_KEY, JSON.stringify(list.slice(0, COMPARE_MAX)));
  } catch {
    // sin almacenamiento: la selección vive solo en esta página
  }
  window.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: list }));
}
