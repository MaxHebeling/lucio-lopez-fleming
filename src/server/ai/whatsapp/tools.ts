/**
 * Herramientas del asistente de WhatsApp. Consultan la BASE REAL (solo propiedades publicadas) y registran
 * cada dato devuelto como "hecho verificable" del turno para las guardas posteriores.
 * Nunca exponen datos privados: ni dirección exacta si `hide_exact_address`, ni propietarios, ni notas internas.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { sql, type Database } from "../../db";
import { audit } from "../../audit";
import type { SystemActor } from "../../auth/actor";
import { notifyRole, notifyUser } from "../../notifications";
import { formatArea, formatMoney } from "../../../components/ui/format";
import { OPERATION_LABEL, STATUS_LABEL, type Operation, type PropertyStatus } from "../../properties/schema";
import { addGroundedText, normalizeUrl, type GroundingFacts } from "../guards";
import { HANDOFF_REASONS } from "../../conversations/labels";

export type ToolContext = {
  db: Database;
  actor: SystemActor;
  conversationId: string;
  inboundMessageId: string;
  facts: GroundingFacts;
  appUrl: string;
  /** Pedido de derivación hecho por la IA durante el turno */
  handoff: { reason: string; note: string | null } | null;
};

const PROPERTY_TYPE_KEYS = [
  "casa",
  "departamento",
  "ph",
  "terreno",
  "lote",
  "local",
  "oficina",
  "deposito",
  "galpon",
  "campo",
  "cochera",
  "hotel",
  "negocio_especial",
  "emprendimiento",
  "otro",
] as const;

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "search_properties",
    description:
      "Busca propiedades PUBLICADAS y disponibles (o reservadas) de Lucio López Fleming en la base real. Devuelve código, título, tipo, estado, operaciones con precio (o 'Consultar'), ubicación, dormitorios, superficies y link público. Es la única fuente válida de precios, superficies, ubicaciones y disponibilidad. Si no hay resultados, no inventes alternativas.",
    input_schema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["sale", "rent", "temporary_rent"], description: "sale=venta, rent=alquiler, temporary_rent=alquiler temporario" },
        property_type: { type: "string", enum: [...PROPERTY_TYPE_KEYS] },
        locality: { type: "string", description: "Localidad, barrio o zona tal como la dijo el cliente (p. ej. 'Tres Cerritos', 'San Lorenzo')" },
        min_price: { type: "number" },
        max_price: { type: "number" },
        currency: { type: "string", enum: ["USD", "ARS"], description: "Obligatoria si se filtra por precio" },
        min_bedrooms: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 5 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_property",
    description: "Trae el detalle de UNA propiedad publicada por su código numérico. Usala antes de mencionar datos de una propiedad concreta, aunque ya la hayas nombrado antes.",
    input_schema: {
      type: "object",
      properties: { code: { type: "integer", minimum: 1 } },
      required: ["code"],
      additionalProperties: false,
    },
  },
  {
    name: "record_requirements",
    description: "Guarda lo que busca el cliente (operación, tipo, zona, dormitorios, presupuesto, nombre) en el CRM. Solo datos que el cliente dijo explícitamente; nunca datos sensibles.",
    input_schema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["sale", "rent", "temporary_rent", "appraisal", "sell_my_property", "other"] },
        property_types: { type: "array", items: { type: "string", enum: [...PROPERTY_TYPE_KEYS] }, maxItems: 5 },
        localities: { type: "array", items: { type: "string" }, maxItems: 5 },
        min_bedrooms: { type: "integer", minimum: 0 },
        budget_max: { type: "number", minimum: 0 },
        budget_currency: { type: "string", enum: ["USD", "ARS"] },
        customer_name: { type: "string" },
        notes: { type: "string", description: "Otros requisitos en una frase corta" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "request_visit",
    description:
      "Registra un PEDIDO de visita para que un asesor lo confirme. NO agenda ni confirma turnos. Después avisá al cliente que un asesor lo va a contactar para coordinar día y horario.",
    input_schema: {
      type: "object",
      properties: {
        property_code: { type: "integer", minimum: 1 },
        preferred_times: { type: "string", description: "Días/horarios que propuso el cliente, textual" },
        notes: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description: "Deriva la conversación a una persona del equipo. Después de esto el asistente deja de responder en esta conversación.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", enum: HANDOFF_REASONS.filter((r) => !["ai_error", "ai_guard", "budget_exhausted", "ai_unavailable", "bot_disabled", "unsupported_message", "taken_by_agent"].includes(r)) },
        note: { type: "string" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];

// ───────────────────────────── Esquemas de entrada (validación real) ─────────────────────────────

const searchSchema = z
  .object({
    operation: z.enum(["sale", "rent", "temporary_rent"]).optional(),
    property_type: z.enum(PROPERTY_TYPE_KEYS).optional(),
    locality: z.string().trim().min(2).max(80).optional(),
    min_price: z.number().nonnegative().optional(),
    max_price: z.number().nonnegative().optional(),
    currency: z.enum(["USD", "ARS"]).optional(),
    min_bedrooms: z.number().int().min(0).max(50).optional(),
    limit: z.number().int().min(1).max(5).optional(),
  })
  .refine((v) => (v.min_price === undefined && v.max_price === undefined) || v.currency, { message: "currency es obligatoria para filtrar por precio" });

const getSchema = z.object({ code: z.number().int().positive() });

const requirementsSchema = z.object({
  operation: z.enum(["sale", "rent", "temporary_rent", "appraisal", "sell_my_property", "other"]).optional(),
  property_types: z.array(z.enum(PROPERTY_TYPE_KEYS)).max(5).optional(),
  localities: z.array(z.string().trim().min(1).max(80)).max(5).optional(),
  min_bedrooms: z.number().int().min(0).max(50).optional(),
  budget_max: z.number().nonnegative().max(1e12).optional(),
  budget_currency: z.enum(["USD", "ARS"]).optional(),
  customer_name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

const visitSchema = z.object({
  property_code: z.number().int().positive().optional(),
  preferred_times: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(500).optional(),
});

const handoffSchema = z.object({ reason: z.enum(HANDOFF_REASONS), note: z.string().trim().max(300).optional() });

// ───────────────────────────── Propiedades ─────────────────────────────

type PropertyRow = {
  id: string;
  code: number;
  slug: string;
  title: string;
  type_name: string;
  status: string;
  location_name: string | null;
  parent_location_name: string | null;
  hide_exact_address: boolean;
  address_street: string | null;
  address_number: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  rooms: number | null;
  garages: number | null;
  total_area_m2: string | null;
  covered_area_m2: string | null;
  land_area_m2: string | null;
  description: string | null;
};

type OperationRow = { property_id: string; operation: string; currency: string; amount: string | null; price_hidden: boolean; expenses_amount: string | null; expenses_currency: string | null };

function baseQuery(db: Database) {
  return db
    .selectFrom("properties as p")
    .innerJoin("property_types as t", "t.key", "p.type_key")
    .leftJoin("locations as l", "l.id", "p.location_id")
    .leftJoin("locations as lp", "lp.id", "l.parent_id")
    .select([
      "p.id",
      "p.code",
      "p.slug",
      "p.title",
      "t.name as type_name",
      "p.status",
      "l.name as location_name",
      "lp.name as parent_location_name",
      "p.hide_exact_address",
      "p.address_street",
      "p.address_number",
      "p.bedrooms",
      "p.bathrooms",
      "p.rooms",
      "p.garages",
      "p.total_area_m2",
      "p.covered_area_m2",
      "p.land_area_m2",
      "p.description",
    ])
    .where("p.is_published", "=", true)
    .where("p.deleted_at", "is", null);
}

async function operationsFor(db: Database, ids: string[]): Promise<OperationRow[]> {
  if (!ids.length) return [];
  return db
    .selectFrom("property_operations")
    .select(["property_id", "operation", "currency", "amount", "price_hidden", "expenses_amount", "expenses_currency"])
    .where("property_id", "in", ids)
    .where("is_active", "=", true)
    .orderBy("operation")
    .execute();
}

function recordArea(facts: GroundingFacts, v: string | null): string | null {
  if (v === null) return null;
  facts.areas.add(Math.round(Number(v) * 100) / 100);
  return formatArea(v);
}

function toFact(p: PropertyRow, ops: OperationRow[], ctx: ToolContext, detail: boolean) {
  const f = ctx.facts;
  f.propertyCodes.add(p.code);
  const path = `/propiedades/${p.slug}`;
  const link = `${ctx.appUrl}${path}`;
  f.urls.add(normalizeUrl(link));
  f.urls.add(normalizeUrl(path));
  const operations = ops
    .filter((o) => o.property_id === p.id)
    .map((o) => {
      const visible = !o.price_hidden && o.amount !== null;
      if (visible) f.amounts.add(Math.round(Number(o.amount) * 100) / 100);
      if (o.expenses_amount !== null) f.amounts.add(Math.round(Number(o.expenses_amount) * 100) / 100);
      return {
        operation: OPERATION_LABEL[o.operation as Operation] ?? o.operation,
        price: visible ? formatMoney(o.amount, o.currency) : "Consultar",
        ...(o.expenses_amount !== null ? { expenses: formatMoney(o.expenses_amount, o.expenses_currency ?? o.currency) } : {}),
      };
    });
  if (detail && p.description) addGroundedText(f, p.description.slice(0, 1200));
  const location = [p.location_name, p.parent_location_name].filter(Boolean).join(", ") || null;
  const address = !p.hide_exact_address && p.address_street ? [p.address_street, p.address_number].filter(Boolean).join(" ") : null;
  return {
    code: p.code,
    title: p.title,
    type: p.type_name,
    status: STATUS_LABEL[p.status as PropertyStatus] ?? p.status,
    operations,
    location,
    address: address ?? "No se informa la dirección exacta",
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    total_area: recordArea(f, p.total_area_m2),
    covered_area: recordArea(f, p.covered_area_m2),
    ...(detail ? { land_area: recordArea(f, p.land_area_m2), rooms: p.rooms, garages: p.garages, description: p.description?.slice(0, 1200) ?? null } : {}),
    link,
  };
}

async function searchProperties(raw: unknown, ctx: ToolContext) {
  const input = searchSchema.parse(raw);
  const limit = input.limit ?? 5;
  let q = baseQuery(ctx.db).where("p.status", "in", ["available", "reserved"]);
  if (input.property_type) q = q.where("p.type_key", "=", input.property_type);
  if (input.min_bedrooms !== undefined) q = q.where("p.bedrooms", ">=", input.min_bedrooms);
  if (input.locality) {
    const term = `%${input.locality.toLowerCase().replace(/[%_\\]/g, "")}%`;
    q = q.where((eb) =>
      eb.or([
        eb(sql`f_unaccent(lower(l.name))`, "like", sql`f_unaccent(${term})`),
        eb(sql`f_unaccent(lower(lp.name))`, "like", sql`f_unaccent(${term})`),
      ]),
    );
  }
  if (input.operation || input.min_price !== undefined || input.max_price !== undefined) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom("property_operations as o")
          .select("o.id")
          .whereRef("o.property_id", "=", "p.id")
          .where("o.is_active", "=", true)
          .$if(Boolean(input.operation), (qb) => qb.where("o.operation", "=", input.operation!))
          .$if(input.min_price !== undefined || input.max_price !== undefined, (qb) =>
            qb.where("o.currency", "=", input.currency!).where("o.price_hidden", "=", false).where("o.amount", "is not", null),
          )
          .$if(input.min_price !== undefined, (qb) => qb.where("o.amount", ">=", String(input.min_price)))
          .$if(input.max_price !== undefined, (qb) => qb.where("o.amount", "<=", String(input.max_price))),
      ),
    );
  }
  const rows = (await q.orderBy("p.featured", "desc").orderBy("p.published_at", "desc").limit(limit + 1).execute()) as PropertyRow[];
  const page = rows.slice(0, limit);
  const ops = await operationsFor(ctx.db, page.map((r) => r.id));
  await rememberShown(ctx, page.map((r) => r.code));
  return {
    results: page.map((r) => toFact(r, ops, ctx, false)),
    count: page.length,
    more_available: rows.length > limit,
    note: page.length ? undefined : "No hay propiedades publicadas que coincidan. No ofrezcas otras por tu cuenta: ofrecé que un asesor busque opciones.",
  };
}

async function getProperty(raw: unknown, ctx: ToolContext) {
  const { code } = getSchema.parse(raw);
  const row = (await baseQuery(ctx.db).where("p.code", "=", code).executeTakeFirst()) as PropertyRow | undefined;
  if (!row) return { found: false, note: `No hay una propiedad publicada con el código ${code}.` };
  const ops = await operationsFor(ctx.db, [row.id]);
  const features = await ctx.db
    .selectFrom("property_features as pf")
    .innerJoin("features as f", "f.id", "pf.feature_id")
    .select(["f.name"])
    .where("pf.property_id", "=", row.id)
    .orderBy("f.sort_order")
    .execute();
  await rememberShown(ctx, [row.code]);
  return { found: true, property: { ...toFact(row, ops, ctx, true), features: features.map((f) => f.name) } };
}

async function rememberShown(ctx: ToolContext, codes: number[]) {
  if (!codes.length) return;
  await sql`
    update conversations set collected = jsonb_set(collected, '{properties_shown}',
      (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (
         select jsonb_array_elements(coalesce(collected->'properties_shown', '[]'::jsonb)) as x
         union select to_jsonb(c) from unnest(${codes}::int[]) as c) s))
    where id = ${ctx.conversationId}`.execute(ctx.db);
}

// ───────────────────────────── Requisitos, visitas y derivación ─────────────────────────────

async function currentLead(ctx: ToolContext) {
  return ctx.db
    .selectFrom("leads")
    .select(["id", "assigned_user_id", "operation_interest"])
    .where("conversation_id", "=", ctx.conversationId)
    .where("deleted_at", "is", null)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
}

async function recordRequirements(raw: unknown, ctx: ToolContext) {
  const input = requirementsSchema.parse(raw);
  if (input.budget_max !== undefined) ctx.facts.amounts.add(Math.round(input.budget_max * 100) / 100);
  await ctx.db.transaction().execute(async (trx) => {
    const conv = await trx.selectFrom("conversations").select(["collected"]).where("id", "=", ctx.conversationId).forUpdate().executeTakeFirstOrThrow();
    const collected = (conv.collected ?? {}) as Record<string, unknown>;
    const previous = (collected.requirements ?? {}) as Record<string, unknown>;
    const requirements = { ...previous, ...input, updated_at: new Date().toISOString() };
    await trx
      .updateTable("conversations")
      .set({ collected: JSON.stringify({ ...collected, requirements }) })
      .where("id", "=", ctx.conversationId)
      .execute();
    const lead = await trx
      .selectFrom("leads")
      .select(["id", "operation_interest"])
      .where("conversation_id", "=", ctx.conversationId)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (lead) {
      if (!lead.operation_interest && input.operation) {
        await trx.updateTable("leads").set({ operation_interest: input.operation }).where("id", "=", lead.id).execute();
      }
      await trx
        .insertInto("activities")
        .values({ entity_type: "lead", entity_id: lead.id, kind: "requirements_recorded", summary: "Requisitos registrados por el asistente de WhatsApp", metadata: JSON.stringify({ requirements: input, conversationId: ctx.conversationId }) })
        .execute();
    }
  });
  return { saved: true };
}

async function requestVisit(raw: unknown, ctx: ToolContext) {
  const input = visitSchema.parse(raw);
  let property: { id: string; code: number; title: string } | undefined;
  if (input.property_code) {
    property = await ctx.db
      .selectFrom("properties")
      .select(["id", "code", "title"])
      .where("code", "=", input.property_code)
      .where("is_published", "=", true)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    if (!property) return { requested: false, note: `No hay una propiedad publicada con el código ${input.property_code}. No registres la visita; ofrecé que un asesor lo contacte.` };
    ctx.facts.propertyCodes.add(property.code);
  }
  const lead = await currentLead(ctx);
  const conv = await ctx.db.selectFrom("conversations").select(["assigned_user_id", "external_thread_id"]).where("id", "=", ctx.conversationId).executeTakeFirstOrThrow();
  const agent = property
    ? await ctx.db
        .selectFrom("property_agents as pa")
        .innerJoin("users as u", "u.id", "pa.user_id")
        .select("pa.user_id")
        .where("pa.property_id", "=", property.id)
        .where("pa.role", "=", "lead")
        .where("u.is_active", "=", true)
        .where("u.deleted_at", "is", null)
        .executeTakeFirst()
    : undefined;
  const assignee = agent?.user_id ?? lead?.assigned_user_id ?? conv.assigned_user_id ?? null;
  const dedupeKey = `whatsapp:visit:${ctx.inboundMessageId}:${property?.code ?? "sin-propiedad"}`;
  const description = [
    property ? `Propiedad #${property.code} — ${property.title}` : "Propiedad a definir",
    `WhatsApp: +${conv.external_thread_id}`,
    input.preferred_times ? `Horarios propuestos por el cliente: ${input.preferred_times}` : null,
    input.notes ? `Notas: ${input.notes}` : null,
    "Pedido registrado por el asistente virtual. NO está confirmado: coordinar con el cliente y agendar.",
  ]
    .filter(Boolean)
    .join("\n");
  const task = await ctx.db.transaction().execute(async (trx) => {
    const t = await trx
      .insertInto("tasks")
      .values({
        title: property ? `Coordinar visita a #${property.code}` : "Coordinar visita pedida por WhatsApp",
        description,
        kind: "whatsapp",
        priority: "high",
        due_at: new Date(Date.now() + 2 * 3_600_000),
        assigned_user_id: assignee,
        entity_type: lead ? "lead" : property ? "property" : null,
        entity_id: lead?.id ?? property?.id ?? null,
        dedupe_key: dedupeKey,
      })
      .onConflict((oc) => oc.column("dedupe_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (t) {
      await audit(trx, ctx.actor, { action: "VISIT_REQUESTED", entityType: "conversation", entityId: ctx.conversationId, after: { taskId: t.id, propertyCode: property?.code ?? null } });
      const n = { kind: "visit_request", title: "Pedido de visita por WhatsApp", body: description, link: `/crm/conversaciones/${ctx.conversationId}`, entityType: "conversation", entityId: ctx.conversationId, dedupeKey };
      if (assignee) await notifyUser(trx, assignee, n);
      else await notifyRole(trx, "administrador", n);
    }
    return t;
  });
  return { requested: true, duplicate: !task, confirmed: false, note: "Pedido registrado. Un asesor va a contactar al cliente para confirmar día y horario. No confirmes ningún turno." };
}

async function handoffToHuman(raw: unknown, ctx: ToolContext) {
  const input = handoffSchema.parse(raw);
  ctx.handoff = { reason: input.reason, note: input.note ?? null };
  return { ok: true, note: "Avisale al cliente que una persona del equipo va a continuar la conversación." };
}

const EXECUTORS: Record<string, (raw: unknown, ctx: ToolContext) => Promise<unknown>> = {
  search_properties: searchProperties,
  get_property: getProperty,
  record_requirements: recordRequirements,
  request_visit: requestVisit,
  handoff_to_human: handoffToHuman,
};

export type ToolCallLog = { name: string; input: unknown; ok: boolean; error?: string; ms: number };

export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean; log: ToolCallLog }> {
  const t0 = Date.now();
  const exec = EXECUTORS[name];
  if (!exec) {
    return { content: JSON.stringify({ error: `Herramienta desconocida: ${name}` }), isError: true, log: { name, input, ok: false, error: "unknown_tool", ms: 0 } };
  }
  try {
    const result = await exec(input, ctx);
    return { content: JSON.stringify(result), isError: false, log: { name, input, ok: true, ms: Date.now() - t0 } };
  } catch (e) {
    const message = e instanceof z.ZodError ? `Parámetros inválidos: ${e.issues.map((i) => i.message).join("; ")}` : "Error interno al consultar el CRM";
    if (!(e instanceof z.ZodError)) throw e; // errores de base: se propagan (el turno falla y se reintenta)
    return { content: JSON.stringify({ error: message }), isError: true, log: { name, input, ok: false, error: message, ms: Date.now() - t0 } };
  }
}
