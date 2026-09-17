/**
 * AI Marketing Director: desde una propiedad del CRM genera BORRADORES por canal. Flujo: IA (o plantilla) genera →
 * persona revisa/edita → persona publica. La publicación automática sigue apagada.
 *
 * - Instagram y Facebook → `social_posts` en `draft` (misma cola, revisión, aprobación, programación y publicación de
 *   /crm/marketing). Fotos: portada + hasta 9 verificadas (igual que `create_social_drafts`).
 * - SEO del sitio, WhatsApp, email y guion de Reel → `property_marketing_drafts` (un borrador abierto por canal).
 *   El SEO se aplica a la ficha solo con confirmación y permiso de edición (auditado, vía `updateProperty`).
 * - Sin clave: plantillas deterministas (content_templates + marketing-templates.ts). Con clave: el modelo redacta con
 *   datos de la ficha delimitados y guardas (marketing-guards.ts); si algo no cierra, queda la plantilla.
 * - Un borrador editado por una persona nunca se pisa al regenerar.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, type Database, type Tx } from "../../db";
import { audit } from "../../audit";
import { actorUserId, can, requirePermission, type Actor } from "../../auth/actor";
import { emitEvent } from "../../events";
import { AppError, conflict, forbidden, invalid, notFound } from "../../errors";
import { isEnabled } from "../../flags";
import { stableStringify, loadPortalProperty } from "../../integrations/portals/snapshot";
import { propertyImages } from "../../media/public-url";
import { MAX_POST_ASSETS } from "../../marketing/drafts";
import { addressLeakInText } from "../../properties/address-leak";
import { publicStreet } from "../../properties/public-helpers";
import { publicZoneLabel } from "../../properties/public";
import { updateProperty } from "../../properties/service";
import { redactForModel, untrustedData } from "../core/governance";
import { marketingDirectorPrompt, type MarketingOutput } from "../prompts/marketing-director";
import { aiAvailable, runExtractTask, type TaskDeps } from "../run-task";
import { marketingViolations } from "./marketing-guards";
import { buildMarketingDrafts, channelText, MARKETING_CHANNELS, MARKETING_RULES_VERSION, type ChannelTemplates, type MarketingChannel, type MarketingDraftSet, type MarketingFacts } from "./marketing-templates";
import { ROOM_KEYS, type RoomKey } from "./rooms";

export const MARKETING_FLAG = "ai_marketing_director";
const SOCIAL = ["instagram", "facebook"] as const;
const OWN = ["site_seo", "whatsapp", "email", "reel_script"] as const;
type OwnChannel = (typeof OWN)[number];
const TEMPLATE_KEY = { instagram: "ai_director_instagram", facebook: "ai_director_facebook" } as const;

async function assertEnabled(db: Database): Promise<void> {
  if (!(await isEnabled(db, MARKETING_FLAG))) throw new AppError("unavailable", "El director de marketing está desactivado");
}

// ───────────────────────────── Datos reales de la ficha ─────────────────────────────

export async function loadMarketingFacts(db: Database, actor: Actor, propertyId: string): Promise<MarketingFacts & { organizationId: string }> {
  const row = await db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .innerJoin("organizations as o", "o.id", "p.organization_id")
    .select(["p.id", "p.organization_id", "p.is_demo", "p.hide_exact_address", "p.address_street", "p.address_number", "p.location_id", "p.credit_eligible", "t.category", "o.name as org_name", "o.founded_year"])
    .where("p.id", "=", propertyId)
    .where("p.deleted_at", "is", null)
    .executeTakeFirst();
  if (!row || row.organization_id !== actor.organizationId) throw notFound("Propiedad");
  if (row.is_demo) throw forbidden("La propiedad demo es ficticia: no se generan borradores de marketing");
  const p = await loadPortalProperty(db, propertyId);
  if (!p) throw notFound("Propiedad");
  const rooms = await db
    .selectFrom("property_media_rooms as r")
    .innerJoin("property_media as m", "m.id", "r.media_id")
    .select("r.room")
    .where("r.property_id", "=", propertyId)
    .where("m.deleted_at", "is", null)
    .where("r.room", "is not", null)
    .orderBy("m.is_cover", "desc")
    .orderBy("m.sort_order")
    .execute();
  const leak = row.hide_exact_address ? addressLeakInText({ street: row.address_street, title: null, description: p.description }) : null;
  return {
    organizationId: row.organization_id,
    code: p.code,
    title: p.title,
    typeName: p.typeName,
    category: row.category,
    operations: p.operations.map((o) => ({ operation: o.operation, currency: o.currency, amount: o.amount, priceHidden: o.priceHidden })),
    zone: await publicZoneLabel(db, row.location_id),
    street: publicStreet(row.address_street, row.address_number, row.hide_exact_address),
    rooms: p.rooms,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    garages: p.garages,
    areas: { totalM2: p.areas.totalM2, coveredM2: p.areas.coveredM2, landM2: p.areas.landM2 },
    creditEligible: row.credit_eligible,
    features: p.features,
    // Si la descripción menciona la altura de una dirección oculta, no se reutiliza en borradores.
    description: leak ? null : p.description,
    publicUrl: p.publicUrl,
    orgName: row.org_name,
    foundedYear: row.founded_year,
    photoRooms: rooms.map((r) => r.room).filter((r): r is RoomKey => (ROOM_KEYS as readonly string[]).includes(r ?? "")),
    photoCount: p.photos.length,
  };
}

async function channelTemplates(db: Database): Promise<ChannelTemplates> {
  const rows = await db.selectFrom("content_templates").select(["key", "body"]).where("key", "in", ["ai_director_instagram", "ai_director_facebook", "ai_director_whatsapp", "ai_director_email"]).where("is_active", "=", true).execute();
  const out: ChannelTemplates = {};
  for (const r of rows) out[r.key.replace("ai_director_", "") as keyof ChannelTemplates] = r.body;
  return out;
}

function hashOf(v: unknown): string {
  return createHash("sha256").update(stableStringify(v)).digest("hex");
}

// ───────────────────────────── IA con guardas ─────────────────────────────

function fromModel(v: MarketingOutput): MarketingDraftSet {
  return {
    site_seo: v.site_seo,
    instagram: { caption: v.instagram.caption, hashtags: v.instagram.hashtags },
    facebook: v.facebook,
    whatsapp: v.whatsapp,
    email: v.email,
    reel_script: { scenes: v.reel_script.scenes },
  };
}

/** Datos de la ficha para el modelo: estructurados + descripción (dato no confiable). Sin dirección oculta ni contactos. */
function factsForModel(f: MarketingFacts): string {
  const structured = {
    codigo: f.code,
    titulo: f.title,
    tipo: f.typeName,
    operaciones: f.operations.map((o) => ({ operacion: o.operation, moneda: o.currency, precio: o.priceHidden || o.amount === null ? "Consultar" : o.amount })),
    zona: f.zone,
    calle_publica: f.street,
    ambientes: f.rooms,
    dormitorios: f.bedrooms,
    banos: f.bathrooms,
    cocheras: f.garages,
    superficies_m2: f.areas,
    apto_credito: f.creditEligible,
    caracteristicas: f.features,
    ambientes_en_fotos: [...new Set(f.photoRooms)],
    cantidad_de_fotos: f.photoCount,
    link_de_la_ficha: f.publicUrl,
    inmobiliaria: f.orgName,
    desde: f.foundedYear,
  };
  return [untrustedData("ficha", JSON.stringify(structured), 6000), untrustedData("descripcion_ficha", redactForModel(f.description ?? "(sin descripción)"), 3000)].join("\n");
}

