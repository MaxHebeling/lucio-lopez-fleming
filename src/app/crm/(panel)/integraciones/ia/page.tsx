import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { getAiUsage } from "@/server/ai/observability";
import { Badge, buttonClass, Card, formatDateTime, PageHeader, Table } from "@/components/ui";
import { INTEGRATION_STATUS } from "@/components/crm/labels";
import { first } from "../../_lib/params";

export const metadata: Metadata = { title: "Uso de IA" };

const REASON_LABEL: Record<string, string> = {
  not_configured: "Sin clave del proveedor",
  flag_disabled: "Flag apagado",
  budget_exhausted: "Presupuesto agotado",
  budget_exceeded: "Presupuesto agotado",
  rate_limited: "Límite de pedidos",
  provider_error: "Error del proveedor",
  timeout: "Tiempo agotado",
  circuit_open: "Circuito en pausa",
  invalid_output: "Salida inválida",
  guard_blocked: "Bloqueada por guardas (datos no verificados)",
  governance_blocked: "Bloqueada por gobernanza",
  error: "Error",
  unavailable: "No disponible",
  fallback: "Respuesta de respaldo",
  blocked: "Bloqueada",
};

const FEATURE_LABEL: Record<string, string> = {
  "copilot.assistant": "Asistente IA · guía",
  "copilot.analyst": "Asistente IA · analista",
  whatsapp_reply: "Asistente de WhatsApp",
};

const usd = (n: number) => `USD ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)} %`);
const ms = (n: number | null) => (n === null ? "—" : n >= 1000 ? `${(n / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s` : `${n} ms`);

