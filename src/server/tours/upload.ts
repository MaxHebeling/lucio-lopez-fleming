/**
 * Entrada común de las subidas del editor de tours (panorámica de una escena o plano), para la ruta con cuerpo
 * (storage local) y la subida directa a S3 (intent + complete). La autorización real está en los servicios.
 */
import "server-only";
import { z } from "zod";
import type { Database } from "../db";
import type { Actor } from "../auth/actor";
import { notFound } from "../errors";
import { addScene, setFloorPlan } from "./service";

export const tourUploadMetaSchema = z.object({
  target: z.enum(["scene", "floor_plan"]),
  name: z.string().trim().max(80).optional(),
  fileName: z.string().max(200).optional(),
});
export type TourUploadMeta = z.infer<typeof tourUploadMetaSchema>;

export async function tourIdForProperty(db: Database, propertyId: string): Promise<string> {
  if (!z.uuid().safeParse(propertyId).success) throw notFound("Propiedad");
  const t = await db.selectFrom("virtual_tours").select("id").where("property_id", "=", propertyId).executeTakeFirst();
  if (!t) throw notFound("Tour");
  return t.id;
}

export async function processTourUpload(db: Database, actor: Actor, propertyId: string, bytes: Uint8Array, meta: TourUploadMeta) {
  const tourId = await tourIdForProperty(db, propertyId);
  if (meta.target === "scene") return { target: "scene" as const, ...(await addScene(db, actor, tourId, bytes, { name: meta.name ?? "", originalName: meta.fileName ?? null })) };
  return { target: "floor_plan" as const, ...(await setFloorPlan(db, actor, tourId, bytes, meta.fileName ?? null)) };
}
