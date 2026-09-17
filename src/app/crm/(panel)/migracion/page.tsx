import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listMigrationWarnings, migrationSummary, warningCodes } from "@/server/migration/review";
import { Badge, buttonClass, Card, EmptyState, Field, formatDateTime, PageHeader, Select, Table } from "@/components/ui";
import { ActionButton } from "@/components/crm/action-button";
import { JsonView } from "@/components/crm/json-view";
import { SEVERITY } from "@/components/crm/labels";
import { PaginationBar } from "@/components/crm/pagination";
import { first, pageParam } from "../_lib/params";
import { reviewWarningAction, verifyPropertyAction } from "./actions";

export const metadata: Metadata = { title: "Migración" };

const STAGE_LABEL: Record<string, string> = {
  discovered: "Descubierta",
  extracted: "Extraída",
  normalized: "Normalizada",
  validated: "Validada",
  imported: "Importada",
  media_verified: "Fotos verificadas",
  review_required: "Requiere revisión",
  verified: "Verificada",
  published: "Publicada",
  failed: "Falló",
  skipped_protected: "Omitida (editada a mano)",
};
const RUN_STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "danger" }> = {
  running: { label: "En curso", tone: "info" },
  completed: { label: "Completa", tone: "success" },
  completed_with_errors: { label: "Completa con errores", tone: "warning" },
  failed: { label: "Falló", tone: "danger" },
};