export default async function AiUsagePage({ searchParams }: PageProps<"/crm/integraciones/ia">) {
  const actor = await requireStaffPage("ai.read_usage");
  const sp = await searchParams;
  const data = await getAiUsage(getDb(), actor, { days: first(sp, "dias") });
  const ranges = [1, 7, 30, 90];

  return (
    <>
      <PageHeader
        title="Uso de IA"
        description="Pedidos, latencia, errores, costos y calidad del Asistente IA y del asistente de WhatsApp. No se guardan prompts ni respuestas completas: solo metadatos."
        actions={
          <Link href="/crm/integraciones" className={buttonClass("secondary", "md")}>
            Volver a Integraciones
          </Link>
        }
      />
      <nav aria-label="Período" className="mb-5 flex flex-wrap gap-2">
        {ranges.map((d) => (
          <Link key={d} href={`/crm/integraciones/ia?dias=${d}`} aria-current={data.days === d ? "page" : undefined} className={buttonClass(data.days === d ? "primary" : "secondary", "sm")}>
            {d === 1 ? "Último día" : `Últimos ${d} días`}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-5">
        <section aria-label="Resumen" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone">Pedidos</p>
            <p className="mt-1 text-2xl font-bold">{data.totals.requests}</p>
            <p className="text-xs text-stone">
              {data.totals.errors} con error · respaldo {pct(data.totals.fallbackRate)}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone">Costo de hoy</p>
            <p className="mt-1 text-2xl font-bold">{usd(data.cost.todayUsd)}</p>
            <p className="text-xs text-stone">
              Presupuesto diario {usd(data.cost.dailyBudgetUsd)}
              {data.cost.budgetExhausted ? " · agotado" : ""}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone">Costo del mes</p>
            <p className="mt-1 text-2xl font-bold">{usd(data.cost.monthUsd)}</p>
            <p className="text-xs text-stone">Referencia: presupuesto diario × días transcurridos = {usd(data.cost.monthBudgetToDateUsd)}</p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wide text-stone">Feedback</p>
            <p className="mt-1 text-2xl font-bold">
              👍 {data.feedback.up} · 👎 {data.feedback.down}
            </p>
            <p className="text-xs text-stone">
              {data.totals.toolFailures} fallas de herramientas · {data.totals.retrievalFailures} de búsqueda en la guía
            </p>
          </Card>
        </section>

        <Card title="Estado">
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Proveedor (Claude):</span>
              {data.integration ? <Badge tone={INTEGRATION_STATUS[data.integration.status]?.tone}>{INTEGRATION_STATUS[data.integration.status]?.label ?? data.integration.status}</Badge> : <Badge>Sin registrar</Badge>}
              {data.integration?.last_ok_at ? <span className="text-xs text-stone">Último OK {formatDateTime(data.integration.last_ok_at)}</span> : null}
              {data.integration?.status === "awaiting_credentials" ? <span className="text-xs text-stone">Falta ANTHROPIC_API_KEY en las variables de entorno del despliegue.</span> : null}
            </li>
            <li>
              <span className="font-semibold">Guía del CRM:</span> {data.knowledge.documents} guías · {data.knowledge.chunks} secciones
              {data.knowledge.lastUpdated ? <span className="text-xs text-stone"> · actualizada {formatDateTime(data.knowledge.lastUpdated)}</span> : <span className="text-xs text-warning"> · sin cargar (pnpm ai:knowledge:ingest)</span>}
            </li>
            <li className="flex flex-wrap gap-1.5">
              <span className="font-semibold">Flags:</span>
              {data.flags.map((f) => (
                <Badge key={f.key} tone={f.enabled ? "success" : "neutral"}>
                  {f.key}: {f.enabled ? "encendido" : "apagado"}
                </Badge>
              ))}
            </li>
          </ul>
        </Card>

        <Card title="Por función">
          {data.byFeature.length ? (
            <Table label="Uso por función">
              <thead>
                <tr>
                  <th scope="col">Función</th>
                  <th scope="col">Pedidos</th>
                  <th scope="col">Errores</th>
                  <th scope="col">Respaldo</th>
                  <th scope="col">Latencia p50 / p95</th>
                  <th scope="col">Costo</th>
                </tr>
              </thead>
              <tbody>
                {data.byFeature.map((r) => (
                  <tr key={r.feature}>
                    <td className="font-semibold">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                    <td>{r.requests}</td>
                    <td>{r.errors}</td>
                    <td>{r.fallbacks}</td>
                    <td className="whitespace-nowrap">
                      {ms(r.p50)} / {ms(r.p95)}
                    </td>
                    <td className="whitespace-nowrap">{usd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-stone">Sin pedidos en el período.</p>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Motivos de respaldo y errores">
            {data.reasons.length ? (
              <ul className="divide-y divide-line text-sm">
                {data.reasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-3 py-2">
                    <span>{REASON_LABEL[r.reason] ?? r.reason}</span>
                    <span className="font-semibold">{r.n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin respaldos ni errores en el período.</p>
            )}
          </Card>
          <Card title="Herramientas">
            {data.tools.length ? (
              <ul className="divide-y divide-line text-sm">
                {data.tools.map((t) => (
                  <li key={t.name} className="flex justify-between gap-3 py-2">
                    <span className="font-mono text-xs">{t.name}</span>
                    <span>
                      {t.calls} usos{t.failures ? <span className="text-danger"> · {t.failures} fallas</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone">Sin uso de herramientas en el período.</p>
            )}
          </Card>
        </div>

        <Card title="Por día">
          {data.daily.length ? (
            <Table label="Uso por día">
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  <th scope="col">Pedidos</th>
                  <th scope="col">Errores</th>
                  <th scope="col">Costo</th>
                </tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{d.requests}</td>
                    <td>{d.errors}</td>
                    <td>{usd(d.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-stone">Sin pedidos en el período.</p>
          )}
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Modelos por tarea">
            <ul className="divide-y divide-line text-sm">
              {data.routing.map((r) => (
                <li key={r.task} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="font-semibold">{r.task}</span>
                  <span className="font-mono text-xs">
                    {r.model} <span className="text-stone">({r.source === "setting" ? "configurado" : "por defecto"})</span>
                    {r.rejected ? <span className="text-danger"> · «{r.rejected}» rechazado: sin precio conocido</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone">Se cambian en settings (ai.model.&lt;tarea&gt;). Solo se aceptan modelos con precio registrado.</p>
          </Card>
          <Card title="Prompts versionados">
            <ul className="divide-y divide-line text-sm">
              {data.prompts.map((p) => (
                <li key={p.id} className="py-2">
                  <span className="font-mono text-xs font-semibold">
                    {p.id}@{p.version}
                  </span>
                  <span className="block text-xs text-stone">{p.notes}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card title="Comentarios recientes">
          {data.feedback.comments.length ? (
            <ul className="divide-y divide-line text-sm">
              {data.feedback.comments.map((c) => (
                <li key={c.id} className="py-2">
                  <p>
                    <span aria-hidden="true">{c.rating === 1 ? "👍" : "👎"}</span>
                    <span className="sr-only">{c.rating === 1 ? "Me sirvió:" : "No me sirvió:"}</span> {c.comment}
                  </p>
                  <p className="text-xs text-stone">
                    {c.full_name} · {formatDateTime(c.created_at)} · {FEATURE_LABEL[c.feature ?? ""] ?? c.feature ?? "—"} · {c.prompt_ref ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone">Todavía no hay comentarios.</p>
          )}
        </Card>
      </div>
    </>
  );
}
