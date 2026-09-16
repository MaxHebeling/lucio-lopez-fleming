/** Alta de ubicaciones (provincia → localidad → barrio/barrio cerrado) desde la ficha de propiedad. */
import { z } from "zod";
import { parseInput } from "../validate";
import { type Database } from "../db";
import { audit } from "../audit";
import { requirePermission, type Actor } from "../auth/actor";
import { invalid, notFound } from "../errors";
import { slugify } from "./schema";

/** Qué tipo de ubicación puede colgar de cuál. */
const PARENT_KIND: Record<string, Array<string | null>> = {
  province: [null, "country"],
  locality: ["province"],
  neighborhood: ["locality"],
  gated_community: ["locality"],
};

export const createLocationSchema = z.object({
  parentId: z.uuid().nullable(),
  kind: z.enum(["province", "locality", "neighborhood", "gated_community"]),
  name: z.string().trim().min(2, "El nombre es muy corto").max(120),
});

export async function createLocation(db: Database, actor: Actor, raw: unknown): Promise<{ id: string; created: boolean; name: string; kind: string }> {
  requirePermission(actor, "properties.update");
  const input = parseInput(createLocationSchema, raw);
  const slug = slugify(input.name);
  if (!slug) throw invalid("Nombre inválido", { name: ["Usá letras o números"] });
  return db.transaction().execute(async (trx) => {
    let parentKind: string | null = null;
    if (input.parentId) {
      const parent = await trx.selectFrom("locations").select(["kind"]).where("id", "=", input.parentId).executeTakeFirst();
      if (!parent) throw notFound("Ubicación");
      parentKind = parent.kind;
    }
    if (!PARENT_KIND[input.kind]!.includes(parentKind)) throw invalid("La ubicación no corresponde a ese nivel", { name: ["Nivel inválido"] });

    let existingQ = trx.selectFrom("locations").select(["id", "name", "kind"]).where("kind", "=", input.kind).where("slug", "=", slug);
    existingQ = input.parentId ? existingQ.where("parent_id", "=", input.parentId) : existingQ.where("parent_id", "is", null);
    const existing = await existingQ.executeTakeFirst();
    if (existing) return { id: existing.id, created: false, name: existing.name, kind: existing.kind };

    const row = await trx
      .insertInto("locations")
      .values({ parent_id: input.parentId, kind: input.kind, name: input.name, slug })
      .onConflict((oc) => oc.doNothing())
      .returning(["id", "name", "kind"])
      .executeTakeFirst();
    if (!row) {
      // Carrera con otra alta idéntica: se devuelve la existente.
      const again = await existingQ.executeTakeFirstOrThrow();
      return { id: again.id, created: false, name: again.name, kind: again.kind };
    }
    await audit(trx, actor, { action: "LOCATION_CREATED", entityType: "location", entityId: row.id, after: { parentId: input.parentId, kind: input.kind, name: input.name } });
    return { id: row.id, created: true, name: row.name, kind: row.kind };
  });
}
