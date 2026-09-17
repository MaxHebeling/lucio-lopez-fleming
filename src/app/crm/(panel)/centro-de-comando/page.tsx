import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { isEnabled } from "@/server/flags";
import { getCommandCenter } from "@/server/ai/command-center/service";
import { EXECUTIVE_FLAG } from "@/server/ai/domains/executive-management";
import { Badge, Card, formatDateTime, PageHeader } from "@/components/ui";
import { INTEGRATION_STATUS } from "@/components/crm/labels";
import { DailyBriefCard } from "@/components/crm/management/daily-brief-card";
import { refreshDailyBriefFormAction } from "../_management/actions";

export const metadata: Metadata = { title: "Centro de comando" };

const SEVERITY = { critical: { label: "Crítica", tone: "danger" }, warning: { label: "Advertencia", tone: "warning" }, info: { label: "Info", tone: "neutral" } } as const;
const usd = (n: number) => `USD ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function More({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} className="text-xs font-semibold underline underline-offset-4">
      {children}
    </Link>
  );
}

function Num({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: "danger" | "warning" }) {
  const cls = "flex flex-col gap-0.5 rounded-[var(--radius-md)] border border-line bg-paper px-3 py-2";
  const body = (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-stone">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${tone === "danger" && Number(value) > 0 ? "text-danger" : tone === "warning" && Number(value) > 0 ? "text-warning" : "text-ink"}`}>{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className={`${cls} hover:border-ink`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function CommandCenterPage() {
  const actor = await requireStaffPage("ai.executive");
  const db = getDb();
  if (!(await isEnabled(db, EXECUTIVE_FLAG))) notFound();
  const c = await getCommandCenter(db, actor);

  return (
    <>
      <PageHeader
        title="Centro de comando"
        description="Lo más importante de cada módulo en una sola vista, con links para actuar. Datos reales del CRM; las sugerencias no ejecutan nada solas."
      />
      <div className="flex flex-col gap-4">
        {c.brief ? <DailyBriefCard brief={c.brief} refreshAction={refreshDailyBriefFormAction} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {c.suggestions ? (
            <Card title="Tareas sugeridas" actions={<More href="/crm/tareas-sugeridas?vista=equipo">Ver todas</More>}>
              {c.suggestions.length ? (
                <ul className="divide-y divide-line text-sm">
                  {c.suggestions.map((s) => (
                    <li key={s.source} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/crm/tareas-sugeridas?vista=equipo&origen=${s.source === "sales_nba" ? "ventas" : s.source === "visit" ? "visitas" : s.source === "property_quality" ? "calidad" : s.source === "ops_alert" ? "alertas" : s.source === "assignment" ? "asignaciones" : s.source === "anomaly" ? "anomalias" : "marketing"}`} className="font-semibold underline-offset-4 hover:underline">
                        {s.label}
                      </Link>
                      <span className="flex items-center gap-2">
                        {s.high ? <Badge tone="danger">{s.high} alta</Badge> : null}
                        <span className="font-semibold tabular-nums">{s.total}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">No hay sugerencias pendientes en el equipo.</p>
              )}
            </Card>
          ) : null}

          <section id="anomalias" className="scroll-mt-28">
            <Card title="Alertas y anomalías" actions={<More href="/crm/tareas-sugeridas?vista=equipo&origen=anomalias">Tareas sugeridas</More>}>
              {c.anomalies.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {c.anomalies.map((a) => (
                    <li key={a.id} className="rounded-[var(--radius-md)] border border-line px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link href={a.link} className="font-semibold underline-offset-4 hover:underline">
                          {a.title}
                        </Link>
                        <Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge>
                      </div>
                      <p className="text-xs text-stone">
                        {a.label} · detectada {formatDateTime(a.detectedAt)}
                        {a.assignedName ? ` · ${a.assignedName}` : ""}
                      </p>
                      {a.evidence.length ? (
                        <details className="mt-1 text-xs text-ink-2">
                          <summary className="cursor-pointer select-none text-stone">Evidencia</summary>
                          <ul className="mt-1 list-disc pl-4">
                            {a.evidence.map((e) => (
                              <li key={`${e.label}-${e.value}`}>
                                {e.label}: {e.value}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">Sin anomalías abiertas. Se revisan cada hora con umbrales documentados.</p>
              )}
            </Card>
          </section>

          {c.visits ? (
            <Card title="Visitas de hoy" actions={<More href="/crm/centro-operativo">Centro operativo</More>}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Num label="Total" value={c.visits.total} href="/crm/centro-operativo" />
                <Num label="Alertas abiertas" value={c.visits.openAlerts} tone="warning" href="/crm/centro-operativo" />
                <Num label="Críticas" value={c.visits.critical} tone="danger" href="/crm/centro-operativo" />
              </div>
              {c.visits.phases.length ? (
                <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                  {c.visits.phases.map((p) => (
                    <li key={p.phase} className="rounded-full border border-line bg-white px-2.5 py-1">
                      {p.label} <span className="font-semibold tabular-nums">{p.n}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-stone">No hay visitas programadas para hoy.</p>
              )}
            </Card>
          ) : null}

          {c.matches ? (
            <Card title="Oportunidades: clientes compatibles (7 días)" actions={<More href="/crm/propiedades?compatibles=recientes">Propiedades nuevas con compatibles</More>}>
              {c.matches.length ? (
                <ul className="divide-y divide-line text-sm">
                  {c.matches.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/crm/propiedades/${m.id}`} className="min-w-0 truncate font-semibold underline-offset-4 hover:underline">
                        #{m.code} · {m.title}
                      </Link>
                      <span className="shrink-0 text-xs text-stone">
                        {m.candidates} {m.candidates === 1 ? "cliente compatible" : "clientes compatibles"}
                        {m.recent ? " · publicada esta semana" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone">Sin coincidencias nuevas en los últimos 7 días.</p>
              )}
            </Card>
          ) : null}

          {c.followUps ? (
            <Card title="Seguimientos" actions={<More href="/crm/tareas?status=overdue&view=team">Tareas vencidas</More>}>
              <div className="grid grid-cols-2 gap-2">
                <Num label="Visitas sin seguimiento" value={c.followUps.visitsWithoutFollowUp} tone="warning" href="/crm/tareas-sugeridas?vista=equipo&origen=visitas" />
                <Num label="Vencidas sin responsable" value={c.followUps.unassigned} tone="danger" href="/crm/tareas?status=overdue&view=team&assignee=none" />
              </div>
              {c.followUps.agents.length ? (
                <ul className="mt-3 divide-y divide-line text-sm">
                  {c.followUps.agents.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/crm/tareas?status=overdue&view=team&assignee=${a.id}`} className="font-semibold underline-offset-4 hover:underline">
                        {a.agent}
                      </Link>
                      <span className="text-xs text-stone">
                        {a.total} vencidas · {a.follow_ups} de seguimiento
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-stone">Nadie tiene tareas vencidas.</p>
              )}
            </Card>
          ) : null}

          {c.quality ? (
            <Card title="Calidad de las publicaciones" actions={<More href="/crm/propiedades/inventario">Inventario</More>}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Num label={`Baja (< ${c.quality.threshold})`} value={c.quality.low} tone="danger" href="/crm/propiedades?quality=low&published=yes" />
                <Num label="Media" value={c.quality.medium} href="/crm/propiedades?quality=medium&published=yes" />
                <Num label="Alta" value={c.quality.high} href="/crm/propiedades?quality=high&published=yes" />
                <Num label="Sin informe" value={c.quality.none} href="/crm/propiedades?quality=none&published=yes" />
              </div>
              <p className="mt-2 text-xs text-stone">Publicadas{c.quality.avg !== null ? ` · promedio ${c.quality.avg}/100` : ""}. El informe nunca modifica la ficha.</p>
            </Card>
          ) : null}

          {c.aiHealth ? (
            <Card title="Salud de la IA (24 h)" actions={<More href="/crm/integraciones/ia">Uso de IA</More>}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Num label="Pedidos" value={c.aiHealth.usage.requests} href="/crm/integraciones/ia?dias=1" />
                <Num label="Con error" value={c.aiHealth.usage.errors} tone="danger" href="/crm/integraciones/ia?dias=1" />
                <Num label="Respaldo" value={c.aiHealth.usage.requests ? `${Math.round((c.aiHealth.usage.fallbacks / c.aiHealth.usage.requests) * 100)} %` : "—"} />
                <Num label="Costo de hoy" value={usd(c.aiHealth.spentTodayUsd)} />
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                <li className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Proveedor:</span>
                  {c.aiHealth.integration ? <Badge tone={INTEGRATION_STATUS[c.aiHealth.integration.status]?.tone}>{INTEGRATION_STATUS[c.aiHealth.integration.status]?.label ?? c.aiHealth.integration.status}</Badge> : <Badge>Sin registrar</Badge>}
                  <span className="text-xs text-stone">
                    Presupuesto diario {usd(c.aiHealth.dailyBudgetUsd)}
                    {c.aiHealth.budgetExhausted ? " · agotado" : ""}
                  </span>
                </li>
                <li>
                  <Link href="/crm/automatizaciones?runs=todas" className="font-semibold underline-offset-4 hover:underline">
                    Automatizaciones de IA
                  </Link>
                  : {c.aiHealth.automations.runs} ejecuciones · {c.aiHealth.automations.failed} con error · {c.aiHealth.automations.skipped} omitidas
                  {c.aiHealth.automations.loop_guard ? ` (${c.aiHealth.automations.loop_guard} por protección contra loops)` : ""}
                </li>
              </ul>
            </Card>
          ) : null}
        </div>

        <p className="text-xs text-stone">
          Preguntas de dirección: abrí el Asistente IA → Analista y usá «¿Cómo estuvo la semana?», «Leads del mes», «Cuellos de botella» o «Seguimientos atrasados». Cada cifra trae su definición, período y origen.
        </p>
      </div>
    </>
  );
}
