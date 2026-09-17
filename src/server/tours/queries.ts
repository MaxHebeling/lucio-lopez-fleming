/**
 * Lecturas de tours. Públicas: solo tours publicados de propiedades publicadas (o la demo), solo escenas publicadas y
 * solo puntos cuyo destino sigue visible; columnas explícitas. CRM: editor completo con permiso.
 */
import "server-only";
import { sql, type Database, type Executor } from "../db";
import { can, requirePermission, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { isEnabled } from "../flags";
import { publicMediaUrl as publicPropertyMediaUrl } from "../properties/public";
import { externalTourDisplay, tourPublishBlockers, type ExternalProvider, type PublicTour, type TourScene } from "./model";
import { publicFileUrl, tourStorageStatus } from "./media";
import { loadTourGraph } from "./service";
import { DEMO_PROPERTY_SLUG } from "./demo-constants";

type FileRef = { id: string | null; storage_driver: string | null; storage_key: string | null; visibility: string | null };
const fileJson = (col: string) => sql<FileRef | null>`(select jsonb_build_object('id', f.id, 'storage_driver', f.storage_driver, 'storage_key', f.storage_key, 'visibility', f.visibility)
  from files f where f.id = ${sql.ref(col)} and f.deleted_at is null)`;

type SceneRow = {
  id: string;
  tour_id: string;
  slug: string;
  name: string;
  panorama_url: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  panorama_file: FileRef | null;
  preview_file: FileRef | null;
  thumbnail_file: FileRef | null;
  width: number;
  height: number;
  initial_yaw: number;
  initial_pitch: number;
  sort_order: number;
  is_published: boolean;
  plan_x: number | null;
  plan_y: number | null;
};

type TourRow = {
  id: string;
  property_id: string;
  kind: string;
  status: string;
  provider: string | null;
  external_url: string | null;
  embed_url: string | null;
  cover_url: string | null;
  cover_file: FileRef | null;
  floor_plan_url: string | null;
  floor_plan_file: FileRef | null;
  floor_plan_width: number | null;
  floor_plan_height: number | null;
  start_scene_id: string | null;
  guided_scene_ids: string[];
  is_demo: boolean;
  published_at: Date | null;
  updated_at: Date;
};

const assetUrl = (url: string | null, file: FileRef | null) => url ?? publicFileUrl(file);

async function loadTourRow(db: Executor, where: ReturnType<typeof sql>): Promise<TourRow | undefined> {
  const r = await sql<TourRow>`
    select t.id, t.property_id, t.kind, t.status, t.provider, t.external_url, t.embed_url, t.cover_url, ${fileJson("t.cover_file_id")} as cover_file,
      t.floor_plan_url, ${fileJson("t.floor_plan_file_id")} as floor_plan_file, t.floor_plan_width, t.floor_plan_height,
      t.start_scene_id, t.guided_scene_ids, t.is_demo, t.published_at, t.updated_at
    from virtual_tours t join properties p on p.id = t.property_id
    where ${where}`.execute(db);
  return r.rows[0];
}

async function loadScenes(db: Executor, tourId: string, onlyPublished: boolean) {
  const scenes = await sql<SceneRow>`
    select s.id, s.tour_id, s.slug, s.name, s.panorama_url, s.preview_url, s.thumbnail_url,
      ${fileJson("s.panorama_file_id")} as panorama_file, ${fileJson("s.preview_file_id")} as preview_file, ${fileJson("s.thumbnail_file_id")} as thumbnail_file,
      s.width, s.height, s.initial_yaw, s.initial_pitch, s.sort_order, s.is_published, s.plan_x, s.plan_y
    from virtual_tour_scenes s
    where s.tour_id = ${tourId} ${onlyPublished ? sql`and s.is_published` : sql``}
    order by s.sort_order, s.created_at`.execute(db);
  const ids = scenes.rows.map((s) => s.id);
  const hotspots = ids.length
    ? await db
        .selectFrom("virtual_tour_hotspots")
        .select(["id", "scene_id", "kind", "target_scene_id", "label", "content", "yaw", "pitch", "sort_order"])
        .where("scene_id", "in", ids)
        .orderBy("sort_order")
        .orderBy("created_at")
        .execute()
    : [];
  return { scenes: scenes.rows, hotspots };
}

function toPublicScenes(rows: SceneRow[], hotspots: Awaited<ReturnType<typeof loadScenes>>["hotspots"]): TourScene[] {
  const visible = new Set(rows.map((s) => s.id));
  const out: TourScene[] = [];
  for (const s of rows) {
    const panoramaUrl = assetUrl(s.panorama_url, s.panorama_file);
    if (!panoramaUrl) continue; // sin archivo servible (storage sin URL pública): la escena no se ofrece
    out.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      panoramaUrl,
      previewUrl: assetUrl(s.preview_url, s.preview_file),
      thumbnailUrl: assetUrl(s.thumbnail_url, s.thumbnail_file),
      width: s.width,
      height: s.height,
      initialYaw: s.initial_yaw,
      initialPitch: s.initial_pitch,
      plan: s.plan_x !== null && s.plan_y !== null ? { x: s.plan_x, y: s.plan_y } : null,
      hotspots: hotspots
        .filter((h) => h.scene_id === s.id && (h.kind !== "scene" || (h.target_scene_id && visible.has(h.target_scene_id))))
        .map((h) => ({ id: h.id, kind: h.kind as "scene" | "info" | "cta", targetSceneId: h.target_scene_id, label: h.label, content: h.content, yaw: h.yaw, pitch: h.pitch })),
    });
  }
  // Un punto que lleva a una escena sin archivo servible tampoco se ofrece.
  const served = new Set(out.map((s) => s.id));
  for (const s of out) s.hotspots = s.hotspots.filter((h) => h.kind !== "scene" || served.has(h.targetSceneId!));
  return out;
}

