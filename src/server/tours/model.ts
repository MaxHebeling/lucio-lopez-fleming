/**
 * Modelo puro de tours virtuales (sin base ni Next): tipos del DTO público, ángulos, URLs de tours externos, validación
 * del grafo antes de publicar, recorrido guiado y pestañas de medios de la ficha. Se usa en servidor y en el navegador
 * y se testea en tests/unit/tours-model.test.ts.
 *
 * Convención de ángulos (Photo Sphere Viewer): radianes; yaw 0 = centro de la imagen equirectangular, positivo hacia la
 * derecha, en (−π, π]; pitch positivo hacia arriba, en [−π/2, π/2].
 */

// ───────────────────────── Tipos públicos ─────────────────────────

export type TourHotspotKind = "scene" | "info" | "cta";
export type TourHotspot = { id: string; kind: TourHotspotKind; targetSceneId: string | null; label: string; content: string | null; yaw: number; pitch: number };
export type TourScene = {
  id: string;
  slug: string;
  name: string;
  panoramaUrl: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  initialYaw: number;
  initialPitch: number;
  plan: { x: number; y: number } | null;
  hotspots: TourHotspot[];
};
export type ExternalProvider = "matterport" | "kuula" | "3dvista" | "other";
export type PublicTour =
  | {
      kind: "internal";
      id: string;
      isDemo: boolean;
      coverUrl: string | null;
      floorPlan: { url: string; width: number; height: number } | null;
      startSceneId: string;
      guidedSceneIds: string[];
      scenes: TourScene[];
    }
  | { kind: "external"; id: string; isDemo: boolean; provider: ExternalProvider; coverUrl: string | null; display: ExternalDisplay };

// ───────────────────────── Ángulos ─────────────────────────

const TAU = Math.PI * 2;

/** Lleva cualquier yaw a (−π, π]. */
export function normalizeYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  let y = ((yaw % TAU) + TAU) % TAU; // [0, 2π)
  if (y > Math.PI) y -= TAU;
  return y === -Math.PI ? Math.PI : y;
}

/** Limita el pitch a [−π/2, π/2]. */
export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
}

export function isYawInRange(yaw: number): boolean {
  return Number.isFinite(yaw) && yaw > -Math.PI && yaw <= Math.PI;
}
export function isPitchInRange(pitch: number): boolean {
  return Number.isFinite(pitch) && pitch >= -Math.PI / 2 && pitch <= Math.PI / 2;
}

/** Equirectangular 2:1 con tolerancia (1 % por defecto). */
export function isEquirectangular(width: number, height: number, tolerance = 0.01): boolean {
  if (!(width > 0 && height > 0)) return false;
  return Math.abs(width / height - 2) <= 2 * tolerance;
}

// ───────────────────────── Tours externos ─────────────────────────

/**
 * Hosts que se pueden embeber en iframe, por proveedor. Solo https y host exacto (nada de sufijos: `kuula.co.evil.com`
 * no pasa). `other` nunca se embebe: se abre en pestaña nueva. Mantener en sincronía con la CSP (`frame-src`, next.config.ts).
 * - Matterport: https://my.matterport.com/show/?m=… (URL de "Share → Embed" oficial).
 * - Kuula: https://kuula.co/share/… (código de inserción oficial).
 * - 3DVista Cloud: https://storage.net-fs.com/hosting/… (dominio de hosting documentado por 3DVista).
 */
export const EMBED_HOSTS: Record<Exclude<ExternalProvider, "other">, readonly string[]> = {
  matterport: ["my.matterport.com"],
  kuula: ["kuula.co"],
  "3dvista": ["storage.net-fs.com"],
};
export const ALL_EMBED_HOSTS: readonly string[] = Object.values(EMBED_HOSTS).flat();

export const PROVIDER_LABEL: Record<ExternalProvider, string> = { matterport: "Matterport", kuula: "Kuula", "3dvista": "3DVista", other: "Otro proveedor" };

