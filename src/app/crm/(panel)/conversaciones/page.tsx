import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { channelStatus, listConversations, type InboxFilter } from "@/server/conversations/queries";
import { handoffLabel } from "@/server/conversations/labels";
import { Badge, buttonClass, cx, EmptyState, formatDateTime, PageHeader } from "@/components/ui";
import { ChannelBanners, MessageStatus, ModeBadge } from "./_components/status";
import { AutoRefresh } from "./_components/client";

export const metadata: Metadata = { title: "Conversaciones" };

const VIEWS: Array<{ key: InboxFilter["view"]; label: string }> = [
  { key: "open", label: "Abiertas" },
  { key: "bot", label: "Asistente" },
  { key: "human", label: "Persona" },
  { key: "closed", label: "Cerradas" },
];

function href(filter: InboxFilter, change: Partial<Record<keyof InboxFilter, string | boolean | undefined>>): string {
  const next = { ...filter, before: undefined, ...change };
  const p = new URLSearchParams();
  if (next.view && next.view !== "open") p.set("view", String(next.view));
  if (next.mine) p.set("mine", "1");
  if (next.unanswered) p.set("unanswered", "1");
  if (next.q) p.set("q", String(next.q));
  if (next.before) p.set("before", String(next.before));
  const qs = p.toString();
  return qs ? `/crm/conversaciones?${qs}` : "/crm/conversaciones";
}

export default async function ConversationsPage({ searchParams }: PageProps<"/crm/conversaciones">) {
  const actor = await requireStaffPage("conversations.read");
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const db = getDb();
  const { items, filter, nextBefore } = await listConversations(db, actor, {
    view: first(sp.view),
    mine: first(sp.mine),
    unanswered: first(sp.unanswered),
    q: first(sp.q) || undefined,
    before: first(sp.before),
  });
  const status = await channelStatus(db, actor);

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader title="Conversaciones" description="WhatsApp Business: lo que atiende el asistente y lo que necesita una persona." />
      <ChannelBanners status={status} />

      <nav aria-label="Filtros de conversaciones" className="mb-4 flex flex-col gap-3">
        <ul className="flex flex-wrap gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1">
          {VIEWS.map((v) => (
            <li key={v.key} className="flex-1 sm:flex-none">
              <Link
                href={href(filter, { view: v.key })}
                aria-current={filter.view === v.key ? "page" : undefined}
                className={cx(
                  "block rounded-[var(--radius-sm)] px-3 py-2 text-center text-sm",
                  filter.view === v.key ? "bg-ink font-semibold text-paper" : "text-ink-2 hover:bg-paper-2",
                )}
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href(filter, { mine: !filter.mine })} aria-pressed={filter.mine} className={buttonClass(filter.mine ? "primary" : "secondary", "sm")}>
            Asignadas a mí
          </Link>
          <Link href={href(filter, { unanswered: !filter.unanswered })} aria-pressed={filter.unanswered} className={buttonClass(filter.unanswered ? "primary" : "secondary", "sm")}>
            Sin responder
          </Link>
          <form action="/crm/conversaciones" method="get" role="search" className="flex w-full min-w-0 gap-2 sm:w-auto sm:max-w-sm sm:flex-1">
            {filter.view !== "open" ? <input type="hidden" name="view" value={filter.view} /> : null}
            {filter.mine ? <input type="hidden" name="mine" value="1" /> : null}
            {filter.unanswered ? <input type="hidden" name="unanswered" value="1" /> : null}
            <label htmlFor="q" className="sr-only">
              Buscar por nombre o teléfono
            </label>
            <input
              id="q"
              name="q"
              defaultValue={filter.q}
              placeholder="Nombre o teléfono"
              className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-white px-3 text-base focus:border-ink focus:outline-none sm:text-sm"
            />
            <button type="submit" className={buttonClass("secondary", "sm")}>
              Buscar
            </button>
          </form>
        </div>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          title="No hay conversaciones con estos filtros"
          description={
            status.whatsappConfigured ? "Cuando un cliente escriba al WhatsApp de la inmobiliaria, aparece acá." : "Cuando se conecte WhatsApp Business y un cliente escriba, la conversación aparece acá."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Conversaciones">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/crm/conversaciones/${c.id}`}
                className="block rounded-[var(--radius-lg)] border border-line bg-white p-3 transition-colors hover:border-ink focus-visible:border-ink sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{c.contactName ?? c.phone}</p>
                    <p className="text-xs text-stone">{c.phone}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.unanswered && c.mode !== "closed" ? <Badge tone="brand">Sin responder</Badge> : null}
                    <ModeBadge mode={c.mode} />
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-ink-2">
                  <span className="sr-only">Último mensaje: </span>
                  {c.lastDirection === "outbound" ? <span className="text-stone">Respuesta: </span> : null}
                  {c.lastBody ?? <span className="italic text-stone">Sin texto</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone">
                  <time dateTime={c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : undefined}>{formatDateTime(c.lastMessageAt)}</time>
                  {c.lastDirection === "outbound" && c.lastStatus ? <MessageStatus status={c.lastStatus} /> : null}
                  <span>{c.assignedName ? `Asignada a ${c.assignedToMe ? "vos" : c.assignedName}` : "Sin asignar"}</span>
                  {c.mode === "human" && c.handoffReason ? <span>Motivo: {handoffLabel(c.handoffReason)}</span> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextBefore ? (
        <div className="mt-4 flex justify-center">
          <Link href={href(filter, { before: nextBefore })} className={buttonClass("secondary", "md")}>
            Ver anteriores
          </Link>
        </div>
      ) : null}
    </>
  );
}