/** Arma el DTO público de un tour ya leído. null si no hay nada mostrable. */
async function buildPublicTour(db: Executor, t: TourRow, opts: { drafts: boolean }): Promise<PublicTour | null> {
  const coverUrl = assetUrl(t.cover_url, t.cover_file);
  if (t.kind === "external") {
    const display = externalTourDisplay(t.provider as ExternalProvider, t.external_url, t.embed_url);
    return display ? { kind: "external", id: t.id, isDemo: t.is_demo, provider: t.provider as ExternalProvider, coverUrl, display } : null;
  }
  const { scenes: rows, hotspots } = await loadScenes(db, t.id, !opts.drafts);
  const scenes = toPublicScenes(rows, hotspots);
  if (!scenes.length) return null;
  const start = scenes.find((s) => s.id === t.start_scene_id) ?? scenes[0]!;
  const planUrl = assetUrl(t.floor_plan_url, t.floor_plan_file);
  return {
    kind: "internal",
    id: t.id,
    isDemo: t.is_demo,
    coverUrl,
    floorPlan: planUrl && t.floor_plan_width && t.floor_plan_height ? { url: planUrl, width: t.floor_plan_width, height: t.floor_plan_height } : null,
    startSceneId: start.id,
    guidedSceneIds: t.guided_scene_ids.filter((id) => scenes.some((s) => s.id === id)),
    scenes,
  };
}

export type PublicPropertyMediaExtras = {
  tour: PublicTour | null;
  floorPlans: Array<{ url: string; width: number | null; height: number | null; alt: string }>;
  videos: Array<{ url: string }>;
};

/**
 * Tour publicado + planos y videos de una propiedad publicada (no demo), por código. Sin actor: datos públicos.
 * Tour: solo si está publicado. Planos/videos: media no borrada ni fallida con URL pública.
 */
