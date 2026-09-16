import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { channelStatus, getConversation } from "@/server/conversations/queries";
import { handoffLabel } from "@/server/conversations/labels";
import { OPERATION_LABEL, STATUS_LABEL, type Operation, type PropertyStatus } from "@/server/properties/schema";
import { Badge, Card, cx, formatDateTime, formatMoney } from "@/components/ui";
import { closeAction, replyAction, retryMessageAction, returnToBotAction, takeAction, templateAction } from "../actions";
import { ActionButton, AutoRefresh, ReplyForm, ScrollToEnd } from "../_components/client";
import { ChannelBanners, MessageStatus, ModeBadge } from "../_components/status";

export const metadata: Metadata = { title: "Conversación" };

const SENDER_LABEL: Record<string, string> = { contact: "Cliente", bot: "Asistente virtual", user: "Equipo", system: "Sistema" };
const LEAD_STATUS: Record<string, string> = { new: "Nuevo", contacted: "Contactado", qualified: "Calificado", unqualified: "No calificado", converted: "Convertido", discarded: "Descartado" };
const KIND_LABEL: Record<string, string> = {
  image: "Foto",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto",
  template: "Plantilla",
  unsupported: "Mensaje no soportado",
};

type Requirements = {
  operation?: string;
  property_types?: string[];
  localities?: string[];
  min_bedrooms?: number;
  budget_max?: number;
  budget_currency?: string;
  customer_name?: string;
  notes?: string;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-stone">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export default async function ConversationPage({ params }: PageProps<"/crm/conversaciones/[id]">) {
  const actor = await requireStaffPage("conversations.read");
  const { id } = await params;
  const db = getDb();
  let data: Awaited<ReturnType<typeof getConversation>>;
  try {
    data = await getConversation(db, actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const status = await channelStatus(db, actor);
  const { conversation: c, messages, lead, requirements, properties, phones, window } = data;
  const canReply = can(actor, "conversations.reply");
  const req = (requirements ?? {}) as Requirements;
  const name = c.contact_name ?? `+${c.external_thread_id}`;
  const assignedToMe = c.assigned_user_id === actor.userId;

  const replyDisabled =
    c.mode === "closed"
      ? "La conversación está cerrada. Tomala para reabrirla y responder."
      : !window.open
        ? "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite enviar una plantilla aprobada."
        : null;

  return (
    <>
      <AutoRefresh seconds={10} />
      <div className="mb-3">
        <Link href="/crm/conversaciones" className="text-sm text-stone underline-offset-4 hover:text-ink hover:underline">
          ← Conversaciones
        </Link>
      </div>
      <ChannelBanners status={status} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="conv-title" className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
          <header className="flex flex-col gap-3 border-b border-line p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 id="conv-title" className="truncate text-xl font-bold tracking-tight text-ink">
                  {name}
                </h1>
                <p className="text-sm text-stone">
                  WhatsApp +{c.external_thread_id} · {c.assigned_name ? `Asignada a ${assignedToMe ? "vos" : c.assigned_name}` : "Sin asignar"}
                </p>
              </div>
              <ModeBadge mode={c.mode} />
            </div>
            {c.mode === "human" && c.handoff_reason ? (
              <p className="text-sm text-ink-2">
                <span className="font-semibold">Derivada:</span> {handoffLabel(c.handoff_reason)} · {formatDateTime(c.handoff_at)}
              </p>
            ) : null}
            <p className="text-xs text-stone">
              {window.open && window.closesAt ? `Ventana de 24 h abierta hasta: ${formatDateTime(window.closesAt)}` : "Ventana de 24 h cerrada: solo plantillas aprobadas."}
            </p>
            {canReply ? (
              <div className="flex flex-wrap gap-2">
                {c.mode !== "human" || !assignedToMe ? (
                  <ActionButton action={takeAction} fields={{ conversationId: c.id }} label={c.mode === "closed" ? "Reabrir y tomar" : "Tomar conversación"} pendingLabel="Tomando…" variant="primary" />
                ) : null}
                {c.mode === "human" ? <ActionButton action={returnToBotAction} fields={{ conversationId: c.id }} label="Devolver al asistente" pendingLabel="Devolviendo…" /> : null}
                {c.mode !== "closed" ? <ActionButton action={closeAction} fields={{ conversationId: c.id }} label="Cerrar" pendingLabel="Cerrando…" variant="ghost" /> : null}
                {!window.open && c.mode !== "closed" && status.templateConfigured ? (
                  <ActionButton action={templateAction} fields={{ conversationId: c.id }} withKey label="Enviar plantilla aprobada" pendingLabel="Encolando…" />
                ) : null}
              </div>
            ) : null}
          </header>

          <ol id="chat-log" role="log" aria-label="Mensajes" aria-live="polite" className="flex max-h-[65svh] min-h-64 flex-col gap-3 overflow-y-auto bg-paper p-3 sm:p-4">
            {messages.length === 0 ? <li className="text-center text-sm text-stone">Sin mensajes.</li> : null}
            {messages.map((m) => {
              const inbound = m.direction === "inbound";
              return (
                <li key={m.id} className={cx("flex", inbound ? "justify-start" : "justify-end")}>
                  <article
                    className={cx(
                      "max-w-[88%] rounded-[var(--radius-lg)] border px-3 py-2 sm:max-w-[75%]",
                      inbound ? "border-line bg-white" : m.sender_kind === "bot" ? "border-[#c9d5e2] bg-[#eef2f7]" : "border-line bg-paper-2",
                    )}
                  >
                    <header className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-stone">
                      <span className="font-semibold text-ink-2">{m.sender_kind === "user" && m.sender_name ? m.sender_name : SENDER_LABEL[m.sender_kind]}</span>
                      <time dateTime={new Date(m.created_at).toISOString()}>{formatDateTime(m.created_at)}</time>
                    </header>
                    {m.kind !== "text" && KIND_LABEL[m.kind] ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone">[{KIND_LABEL[m.kind]}]</p> : null}
                    <p className="whitespace-pre-wrap break-words text-sm text-ink">{m.body ?? <span className="italic text-stone">Sin texto</span>}</p>
                    {!inbound ? (
                      <footer className="mt-1.5 flex flex-col items-end gap-1">
                        <MessageStatus status={m.status} />
                        {m.error ? <p className={cx("text-right text-xs", m.status === "failed" ? "text-danger" : "text-warning")}>{m.error}</p> : null}
                        {canReply && ["failed", "awaiting_credentials"].includes(m.status) && m.error_code !== "window_expired" ? (
                          <ActionButton action={retryMessageAction} fields={{ messageId: m.id }} label="Reintentar envío" pendingLabel="Reintentando…" variant="ghost" />
                        ) : null}
                      </footer>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ol>
          <ScrollToEnd targetId="chat-log" />
          {canReply ? <ReplyForm action={replyAction} conversationId={c.id} disabledReason={replyDisabled} /> : null}
        </section>

        <aside className="flex flex-col gap-4" aria-label="Datos vinculados">
          <Card title="Contacto">
            <dl>
              <Row label="Nombre">{c.contact_id ? <Link className="underline underline-offset-4" href={`/crm/contactos/${c.contact_id}`}>{name}</Link> : name}</Row>
              <Row label="WhatsApp">+{c.external_thread_id}</Row>
              {phones.filter((p) => p.phone_e164 && p.phone_e164 !== `+${c.external_thread_id}`).length ? (
                <Row label="Otros teléfonos">
                  {phones
                    .filter((p) => p.phone_e164 && p.phone_e164 !== `+${c.external_thread_id}`)
                    .map((p) => p.phone_e164)
                    .join(", ")}
                </Row>
              ) : null}
            </dl>
          </Card>

          <Card title="Lead">
            {lead ? (
              <dl>
                <Row label="Estado">
                  <Link className="underline underline-offset-4" href={`/crm/leads/${lead.id}`}>
                    {LEAD_STATUS[lead.status] ?? lead.status}
                  </Link>
                </Row>
                <Row label="Creado">{formatDateTime(lead.created_at)}</Row>
                {lead.assigned_name ? <Row label="Asignado a">{lead.assigned_name}</Row> : null}
                {lead.property_code ? (
                  <Row label="Propiedad">
                    <Link className="underline underline-offset-4" href={`/crm/propiedades/${lead.property_id}`}>
                      #{lead.property_code} {lead.property_title}
                    </Link>
                  </Row>
                ) : null}
              </dl>
            ) : (
              <p className="text-sm text-stone">Sin lead vinculado.</p>
            )}
          </Card>

          <Card title="Datos recogidos">
            {requirements ? (
              <dl>
                {req.operation ? <Row label="Operación">{OPERATION_LABEL[req.operation as Operation] ?? req.operation}</Row> : null}
                {req.property_types?.length ? <Row label="Tipo">{req.property_types.join(", ")}</Row> : null}
                {req.localities?.length ? <Row label="Zona">{req.localities.join(", ")}</Row> : null}
                {req.min_bedrooms !== undefined ? <Row label="Dormitorios">{req.min_bedrooms} o más</Row> : null}
                {req.budget_max !== undefined ? <Row label="Presupuesto (según el cliente)">{formatMoney(req.budget_max, req.budget_currency ?? "ARS")}</Row> : null}
                {req.customer_name ? <Row label="Nombre indicado">{req.customer_name}</Row> : null}
                {req.notes ? <Row label="Notas">{req.notes}</Row> : null}
              </dl>
            ) : (
              <p className="text-sm text-stone">Todavía no se registraron necesidades.</p>
            )}
            {c.summary ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone">Resumen del asistente</p>
                <p className="mt-1 text-sm text-ink-2">{c.summary}</p>
              </div>
            ) : null}
          </Card>

          <Card title="Propiedades mencionadas">
            {properties.length ? (
              <ul className="flex flex-col gap-2">
                {properties.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link className="min-w-0 underline underline-offset-4" href={`/crm/propiedades/${p.id}`}>
                      #{p.code} {p.title}
                    </Link>
                    <Badge tone={p.is_published ? "success" : "neutral"}>{STATUS_LABEL[p.status as PropertyStatus] ?? p.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Ninguna por ahora.</p>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
