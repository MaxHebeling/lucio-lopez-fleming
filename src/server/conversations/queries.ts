/** Lecturas de la bandeja de conversaciones (permiso conversations.read + alcance de ./scope). Columnas explícitas. */
import { z } from "zod";
import { sql, type Database } from "../db";
import { requirePermission, requireStaff, type Actor } from "../auth/actor";
import { notFound } from "../errors";
import { isEnabled } from "../flags";
import { conversationInScopeSql, conversationScopeUserId } from "./scope";
import { reengagementTemplate, isWindowOpen, CUSTOMER_SERVICE_WINDOW_MS, whatsappSendConfig } from "../integrations/whatsapp/config";

export const inboxFilterSchema = z.object({
  view: z.enum(["open", "bot", "human", "closed"]).catch("open"),
  mine: z.preprocess((v) => v === "1" || v === true, z.boolean()).catch(false),
  unanswered: z.preprocess((v) => v === "1" || v === true, z.boolean()).catch(false),
  q: z.string().trim().max(80).optional().catch(undefined),
  before: z.iso.datetime({ offset: true }).optional().catch(undefined),
});
export type InboxFilter = z.infer<typeof inboxFilterSchema>;

export const INBOX_PAGE_SIZE = 40;

export type InboxItem = {
  id: string;
  mode: string;
  contactName: string | null;
  phone: string;
  assignedName: string | null;
  assignedToMe: boolean;
  handoffReason: string | null;
  lastMessageAt: Date | null;
  lastBody: string | null;
  lastDirection: string | null;
  lastStatus: string | null;
  unanswered: boolean;
};

export async function listConversations(db: Database, actor: Actor, raw: unknown): Promise<{ items: InboxItem[]; nextBefore: string | null; filter: InboxFilter }> {
  requirePermission(actor, "conversations.read");
  requireStaff(actor);
  const filter = inboxFilterSchema.parse(raw ?? {});
  let q = db
    .selectFrom("conversations as c")
    .leftJoin("contacts as ct", "ct.id", "c.contact_id")
    .leftJoin("users as u", "u.id", "c.assigned_user_id")
    .select([
      "c.id",
      "c.mode",
      "c.external_thread_id",
      "c.assigned_user_id",
      "c.handoff_reason",
      "c.last_message_at",
      "c.last_inbound_at",
      "c.last_outbound_at",
      "ct.display_name",
      "u.full_name as assigned_name",
    ])
    .select((eb) => [
      eb
        .selectFrom("conversation_messages as m")
        .select("m.body")
        .whereRef("m.conversation_id", "=", "c.id")
        .orderBy("m.created_at", "desc")
        .limit(1)
        .as("last_body"),
      eb
        .selectFrom("conversation_messages as m")
        .select("m.direction")
        .whereRef("m.conversation_id", "=", "c.id")
        .orderBy("m.created_at", "desc")
        .limit(1)
        .as("last_direction"),
      eb
        .selectFrom("conversation_messages as m")
        .select("m.status")
        .whereRef("m.conversation_id", "=", "c.id")
        .orderBy("m.created_at", "desc")
        .limit(1)
        .as("last_status"),
    ])
    .where("c.channel", "=", "whatsapp");

  const scopeUserId = conversationScopeUserId(actor);
  if (scopeUserId) q = q.where(conversationInScopeSql(scopeUserId));
  if (filter.view === "open") q = q.where("c.mode", "in", ["bot", "human"]);
  else q = q.where("c.mode", "=", filter.view);
  if (filter.mine) q = q.where("c.assigned_user_id", "=", actor.userId);
  if (filter.unanswered) {
    q = q
      .where("c.last_inbound_at", "is not", null)
      .where((eb) => eb.or([eb("c.last_outbound_at", "is", null), eb("c.last_outbound_at", "<", eb.ref("c.last_inbound_at"))]));
  }
  if (filter.q) {
    const term = `%${filter.q.toLowerCase().replace(/[%_\\]/g, "")}%`;
    const digits = filter.q.replace(/\D/g, "");
    q = q.where((eb) =>
      eb.or([
        eb(sql`f_unaccent(lower(ct.display_name))`, "like", sql`f_unaccent(${term})`),
        ...(digits.length >= 4 ? [eb("c.external_thread_id", "like", `%${digits}%`)] : []),
      ]),
    );
  }
  if (filter.before) q = q.where("c.last_message_at", "<", new Date(filter.before));

  const rows = await q.orderBy(sql`c.last_message_at desc nulls last`).orderBy("c.id").limit(INBOX_PAGE_SIZE + 1).execute();
  const page = rows.slice(0, INBOX_PAGE_SIZE);
  const last = page.at(-1);
  return {
    filter,
    nextBefore: rows.length > INBOX_PAGE_SIZE && last?.last_message_at ? new Date(last.last_message_at).toISOString() : null,
    items: page.map((r) => ({
      id: r.id,
      mode: r.mode,
      contactName: r.display_name,
      phone: `+${r.external_thread_id}`,
      assignedName: r.assigned_name,
      assignedToMe: r.assigned_user_id === actor.userId,
      handoffReason: r.handoff_reason,
      lastMessageAt: r.last_message_at,
      lastBody: r.last_body,
      lastDirection: r.last_direction,
      lastStatus: r.last_status,
      unanswered: Boolean(r.last_inbound_at && (!r.last_outbound_at || r.last_outbound_at < r.last_inbound_at)),
    })),
  };
}

