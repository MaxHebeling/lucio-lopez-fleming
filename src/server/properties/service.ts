/**
 * Ciclo de vida de propiedades. Toda mutación: permiso en servidor → validación → transacción con bloqueo de fila
 * → historial (precio/estado) → auditoría (antes/después) → evento de dominio (propaga a web, portales, redes).
 * Si un portal falla después, el dato del CRM NO se revierte: la sincronización se reintenta aparte.
 */
import { z } from "zod";
import { sql, type Database, type Tx } from "../db";
import { audit, diff } from "../audit";
import { actorUserId, can, requirePermission, type Actor } from "../auth/actor";
import { emitEvent } from "../events";
import { conflict, forbidden, invalid, notFound } from "../errors";
import {
  createPropertySchema,
  FIELD_COLUMNS,
  slugify,
  STATUS_TRANSITIONS,
  updatePropertySchema,
  validateAttributes,
  type FieldSchemaEntry,
  type OperationInput,
  type PropertyStatus,
} from "./schema";

type Columns = Record<string, unknown>;

/**
 * Si la propiedad vino del sitio anterior, marca campos como corregidos por una persona para que una reimportación
 * no los revierta (estado, publicación, agentes, fotos, características). Sin efecto para propiedades creadas en el CRM.
 */
export async function protectImportedFields(trx: Tx, actor: Actor, propertyId: string, fields: string[]): Promise<void> {
  if (actor.kind !== "staff" || !fields.length) return;
  await trx
    .updateTable("properties")
    .set({ protected_fields: sql`array(select distinct unnest(protected_fields || ${fields}::text[]))` })
    .where("id", "=", propertyId)
    .where("source", "=", "adinco_import")
    .execute();
}

async function loadForUpdate(trx: Tx, id: string) {
  const p = await trx.selectFrom("properties").selectAll().where("id", "=", id).where("deleted_at", "is", null).forUpdate().executeTakeFirst();
  if (!p) throw notFound("Propiedad");
  return p;
}

async function typeSchema(trx: Tx, typeKey: string): Promise<FieldSchemaEntry[]> {
  const t = await trx.selectFrom("property_types").select(["field_schema", "is_active"]).where("key", "=", typeKey).executeTakeFirst();
  if (!t || !t.is_active) throw invalid("Tipo de propiedad inválido", { typeKey: ["Tipo inválido"] });
  return (t.field_schema ?? []) as FieldSchemaEntry[];
}

function toColumns(input: Record<string, unknown>): Columns {
  const cols: Columns = {};
  for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
    if (!(field in input) || input[field] === undefined) continue;
    const v = input[field];
    cols[column] = field === "attributes" ? JSON.stringify(v) : typeof v === "number" && (column.includes("area") || column === "latitude" || column === "longitude") ? String(v) : v;
  }
  return cols;
}

export async function buildSlug(trx: Tx, title: string, code: number, excludeId?: string): Promise<string> {
  const base = `${slugify(title).slice(0, 90) || "propiedad"}-${code}`;
  let slug = base;
  for (let i = 2; ; i++) {
    let q = trx.selectFrom("properties").select("id").where("slug", "=", slug);
    if (excludeId) q = q.where("id", "<>", excludeId);
    if (!(await q.executeTakeFirst())) return slug;
    slug = `${base}-${i}`;
  }
}

async function setFeatures(trx: Tx, propertyId: string, keys: string[]): Promise<void> {
  await trx.deleteFrom("property_features").where("property_id", "=", propertyId).execute();
  if (!keys.length) return;
  const features = await trx.selectFrom("features").select(["id", "key"]).where("key", "in", keys).execute();
  if (features.length !== new Set(keys).size) throw invalid("Hay características desconocidas");
  await trx.insertInto("property_features").values(features.map((f) => ({ property_id: propertyId, feature_id: f.id }))).execute();
}