/** URL https válida (sin credenciales, puerto estándar, host con punto). null si no. */
export function parseHttpsUrl(raw: string | null | undefined): URL | null {
  if (!raw || typeof raw !== "string" || raw.length > 2000 || /[\s"'<>]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!u.hostname.includes(".") || u.hostname.endsWith(".")) return null;
  return u;
}

export function isEmbeddableUrl(provider: ExternalProvider, raw: string | null | undefined): boolean {
  if (provider === "other") return false;
  const u = parseHttpsUrl(raw);
  return Boolean(u && EMBED_HOSTS[provider].includes(u.hostname.toLowerCase()));
}

export type ExternalDisplay = { mode: "embed"; src: string; href: string } | { mode: "link"; href: string };

/**
 * Cómo se muestra un tour externo: iframe solo si la URL de inserción (o, sin ella, la pública) es https y su host está
 * en la lista del proveedor; si no, enlace a pestaña nueva con la URL pública. null si ninguna URL es https válida.
 */
export function externalTourDisplay(provider: ExternalProvider, externalUrl: string | null, embedUrl: string | null): ExternalDisplay | null {
  const href = parseHttpsUrl(externalUrl)?.toString() ?? null;
  const candidate = embedUrl ?? externalUrl;
  if (href && isEmbeddableUrl(provider, candidate)) return { mode: "embed", src: parseHttpsUrl(candidate)!.toString(), href };
  return href ? { mode: "link", href } : null;
}

// ───────────────────────── Validación para publicar ─────────────────────────

export type GraphScene = { id: string; name: string; isPublished: boolean; hotspots: Array<{ kind: TourHotspotKind; targetSceneId: string | null; label: string }> };
export type GraphTour = { kind: "internal" | "external"; provider?: ExternalProvider | null; externalUrl?: string | null; embedUrl?: string | null; startSceneId: string | null; guidedSceneIds: string[]; scenes: GraphScene[] };

/** Qué impide publicar un tour (vacío = publicable). Mensajes para el equipo. */
export function tourPublishBlockers(t: GraphTour): string[] {
  if (t.kind === "external") {
    const blockers: string[] = [];
    if (!t.provider) blockers.push("Elegí el proveedor del tour externo");
    if (!parseHttpsUrl(t.externalUrl)) blockers.push("La URL del tour tiene que empezar con https://");
    if (t.embedUrl && !parseHttpsUrl(t.embedUrl)) blockers.push("La URL de inserción tiene que empezar con https://");
    return blockers;
  }
  const blockers: string[] = [];
  const byId = new Map(t.scenes.map((s) => [s.id, s]));
  const published = t.scenes.filter((s) => s.isPublished);
  if (!published.length) blockers.push("Falta al menos una escena publicada");
  if (!t.startSceneId || !byId.has(t.startSceneId)) blockers.push("Elegí la escena inicial");
  else if (!byId.get(t.startSceneId)!.isPublished) blockers.push("La escena inicial está oculta");
  for (const s of published) {
    for (const h of s.hotspots) {
      if (h.kind !== "scene") continue;
      const target = h.targetSceneId ? byId.get(h.targetSceneId) : undefined;
      if (!target) blockers.push(`«${s.name}»: el punto «${h.label}» no tiene un destino válido`);
      else if (!target.isPublished) blockers.push(`«${s.name}»: el punto «${h.label}» lleva a «${target.name}», que está oculta`);
    }
  }
  for (const id of t.guidedSceneIds) {
    const s = byId.get(id);
    if (!s) blockers.push("El recorrido guiado incluye una escena que ya no existe");
    else if (!s.isPublished) blockers.push(`El recorrido guiado incluye «${s.name}», que está oculta`);
  }
  return [...new Set(blockers)];
}

// ───────────────────────── Recorrido guiado ─────────────────────────

/** Secuencia guiada efectiva: solo escenas presentes (publicadas en el DTO), sin repetidas. Sin secuencia: el orden de las escenas. */
export function guidedSequence(guidedSceneIds: string[], scenes: Array<{ id: string }>): string[] {
  const present = new Set(scenes.map((s) => s.id));
  const seq = [...new Set(guidedSceneIds.filter((id) => present.has(id)))];
  return seq.length ? seq : scenes.map((s) => s.id);
}

export type GuidedState = { index: number; total: number; sceneId: string; hasPrev: boolean; hasNext: boolean; label: string };

/** Estado del paso `index` (se limita al rango). */
export function guidedStep(sequence: string[], index: number): GuidedState | null {
  if (!sequence.length) return null;
  const i = Math.max(0, Math.min(sequence.length - 1, Math.trunc(index)));
  return { index: i, total: sequence.length, sceneId: sequence[i]!, hasPrev: i > 0, hasNext: i < sequence.length - 1, label: `${i + 1} de ${sequence.length}` };
}

/** Índice donde arranca el guiado: la escena actual si forma parte de la secuencia; si no, el principio. */
export function guidedStartIndex(sequence: string[], currentSceneId: string | null): number {
  const i = currentSceneId ? sequence.indexOf(currentSceneId) : -1;
  return i >= 0 ? i : 0;
}

// ───────────────────────── Pestañas de medios de la ficha ─────────────────────────

export type MediaTabKey = "fotos" | "tour" | "plano" | "video";
export const MEDIA_TAB_LABEL: Record<MediaTabKey, string> = { fotos: "Fotos", tour: "Tour 360°", plano: "Plano", video: "Video" };

/**
 * Pestañas visibles. Regla de compatibilidad: sin tour disponible (flag apagado o sin tour publicado) NO hay barra de
 * pestañas y la ficha queda exactamente como antes (devuelve []). Con tour: fotos (si hay), tour, plano (planos cargados
 * o plano del tour) y video (si hay), en ese orden.
 */
export function mediaTabs(input: { flagEnabled: boolean; hasTour: boolean; photoCount: number; floorPlanCount: number; tourHasFloorPlan: boolean; videoCount: number }): MediaTabKey[] {
  if (!input.flagEnabled || !input.hasTour) return [];
  const tabs: MediaTabKey[] = [];
  if (input.photoCount > 0) tabs.push("fotos");
  tabs.push("tour");
  if (input.floorPlanCount > 0 || input.tourHasFloorPlan) tabs.push("plano");
  if (input.videoCount > 0) tabs.push("video");
  return tabs;
}
