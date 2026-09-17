import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { isEnabled } from "@/server/flags";
import { tryVisitScope } from "@/server/visits/access";
import { listMyVisits } from "@/server/visits/queries";
import { utcToLocalInput } from "@/server/crm/time";
import { crmImageSource } from "@/server/media/crm-preview";
import { EmptyState, PageHeader, cx } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { CheckinBadge, VisitStatusBadge } from "@/components/visits/visit-badges";

export const metadata: Metadata = { title: "Mis visitas" };

const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Argentina/Salta" });
const hhmm = (d: Date) => utcToLocalInput(d).slice(11);

export default async function MyVisitsPage({ searchParams }: PageProps<"/crm/mis-visitas">) {
  const actor = await requireStaffPage();
  const db = getDb();
  if (!(await isEnabled(db, "visits_operations"))) notFound();
  const scope = tryVisitScope(actor);
  if (!scope) redirect("/crm?sin-permiso=1");
  const sp = flatParams(await searchParams);
  const view = sp.vista === "proximas" ? "proximas" : "hoy";
  const team = scope.all && sp.equipo === "1";
  const { rows } = await listMyVisits(db, actor, { view, team });
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ vista: view === "hoy" ? undefined : view, equipo: team ? "1" : undefined, ...over })) if (v) p.set(k, v);
    const q = p.toString();
    return `/crm/mis-visitas${q ? `?${q}` : ""}`;
  };
  const tab = "flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-center text-sm font-semibold";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Mis visitas" description={team ? "Visitas de todo el equipo" : "Tus visitas asignadas"} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Período" className="flex gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1 sm:w-72">
          <Link href={href({ vista: undefined })} aria-current={view === "hoy" ? "page" : undefined} className={cx(tab, view === "hoy" ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
            Hoy
          </Link>
          <Link href={href({ vista: "proximas" })} aria-current={view === "proximas" ? "page" : undefined} className={cx(tab, view === "proximas" ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
            Próximas
          </Link>
        </nav>
        {scope.all ? (
          <nav aria-label="Alcance" className="flex gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1 sm:w-60">
            <Link href={href({ equipo: undefined })} aria-current={!team ? "page" : undefined} className={cx(tab, !team ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
              Mías
            </Link>
            <Link href={href({ equipo: "1" })} aria-current={team ? "page" : undefined} className={cx(tab, team ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
              Equipo
            </Link>
          </nav>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={view === "hoy" ? "No tenés visitas para hoy" : "Sin visitas en los próximos 15 días"}
          description="Las visitas se agendan desde la Agenda (tipo «Visita») y aparecen acá con su propiedad y su cliente."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((v) => {
            const img = v.cover ? crmImageSource(v.cover) : null;
            return (
              <li key={v.id}>
                <Link href={`/crm/mis-visitas/${v.id}`} className="grid grid-cols-[4.5rem_1fr] gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-3 transition-colors hover:border-ink sm:grid-cols-[6rem_1fr] sm:p-4">
                  <span className="relative block aspect-square overflow-hidden rounded-[var(--radius-md)] bg-paper-2">
                    {img ? <Image src={img.src} alt="" fill unoptimized={!img.optimize} sizes="96px" className="object-cover" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-bold tabular-nums leading-none">{hhmm(v.starts_at)}</span>
                      {view === "proximas" ? <span className="text-sm capitalize text-stone">{dayFmt.format(v.starts_at)}</span> : null}
                      <VisitStatusBadge status={v.status} />
                      <CheckinBadge c={v.last_checkin} />
                    </span>
                    <span className="truncate font-semibold">
                      Cód. {v.property_code} · {v.property_title}
                    </span>
                    <span className="truncate text-sm text-stone">{[v.contact_name ?? "Sin cliente cargado", team ? v.agent_name : null].filter(Boolean).join(" · ")}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
