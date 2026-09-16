import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listOwnersForReports, listReports } from "@/server/reports/service";
import { addMonths, firstOfMonth, lastOfMonth, todayInSalta } from "@/server/rentals/dates";
import { Card, EmptyState, PageHeader, Table, formatDate, formatDateTime } from "@/components/ui";
import { ReportStatus } from "@/components/rentals/status";
import { ReportForm } from "./report-form";

export const metadata: Metadata = { title: "Informes a propietarios" };

export default async function ReportsPage() {
  const actor = await requireStaffPage("reports.read");
  const db = getDb();
  const [reports, owners] = await Promise.all([listReports(db, actor), can(actor, "reports.generate") ? listOwnersForReports(db, actor) : Promise.resolve([])]);
  const prevMonth = addMonths(firstOfMonth(todayInSalta()), -1);

  return (
    <>
      <PageHeader title="Informes a propietarios" description="Consultas, visitas, cambios de precio y estado, cobros y liquidaciones del período. Solo datos registrados en el sistema." />
      {can(actor, "reports.generate") ? (
        <Card title="Generar informe" className="mb-5">
          {owners.length ? (
            <ReportForm owners={owners} defaultStart={prevMonth} defaultEnd={lastOfMonth(prevMonth)} />
          ) : (
            <p className="text-sm text-stone">No hay propietarios con propiedades o contratos cargados.</p>
          )}
        </Card>
      ) : null}
      {reports.length === 0 ? (
        <EmptyState title="Todavía no hay informes" description="Generá el primero eligiendo propietario y período." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Propietario</th>
              <th>Alcance</th>
              <th>Período</th>
              <th>Estado</th>
              <th>Generado</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/crm/informes/${r.id}`} className="font-semibold underline-offset-4 hover:underline">
                    {r.owner_name}
                  </Link>
                </td>
                <td className="max-w-[240px] truncate">{r.property_title ?? "Todas sus propiedades"}</td>
                <td className="whitespace-nowrap text-xs">
                  {formatDate(r.period_start)} → {formatDate(r.period_end)}
                </td>
                <td>
                  <ReportStatus status={r.status} />
                  {r.last_error ? <span className="block text-xs text-danger">{r.last_error.slice(0, 80)}</span> : null}
                </td>
                <td className="whitespace-nowrap text-xs">{formatDateTime(r.generated_at)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