/**
 * Plantillas con las mismas guardas: el resumen cita la descripción cargada; si esa cita trae cifras que los campos no
 * respaldan (p. ej. un precio escrito a mano, o texto inyectado), los borradores salen sin el resumen.
 */
export function safeTemplateDrafts(facts: MarketingFacts, templates: ChannelTemplates): MarketingDraftSet {
  const set = buildMarketingDrafts(facts, templates);
  const dirty = MARKETING_CHANNELS.some((c) => marketingViolations(channelText(c, set), facts).length > 0);
  return dirty ? buildMarketingDrafts({ ...facts, description: null }, templates) : set;
}

export type GenerateResult = { generatedBy: "template" | "ai"; notice: string | null; created: number; updated: number; kept: MarketingChannel[] };

// ───────────────────────────── Generación ─────────────────────────────

/** `scope: "own"`: solo SEO, WhatsApp, email y Reel (la reacción a property.published: Instagram y Facebook ya los arma
 * la automatización `property_social_drafts`, así no se duplican borradores de redes). */
export const generateSchema = z.object({ propertyId: z.uuid(), mode: z.enum(["template", "ai"]).default("template"), scope: z.enum(["all", "own"]).default("all") });

export async function generateMarketingDrafts(db: Database, actor: Actor, raw: z.input<typeof generateSchema>, deps: TaskDeps = {}): Promise<GenerateResult> {
  requirePermission(actor, "marketing.create");
  const input = generateSchema.parse(raw);
  await assertEnabled(db);
  const facts = await loadMarketingFacts(db, actor, input.propertyId);
  const templates = await channelTemplates(db);
  let set = safeTemplateDrafts(facts, templates);
  let generatedBy: "template" | "ai" = "template";
  let promptVersion: string | null = null;
  let notice: string | null = null;

  if (input.mode === "ai") {
    const res = await runExtractTask({
      db,
      who: { organizationId: facts.organizationId, userId: actorUserId(actor), requestId: actor.requestId },
      purpose: "marketing_draft",
      feature: "ai.marketing_director",
      task: "answer",
      prompt: marketingDirectorPrompt,
      context: [factsForModel(facts)],
      messages: [{ role: "user", content: "Prepará los borradores de todos los canales con los datos de la ficha." }],
      maxTokens: 2500,
      timeoutMs: 40_000,
      entityType: "property",
      entityId: input.propertyId,
      deps,
      verify: (v) => {
        const draft = fromModel(v);
        return MARKETING_CHANNELS.flatMap((c) => marketingViolations(channelText(c, draft), facts));
      },
    });
    if (res.ok) {
      set = fromModel(res.value);
      generatedBy = "ai";
      promptVersion = res.promptRef;
    } else {
      notice =
        res.reason === "not_configured"
          ? "La IA no está configurada: se usaron las plantillas con los datos de la ficha."
          : res.reason === "guard_blocked"
            ? "La redacción de la IA mencionaba datos que la ficha no tiene: se descartó y se usaron las plantillas."
            : "La IA no respondió: se usaron las plantillas con los datos de la ficha.";
    }
  }

  const sourceHash = hashOf({ v: MARKETING_RULES_VERSION, facts, templates, generatedBy, set: generatedBy === "ai" ? set : null });
  const images = (await propertyImages(db, input.propertyId, { onlyVerified: true })).slice(0, MAX_POST_ASSETS);
  const userId = actorUserId(actor);
  const result = await db.transaction().execute(async (trx) => {
    await trx.selectFrom("properties").select("id").where("id", "=", input.propertyId).forUpdate().executeTakeFirstOrThrow();
    let created = 0;
    let updated = 0;
    const kept: MarketingChannel[] = [];
    for (const channel of OWN) {
      const content = set[channel];
      const open = await trx.selectFrom("property_marketing_drafts").select(["id", "generated_by", "source_hash", "content"]).where("property_id", "=", input.propertyId).where("channel", "=", channel).where("status", "=", "draft").forUpdate().executeTakeFirst();
      if (open?.generated_by === "human") {
        kept.push(channel);
        continue;
      }
      if (open && open.source_hash === sourceHash) continue;
      const values = { content: JSON.stringify(content), generated_by: generatedBy, prompt_version: promptVersion, rules_version: MARKETING_RULES_VERSION, source_hash: sourceHash, updated_by: userId };
      if (open) {
        await trx.updateTable("property_marketing_drafts").set(values).where("id", "=", open.id).execute();
        updated++;
      } else {
        await trx.insertInto("property_marketing_drafts").values({ ...values, organization_id: facts.organizationId, property_id: input.propertyId, channel, created_by: userId }).execute();
        created++;
      }
    }
    for (const channel of input.scope === "own" ? [] : SOCIAL) {
      const caption = channel === "instagram" ? set.instagram.caption : set.facebook.text;
      const existing = await trx
        .selectFrom("social_posts")
        .select(["id", "generated_by", "caption"])
        .where("property_id", "=", input.propertyId)
        .where("channel", "=", channel)
        .where("template_key", "=", TEMPLATE_KEY[channel])
        .where("status", "in", ["draft", "in_review"])
        .forUpdate()
        .executeTakeFirst();
      if (existing?.generated_by === "human") {
        kept.push(channel);
        continue;
      }
      if (existing) {
        if (existing.caption !== caption) {
          await trx.updateTable("social_posts").set({ caption, generated_by: generatedBy, prompt_version: promptVersion }).where("id", "=", existing.id).execute();
          updated++;
        }
        continue;
      }
      const post = await trx
        .insertInto("social_posts")
        .values({ property_id: input.propertyId, channel, status: "draft", caption, template_key: TEMPLATE_KEY[channel], generated_by: generatedBy, prompt_version: promptVersion, created_by: userId })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (images.length) await trx.insertInto("social_assets").values(images.map((img, i) => ({ social_post_id: post.id, property_media_id: img.id, sort_order: i }))).execute();
      created++;
    }
    if (created || updated) {
      await audit(trx, actor, { action: "MARKETING_DRAFTS_GENERATED", entityType: "property", entityId: input.propertyId, after: { generatedBy, created, updated, kept, promptVersion } });
      await emitEvent(trx, actor, {
        type: "marketing.draft_created",
        aggregateType: "property",
        aggregateId: input.propertyId,
        payload: { generatedBy, created, updated, channels: MARKETING_CHANNELS.filter((c) => !kept.includes(c)) },
        dedupeKey: `marketing.draft_created:${input.propertyId}:${sourceHash.slice(0, 32)}`,
      });
    }
    return { created, updated, kept };
  });
  return { generatedBy, notice, ...result };
}

