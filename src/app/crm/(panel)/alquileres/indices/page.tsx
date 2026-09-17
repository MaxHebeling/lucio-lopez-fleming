import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { indicesOverview } from "@/server/rentals/queries";
import { pctFromCoefficient } from "@/server/rentals/adjustment-calc";
import { monthLabel, todayInSalta } from "@/server/rentals/dates";
import { INDEX_LABEL } from "@/server/rentals/schema";
import { Alert, Badge, Card, Field, Input, PageHeader, Select, Table, formatDate, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/rentals/action-form";
import { fetchBcraNowAction, manualIndexAction } from "../actions";

export const metadata: Metadata = { title: "Índices de ajuste" };

const INTEGRATION_STATUS: Record<string, string> = { active: "Operativa", degraded: "Con fallas", error: "Con error", disabled: "Desactivada", awaiting_credentials: "Sin credenciales" };
const SOURCE_LABEL: Record<string, string> = { bcra_api: "API BCRA", manual: "Carga manual", import: "Importación" };

export default async function IndicesPage() {
  const actor = await requireStaffPage("rentals.read");
  const data = await indicesOverview(getDb(), actor);
  const canAdjust = can(actor, "rentals.adjust");
  const today = todayInSalta();
  const bcra = data.integration;
  const latestFor = (k: string) => data.latest.find((l) => l.index_key === k);

  return (
    <>
      <PageHeader title="Índices de ajuste" description="ICL y CER se descargan a diario de la API pública del BCRA. IPC y Casa Propia se cargan a mano con la variación mensual publicada." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.indices.map((i) => {
          const l = latestFor(i.key);
          const monthly = i.granularity === "monthly";
          return (
            <Card key={i.key} title={INDEX_LABEL[i.key] ?? i.key}>
              <p className="text-xs text-stone">
                {i.name} · {i.source}
              </p>
              {l ? (
                <>
                  <p className="mt-2 text-2xl font-bold tabular-nums">{monthly ? `${pctFromCoefficient(l.value, 2)}%` : Number(l.value).toLocaleString("es-AR", { maximumFractionDigits: 8 })}</p>
                  <p className="text-xs text-stone">
                    {monthly ? <span className="capitalize">{monthLabel(l.period_date)}</span> : `al ${formatDate(l.period_date)}`} · {SOURCE_LABEL[l.source] ?? l.source} · {l.total} valores cargados
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-stone">Sin valores cargados.</p>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card
          title="Descarga desde el BCRA"
          actions={
            canAdjust ? (
              <ActionForm action={fetchBcraNowAction} submitLabel="Actualizar ahora" pendingLabel="Consultando al BCRA…" size="sm" variant="secondary" />
            ) : null
          }
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={bcra?.status === "active" ? "success" : bcra?.status === "degraded" ? "warning" : "danger"}>{bcra ? (INTEGRATION_STATUS[bcra.status] ?? bcra.status) : "Sin configurar"}</Badge>
            <Badge tone={data.fetchEnabled ? "success" : "neutral"}>{data.fetchEnabled ? "Descarga diaria activa" : "Descarga diaria desactivada (flag rent_index_fetch)"}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <dt className="text-stone">Última respuesta correcta</dt>
            <dd>{formatDateTime(bcra?.last_ok_at)}</dd>
            <dt className="text-stone">Último error</dt>
            <dd>{bcra?.last_error_at ? `${formatDateTime(bcra.last_error_at)}: ${bcra.last_error}` : "—"}</dd>
            <dt className="text-stone">Fallas seguidas</dt>
            <dd>{bcra?.consecutive_failures ?? 0}</dd>
            {bcra?.circuit_open_until && bcra.circuit_open_until > new Date() ? (
              <>
                <dt className="text-stone">En pausa hasta</dt>
                <dd>{formatDateTime(bcra.circuit_open_until)}</dd>
              </>
            ) : null}
          </dl>
          {data.logs.length ? (
            <ul className="mt-3 flex flex-col gap-1 text-xs">
              {data.logs.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>
                    {formatDateTime(l.created_at)} · {l.operation}
                  </span>
                  <span className={l.status === "ok" ? "text-success" : "text-danger"}>
                    {l.status === "ok" ? `ok (${l.duration_ms} ms)` : (l.error ?? "error").slice(0, 80)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-stone">Todavía no hubo consultas al BCRA.</p>
          )}
          <p className="mt-3 text-xs text-stone">Fuente: api.bcra.gob.ar, Estadísticas Monetarias v4.0 (variables 40 = ICL y 30 = CER). El BCRA publica valores por adelantado.</p>
        </Card>

        <Card title="Carga manual (IPC / Casa Propia)">
          {canAdjust ? (
            <ActionForm action={manualIndexAction} submitLabel="Guardar valor" resetOnSuccess>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Índice" htmlFor="indexKey">
                  <Select id="indexKey" name="indexKey" defaultValue="IPC">
                    <option value="IPC">IPC (INDEC)</option>
                    <option value="CASA_PROPIA">Casa Propia</option>
                  </Select>
                </Field>
                <Field label="Mes" htmlFor="month">
                  <Input id="month" name="month" type="month" max={today.slice(0, 7)} required />
                </Field>
                <Field label="Variación mensual %" htmlFor="variationPct" hint="Ej.: 2.1 (tal como se publica)">
                  <Input id="variationPct" name="variationPct" type="number" step="0.0001" inputMode="decimal" required />
                </Field>
              </div>
              <Alert tone="info">Cada carga o corrección queda auditada con el valor anterior. Verificá el dato contra la publicación oficial antes de guardarlo.</Alert>
            </ActionForm>
          ) : (
            <p className="text-sm text-stone">Necesitás el permiso de ajustes para cargar valores.</p>
          )}
          {data.monthly.length ? (
            <Table label="Índices cargados" className="mt-4">
              <thead>
                <tr>
                  <th>Índice</th>
                  <th>Mes</th>
                  <th className="text-right">Variación</th>
                  <th>Cargó</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly.map((m) => (
                  <tr key={`${m.index_key}-${m.period_date}`}>
                    <td>{INDEX_LABEL[m.index_key] ?? m.index_key}</td>
                    <td className="capitalize">{monthLabel(m.period_date)}</td>
                    <td className="text-right tabular-nums">{pctFromCoefficient(m.value, 2)}%</td>
                    <td className="text-xs">
                      {m.entered_by_name ?? SOURCE_LABEL[m.source]} · {formatDate(m.fetched_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>
      </div>

      {data.recentDaily.length ? (
        <Card title="ICL y CER: una semana antes y después de hoy" className="mt-5">
          <Table label="ICL y CER alrededor de hoy">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="text-right">ICL</th>
                <th className="text-right">CER</th>
              </tr>
            </thead>
            <tbody>
              {[...new Set(data.recentDaily.map((d) => d.period_date))].map((date) => (
                <tr key={date} className={date === today ? "bg-paper font-semibold" : undefined}>
                  <td>{formatDate(date)}</td>
                  <td className="text-right tabular-nums">{data.recentDaily.find((d) => d.period_date === date && d.index_key === "ICL")?.value ?? "—"}</td>
                  <td className="text-right tabular-nums">{data.recentDaily.find((d) => d.period_date === date && d.index_key === "CER")?.value ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
