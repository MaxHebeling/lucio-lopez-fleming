import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/dashboard/queries";
import { STATUS_LABEL, type PropertyStatus } from "@/server/properties/schema";
import { Alert, Badge, buttonClass, ButtonLink, Card, Field, formatDate, formatDateTime, Input, PageHeader, Select } from "@/components/ui";
import { INTEGRATION_STATUS, PROPERTY_STATUS_TONE } from "@/components/crm/labels";
import { first } from "./_lib/params";

export const metadata: Metadata = { title: "Tablero" };

function Stat({ label, value, href, tone, hint }: { label: string; value: number; href?: string; tone?: "danger" | "warning"; hint?: string }) {
  const body = (
    <>
      <span className="text-xs font-semibold uppercase tracking-wide text-stone">{label}</span>
      <span className={`text-3xl font-bold tabular-nums ${tone === "danger" && value > 0 ? "text-danger" : tone === "warning" && value > 0 ? "text-warning" : "text-ink"}`}>{value.toLocaleString("es-AR")}</span>
      {hint ? <span className="text-xs text-stone">{hint}</span> : null}
    </>
  );
  const cls = "flex flex-col gap-1 rounded-[var(--radius-md)] border border-line bg-paper px-3 py-2.5";
  return href ? (
    <Link href={href} className={`${cls} hover:border-ink`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Block({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card title={title} actions={action} className="flex flex-col">
      {children}
    </Card>
  );
}

export default async function Dashboard({ searchParams }: PageProps<"/crm">) {
  // Sin permiso: la página no redirige (evita un bucle con ?sin-permiso=1) y muestra solo el saludo.
  const actor = await requireStaffPage();
  const sp = await searchParams;
  const denied = first(sp, "sin-permiso") === "1";
  if (!can(actor, "dashboard.read")) {
    return (
      <>
        <PageHeader title="Tablero" description={`Hola, ${actor.fullName}.`} />
        {denied ? <Alert tone="warning">No tenés permiso para la sección a la que intentaste entrar.</Alert> : <Alert tone="info">Tu rol no incluye el tablero. Usá el menú para ir a tus secciones.</Alert>}
      </>
    );
  }

  const db = getDb();
  const [d, branches] = await Promise.all([
    getDashboard(db, actor, { branchId: first(sp, "branchId"), from: first(sp, "from"), to: first(sp, "to") }),
    db.selectFrom("branches").select(["id", "name"]).where("is_active", "=", true).orderBy("is_main", "desc").orderBy("name").execute(),
  ]);
  const branchName = branches.find((b) => b.id === d.branchId)?.name;

  return (
    <>
      <PageHeader title="Tablero" description={`Hola, ${actor.fullName}. Datos del ${formatDate(d.range.from)} al ${formatDate(d.range.to)}${branchName ? ` · ${branchName}` : ""}.`} />
      {denied ? (
        <div className="mb-4">
          <Alert tone="warning">No tenés permiso para la sección a la que intentaste entrar.</Alert>
        </div>
      ) : null}

      <form method="get" action="/crm" className="mb-5 grid gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end" aria-label="Filtros del tablero">
        <Field label="Sucursal" htmlFor="d-branch" hint="Filtra propiedades, leads, visitas y contratos.">
          <Select id="d-branch" name="branchId" defaultValue={d.branchId ?? ""}>
            <option value="">Todas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Desde" htmlFor="d-from">
          <Input id="d-from" name="from" type="date" defaultValue={d.range.from} />
        </Field>
        <Field label="Hasta" htmlFor="d-to">
          <Input id="d-to" name="to" type="date" defaultValue={d.range.to} />
        </Field>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("primary", "md")}>
            Aplicar
          </button>
          <Link href="/crm" className={buttonClass("ghost", "md")}>
            Últimos 30 días
          </Link>
        </div>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.properties ? (
          <Block title="Propiedades" action={<Link href="/crm/propiedades" className="text-xs font-semibold underline underline-offset-4">Ver todas</Link>}>
            {d.properties.total === 0 ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-stone">Todavía no hay propiedades cargadas{branchName ? " en esta sucursal" : ""}.</p>
                {can(actor, "properties.create") ? (
                  <ButtonLink href="/crm/propiedades/nueva" size="sm">
                    Cargar propiedad
                  </ButtonLink>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Total" value={d.properties.total} />
                  <Stat label="Publicadas" value={d.properties.published} href="/crm/propiedades?published=yes" />
                  <Stat label="Altas en el período" value={d.properties.createdInRange} />
                </div>
                <ul className="flex flex-wrap gap-2">
                  {d.properties.byStatus.map((s) => (
                    <li key={s.status}>
                      <Link href={`/crm/propiedades?status=${s.status}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-sm hover:border-ink">
                        <Badge tone={PROPERTY_STATUS_TONE[s.status]}>{STATUS_LABEL[s.status as PropertyStatus] ?? s.status}</Badge>
                        <span className="font-semibold tabular-nums">{s.n}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Block>
        ) : null}

        {d.leads ? (
          <Block title={d.leads.scope === "own" ? "Mis leads" : "Leads"} action={<Link href="/crm/leads" className="text-xs font-semibold underline underline-offset-4">Ir a leads</Link>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Nuevos en el período" value={d.leads.newInRange} />
              <Stat label="Sin responder" value={d.leads.unanswered} tone="warning" />
              <Stat label={`Fuera de SLA (${d.leads.slaMinutes} min)`} value={d.leads.overSla} tone="danger" />
              {d.leads.unassigned !== null ? <Stat label="Sin asignar" value={d.leads.unassigned} tone="warning" /> : null}
            </div>
            {d.leads.newInRange === 0 && d.leads.unanswered === 0 ? <p className="mt-3 text-sm text-stone">No hay consultas en el período.</p> : null}
          </Block>
        ) : null}

        {d.visits ? (
          <Block title={`Visitas próximas (7 días)${d.visits.scope === "own" ? " · mías" : ""}`} action={<Link href="/crm/agenda" className="text-xs font-semibold underline underline-offset-4">Agenda</Link>}>
            {d.visits.items.length === 0 ? (
              <p className="text-sm text-stone">No hay visitas agendadas para los próximos 7 días.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {d.visits.items.map((v) => (
                  <li key={v.id} className="flex flex-wrap justify-between gap-x-3 py-2">
                    <span className="min-w-0">
                      <span className="font-semibold">{formatDateTime(v.starts_at)}</span> · {v.title}
                      {v.property_id ? (
                        <Link href={`/crm/propiedades/${v.property_id}`} className="block text-xs text-stone underline-offset-4 hover:underline">
                          #{v.property_code} {v.property_title}
                        </Link>
                      ) : null}
                    </span>
                    <span className="text-xs text-stone">{v.assigned_name}</span>
                  </li>
                ))}
                {d.visits.count > d.visits.items.length ? <li className="pt-2 text-xs text-stone">y {d.visits.count - d.visits.items.length} más</li> : null}
              </ul>
            )}
          </Block>
        ) : null}

        {d.tasks ? (
          <Block title="Tareas vencidas" action={<Link href="/crm/tareas" className="text-xs font-semibold underline underline-offset-4">Tareas</Link>}>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <Stat label="Mías" value={d.tasks.mine} tone="danger" />
              {d.tasks.team !== null ? <Stat label="Todo el equipo" value={d.tasks.team} tone="warning" /> : null}
            </div>
            {d.tasks.items.length ? (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {d.tasks.items.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0">{t.title}</span>
                    <span className="shrink-0 text-xs text-danger">venció {formatDateTime(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">No tenés tareas vencidas.</p>
            )}
          </Block>
        ) : null}

        {d.contracts ? (
          <Block title={`Contratos por vencer (${d.contracts.noticeDays} días)`} action={<Link href="/crm/alquileres" className="text-xs font-semibold underline underline-offset-4">Contratos</Link>}>
            {d.contracts.count === 0 ? (
              <p className="text-sm text-stone">No hay contratos activos que venzan en ese plazo.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line text-sm">
                {d.contracts.items.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-x-3 py-2">
                    <span>
                      <span className="font-mono text-xs">{c.code}</span> · #{c.property_code} {c.property_title}
                    </span>
                    <span className="text-xs text-warning">vence {formatDate(c.end_date)}</span>
                  </li>
                ))}
                {d.contracts.count > d.contracts.items.length ? <li className="pt-2 text-xs text-stone">y {d.contracts.count - d.contracts.items.length} más</li> : null}
              </ul>
            )}
          </Block>
        ) : null}

        {d.jobs || d.integrations || d.migration ? (
          <Block title="Salud del sistema">
            <div className="flex flex-col gap-3">
              {d.jobs ? (
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Jobs muertos" value={d.jobs.dead} tone="danger" href="/crm/sistema/jobs?status=dead" />
                  <Stat label="Reintentando" value={d.jobs.failed} tone="warning" href="/crm/sistema/jobs?status=failed" />
                  <Stat label="En cola demorados" value={d.jobs.queued_late} tone="warning" href="/crm/sistema/jobs?status=queued" hint="más de 10 min" />
                </div>
              ) : null}
              {d.migration ? (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Advertencias de migración" value={d.migration.open} tone="warning" href="/crm/migracion" />
                  <Stat label="De severidad error" value={d.migration.errors} tone="danger" href="/crm/migracion?severity=error" />
                </div>
              ) : null}
              {d.integrations ? (
                d.integrations.length === 0 ? (
                  <p className="text-sm text-stone">Ninguna integración con errores.</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {d.integrations.map((i) => (
                      <li key={i.key} className="flex flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href="/crm/integraciones" className="font-semibold underline-offset-4 hover:underline">
                            {i.name}
                          </Link>
                          <Badge tone={INTEGRATION_STATUS[i.status]?.tone}>{INTEGRATION_STATUS[i.status]?.label ?? i.status}</Badge>
                          {i.circuit_open_until && i.circuit_open_until > new Date() ? <Badge tone="danger">En pausa hasta {formatDateTime(i.circuit_open_until)}</Badge> : null}
                        </span>
                        {i.last_error ? <span className="text-xs text-danger">{i.last_error}</span> : null}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          </Block>
        ) : null}
      </div>
    </>
  );
}