export type ChannelStatus = {
  whatsappStatus: string;
  whatsappConfigured: boolean;
  outboundEnabled: boolean;
  botEnabled: boolean;
  anthropicStatus: string;
  templateConfigured: boolean;
};

export async function channelStatus(db: Database, actor: Actor): Promise<ChannelStatus> {
  requirePermission(actor, "conversations.read");
  const integrations = await db.selectFrom("integrations").select(["key", "status"]).where("key", "in", ["whatsapp_cloud", "anthropic"]).execute();
  return {
    whatsappStatus: integrations.find((i) => i.key === "whatsapp_cloud")?.status ?? "awaiting_credentials",
    anthropicStatus: integrations.find((i) => i.key === "anthropic")?.status ?? "awaiting_credentials",
    whatsappConfigured: Boolean(whatsappSendConfig().config),
    outboundEnabled: await isEnabled(db, "outbound_whatsapp"),
    botEnabled: await isEnabled(db, "whatsapp_ai_bot"),
    templateConfigured: Boolean(reengagementTemplate()),
  };
}

export async function getConversation(db: Database, actor: Actor, id: string) {
  requirePermission(actor, "conversations.read");
  requireStaff(actor);
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) throw notFound("Conversación");
  const conv = await db
    .selectFrom("conversations as c")
    .leftJoin("contacts as ct", "ct.id", "c.contact_id")
    .leftJoin("users as u", "u.id", "c.assigned_user_id")
    .select([
      "c.id",
      "c.channel",
      "c.mode",
      "c.external_thread_id",
      "c.contact_id",
      "c.assigned_user_id",
      "c.handoff_at",
      "c.handoff_reason",
      "c.summary",
      "c.collected",
      "c.last_inbound_at",
      "c.last_message_at",
      "c.closed_at",
      "c.created_at",
      "ct.display_name as contact_name",
      "u.full_name as assigned_name",
    ])
    .where("c.id", "=", parsedId.data)
    .$if(conversationScopeUserId(actor) !== null, (qb) => qb.where(conversationInScopeSql(conversationScopeUserId(actor)!)))
    .executeTakeFirst();
  if (!conv) throw notFound("Conversación");

  const messages = (
    await db
      .selectFrom("conversation_messages as m")
      .leftJoin("users as u", "u.id", "m.sender_user_id")
      .select(["m.id", "m.direction", "m.sender_kind", "m.body", "m.kind", "m.status", "m.error", "m.error_code", "m.created_at", "m.sent_at", "m.delivered_at", "m.read_at", "u.full_name as sender_name"])
      .where("m.conversation_id", "=", conv.id)
      .orderBy("m.created_at", "desc")
      .orderBy("m.id", "desc")
      .limit(200)
      .execute()
  ).reverse();

  const lead = await db
    .selectFrom("leads as l")
    .leftJoin("properties as p", "p.id", "l.property_id")
    .leftJoin("users as u", "u.id", "l.assigned_user_id")
    .select(["l.id", "l.status", "l.created_at", "l.operation_interest", "p.id as property_id", "p.code as property_code", "p.title as property_title", "u.full_name as assigned_name"])
    .where("l.conversation_id", "=", conv.id)
    .where("l.deleted_at", "is", null)
    .orderBy("l.created_at", "desc")
    .executeTakeFirst();

  const collected = (conv.collected ?? {}) as { requirements?: Record<string, unknown>; properties_shown?: number[] };
  const codes = [...new Set([...(collected.properties_shown ?? []), ...(lead?.property_code ? [lead.property_code] : [])])].filter((n) => Number.isInteger(n)).slice(0, 30);
  const properties = codes.length
    ? await db.selectFrom("properties").select(["id", "code", "title", "status", "is_published"]).where("code", "in", codes).where("deleted_at", "is", null).orderBy("code").execute()
    : [];

  const phones = conv.contact_id
    ? await db.selectFrom("contact_phones").select(["phone_e164", "is_whatsapp"]).where("contact_id", "=", conv.contact_id).execute()
    : [];

  const windowOpen = isWindowOpen(conv.last_inbound_at);
  return {
    conversation: conv,
    messages,
    lead: lead ?? null,
    requirements: collected.requirements ?? null,
    properties,
    phones,
    window: {
      open: windowOpen,
      closesAt: conv.last_inbound_at ? new Date(new Date(conv.last_inbound_at).getTime() + CUSTOMER_SERVICE_WINDOW_MS) : null,
    },
  };
}
