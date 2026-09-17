import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { isEnabled } from "@/server/flags";
import { getOpsBoard } from "@/server/visits/queries";
import { listStaffUsers } from "@/server/crm/lookups";
import { addDays, isLocalDate, localDate, utcToLocalInput } from "@/server/crm/time";
import { ALERT_LABEL, type AlertKind } from "@/server/visits/rules";
import { visitPhase, VISIT_PHASE_LABEL, type VisitPhase } from "@/server/visits/state";
import { Badge, EmptyState, PageHeader, Select, Table, buttonClass, cx } from "@/components/ui";
import { flatParams } from "@/components/crm/pagination";
import { CheckinBadge, VisitStatusBadge } from "@/components/visits/visit-badges";
import { ReassignButton } from "@/components/visits/reassign-button";
import { UUID_RE } from "../_shared/load";

export const metadata: Metadata = { title: "Centro operativo" };

const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const hhmm = (d: Date | null) => (d ? utcToLocalInput(d).slice(11) : null);
const SEVERITY_TONE = { critical: "danger", warning: "warning", info: "info" } as const;
const COLUMNS: Array<{ key: VisitPhase | "issues"; label: string }> = [
  { key: "scheduled", label: "Programadas" },
  { key: "en_route", label: "En camino" },
  { key: "checked_in", label: "Check-in" },
  { key: "in_progress", label: "En curso" },
  { key: "completed", label: "Finalizadas" },
  { key: "issues", label: "Incidencias" },
];

export default async function OpsCenterPage({ searchParams }: PageProps<"/crm/centro-operativo">) {
  const actor = await requireStaffPage("visits.monitor");
  const db = getDb();
  if (!(await isEnabled(db, "visits_operations"))) notFound();
  const sp = flatParams(await searchParams);
  const today = localDate(new Date());
  const date = sp.fecha && isLocalDate(sp.fecha) ? sp.fecha : today;
  const agentId = sp.agente && UUID_RE.test(sp.agente) ? sp.agente : null;
  const [{ rows, openAlerts }, users] = await Promise.all([getOpsBoard(db, actor, { date, agentId }), listStaffUsers(db, actor)]);
  const reassignable = new Set(["scheduled", "confirmed", "en_route"]);
  const count = (k: VisitPhase | "issues") =>
    k === "issues" ? rows.filter((r) => r.alerts.length > 0 || r.status === "cancelled" || r.status === "no_show").length : rows.filter((r) => visitPhase(r.status) === k).length;
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ fecha: date === today ? undefined : date, agente: agentId ?? undefined, ...over })) if (v) p.set(k, v);
    const q = p.toString();
    return `/crm/centro-operativo${q ? `?${q}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Centro operativo" description={`Visitas del ${dayFmt.format(new Date(`${date}T12:00:00Z`))}`} />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label="Fecha" className="flex items-center gap-1">
          <Link href={href({ fecha: addDays(date, -1) })} className={buttonClass("secondary", "sm")} aria-label="Día anterior">
            ←
          </Link>
          <Link href={href({ fecha: undefined })} className={buttonClass("secondary", "sm")}>
            Hoy
          </Link>
          <Link href={href({ fecha: addDays(date, 1) })} className={buttonClass("secondary", "sm")} aria-label="Día siguiente">
            →
          </Link>
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Filtros del centro operativo">
          {date !== today ? <input type="hidden" name="fecha" value={date} /> : null}
          <div className="flex flex-col gap-1">
            <label htmlFor="ops-agente" className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              Agente
            </label>
            <Select id="ops-agente" name="agente" defaultValue={agentId ?? ""} className="w-56">
              <option value="">Todos</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </div>
          <button type="submit" className={buttonClass("secondary", "md")}>
            Filtrar
          </button>
        </form>
      </div>

      <section aria-label="Resumen por estado" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {COLUMNS.map((c) => (
          <div key={c.key} className={cx("rounded-[var(--radius-lg)] border bg-white px-4 py-3", c.key === "issues" && count("issues") > 0 ? "border-danger/40" : "border-line")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone">{c.label}</p>
            <p className={cx("text-2xl font-bold tabular-nums", c.key === "issues" && count("issues") > 0 && "text-danger")}>{count(c.key)}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="ops-alerts" className="mb-6">
        <h2 id="ops-alerts" className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-2">
          Alertas abiertas
        </h2>
        {openAlerts.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-line bg-white px-4 py-3 text-sm text-stone">Sin alertas abiertas. Se recalculan cada 5 minutos.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
            {openAlerts.map((a) => (
              <li key={a.id}>
                <Link href={`/crm/mis-visitas/${a.appointment_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-paper">
                  <Badge tone={SEVERITY_TONE[a.severity as keyof typeof SEVERITY_TONE] ?? "info"}>{ALERT_LABEL[a.kind as AlertKind] ?? a.kind}</Badge>
                  <span className="text-sm font-semibold">
                    {localDate(a.starts_at) === date ? hhmm(a.starts_at) : utcToLocalInput(a.starts_at).replace("T", " ")} · Cód. {a.property_code}
                  </span>
                  <span className="text-sm text-stone">{a.agent_name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ops-visits">
        <h2 id="ops-visits" className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-2">
          Visitas del día
        </h2>
        {rows.length === 0 ? (
          <EmptyState title="Sin visitas para este día" description="Las visitas se agendan desde la Agenda con el tipo «Visita»." />
        ) : (
          <Table label="Visitas del día">
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Agente</th>
                <th scope="col">Propiedad</th>
                <th scope="col">Cliente</th>
                <th scope="col">Estado</th>
                <th scope="col">Llegada</th>
                <th scope="col">Cierre</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap font-semibold tabular-nums">
                    {hhmm(r.starts_at)}
                    <span className="block text-xs font-normal text-stone">{hhmm(r.ends_at)}</span>
                  </td>
                  <td>
                    {r.agent_name}
                    {!r.agent_active ? <span className="block text-xs text-danger">Usuario inactivo</span> : null}
                  </td>
                  <td className="max-w-56">
                    <span className="block font-semibold">Cód. {r.property_code}</span>
                    <span className="block truncate text-stone">{r.property_title}</span>
                  </td>
                  <td>{r.contact_name ?? "—"}</td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <VisitStatusBadge status={r.status} />
                      {r.alerts.map((k) => (
                        <Badge key={k} tone="danger">
                          {ALERT_LABEL[k] ?? k}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <CheckinBadge c={r.last_checkin} />
                      <span className="text-xs text-stone">{[r.en_route_at ? `Salió ${hhmm(r.en_route_at)}` : null, r.checked_in_at ? `Llegó ${hhmm(r.checked_in_at)}` : null].filter(Boolean).join(" · ") || "—"}</span>
                    </div>
                  </td>
                  <td className="text-xs">
                    {r.status === "completed" ? (
                      <span className="flex flex-col gap-0.5">
                        <span>{r.report_status === "confirmed" ? "Informe confirmado" : r.report_status === "draft" ? "Informe en borrador" : "Sin informe"}</span>
                        <span className="text-stone">{r.follow_up_task_id ? "Con seguimiento" : "Sin seguimiento"}</span>
                      </span>
                    ) : (
                      <span className="text-stone">{VISIT_PHASE_LABEL[visitPhase(r.status)]}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <Link href={`/crm/mis-visitas/${r.id}`} className={buttonClass("ghost", "sm")}>
                        Ver
                      </Link>
                      {reassignable.has(r.status) ? <ReassignButton appointmentId={r.id} currentUserId={r.assigned_user_id} label={`${hhmm(r.starts_at)} · Cód. ${r.property_code}`} users={users} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