export default async function MigrationPage({ searchParams }: PageProps<"/crm/migracion">) {
  const actor = await requireStaffPage("migration.read");
  const sp = await searchParams;
  const params = { severity: first(sp, "severity"), status: first(sp, "status"), code: first(sp, "code") };
  const db = getDb();
  const [summary, codes, warnings] = await Promise.all([migrationSummary(db, actor), warningCodes(db, actor), listMigrationWarnings(db, actor, { ...params, page: pageParam(sp) })]);
  const review = can(actor, "migration.review");
  const status = params.status ?? "open";
  const sources = [...new Set(summary.stages.map((s) => s.source))];
  const openBySeverity = (sev: string) => summary.warnings.find((w) => w.severity === sev && w.status === "open")?.n ?? 0;

  return (
    <>
      <PageHeader title="Migración" description="Revisión humana de lo importado desde el sitio anterior. Nada se corrige en silencio: cada decisión queda auditada." />
      <div className="flex flex-col gap-5">
        {summary.runs.length === 0 ? (
          <EmptyState title="Todavía no se corrió ninguna importación" description="Cuando el importador procese el sitio anterior, acá vas a ver el avance por etapa y las advertencias para revisar." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Registros por etapa">
              {sources.length === 0 ? (
                <p className="text-sm text-stone">Sin registros.</p>
              ) : (
                sources.map((src) => (
                  <div key={src} className="mb-3 last:mb-0">
                    <p className="mb-2 font-mono text-xs text-stone">{src}</p>
                    <ul className="flex flex-wrap gap-2">
                      {summary.stages
                        .filter((s) => s.source === src)
                        .map((s) => (
                          <li key={s.stage} className="rounded-full border border-line bg-paper px-2.5 py-1 text-sm">
                            {STAGE_LABEL[s.stage] ?? s.stage} <span className="font-semibold tabular-nums">{s.n}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))
              )}
            </Card>
            <Card title="Corridas recientes">
              <ul className="flex flex-col divide-y divide-line text-sm">
                {summary.runs.map((r) => (
                  <li key={r.id} className="py-2">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-xs">{r.source}</span>
                          <Badge tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge>
                        </span>
                        <span className="text-xs text-stone">
                          {formatDateTime(r.started_at)}
                          {r.finished_at ? ` → ${formatDateTime(r.finished_at)}` : ""} · {r.triggered_by}
                        </span>
                      </summary>
                      {r.error ? <p className="mt-2 text-xs text-danger">{r.error}</p> : null}
                      <div className="mt-2">
                        <JsonView label="Estadísticas" value={r.stats} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        <Card title="Advertencias">
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="danger">{openBySeverity("error")} errores abiertos</Badge>
            <Badge tone="warning">{openBySeverity("warning")} advertencias abiertas</Badge>
            <Badge tone="info">{openBySeverity("info")} informativas abiertas</Badge>
          </div>
          <form method="get" className="mb-4 flex flex-wrap items-end gap-2" aria-label="Filtrar advertencias">
            <Field label="Estado" htmlFor="w-status">
              <Select id="w-status" name="status" defaultValue={status}>
                <option value="open">Abiertas</option>
                <option value="resolved">Resueltas</option>
                <option value="dismissed">Descartadas</option>
              </Select>
            </Field>
            <Field label="Severidad" htmlFor="w-sev">
              <Select id="w-sev" name="severity" defaultValue={params.severity ?? ""}>
                <option value="">Todas</option>
                <option value="error">Error</option>
                <option value="warning">Advertencia</option>
                <option value="info">Info</option>
              </Select>
            </Field>
            <Field label="Código" htmlFor="w-code">
              <Select id="w-code" name="code" defaultValue={params.code ?? ""}>
                <option value="">Todos</option>
                {codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <button type="submit" className={buttonClass("secondary", "md")}>
              Filtrar
            </button>
            {params.severity || params.code || params.status ? (
              <Link href="/crm/migracion" className={buttonClass("ghost", "md")}>
                Limpiar
              </Link>
            ) : null}
          </form>
          {warnings.total === 0 ? (
            <p className="text-sm text-stone">{status === "open" ? "No hay advertencias abiertas." : "No hay advertencias con ese filtro."}</p>
          ) : (
            <>
              <Table label="Advertencias de migración">
                <thead>
                  <tr>
                    <th scope="col">Advertencia</th>
                    <th scope="col">Valores</th>
                    <th scope="col">Propiedad</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {warnings.items.map((w) => (
                    <tr key={w.id} className="align-top">
                      <td className="min-w-64">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={SEVERITY[w.severity]?.tone}>{SEVERITY[w.severity]?.label ?? w.severity}</Badge>
                          <span className="font-mono text-xs">{w.code}</span>
                        </span>
                        <p className="mt-1 text-sm">{w.message}</p>
                        <p className="text-xs text-stone">
                          Campo: {w.field} · {w.source} #{w.external_id}
                          {w.record_stage ? ` · ${STAGE_LABEL[w.record_stage] ?? w.record_stage}` : ""}
                        </p>
                        {w.reviewed_at ? (
                          <p className="text-xs text-stone">
                            {w.status === "resolved" ? "Resuelta" : "Descartada"} por {w.reviewed_by_name ?? "—"} el {formatDateTime(w.reviewed_at)}
                          </p>
                        ) : null}
                      </td>
                      <td className="max-w-xs text-xs">
                        {w.value_a !== null ? <span className="block break-words">A: {w.value_a}</span> : null}
                        {w.value_b !== null ? <span className="block break-words">B: {w.value_b}</span> : null}
                        {w.value_a === null && w.value_b === null ? <span className="text-stone">—</span> : null}
                      </td>
                      <td className="text-sm">
                        {w.property_id ? (
                          <>
                            <Link href={`/crm/propiedades/${w.property_id}`} className="font-semibold underline-offset-4 hover:underline">
                              #{w.property_code} {w.property_title}
                            </Link>
                            {w.property_verified_at ? (
                              <span className="block text-xs text-success">Verificada {formatDateTime(w.property_verified_at)}</span>
                            ) : review ? (
                              <span className="mt-1 block">
                                <ActionButton action={verifyPropertyAction.bind(null, w.property_id)} confirm="¿Marcar la propiedad como verificada?" pendingLabel="…">
                                  Marcar verificada
                                </ActionButton>
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-stone">Sin propiedad</span>
                        )}
                      </td>
                      <td>
                        {review && w.status === "open" ? (
                          <span className="flex flex-col items-start gap-1.5">
                            <ActionButton action={reviewWarningAction.bind(null, w.id, "resolved")} variant="primary" pendingLabel="…">
                              Resolver
                            </ActionButton>
                            <ActionButton action={reviewWarningAction.bind(null, w.id, "dismissed")} variant="ghost" pendingLabel="…">
                              Descartar
                            </ActionButton>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <PaginationBar page={warnings.page} pageCount={warnings.pageCount} total={warnings.total} pathname="/crm/migracion" params={params} label="advertencias" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