export async function getPublicPropertyMediaExtras(db: Executor, code: number): Promise<PublicPropertyMediaExtras> {
  const empty: PublicPropertyMediaExtras = { tour: null, floorPlans: [], videos: [] };
  const p = await db.selectFrom("properties").select(["id", "title"]).where("code", "=", code).where("is_published", "=", true).where("is_demo", "=", false).where("deleted_at", "is", null).executeTakeFirst();
  if (!p) return empty;
  const t = await loadTourRow(db, sql`t.property_id = ${p.id} and t.status = 'published' and p.is_published and not p.is_demo and p.deleted_at is null`);
  const media = await sql<{ kind: string; source_url: string | null; storage_driver: string | null; storage_key: string | null; visibility: string | null; width: number | null; height: number | null; alt_text: string | null }>`
    select m.kind, m.source_url, f.storage_driver, f.storage_key, f.visibility, coalesce(m.width, f.width) as width, coalesce(m.height, f.height) as height, m.alt_text
    from property_media m left join files f on f.id = m.file_id and f.deleted_at is null
    where m.property_id = ${p.id} and m.deleted_at is null and m.kind in ('floor_plan', 'video') and m.status <> 'failed'
    order by m.sort_order, m.created_at`.execute(db);
  const plans = media.rows.filter((m) => m.kind === "floor_plan");
  return {
    tour: t ? await buildPublicTour(db, t, { drafts: false }) : null,
    floorPlans: plans.flatMap((m, i) => {
      const url = publicPropertyMediaUrl(m);
      return url ? [{ url, width: m.width, height: m.height, alt: m.alt_text?.trim() || `Plano ${plans.length > 1 ? `${i + 1} ` : ""}de la propiedad` }] : [];
    }),
    videos: media.rows.filter((m) => m.kind === "video").flatMap((m) => {
      const url = publicPropertyMediaUrl(m);
      return url ? [{ url }] : [];
    }),
  };
}

/** Lo que lee la ficha pública: con el flag `virtual_tours` apagado no hay tour (la ficha queda como siempre). */
export async function loadSitePropertyMediaExtras(db: Executor, code: number): Promise<PublicPropertyMediaExtras & { flagEnabled: boolean }> {
  if (!(await isEnabled(db, "virtual_tours"))) return { tour: null, floorPlans: [], videos: [], flagEnabled: false };
  return { ...(await getPublicPropertyMediaExtras(db, code)), flagEnabled: true };
}

/** Lo que lee /demo/tour-360: null con el flag apagado o sin demo sembrada (404). */
export async function loadSiteDemoShowcase(db: Executor): Promise<DemoShowcase | null> {
  return (await isEnabled(db, "virtual_tours")) ? getDemoShowcase(db) : null;
}

// ───────────────────────── Demo ─────────────────────────


export type DemoShowcase = {
  property: {
    code: number;
    title: string;
    description: string | null;
    typeName: string;
    rooms: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    toilets: number | null;
    garages: number | null;
    coveredAreaM2: number | null;
    landAreaM2: number | null;
    totalAreaM2: number | null;
  };
  tour: Extract<PublicTour, { kind: "internal" }>;
};

/** Propiedad demo + su tour publicado. null si no se sembró (la ruta demo responde 404). */
export async function getDemoShowcase(db: Executor): Promise<DemoShowcase | null> {
  const p = await db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .select(["p.id", "p.code", "p.title", "p.description", "t.name as type_name", "p.rooms", "p.bedrooms", "p.bathrooms", "p.toilets", "p.garages", "p.covered_area_m2", "p.land_area_m2", "p.total_area_m2"])
    .where("p.slug", "=", DEMO_PROPERTY_SLUG)
    .where("p.is_demo", "=", true)
    .where("p.deleted_at", "is", null)
    .executeTakeFirst();
  if (!p) return null;
  const t = await loadTourRow(db, sql`t.property_id = ${p.id} and t.is_demo and t.status = 'published'`);
  const tour = t ? await buildPublicTour(db, t, { drafts: false }) : null;
  if (!tour || tour.kind !== "internal") return null;
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    property: {
      code: p.code,
      title: p.title,
      description: p.description,
      typeName: p.type_name,
      rooms: p.rooms,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      toilets: p.toilets,
      garages: p.garages,
      coveredAreaM2: num(p.covered_area_m2),
      landAreaM2: num(p.land_area_m2),
      totalAreaM2: num(p.total_area_m2),
    },
    tour,
  };
}