// ───────────────────────────── Revisión humana ─────────────────────────────

const contentSchemas = {
  site_seo: z.object({ title: z.string().trim().min(10, "El título es muy corto").max(70, "Máximo 70 caracteres"), description: z.string().trim().min(30, "La descripción es muy corta").max(160, "Máximo 160 caracteres") }),
  whatsapp: z.object({ text: z.string().trim().min(10).max(900, "Máximo 900 caracteres") }),
  email: z.object({ subject: z.string().trim().min(3).max(120), body: z.string().trim().min(20).max(3000) }),
  reel_script: z.object({ scenes: z.array(z.object({ shot: z.string().trim().min(1).max(160), voiceover: z.string().trim().min(1).max(300), on_screen: z.string().trim().max(80) })).min(1).max(8) }),
} satisfies Record<OwnChannel, z.ZodType>;

export const updateDraftSchema = z.object({ draftId: z.uuid(), content: z.record(z.string(), z.unknown()) });

async function loadDraft(trx: Tx, actor: Actor, draftId: string) {
  const d = await trx.selectFrom("property_marketing_drafts").selectAll().where("id", "=", draftId).forUpdate().executeTakeFirst();
  if (!d || d.organization_id !== actor.organizationId) throw notFound("Borrador");
  return d;
}

