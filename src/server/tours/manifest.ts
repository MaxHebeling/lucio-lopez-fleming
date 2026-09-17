/**
 * Manifiesto de un tour estático versionado en el repo (hoy: la demo en public/tours/demo/residencia/manifest.json).
 * El seed (scripts/seed-demo-tour.ts) lo valida acá antes de tocar la base: estructura, 2:1, slugs únicos, destinos
 * existentes, ángulos en rango y recorrido guiado coherente. La existencia y el tamaño real de los archivos se verifican
 * en el script (necesita disco).
 */
import { z } from "zod";
import { isEquirectangular, isPitchInRange, isYawInRange } from "./model";

const file = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}\.(jpg|jpeg|png|webp|svg)$/, "Nombre de archivo inválido (minúsculas, sin rutas)");
const slug = z.string().regex(/^[a-z0-9-]{1,60}$/, "Slug inválido");
const yaw = z.number().refine(isYawInRange, "yaw fuera de (−π, π]");
const pitch = z.number().refine(isPitchInRange, "pitch fuera de [−π/2, π/2]");
const unit = z.number().min(0).max(1);

const hotspotSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scene"), target: slug, label: z.string().trim().min(1).max(80), yaw, pitch }).strict(),
  z.object({ type: z.literal("info"), label: z.string().trim().min(1).max(80), content: z.string().trim().min(1).max(600), yaw, pitch }).strict(),
  z.object({ type: z.literal("cta"), label: z.string().trim().min(1).max(80), content: z.string().trim().max(600).optional(), yaw, pitch }).strict(),
]);

const sceneSchema = z
  .object({
    slug,
    name: z.string().trim().min(1).max(80),
    panorama: file,
    preview: file,
    thumbnail: file,
    width: z.number().int().min(256).max(16384),
    height: z.number().int().min(128).max(8192),
    initialYaw: yaw,
    initialPitch: pitch,
    plan: z.object({ x: unit, y: unit }).strict().nullable().optional(),
    hotspots: z.array(hotspotSchema).max(40),
  })
  .strict();

export const tourManifestSchema = z
  .object({
    version: z.literal(1),
    tour: z
      .object({
        name: z.string().trim().min(1).max(120),
        isDemo: z.boolean(),
        cover: file,
        floorPlan: file.nullable().optional(),
        floorPlanViewBox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]).nullable().optional(),
        startScene: slug,
        guided: z.array(slug).max(60),
      })
      .strict(),
    scenes: z.array(sceneSchema).min(1).max(60),
  })
  .strict()
  .superRefine((m, ctx) => {
    const slugs = new Set<string>();
    m.scenes.forEach((s, i) => {
      if (slugs.has(s.slug)) ctx.addIssue({ code: "custom", path: ["scenes", i, "slug"], message: `Slug repetido: ${s.slug}` });
      slugs.add(s.slug);
      if (!isEquirectangular(s.width, s.height)) ctx.addIssue({ code: "custom", path: ["scenes", i], message: `«${s.slug}» no es 2:1 (${s.width}×${s.height})` });
    });
    m.scenes.forEach((s, i) =>
      s.hotspots.forEach((h, j) => {
        if (h.type !== "scene") return;
        if (!slugs.has(h.target)) ctx.addIssue({ code: "custom", path: ["scenes", i, "hotspots", j, "target"], message: `«${s.slug}» apunta a una escena inexistente: ${h.target}` });
        if (h.target === s.slug) ctx.addIssue({ code: "custom", path: ["scenes", i, "hotspots", j, "target"], message: `«${s.slug}» apunta a sí misma` });
      }),
    );
    if (!slugs.has(m.tour.startScene)) ctx.addIssue({ code: "custom", path: ["tour", "startScene"], message: `Escena inicial inexistente: ${m.tour.startScene}` });
    m.tour.guided.forEach((g, i) => {
      if (!slugs.has(g)) ctx.addIssue({ code: "custom", path: ["tour", "guided", i], message: `Recorrido guiado con escena inexistente: ${g}` });
    });
    if (new Set(m.tour.guided).size !== m.tour.guided.length) ctx.addIssue({ code: "custom", path: ["tour", "guided"], message: "Recorrido guiado con escenas repetidas" });
    if (Boolean(m.tour.floorPlan) !== Boolean(m.tour.floorPlanViewBox)) ctx.addIssue({ code: "custom", path: ["tour", "floorPlanViewBox"], message: "Plano y floorPlanViewBox van juntos" });
  });

export type TourManifest = z.infer<typeof tourManifestSchema>;

/** Valida un manifiesto; devuelve errores legibles (ruta: mensaje) o el manifiesto tipado. */
export function parseTourManifest(raw: unknown): { ok: true; manifest: TourManifest } | { ok: false; errors: string[] } {
  const r = tourManifestSchema.safeParse(raw);
  if (r.success) return { ok: true, manifest: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`) };
}

/** Archivos que el manifiesto referencia (para verificar que existan). */
export function manifestFiles(m: TourManifest): string[] {
  const files = [m.tour.cover, ...(m.tour.floorPlan ? [m.tour.floorPlan] : [])];
  for (const s of m.scenes) files.push(s.panorama, s.preview, s.thumbnail);
  return [...new Set(files)];
}