async function upsertOperation(trx: Tx, actor: Actor, propertyId: string, op: OperationInput, source: "crm" | "import" | "api", reason?: string | null) {
  const prev = await trx.selectFrom("property_operations").selectAll().where("property_id", "=", propertyId).where("operation", "=", op.operation).executeTakeFirst();
  const values = {
    currency: op.currency,
    amount: op.amount === null ? null : String(op.amount),
    price_hidden: op.priceHidden,
    expenses_amount: op.expensesAmount == null ? null : String(op.expensesAmount),
    expenses_currency: op.expensesAmount == null ? null : (op.expensesCurrency ?? op.currency),
    is_active: true,
  };
  if (prev) {
    await trx.updateTable("property_operations").set(values).where("id", "=", prev.id).execute();
  } else {
    await trx.insertInto("property_operations").values({ property_id: propertyId, operation: op.operation, ...values }).execute();
  }
  const priceChanged = !prev || prev.currency !== op.currency || Number(prev.amount) !== Number(op.amount) || (prev.amount === null) !== (op.amount === null);
  if (priceChanged) {
    await trx
      .insertInto("property_price_history")
      .values({
        property_id: propertyId,
        operation: op.operation,
        previous_currency: prev?.currency ?? null,
        previous_amount: prev?.amount ?? null,
        new_currency: op.currency,
        new_amount: values.amount,
        changed_by: actorUserId(actor),
        source,
        reason: reason ?? null,
      })
      .execute();
  }
  return { prev, priceChanged };
}

export async function createProperty(db: Database, actor: Actor, raw: unknown): Promise<{ id: string; code: number; slug: string }> {
  requirePermission(actor, "properties.create");
  const input = createPropertySchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const schema = await typeSchema(trx, input.typeKey);
    const attrs = validateAttributes(schema, input.attributes);
    if (Object.keys(attrs.errors).length) throw invalid("Revisá los campos del tipo de propiedad", attrs.errors);
    const code = Number((await sql<{ code: string }>`select nextval('property_code_seq') as code`.execute(trx)).rows[0]!.code);
    const slug = await buildSlug(trx, input.title, code);
    const cols = toColumns({ ...input, attributes: attrs.value });
    const row = await trx
      .insertInto("properties")
      .values({
        ...(cols as object),
        organization_id: actor.organizationId,
        code,
        slug,
        title: input.title,
        type_key: input.typeKey,
        status: "draft",
        source: "crm",
        created_by: actorUserId(actor),
        updated_by: actorUserId(actor),
      } as never)
      .returning(["id", "code", "slug"])
      .executeTakeFirstOrThrow();
    const ops = new Set<string>();
    for (const op of input.operations) {
      if (ops.has(op.operation)) throw invalid("Operación repetida");
      ops.add(op.operation);
      await upsertOperation(trx, actor, row.id, op, "crm");
    }
    await setFeatures(trx, row.id, input.featureKeys);
    await trx.insertInto("property_status_history").values({ property_id: row.id, from_status: null, to_status: "draft", changed_by: actorUserId(actor) }).execute();
    if (actor.kind === "staff") {
      await trx.insertInto("property_agents").values({ property_id: row.id, user_id: actor.userId, role: "lead" }).onConflict((oc) => oc.doNothing()).execute();
    }
    await audit(trx, actor, { action: "PROPERTY_CREATED", entityType: "property", entityId: row.id, after: { code, title: input.title, typeKey: input.typeKey, operations: input.operations } });
    await emitEvent(trx, actor, { type: "property.created", aggregateType: "property", aggregateId: row.id, payload: { code, link: `/crm/propiedades/${row.id}` } });
    return row;
  });
}

/**
 * Edita datos (no precio ni estado: tienen su propio flujo y permiso).
 * Si la propiedad vino de la migración, los campos editados por una persona quedan protegidos.
 */