// ───────────────────────── CRM ─────────────────────────

export type TourStatusSummary = { id: string; kind: "internal" | "external"; status: "draft" | "published"; isDemo: boolean; sceneCount: number } | null;

export async function getTourSummary(db: Database, actor: Actor, propertyId: string): Promise<TourStatusSummary> {
  requirePermission(actor, "properties.read");
  const t = await db
    .selectFrom("virtual_tours as t")
    .select(["t.id", "t.kind", "t.status", "t.is_demo", sql<number>`(select count(*)::int from virtual_tour_scenes s where s.tour_id = t.id)`.as("scene_count")])
    .where("t.property_id", "=", propertyId)
    .executeTakeFirst();
  return t ? { id: t.id, kind: t.kind as "internal" | "external", status: t.status as "draft" | "published", isDemo: t.is_demo, sceneCount: t.scene_count } : null;
}

export async function getTourEditor(db: Database, actor: Actor, propertyId: string) {
  requirePermission(actor, "properties.read");
  const p = await db
    .selectFrom("properties")
    .select(["id", "code", "title", "slug", "is_published", "is_demo"])
    .where("id", "=", propertyId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!p) throw notFound("Propiedad");
  const t = await loadTourRow(db, sql`t.property_id = ${p.id}`);
  const permissions = { canEdit: can(actor, "properties.manage_media") && !p.is_demo, canPublish: can(actor, "properties.publish") && !p.is_demo };
  if (!t) return { property: p, tour: null, permissions, storage: tourStorageStatus() };
  const { scenes, hotspots } = await loadScenes(db, t.id, false);
  const blockers = tourPublishBlockers(await loadTourGraph(db, t.id));
  const preview = await buildPublicTour(db, t, { drafts: true });
  return {
    property: p,
    permissions,
    storage: tourStorageStatus(),
    tour: {
      id: t.id,
      kind: t.kind as "internal" | "external",
      status: t.status as "draft" | "published",
      isDemo: t.is_demo,
      provider: t.provider as ExternalProvider | null,
      externalUrl: t.external_url,
      embedUrl: t.embed_url,
      startSceneId: t.start_scene_id,
      guidedSceneIds: t.guided_scene_ids,
      publishedAt: t.published_at,
      floorPlan: assetUrl(t.floor_plan_url, t.floor_plan_file) && t.floor_plan_width && t.floor_plan_height ? { url: assetUrl(t.floor_plan_url, t.floor_plan_file)!, width: t.floor_plan_width, height: t.floor_plan_height } : null,
      scenes: scenes.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        isPublished: s.is_published,
        panoramaUrl: assetUrl(s.panorama_url, s.panorama_file),
        previewUrl: assetUrl(s.preview_url, s.preview_file),
        thumbnailUrl: assetUrl(s.thumbnail_url, s.thumbnail_file),
        width: s.width,
        height: s.height,
        initialYaw: s.initial_yaw,
        initialPitch: s.initial_pitch,
        plan: s.plan_x !== null && s.plan_y !== null ? { x: s.plan_x, y: s.plan_y } : null,
        hotspots: hotspots.filter((h) => h.scene_id === s.id).map((h) => ({ id: h.id, kind: h.kind as "scene" | "info" | "cta", targetSceneId: h.target_scene_id, label: h.label, content: h.content, yaw: h.yaw, pitch: h.pitch })),
      })),
      blockers,
      preview,
    },
  };
}
export type TourEditorData = Awaited<ReturnType<typeof getTourEditor>>;
