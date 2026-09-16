import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { listPortalPublications, portalChannelsOverview, SYNC_STATUSES, type SyncStatus } from "@/server/integrations/portals/queries";
import { Alert, Badge, Card, EmptyState, Input, PageHeader, Select, Table, buttonClass, formatDateTime } from "@/components/ui";
import { InlineAction } from "@/components/crm/inline-action";
import { retryPublicationAction, toggleChannelAction } from "./actions";

export const metadata: Metadata = { title: "Portales · CRM" };

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const SYNC_LABEL: Record<SyncStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "neutral" },
  syncing: { label: "Sincronizando", tone: "info" },
  synced: { label: "Sincronizada", tone: "success" },
  failed: { label: "Con error", tone: "danger" },
  retrying: { label: "Reintentando", tone: "warning" },
  awaiting_credentials: { label: "Esperando credenciales", tone: "warning" },
  disabled: { label: "Canal deshabilitado", tone: "neutral" },
};

const INTEGRATION_LABEL: Record<string, { label: string; tone: Tone }> = {
  awaiting_credentials: { label: "Esperando credenciales", tone: "warning" },
  active: { label: "Conectada", tone: "success" },
  degraded: { label: "Con fallas", tone: "warning" },
  error: { label: "Error", tone: "danger" },
  disabled: { label: "Apagada", tone: "neutral" },
};

/** Estado real relevado de cada portal (ver docs/INTEGRATIONS.md). */
const PORTAL_NOTE: Record<string, string> = {
  mercadolibre: "API pública oficial. Requiere aplicación en Mercado Libre, autorización de la cuenta y paquete de publicación de inmuebles.",
  argenprop: "Sin API pública: la integración la habilita Argenprop por acuerdo comercial. Hasta entonces no se envía nada.",
  zonaprop: "Sin API pública: la integración la habilita Zonaprop (Navent) por acuerdo comercial. Hasta entonces no se envía nada.",
};

const RETRYABLE: SyncStatus[] = ["failed", "retrying", "awaiting_credentials", "pending"];