export async function updateProperty(db: Database, actor: Actor, id: string, raw: unknown): Promise<void> {
  requirePermission(actor, "properties.update");
  const input = updatePropertySchema.parse(raw);
  await db.transaction().execute(async (trx) => {
    const current = await loadForUpdate(trx, id);
    let attributes = input.attributes;
    if (input.attributes !== undefined || input.typeKey !== undefined) {
      const schema = await typeSchema(trx, input.typeKey ?? current.type_key);
      const attrs = validateAttributes(schema, input.attributes ?? (current.attributes as Record<string, unknown>));
      if (Object.keys(attrs.errors).length) throw invalid("Revisá los campos del tipo de propiedad", attrs.errors);
      attributes = attrs.value;
    }
    // Mostrar la dirección exacta de algo ya publicado equivale a publicar un dato nuevo: requiere properties.publish.
    if (current.is_published && current.hide_exact_address && input.hideExactAddress === false && !can(actor, "properties.publish")) {
      throw forbidden("Mostrar la dirección exacta de una propiedad publicada requiere permiso para publicar");
    }
    const cols = toColumns({ ...input, attributes });
    const changes = diff(current as unknown as Record<string, unknown>, cols);
    const changedColumns = Object.keys(changes.after);
    if (input.featureKeys) await setFeatures(trx, id, input.featureKeys);
    if (!changedColumns.length && !input.featureKeys) return;

    const protectedFields = new Set(current.protected_fields);
    if (current.source === "adinco_import" && actor.kind === "staff") changedColumns.forEach((c) => protectedFields.add(c));
    let slug = current.slug;
    if (changes.after.title) slug = await buildSlug(trx, String(changes.after.title), current.code, id);

    await trx
      .updateTable("properties")
      .set({ ...(changes.after as object), slug, protected_fields: [...protectedFields], updated_by: actorUserId(actor) } as never)
      .where("id", "=", id)
      .execute();
    if (slug !== current.slug) {
      await trx.insertInto("property_redirects").values({ path: `/propiedades/${current.slug}`, property_id: id }).onConflict((oc) => oc.column("path").doUpdateSet({ property_id: id })).execute();
    }
    await audit(trx, actor, { action: "PROPERTY_UPDATED", entityType: "property", entityId: id, before: changes.before, after: { ...changes.after, ...(input.featureKeys ? { featureKeys: input.featureKeys } : {}) } });
    if (input.featureKeys) await protectImportedFields(trx, actor, id, ["features"]);
    await emitEvent(trx, actor, { type: "property.updated", aggregateType: "property", aggregateId: id, payload: { fields: changedColumns, link: `/crm/propiedades/${id}` } });
  });
}

export async function changePrice(
  db: Database,
  actor: Actor,
  id: string,
  op: OperationInput,
  reason?: string | null,
): Promise<{ changed: boolean }> {
  requirePermission(actor, "properties.change_price");
  return db.transaction().execute(async (trx) => {
    const current = await loadForUpdate(trx, id);
    const { prev, priceChanged } = await upsertOperation(trx, actor, id, op, "crm", reason);
    if (!priceChanged && prev && prev.price_hidden === op.priceHidden) return { changed: false };
    if (current.source === "adinco_import" && actor.kind === "staff") {
      await trx
        .updateTable("properties")
        .set({ protected_fields: sql`array(select distinct unnest(protected_fields || array[${`price:${op.operation}`}]))`, updated_by: actorUserId(actor) })
        .where("id", "=", id)
        .execute();
    }
    await audit(trx, actor, {
      action: "PROPERTY_PRICE_CHANGED",
      entityType: "property",
      entityId: id,
      before: prev ? { operation: prev.operation, currency: prev.currency, amount: prev.amount, priceHidden: prev.price_hidden } : null,
      after: op,
      metadata: reason ? { reason } : undefined,
    });
    await emitEvent(trx, actor, { type: "property.price_changed", aggregateType: "property", aggregateId: id, payload: { operation: op.operation, previous: prev?.amount ?? null, current: op.amount, currency: op.currency } });
    await emitEvent(trx, actor, { type: "property.updated", aggregateType: "property", aggregateId: id, payload: { fields: [`price:${op.operation}`] } });
    return { changed: true };
  });
}

