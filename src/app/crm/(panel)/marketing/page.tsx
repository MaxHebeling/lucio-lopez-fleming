import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { QUEUE_TABS, socialQueue, type QueueTab } from "@/server/marketing/queries";
import { Alert, Badge, EmptyState, PageHeader, cx, formatDateTime } from "@/components/ui";
import { CHANNEL_LABEL, POST_STATUS } from "./labels";

export const metadata: Metadata = { title: "Contenido · CRM" };

const EMPTY: Record<QueueTab, { title: string; description: string }> = {
  revision: { title: "No hay borradores para revisar", description: "Al publicar una propiedad se generan borradores para Instagram y Facebook con sus datos y fotos verificadas." },
  aprobadas: { title: "No hay publicaciones aprobadas", description: "Aprobá un borrador y programalo para que salga en la fecha elegida." },
  publicadas: { title: "Todavía no se publicó nada", description: "Las publicaciones que salgan en Instagram o Facebook aparecen acá." },
  problemas: { title: "Sin rechazos ni errores", description: "Las publicaciones rechazadas o con error de publicación aparecen acá." },
};

export default async function MarketingPage({ searchParams }: PageProps<"/crm/marketing">) {
  const actor = await requireStaffPage("marketing.read");
  const sp = await searchParams;
  const tab: QueueTab = typeof sp.tab === "string" && sp.tab in QUEUE_TABS ? (sp.tab as QueueTab) : "revision";
  const { posts, counts, flags } = await socialQueue(getDb(), actor, tab);
  const countFor = (t: QueueTab) => QUEUE_TABS[t].statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Contenido para redes" description="Nada se publica sin aprobación: revisá el texto y las fotos, aprobá y programá la fecha (hora de Salta)." />

      {!flags.publishing ? (
        <Alert tone="info">La publicación automática está apagada (feature flag social_publishing). Podés aprobar y programar; las publicaciones esperan hasta activarla.</Alert>
      ) : null}
      {!flags.drafts ? <Alert tone="warning">La generación de borradores está apagada (feature flag social_drafts).</Alert> : null}

      <nav aria-label="Estados" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {(Object.keys(QUEUE_TABS) as QueueTab[]).map((t) => (
            <li key={t}>
              <Link
                href={`/crm/marketing?tab=${t}`}
                aria-current={t === tab ? "page" : undefined}
                className={cx(
                  "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap",
                  t === tab ? "border-brick text-ink" : "border-transparent text-stone hover:text-ink",
                )}
              >
                {QUEUE_TABS[t].label}
                <span className="rounded-full bg-paper-2 px-1.5 text-xs tabular-nums text-ink-2">{countFor(t)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {posts.length === 0 ? (
        <EmptyState title={EMPTY[tab].title} description={EMPTY[tab].description} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((p) => {
            const st = POST_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };
            return (
              <li key={p.id} className="flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
                <Link href={`/crm/marketing/${p.id}`} className="group flex flex-1 flex-col focus-visible:outline-offset-[-2px]">
                  <div className="relative aspect-[4/3] w-full bg-paper-2">
                    {p.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- fotos de origen/CDN ya optimizadas; next/image exige hosts fijos
                      <img src={p.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-stone">
                        {p.assetCount ? "Foto sin URL pública todavía" : "Sin fotos seleccionadas"}
                      </span>
                    )}
                    <span className="absolute left-2 top-2 flex gap-1.5">
                      <Badge tone="brand">{CHANNEL_LABEL[p.channel] ?? p.channel}</Badge>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone">
                      {p.code ? `Código ${p.code}` : "Sin propiedad"} · {p.assetCount} {p.assetCount === 1 ? "foto" : "fotos"}
                    </p>
                    <p className="line-clamp-1 font-semibold text-ink group-hover:underline">{p.property_title ?? "Publicación"}</p>
                    <p className="line-clamp-3 whitespace-pre-line text-sm text-ink-2">{p.caption}</p>
                    <div className="mt-auto pt-2 text-xs text-stone">
                      {p.status === "scheduled" ? <>Sale: {formatDateTime(p.scheduled_at)}</> : null}
                      {p.status === "published" ? <>Publicada: {formatDateTime(p.published_at)}</> : null}
                      {!["scheduled", "published"].includes(p.status) ? <>Actualizada: {formatDateTime(p.updated_at)}</> : null}
                    </div>
                    {p.last_error ? <p className="line-clamp-2 text-xs text-danger">{p.last_error}</p> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