export async function updateMarketingDraft(db: Database, actor: Actor, raw: z.input<typeof updateDraftSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "marketing.create");
  const input = updateDraftSchema.parse(raw);
  await assertEnabled(db);
  return db.transaction().execute(async (trx) => {
    const d = await loadDraft(trx, actor, input.draftId);
    if (d.status !== "draft") throw conflict("Este borrador ya no se puede editar");
    const parsed = contentSchemas[d.channel as OwnChannel].safeParse(input.content);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fieldErrors[i.path.join(".") || "_"] ??= []).push(i.message);
      throw invalid("Revisá el borrador", fieldErrors);
    }
    if (JSON.stringify(d.content) === JSON.stringify(parsed.data)) return { changed: false };
    await trx.updateTable("property_marketing_drafts").set({ content: JSON.stringify(parsed.data), generated_by: "human", updated_by: actorUserId(actor) }).where("id", "=", d.id).execute();
    await audit(trx, actor, { action: "MARKETING_DRAFT_EDITED", entityType: "property", entityId: d.property_id, before: { draftId: d.id, content: d.content }, after: { draftId: d.id, content: parsed.data } });
    return { changed: true };
  });
}

export const draftIdSchema = z.object({ draftId: z.uuid() });

export async function discardMarketingDraft(db: Database, actor: Actor, raw: z.input<typeof draftIdSchema>): Promise<{ changed: boolean }> {
  requirePermission(actor, "marketing.create");
  const input = draftIdSchema.parse(raw);
  return db.transaction().execute(async (trx) => {
    const d = await loadDraft(trx, actor, input.draftId);
    if (d.status !== "draft") return { changed: false };
    await trx.updateTable("property_marketing_drafts").set({ status: "discarded", discarded_by: actorUserId(actor), discarded_at: new Date() }).where("id", "=", d.id).execute();
    await audit(trx, actor, { action: "MARKETING_DRAFT_DISCARDED", entityType: "property", entityId: d.property_id, after: { draftId: d.id, channel: d.channel } });
    return { changed: true };
  });
}