/** Acepta una transacción en curso (p. ej. activar un contrato de alquiler) para que ambos cambios sean atómicos. */
export async function changeStatus(db: Database | Tx, actor: Actor, id: string, to: PropertyStatus, reason?: string | null): Promise<void> {
  requirePermission(actor, "properties.change_status");
  const run = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => (db.isTransaction ? fn(db as Tx) : db.transaction().execute(fn));
  await run(async (trx) => {
    const current = await loadForUpdate(trx, id);
    const from = current.status as PropertyStatus;
    if (from === to) return;
    if (!STATUS_TRANSITIONS[from].includes(to)) throw conflict(`No se puede pasar de ${from} a ${to}`);
    const unpublish = current.is_published && !["available", "reserved", "sold", "rented"].includes(to);
    await trx
      .updateTable("properties")
      .set({
        status: to,
        is_published: unpublish ? false : current.is_published,
        archived_at: to === "archived" ? new Date() : null,
        updated_by: actorUserId(actor),
      })
      .where("id", "=", id)
      .execute();
    await trx.insertInto("property_status_history").values({ property_id: id, from_status: from, to_status: to, changed_by: actorUserId(actor), reason: reason ?? null }).execute();
    await audit(trx, actor, { action: "PROPERTY_STATUS_CHANGED", entityType: "property", entityId: id, before: { status: from }, after: { status: to, unpublished: unpublish }, metadata: reason ? { reason } : undefined });
    await protectImportedFields(trx, actor, id, unpublish ? ["status", "is_published"] : ["status"]);
    await emitEvent(trx, actor, { type: "property.status_changed", aggregateType: "property", aggregateId: id, payload: { from, to } });
    if (unpublish) {
      await markPublications(trx, id, "unpublished");
      await emitEvent(trx, actor, { type: "property.unpublished", aggregateType: "property", aggregateId: id, payload: { reason: `estado ${to}` } });
    }
    await emitEvent(trx, actor, { type: "property.updated", aggregateType: "property", aggregateId: id, payload: { fields: ["status"] } });
  });
}

/** Qué falta para poder publicar (vacío = publicable). */
export async function publishBlockers(trx: Tx | Database, id: string): Promise<string[]> {
  const p = await trx.selectFrom("properties").select(["title", "status", "location_id", "description"]).where("id", "=", id).executeTakeFirst();
  if (!p) return ["La propiedad no existe"];
  const blockers: string[] = [];
  if (!["available", "reserved", "sold", "rented"].includes(p.status)) blockers.push("El estado debe ser Disponible, Reservada, Vendida o Alquilada");
  if (!p.location_id) blockers.push("Falta la ubicación");
  const media = await trx.selectFrom("property_media").select(sql<number>`count(*)::int`.as("n")).where("property_id", "=", id).where("kind", "=", "image").where("deleted_at", "is", null).where("status", "<>", "failed").executeTakeFirst();
  if (!media?.n) blockers.push("Falta al menos una foto");
  const ops = await trx.selectFrom("property_operations").select(sql<number>`count(*)::int`.as("n")).where("property_id", "=", id).where("is_active", "=", true).executeTakeFirst();
  if (!ops?.n) blockers.push("Falta la operación y el precio");
  return blockers;
}

export async function publishProperty(db: Database, actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "properties.publish");
  await db.transaction().execute(async (trx) => {
    const current = await loadForUpdate(trx, id);
    if (current.is_published) return;
    const blockers = await publishBlockers(trx, id);
    if (blockers.length) throw invalid(`No se puede publicar: ${blockers.join(" · ")}`);
    await trx.updateTable("properties").set({ is_published: true, published_at: current.published_at ?? new Date(), updated_by: actorUserId(actor) }).where("id", "=", id).execute();
    await markPublications(trx, id, "published");
    await audit(trx, actor, { action: "PROPERTY_PUBLISHED", entityType: "property", entityId: id });
    await protectImportedFields(trx, actor, id, ["is_published"]);
    // dedupe por día: republicar varias veces el mismo día no genera borradores de redes repetidos
    await emitEvent(trx, actor, {
      type: "property.published",
      aggregateType: "property",
      aggregateId: id,
      payload: { code: current.code, link: `/crm/propiedades/${id}` },
      dedupeKey: `property.published:${id}:${new Date().toISOString().slice(0, 10)}`,
    });
  });
}

export async function unpublishProperty(db: Database, actor: Actor, id: string, reason?: string | null): Promise<void> {
  requirePermission(actor, "properties.publish");
  await db.transaction().execute(async (trx) => {
    const current = await loadForUpdate(trx, id);
    if (!current.is_published) return;
    await trx.updateTable("properties").set({ is_published: false, updated_by: actorUserId(actor) }).where("id", "=", id).execute();
    await markPublications(trx, id, "unpublished");
    await audit(trx, actor, { action: "PROPERTY_UNPUBLISHED", entityType: "property", entityId: id, metadata: reason ? { reason } : undefined });
    await protectImportedFields(trx, actor, id, ["is_published"]);
    await emitEvent(trx, actor, { type: "property.unpublished", aggregateType: "property", aggregateId: id, payload: { reason: reason ?? null } });
  });
}

