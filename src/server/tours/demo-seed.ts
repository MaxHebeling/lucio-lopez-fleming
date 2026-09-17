/**
 * Siembra (idempotente) la propiedad demo y su tour a partir del manifiesto estático versionado en el repo.
 * - Propiedad: slug fijo `residencia-demo-360`, is_demo, borrador, sin dirección, sin precio, sin asesor ni fotos
 *   propias. La base impide publicarla.
 * - Tour: interno y publicado (solo se ve en /demo/tour-360). Escenas por slug (upsert; las que salieron del manifiesto
 *   se borran), puntos reemplazados, escena inicial y recorrido guiado del manifiesto.
 * - URLs con `?v=<hash>` del contenido: al reemplazar un archivo y volver a sembrar, navegadores y CDN piden el nuevo.
 * Se ejecuta con `pnpm seed:demo-tour`; también lo usan los tests de integración y el e2e.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { sql, type Database } from "../db";
import { audit } from "../audit";
import { systemActor } from "../auth/actor";
import { emitEvent } from "../events";
import { organizationId } from "../org";
import { manifestFiles, parseTourManifest } from "./manifest";
import { isEquirectangular, tourPublishBlockers } from "./model";
import { DEMO_PROPERTY_SLUG } from "./demo-constants";
import { loadTourGraph } from "./service";

export const DEMO_PROPERTY = {
  slug: DEMO_PROPERTY_SLUG,
  title: "RESIDENCIA DEMO 360°",
  description:
    "Propiedad FICTICIA creada para demostrar el recorrido virtual 360°. No está en venta ni en alquiler, no tiene dirección ni precio y sus datos son de ejemplo. Las imágenes son renders 3D de una residencia que no existe.",
  typeKey: "casa",
  // Coherentes con el plano demostrativo (plano.svg): living, comedor y 3 dormitorios; baño principal + toilette.
  rooms: 5,
  bedrooms: 3,
  bathrooms: 1,
  toilets: 1,
  coveredAreaM2: "290",
  landAreaM2: "900",
} as const;

export type DemoSeedResult = { propertyId: string; tourId: string; code: number; scenes: number; hotspots: number; created: boolean };

export async function seedDemoTour(db: Database, opts: { dir: string; publicPrefix: string; log?: (m: string) => void }): Promise<DemoSeedResult> {
  const log = opts.log ?? (() => undefined);
  const manifestPath = resolve(opts.dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`No existe ${manifestPath}`);
  const parsed = parseTourManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!parsed.ok) throw new Error(`Manifiesto inválido:\n- ${parsed.errors.join("\n- ")}`);
  const m = parsed.manifest;
  if (!m.tour.isDemo) throw new Error("Este seed solo carga tours demo (tour.isDemo = true)");

  // Archivos: existen, se leen y las panorámicas miden lo que dice el manifiesto (2:1).
  const url = new Map<string, string>();
  const problems: string[] = [];
  for (const f of manifestFiles(m)) {
    const path = resolve(opts.dir, f);
    if (!existsSync(path)) {
      problems.push(`Falta el archivo ${f}`);
      continue;
    }
    const bytes = readFileSync(path);
    url.set(f, `${opts.publicPrefix}/${f}?v=${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  for (const s of m.scenes) {
    const meta = await sharp(resolve(opts.dir, s.panorama)).metadata();
    if (meta.width !== s.width || meta.height !== s.height) problems.push(`${s.panorama} mide ${meta.width}×${meta.height} y el manifiesto dice ${s.width}×${s.height}`);
    if (!isEquirectangular(meta.width ?? 0, meta.height ?? 0)) problems.push(`${s.panorama} no es 2:1`);
    for (const f of [s.preview, s.thumbnail]) {
      const pm = await sharp(resolve(opts.dir, f)).metadata().catch(() => null);
      if (!pm?.width) problems.push(`${f} no es una imagen legible`);
    }
  }
  if (problems.length) throw new Error(problems.join("\n"));

  const orgId = await organizationId(db);
  const actor = systemActor(orgId, "seed-demo-tour");
  const result = await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtext('seed-demo-tour'))`.execute(trx);
    const clash = await trx.selectFrom("properties").select(["id", "is_demo"]).where("slug", "=", DEMO_PROPERTY.slug).executeTakeFirst();
    if (clash && !clash.is_demo) throw new Error(`El slug ${DEMO_PROPERTY.slug} lo usa una propiedad real: no se toca`);
    const values = {
      title: DEMO_PROPERTY.title,
      description: DEMO_PROPERTY.description,
      type_key: DEMO_PROPERTY.typeKey,
      rooms: DEMO_PROPERTY.rooms,
      bedrooms: DEMO_PROPERTY.bedrooms,
      bathrooms: DEMO_PROPERTY.bathrooms,
      toilets: DEMO_PROPERTY.toilets,
      covered_area_m2: DEMO_PROPERTY.coveredAreaM2,
      land_area_m2: DEMO_PROPERTY.landAreaM2,
      hide_exact_address: true,
      is_demo: true,
      is_published: false,
      featured: false,
    };
    let propertyId: string;
    let code: number;
    const created = !clash;
    if (clash) {
      const row = await trx.updateTable("properties").set(values).where("id", "=", clash.id).returning(["id", "code"]).executeTakeFirstOrThrow();
      propertyId = row.id;
      code = row.code;
    } else {
      const next = Number((await sql<{ code: string }>`select nextval('property_code_seq') as code`.execute(trx)).rows[0]!.code);
      const row = await trx
        .insertInto("properties")
        .values({ ...values, organization_id: orgId, code: next, slug: DEMO_PROPERTY.slug, status: "draft", source: "crm" })
        .returning(["id", "code"])
        .executeTakeFirstOrThrow();
      propertyId = row.id;
      code = row.code;
      await trx.insertInto("property_status_history").values({ property_id: propertyId, from_status: null, to_status: "draft", reason: "Propiedad demo (ficticia)" }).execute();
    }

    const [, , vbW, vbH] = m.tour.floorPlanViewBox ?? [0, 0, null, null];
    const tourValues = {
      kind: "internal",
      status: "published",
      is_demo: true,
      cover_url: url.get(m.tour.cover)!,
      cover_file_id: null,
      floor_plan_url: m.tour.floorPlan ? url.get(m.tour.floorPlan)! : null,
      floor_plan_file_id: null,
      floor_plan_width: vbW ? Math.round(vbW) : null,
      floor_plan_height: vbH ? Math.round(vbH) : null,
      provider: null,
      external_url: null,
      embed_url: null,
    };
    const existingTour = await trx.selectFrom("virtual_tours").select("id").where("property_id", "=", propertyId).forUpdate().executeTakeFirst();
    const tourId = existingTour
      ? (await trx.updateTable("virtual_tours").set({ ...tourValues, published_at: sql`coalesce(published_at, now())` }).where("id", "=", existingTour.id).returning("id").executeTakeFirstOrThrow()).id
      : (await trx.insertInto("virtual_tours").values({ ...tourValues, property_id: propertyId, published_at: new Date() }).returning("id").executeTakeFirstOrThrow()).id;

    const ids = new Map<string, string>();
    for (const [i, s] of m.scenes.entries()) {
      const sv = {
        name: s.name,
        panorama_url: url.get(s.panorama)!,
        panorama_file_id: null,
        preview_url: url.get(s.preview)!,
        preview_file_id: null,
        thumbnail_url: url.get(s.thumbnail)!,
        thumbnail_file_id: null,
        width: s.width,
        height: s.height,
        initial_yaw: s.initialYaw,
        initial_pitch: s.initialPitch,
        sort_order: (i + 1) * 10,
        is_published: true,
        plan_x: s.plan?.x ?? null,
        plan_y: s.plan?.y ?? null,
      };
      const row = await trx
        .insertInto("virtual_tour_scenes")
        .values({ ...sv, tour_id: tourId, slug: s.slug })
        .onConflict((oc) => oc.columns(["tour_id", "slug"]).doUpdateSet(sv))
        .returning("id")
        .executeTakeFirstOrThrow();
      ids.set(s.slug, row.id);
    }
    await trx.deleteFrom("virtual_tour_scenes").where("tour_id", "=", tourId).where("slug", "not in", [...ids.keys()]).execute();
    await trx.deleteFrom("virtual_tour_hotspots").where("scene_id", "in", [...ids.values()]).execute();
    let hotspots = 0;
    for (const s of m.scenes) {
      const rows = s.hotspots.map((h, j) => ({
        scene_id: ids.get(s.slug)!,
        kind: h.type,
        target_scene_id: h.type === "scene" ? ids.get(h.target)! : null,
        label: h.label,
        content: h.type === "scene" ? null : (h.content ?? null),
        yaw: h.yaw,
        pitch: h.pitch,
        sort_order: (j + 1) * 10,
      }));
      if (rows.length) await trx.insertInto("virtual_tour_hotspots").values(rows).execute();
      hotspots += rows.length;
    }
    await trx
      .updateTable("virtual_tours")
      .set({ start_scene_id: ids.get(m.tour.startScene)!, guided_scene_ids: m.tour.guided.map((g) => ids.get(g)!) })
      .where("id", "=", tourId)
      .execute();

    const blockers = tourPublishBlockers(await loadTourGraph(trx, tourId));
    if (blockers.length) throw new Error(`El tour demo no quedaría publicable: ${blockers.join(" · ")}`);
    await audit(trx, actor, { action: "DEMO_TOUR_SEEDED", entityType: "virtual_tour", entityId: tourId, after: { scenes: ids.size, hotspots, created }, metadata: { propertyId } });
    await emitEvent(trx, actor, { type: "virtual_tour.updated", aggregateType: "virtual_tour", aggregateId: tourId, payload: { propertyId, action: "demo_seeded" } });
    return { propertyId, tourId, code, scenes: ids.size, hotspots, created };
  });
  log(`Demo ${result.created ? "creada" : "actualizada"}: propiedad #${result.code} (${result.propertyId}), tour ${result.tourId}, ${result.scenes} escenas, ${result.hotspots} puntos`);
  return result;
}