/** Aplica el SEO revisado a la ficha (título y descripción SEO). Requiere editar propiedades. Auditado dos veces: el cambio de la ficha y el borrador. */
export async function applySeoDraft(db: Database, actor: Actor, raw: z.input<typeof draftIdSchema>): Promise<{ applied: boolean }> {
  requirePermission(actor, "marketing.create");
  requirePermission(actor, "properties.update");
  const input = draftIdSchema.parse(raw);
  await assertEnabled(db);
  const d = await db.selectFrom("property_marketing_drafts").selectAll().where("id", "=", input.draftId).executeTakeFirst();
  if (!d || d.organization_id !== actor.organizationId) throw notFound("Borrador");
  if (d.channel !== "site_seo") throw invalid("Solo el borrador de SEO se aplica a la ficha");
  if (d.status !== "draft") throw conflict("Este borrador ya se aplicó o se descartó");
  const content = contentSchemas.site_seo.parse(d.content);
  await updateProperty(db, actor, d.property_id, { seoTitle: content.title, seoDescription: content.description });
  await db.transaction().execute(async (trx) => {
    const locked = await loadDraft(trx, actor, d.id);
    if (locked.status !== "draft") return;
    await trx.updateTable("property_marketing_drafts").set({ status: "applied", applied_by: actorUserId(actor), applied_at: new Date() }).where("id", "=", d.id).execute();
    await audit(trx, actor, { action: "MARKETING_SEO_APPLIED", entityType: "property", entityId: d.property_id, after: { draftId: d.id, seoTitle: content.title, seoDescription: content.description } });
  });
  return { applied: true };
}

// ───────────────────────────── Lectura ─────────────────────────────

export type MarketingDirectorView = {
  enabled: boolean;
  canCreate: boolean;
  canApplySeo: boolean;
  aiAvailable: boolean;
  drafts: Array<{ id: string; channel: OwnChannel; content: Record<string, unknown>; generatedBy: string; updatedAt: Date }>;
  social: Array<{ id: string; channel: "instagram" | "facebook"; status: string; caption: string; generatedBy: string; updatedAt: Date }>;
};

export async function getMarketingDirector(db: Database, actor: Actor, propertyId: string, deps: TaskDeps = {}): Promise<MarketingDirectorView> {
  requirePermission(actor, "marketing.read");
  if (!z.uuid().safeParse(propertyId).success) throw notFound("Propiedad");
  const enabled = await isEnabled(db, MARKETING_FLAG);
  const canCreate = can(actor, "marketing.create");
  if (!enabled) return { enabled, canCreate, canApplySeo: false, aiAvailable: false, drafts: [], social: [] };
  const [drafts, social] = await Promise.all([
    db
      .selectFrom("property_marketing_drafts")
      .select(["id", "channel", "content", "generated_by", "updated_at"])
      .where("property_id", "=", propertyId)
      .where("organization_id", "=", actor.organizationId)
      .where("status", "=", "draft")
      .orderBy(sql`array_position(array['site_seo','whatsapp','email','reel_script'], channel)`)
      .execute(),
    db
      .selectFrom("social_posts as s")
      .innerJoin("properties as p", "p.id", "s.property_id")
      .select(["s.id", "s.channel", "s.status", "s.caption", "s.generated_by", "s.updated_at"])
      .where("s.property_id", "=", propertyId)
      .where("p.organization_id", "=", actor.organizationId)
      .where("s.template_key", "in", Object.values(TEMPLATE_KEY))
      .where("s.status", "not in", ["rejected"])
      .orderBy("s.updated_at", "desc")
      .limit(10)
      .execute(),
  ]);
  return {
    enabled,
    canCreate,
    canApplySeo: canCreate && can(actor, "properties.update"),
    aiAvailable: canCreate ? await aiAvailable(db, deps) : false,
    drafts: drafts.map((d) => ({ id: d.id, channel: d.channel as OwnChannel, content: d.content as Record<string, unknown>, generatedBy: d.generated_by, updatedAt: new Date(d.updated_at) })),
    social: social.map((s) => ({ id: s.id, channel: s.channel as "instagram" | "facebook", status: s.status, caption: s.caption, generatedBy: s.generated_by, updatedAt: new Date(s.updated_at) })),
  };
}