/** Deja el estado deseado por canal; los portales se sincronizan por job (estado pending/awaiting_credentials). */
async function markPublications(trx: Tx, propertyId: string, desired: "published" | "unpublished"): Promise<void> {
  const channels = await trx.selectFrom("publication_channels as c").leftJoin("integrations as i", "i.key", "c.integration_key").select(["c.key", "c.kind", "c.is_enabled", "i.status as integration_status"]).where("c.kind", "in", ["web", "portal"]).execute();
  for (const c of channels) {
    const syncStatus = c.kind === "web" ? "synced" : !c.is_enabled ? "disabled" : c.integration_status === "awaiting_credentials" ? "awaiting_credentials" : "pending";
    await trx
      .insertInto("property_publications")
      .values({ property_id: propertyId, channel_key: c.key, desired_state: desired, sync_status: syncStatus, last_synced_at: c.kind === "web" ? new Date() : null })
      // Si un job está hablando con el portal (lock vigente) no se pisa su estado visible; el job relee desired_state al terminar.
      .onConflict((oc) =>
        oc.columns(["property_id", "channel_key"]).doUpdateSet({
          desired_state: desired,
          sync_status: sql`case when property_publications.sync_locked_until > now() then property_publications.sync_status else ${syncStatus} end`,
          last_error: sql`case when property_publications.sync_locked_until > now() then property_publications.last_error else null end`,
        }),
      )
      .execute();
  }
}

/**
 * Responsable y apoyo de una propiedad (el responsable recibe los leads de la ficha): permiso propio
 * `properties.assign_agents` (no alcanza con editar datos) y solo usuarios del equipo activos.
 */
export async function assignAgents(db: Database, actor: Actor, id: string, leadUserId: string | null, supportUserIds: string[] = []): Promise<void> {
  requirePermission(actor, "properties.assign_agents");
  await db.transaction().execute(async (trx) => {
    await loadForUpdate(trx, id);
    const wanted = [...new Set([...(leadUserId ? [leadUserId] : []), ...supportUserIds])];
    const uuid = z.uuid();
    if (wanted.some((u) => !uuid.safeParse(u).success)) throw invalid("Elegí un usuario activo del equipo", { agents: ["Usuario inválido"] });
    if (wanted.length) {
      const valid = await trx
        .selectFrom("users")
        .select("id")
        .where("id", "in", wanted)
        .where("kind", "=", "staff")
        .where("is_active", "=", true)
        .where("deleted_at", "is", null)
        .execute();
      if (valid.length !== wanted.length) throw invalid("Elegí un usuario activo del equipo", { agents: ["Solo usuarios activos del equipo"] });
    }
    const before = await trx.selectFrom("property_agents").select(["user_id", "role"]).where("property_id", "=", id).execute();
    await trx.deleteFrom("property_agents").where("property_id", "=", id).execute();
    const rows = [
      ...(leadUserId ? [{ property_id: id, user_id: leadUserId, role: "lead" }] : []),
      ...supportUserIds.filter((u) => u !== leadUserId).map((u) => ({ property_id: id, user_id: u, role: "support" })),
    ];
    if (rows.length) await trx.insertInto("property_agents").values(rows).execute();
    await audit(trx, actor, { action: "PROPERTY_AGENTS_ASSIGNED", entityType: "property", entityId: id, before, after: rows.map((r) => ({ user_id: r.user_id, role: r.role })) });
    await protectImportedFields(trx, actor, id, ["agents"]);
  });
}

