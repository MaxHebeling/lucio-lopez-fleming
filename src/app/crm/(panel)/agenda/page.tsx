import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { agendaScope } from "@/server/crm/access";
import { listAppointments } from "@/server/agenda/queries";
import { listStaffUsers } from "@/server/crm/lookups";
import { addDays, isLocalDate, localDate, localDayRange, startOfWeek, utcToLocalInput } from "@/server/crm/time";
import { Badge, ButtonLink, EmptyState, PageHeader, Select, buttonClass, cx } from "@/components/ui";
import { APPOINTMENT_KIND_LABEL, APPOINTMENT_STATUS_LABEL, APPOINTMENT_STATUS_TONE } from "@/components/crm/labels";
import { flatParams } from "@/components/crm/pagination";
import { requireScope } from "../_shared/load";

export const metadata: Metadata = { title: "Agenda" };

const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const dayLabel = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
const shortDay = (d: string) => shortDayFmt.format(new Date(`${d}T12:00:00Z`));
const hhmm = (d: Date) => utcToLocalInput(d).slice(11);

type Row = Awaited<ReturnType<typeof listAppointments>>["rows"][number];

export default async function AgendaPage({ searchParams }: PageProps<"/crm/agenda">) {
  const actor = await requireStaffPage();
  const scope = requireScope(agendaScope, actor);
  const sp = flatParams(await searchParams);
  const today = localDate(new Date());
  const date = sp.fecha && isLocalDate(sp.fecha) ? sp.fecha : today;
  const view = sp.vista === "semana" || (sp.vista === "equipo" && scope.all) ? sp.vista : "dia";
  const start = view === "dia" ? date : startOfWeek(date);
  const days = view === "dia" ? 1 : 7;
  const range = localDayRange(start, days);
  const db = getDb();
  const [{ rows }, users] = await Promise.all([
    listAppointments(db, actor, { ...range, agent: view === "equipo" ? undefined : sp.agente, includeInactive: sp.canceladas === "1" }),
    scope.all ? listStaffUsers(db, actor) : Promise.resolve([]),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { vista: view, fecha: date, agente: sp.agente, canceladas: sp.canceladas, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return `/crm/agenda?${p.toString()}`;
  };
  const step = view === "dia" ? 1 : 7;
  const dayList = Array.from({ length: days }, (_, i) => addDays(start, i));
  const byDay = (d: string, list: Row[]) => list.filter((r) => localDate(r.starts_at) === d);

  return (
    <>
      <PageHeader
        title="Agenda"
        description={view === "dia" ? dayLabel(date) : `Semana del ${dayLabel(start)}`}
        actions={can(actor, "agenda.manage") ? <ButtonLink href={`/crm/agenda/nueva${date !== today ? `?fecha=${date}` : ""}`}>Agendar</ButtonLink> : null}
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Vista" className="flex gap-1 rounded-[var(--radius-md)] border border-line bg-white p-1">
            {[
              ["dia", "Día"],
              ["semana", "Semana"],
              ...(scope.all ? [["equipo", "Equipo"]] : []),
            ].map(([v, l]) => (
              <Link key={v} href={href({ vista: v })} aria-current={view === v ? "page" : undefined} className={cx("rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-semibold", view === v ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
                {l}
              </Link>
            ))}
          </nav>
          <nav aria-label="Fecha" className="flex items-center gap-1">
            <Link href={href({ fecha: addDays(date, -step) })} className={buttonClass("secondary", "sm")} aria-label={view === "dia" ? "Día anterior" : "Semana anterior"}>
              ←
            </Link>
            <Link href={href({ fecha: today })} className={buttonClass("secondary", "sm")}>
              Hoy
            </Link>
            <Link href={href({ fecha: addDays(date, step) })} className={buttonClass("secondary", "sm")} aria-label={view === "dia" ? "Día siguiente" : "Semana siguiente"}>
              →
            </Link>
          </nav>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filtros de agenda">
          <input type="hidden" name="vista" value={view} />
          <div className="flex flex-col gap-1">
            <label htmlFor="fecha" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              Ir a
            </label>
            <input id="fecha" name="fecha" type="date" defaultValue={date} className="h-10 rounded-[var(--radius-md)] border border-line bg-white px-3 text-sm" />
          </div>
          {scope.all && view !== "equipo" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="agente" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                Agente
              </label>
              <Select id="agente" name="agente" defaultValue={sp.agente ?? ""} className="w-48">
                <option value="">Todos</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <label className="inline-flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" name="canceladas" value="1" defaultChecked={sp.canceladas === "1"} className="size-4 accent-[var(--ink)]" />
            Ver canceladas
          </label>
          <button type="submit" className={buttonClass("secondary", "md")}>
            Ver
          </button>
        </form>
      </div>

      {view === "equipo" ? (
        <TeamWeek days={dayList} users={users} rows={rows} today={today} />
      ) : rows.length === 0 ? (
        <EmptyState title={view === "dia" ? "Sin citas este día" : "Sin citas esta semana"} description={can(actor, "agenda.manage") ? "Usá “Agendar” para cargar una visita, llamada o reunión." : undefined} />
      ) : (
        <div className="flex flex-col gap-5">
          {dayList.map((d) => {
            const list = byDay(d, rows);
            if (view === "semana" && list.length === 0) return null;
            return (
              <section key={d} aria-label={dayLabel(d)}>
                {view === "semana" ? <h2 className={cx("mb-2 text-sm font-bold capitalize", d === today && "text-brick")}>{dayLabel(d)}</h2> : null}
                <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
                  {list.map((a) => (
                    <li key={a.id}>
                      <Link href={`/crm/agenda/${a.id}`} className="grid grid-cols-[4.5rem_1fr] gap-3 px-4 py-3 hover:bg-paper">
                        <span className="text-sm font-bold tabular-nums">
                          {hhmm(a.starts_at)}
                          <span className="block text-xs font-normal text-stone">{hhmm(a.ends_at)}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge>{APPOINTMENT_KIND_LABEL[a.kind]}</Badge>
                            <Badge tone={APPOINTMENT_STATUS_TONE[a.status]}>{APPOINTMENT_STATUS_LABEL[a.status]}</Badge>
                          </span>
                          <span className="mt-1 block truncate font-semibold">{a.title}</span>
                          <span className="block truncate text-sm text-stone">
                            {[a.contact_name, a.location, scope.all ? a.agent_name : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function TeamWeek({ days, users, rows, today }: { days: string[]; users: Array<{ id: string; fullName: string }>; rows: Row[]; today: string }) {
  const agents = users.filter((u) => rows.some((r) => r.assigned_user_id === u.id));
  if (agents.length === 0) return <EmptyState title="Nadie del equipo tiene citas esta semana" />;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-white" role="region" aria-label="Agenda semanal por agente" tabIndex={0}>
      <table className="w-full min-w-[960px] table-fixed border-collapse text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="w-40 border-b border-line px-3 py-2 text-xs uppercase text-stone">
              Agente
            </th>
            {days.map((d) => (
              <th key={d} scope="col" className={cx("border-b border-l border-line px-2 py-2 text-xs capitalize", d === today ? "text-brick" : "text-stone")}>
                {shortDay(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.map((u) => (
            <tr key={u.id} className="align-top">
              <th scope="row" className="border-b border-line px-3 py-2 font-semibold">
                {u.fullName}
              </th>
              {days.map((d) => (
                <td key={d} className="border-b border-l border-line p-1.5">
                  <ul className="flex flex-col gap-1">
                    {rows
                      .filter((r) => r.assigned_user_id === u.id && localDate(r.starts_at) === d)
                      .map((a) => (
                        <li key={a.id}>
                          <Link href={`/crm/agenda/${a.id}`} className={cx("block rounded-[var(--radius-sm)] px-1.5 py-1 text-xs hover:bg-paper-2", a.status === "cancelled" ? "text-stone line-through" : "bg-paper")}>
                            <span className="font-bold tabular-nums">{hhmm(a.starts_at)}</span> {APPOINTMENT_KIND_LABEL[a.kind]}
                            <span className="block truncate text-stone">{a.contact_name ?? a.title}</span>
                          </Link>
                        </li>
                      ))}
                  </ul>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
