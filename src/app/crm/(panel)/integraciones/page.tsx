import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listFeatureFlags, listIntegrationLogs, listIntegrations } from "@/server/system/integrations";
import { Badge, buttonClass, Card, Field, formatDateTime, PageHeader, Select, Table } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { INTEGRATION_STATUS } from "@/components/crm/labels";
import { first } from "../_lib/params";
import { setFeatureFlagAction } from "./actions";

export const metadata: Metadata = { title: "Integraciones" };

const CATEGORY: Record<string, string> = { messaging: "Mensajería", portal: "Portales", social: "Redes", email: "Email", ai: "IA", storage: "Storage", data: "Datos", monitoring: "Monitoreo" };
const LOG_TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = { ok: "success", error: "danger", skipped: "neutral", retry: "warning" };

export default async function IntegrationsPage({ searchParams }: PageProps<"/crm/integraciones">) {
  const actor = await requireStaffPage("integrations.read");
  const sp = await searchParams;
  const key = first(sp, "integracion");
  const status = first(sp, "estado");
  const db = getDb();
  const [integrations, logs, flags] = await Promise.all([listIntegrations(db, actor), listIntegrationLogs(db, actor, { integrationKey: key, status, limit: 50 }), listFeatureFlags(db, actor)]);
  const manage = can(actor, "integrations.manage");
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Integraciones"
        description="Estado real de cada conexión externa. Sin credenciales, una integración queda en espera: nunca simula respuestas."
        actions={
          can(actor, "ai.read_usage") ? (
            <Link href="/crm/integraciones/ia" className={buttonClass("secondary", "md")}>
              Uso de IA
            </Link>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-5">
        <Card title="Estado">
          <Table label="Estado de integraciones">
            <thead>
              <tr>
                <th scope="col">Integración</th>
                <th scope="col">Estado</th>
                <th scope="col">Último OK</th>
                <th scope="col">Último error</th>
              </tr>
            </thead>
            <tbody>
              {integrations.map((i) => (
                <tr key={i.key}>
                  <td>
                    <span className="font-semibold">{i.name}</span>
                    <span className="block text-xs text-stone">{CATEGORY[i.category] ?? i.category}</span>
                  </td>
                  <td>
                    <span className="flex flex-col items-start gap-1">
                      <Badge tone={INTEGRATION_STATUS[i.status]?.tone}>{INTEGRATION_STATUS[i.status]?.label ?? i.status}</Badge>
                      {i.circuit_open_until && i.circuit_open_until > now ? <Badge tone="danger">En pausa hasta {formatDateTime(i.circuit_open_until)}</Badge> : null}
                      {i.consecutive_failures > 0 ? <span className="text-xs text-warning">{i.consecutive_failures} fallas seguidas</span> : null}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-xs text-stone">{formatDateTime(i.last_ok_at)}</td>
                  <td className="max-w-md text-xs">
                    {i.last_error ? (
                      <>
                        <span className="block text-danger">{i.last_error}</span>
                        <span className="text-stone">{formatDateTime(i.last_error_at)}</span>
                      </>
                    ) : (
                      <span className="text-stone">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Feature flags">
          <p className="mb-3 text-sm text-stone">Encienden o apagan funciones sin desplegar. Cada cambio queda auditado; otras instancias lo toman en hasta 15 segundos.</p>
          <ul className="flex flex-col divide-y divide-line">
            {flags.map((f) => (
              <li key={f.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{f.key}</span>
                    <Badge tone={f.enabled ? "success" : "neutral"}>{f.enabled ? "Encendido" : "Apagado"}</Badge>
                  </p>
                  <p className="text-sm text-ink-2">{f.description}</p>
                  {f.updated_by_name ? (
                    <p className="text-xs text-stone">
                      Último cambio: {formatDateTime(f.updated_at)} por {f.updated_by_name}
                    </p>
                  ) : null}
                </div>
                {manage ? (
                  <ActionButton
                    action={setFeatureFlagAction.bind(null, f.key, !f.enabled)}
                    variant={f.enabled ? "secondary" : "primary"}
                    confirm={`¿${f.enabled ? "Apagar" : "Encender"} ${f.key}?`}
                    pendingLabel="Guardando…"
                  >
                    {f.enabled ? "Apagar" : "Encender"}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Logs recientes">
          <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
            <Field label="Integración" htmlFor="l-key">
              <Select id="l-key" name="integracion" defaultValue={key ?? ""}>
                <option value="">Todas</option>
                {integrations.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Resultado" htmlFor="l-status">
              <Select id="l-status" name="estado" defaultValue={status ?? ""}>
                <option value="">Todos</option>
                <option value="error">Error</option>
                <option value="ok">OK</option>
                <option value="retry">Reintento</option>
                <option value="skipped">Omitido</option>
              </Select>
            </Field>
            <button type="submit" className={buttonClass("secondary", "md")}>
              Filtrar
            </button>
            {key || status ? (
              <Link href="/crm/integraciones" className={buttonClass("ghost", "md")}>
                Limpiar
              </Link>
            ) : null}
          </form>
          {logs.length === 0 ? (
            <p className="text-sm text-stone">Sin llamadas registradas{key || status ? " para ese filtro" : ""}.</p>
          ) : (
            <Table label="Registro de llamadas">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Integración</th>
                  <th scope="col">Operación</th>
                  <th scope="col">Resultado</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs text-stone">{formatDateTime(l.created_at)}</td>
                    <td className="font-mono text-xs">{l.integration_key}</td>
                    <td className="text-xs">
                      {l.operation}
                      {l.entity_type ? <span className="block text-stone">{l.entity_type}</span> : null}
                    </td>
                    <td>
                      <Badge tone={LOG_TONE[l.status]}>{l.status}</Badge>
                      {l.http_status ? <span className="ml-1 text-xs text-stone">HTTP {l.http_status}</span> : null}
                      {l.duration_ms !== null ? <span className="block text-xs text-stone">{l.duration_ms} ms</span> : null}
                    </td>
                    <td className="max-w-md text-xs text-danger">{l.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