export async function setOwners(db: Database, actor: Actor, id: string, owners: Array<{ contactId: string; sharePct?: number | null; isPrimary?: boolean }>): Promise<void> {
  requirePermission(actor, "properties.update");
  requirePermission(actor, "properties.read_private");
  const total = owners.reduce((s, o) => s + (o.sharePct ?? 0), 0);
  if (total > 100.001) throw invalid("La suma de porcentajes supera el 100%");
  await db.transaction().execute(async (trx) => {
    await loadForUpdate(trx, id);
    const before = await trx.selectFrom("property_owners").select(["contact_id", "share_pct", "is_primary"]).where("property_id", "=", id).execute();
    await trx.deleteFrom("property_owners").where("property_id", "=", id).execute();
    if (owners.length) {
      await trx
        .insertInto("property_owners")
        .values(owners.map((o, i) => ({ property_id: id, contact_id: o.contactId, share_pct: o.sharePct == null ? null : String(o.sharePct), is_primary: o.isPrimary ?? i === 0 })))
        .execute();
      for (const o of owners) await trx.insertInto("contact_roles").values({ contact_id: o.contactId, role: "owner" }).onConflict((oc) => oc.doNothing()).execute();
    }
    await audit(trx, actor, { action: "PROPERTY_OWNERS_ASSIGNED", entityType: "property", entityId: id, before, after: owners });
  });
}

/**
 * Duplica una propiedad como borrador con código nuevo: copia datos, operaciones (con su precio) y características.
 * No copia multimedia, publicaciones, propietarios, historial ni trazabilidad de migración.
 */
export async function duplicateProperty(db: Database, actor: Actor, id: string): Promise<{ id: string; code: number; slug: string }> {
  requirePermission(actor, "properties.create");
  return db.transaction().execute(async (trx) => {
    const src = await trx.selectFrom("properties").selectAll().where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
    if (!src) throw notFound("Propiedad");
    const code = Number((await sql<{ code: string }>`select nextval('property_code_seq') as code`.execute(trx)).rows[0]!.code);
    const suffix = " (copia)";
    const title = `${src.title.slice(0, 200 - suffix.length)}${suffix}`;
    const slug = await buildSlug(trx, title, code);
    const copied: Columns = {};
    for (const column of Object.values(FIELD_COLUMNS)) copied[column] = (src as Record<string, unknown>)[column];
    copied.title = title;
    copied.featured = false;
    copied.attributes = JSON.stringify(src.attributes ?? {});
    const row = await trx
      .insertInto("properties")
      .values({
        ...(copied as object),
        organization_id: src.organization_id,
        code,
        slug,
        type_key: src.type_key,
        status: "draft",
        is_published: false,
        source: "crm",
        created_by: actorUserId(actor),
        updated_by: actorUserId(actor),
      } as never)
      .returning(["id", "code", "slug"])
      .executeTakeFirstOrThrow();

    const ops = await trx.selectFrom("property_operations").select(["operation", "currency", "amount", "price_hidden", "expenses_amount", "expenses_currency"]).where("property_id", "=", id).where("is_active", "=", true).execute();
    for (const op of ops) {
      await upsertOperation(
        trx,
        actor,
        row.id,
        {
          operation: op.operation as OperationInput["operation"],
          currency: op.currency as OperationInput["currency"],
          amount: op.amount === null ? null : Number(op.amount),
          priceHidden: op.price_hidden,
          expensesAmount: op.expenses_amount === null ? null : Number(op.expenses_amount),
          expensesCurrency: (op.expenses_currency as OperationInput["currency"] | null) ?? null,
        },
        "crm",
        `Duplicada de la propiedad #${src.code}`,
      );
    }
    await sql`insert into property_features(property_id, feature_id) select ${row.id}, feature_id from property_features where property_id = ${id}`.execute(trx);
    await trx.insertInto("property_status_history").values({ property_id: row.id, from_status: null, to_status: "draft", changed_by: actorUserId(actor), reason: `Duplicada de #${src.code}` }).execute();
    if (actor.kind === "staff") {
      await trx.insertInto("property_agents").values({ property_id: row.id, user_id: actor.userId, role: "lead" }).onConflict((oc) => oc.doNothing()).execute();
    }
    await audit(trx, actor, { action: "PROPERTY_DUPLICATED", entityType: "property", entityId: row.id, after: { code, title, typeKey: src.type_key, operations: ops.length }, metadata: { sourceId: id, sourceCode: src.code } });
    await emitEvent(trx, actor, { type: "property.created", aggregateType: "property", aggregateId: row.id, payload: { code, duplicatedFrom: id, link: `/crm/propiedades/${row.id}` } });
    return row;
  });
}