function syncBadge(status: string) {
  const s = SYNC_LABEL[status as SyncStatus] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export default async function PublicacionesPage({ searchParams }: PageProps<"/crm/publicaciones">) {
  const actor = await requireStaffPage("publications.manage");
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const filters = { channel: str(sp.canal), status: str(sp.estado), q: str(sp.q), page: Number(str(sp.pagina) ?? "1") || 1 };
  const db = getDb();
  const [overview, list] = await Promise.all([portalChannelsOverview(db, actor), listPortalPublications(db, actor, filters)]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.channel) params.set("canal", filters.channel);
    if (filters.status) params.set("estado", filters.status);
    if (filters.q) params.set("q", filters.q);
    params.set("pagina", String(page));
    return `/crm/publicaciones?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Portales" description="Estado de publicación de cada propiedad en los portales inmobiliarios. Si un portal falla, el dato del CRM no cambia: se reintenta aparte." />

      {!overview.flagEnabled ? (
        <Alert tone="warning">La sincronización automática está apagada (feature flag portal_sync). Los cambios quedan pendientes hasta activarla desde Integraciones.</Alert>
      ) : null}

      <section aria-labelledby="canales" className="flex flex-col gap-3">
        <h2 id="canales" className="text-sm font-bold uppercase tracking-wide text-ink-2">
          Canales
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {overview.channels.map((c) => {
            const integ = INTEGRATION_LABEL[c.integration_status ?? ""] ?? { label: "Sin integración", tone: "neutral" as Tone };
            const total = Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0);
            return (
              <Card key={c.key} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-ink">{c.name}</h3>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={c.is_enabled ? "success" : "neutral"}>{c.is_enabled ? "Habilitado" : "Deshabilitado"}</Badge>
                    <Badge tone={integ.tone}>{integ.label}</Badge>
                  </div>
                </div>
                {PORTAL_NOTE[c.key] ? <p className="text-sm text-stone">{PORTAL_NOTE[c.key]}</p> : null}
                {c.integration_error ? (
                  <p className="break-words rounded-[var(--radius-md)] bg-paper-2 px-3 py-2 text-xs text-ink-2" title={c.integration_error}>
                    {c.integration_error.slice(0, 220)}
                  </p>
                ) : null}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {(["synced", "failed", "retrying", "awaiting_credentials", "pending", "disabled"] as const).map((s) =>
                    c.counts[s] ? (
                      <div key={s} className="flex justify-between gap-2">
                        <dt className="text-stone">{SYNC_LABEL[s].label}</dt>
                        <dd className="font-semibold tabular-nums text-ink">{c.counts[s]}</dd>
                      </div>
                    ) : null,
                  )}
                  {!total ? <p className="col-span-2 text-stone">Sin propiedades publicadas en este canal todavía.</p> : null}
                </dl>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="text-xs text-stone">Último OK: {formatDateTime(c.last_ok_at)}</span>
                  <InlineAction
                    action={toggleChannelAction}
                    fields={{ channelKey: c.key, enabled: String(!c.is_enabled) }}
                    label={c.is_enabled ? "Deshabilitar" : "Habilitar"}
                    variant={c.is_enabled ? "ghost" : "primary"}
                    confirmText={
                      c.is_enabled
                        ? `¿Deshabilitar ${c.name}? Se deja de sincronizar; los avisos ya publicados en el portal no se borran.`
                        : `¿Habilitar ${c.name}? Las propiedades publicadas se sincronizarán cuando haya credenciales.`
                    }
                  />
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="publicaciones" className="flex flex-col gap-3">
        <h2 id="publicaciones" className="text-sm font-bold uppercase tracking-wide text-ink-2">
          Publicaciones <span className="font-normal normal-case text-stone">({list.total})</span>
        </h2>
        <form method="get" className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]" role="search">
          <label className="sr-only" htmlFor="f-canal">
            Canal
          </label>
          <Select id="f-canal" name="canal" defaultValue={filters.channel ?? ""}>
            <option value="">Todos los portales</option>
            {overview.channels.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </Select>
          <label className="sr-only" htmlFor="f-estado">
            Estado
          </label>
          <Select id="f-estado" name="estado" defaultValue={filters.status ?? ""}>
            <option value="">Todos los estados</option>
            {SYNC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SYNC_LABEL[s].label}
              </option>
            ))}
          </Select>
          <label className="sr-only" htmlFor="f-q">
            Buscar
          </label>
          <Input id="f-q" name="q" placeholder="Código o título" defaultValue={filters.q ?? ""} />
          <button type="submit" className={buttonClass("secondary")}>
            Filtrar
          </button>
        </form>

        {list.rows.length === 0 ? (
          <EmptyState
            title="No hay publicaciones para mostrar"
            description="Cuando se publica una propiedad, acá aparece su estado en cada portal habilitado."
          />
        ) : (
          <>
            <Table className="hidden md:block">
              <thead>
                <tr>
                  <th>Propiedad</th>
                  <th>Portal</th>
                  <th>Estado</th>
                  <th>Aviso</th>
                  <th>Último intento</th>
                  <th>Detalle</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td>
                      <Link href={`/crm/propiedades/${r.property_id}`} className="font-semibold text-ink hover:underline">
                        {r.code} · {r.title}
                      </Link>
                      <p className="text-xs text-stone">{r.desired_state === "published" ? "Debe estar publicada" : "Debe estar dada de baja"}</p>
                    </td>
                    <td className="whitespace-nowrap">{r.channel_name}</td>
                    <td>{syncBadge(r.sync_status)}</td>
                    <td className="whitespace-nowrap">
                      {r.external_url ? (
                        <a href={r.external_url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">
                          Ver aviso
                        </a>
                      ) : (
                        <span className="text-stone">{r.external_id ?? "—"}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-stone">
                      {formatDateTime(r.last_attempt_at)}
                      {r.attempts ? <span className="block">Intentos: {r.attempts}</span> : null}
                    </td>
                    <td className="max-w-[320px] text-xs text-ink-2">
                      {r.last_error ? <span className="line-clamp-3 break-words" title={r.last_error}>{r.last_error}</span> : <span className="text-stone">Sincronizada {formatDateTime(r.last_synced_at)}</span>}
                    </td>
                    <td>
                      {r.channel_enabled && RETRYABLE.includes(r.sync_status as SyncStatus) ? (
                        <InlineAction action={retryPublicationAction} fields={{ publicationId: r.id }} label="Reintentar" pendingLabel="Encolando…" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <ul className="flex flex-col gap-2 md:hidden">
              {list.rows.map((r) => (
                <li key={r.id} className="rounded-[var(--radius-lg)] border border-line bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/crm/propiedades/${r.property_id}`} className="min-w-0 font-semibold text-ink hover:underline">
                      <span className="block truncate">
                        {r.code} · {r.title}
                      </span>
                    </Link>
                    {syncBadge(r.sync_status)}
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{r.channel_name}</p>
                  {r.last_error ? <p className="mt-2 break-words text-xs text-ink-2">{r.last_error.slice(0, 240)}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-stone">Último intento: {formatDateTime(r.last_attempt_at)}</span>
                    {r.external_url ? (
                      <a href={r.external_url} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">
                        Ver aviso
                      </a>
                    ) : null}
                  </div>
                  {r.channel_enabled && RETRYABLE.includes(r.sync_status as SyncStatus) ? (
                    <InlineAction action={retryPublicationAction} fields={{ publicationId: r.id }} label="Reintentar" pendingLabel="Encolando…" className="mt-2" />
                  ) : null}
                </li>
              ))}
            </ul>

            {pages > 1 ? (
              <nav aria-label="Paginación" className="flex items-center justify-between gap-2 text-sm">
                {list.page > 1 ? (
                  <Link href={pageHref(list.page - 1)} className={buttonClass("secondary", "sm")}>
                    Anterior
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-stone">
                  Página {list.page} de {pages}
                </span>
                {list.page < pages ? (
                  <Link href={pageHref(list.page + 1)} className={buttonClass("secondary", "sm")}>
                    Siguiente
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
