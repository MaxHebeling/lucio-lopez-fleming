import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { can, canAny } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getReport, type ReportData } from "@/server/reports/service";
import { Alert, PageHeader, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/rentals/action-form";
import { PrintButton } from "@/components/rentals/print-button";
import { ReportView } from "@/components/rentals/report-view";
import { ReportStatus } from "@/components/rentals/status";
import { inviteOwnerAction } from "../../alquileres/actions";
import { sendReportAction } from "../actions";

export const metadata: Metadata = { title: "Informe a propietario" };

export default async function ReportPage({ params, searchParams }: PageProps<"/crm/informes/[id]">) {
  const actor = await requireStaffPage("reports.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let report;
  try {
    report = await getReport(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const canSend = can(actor, "reports.generate") && ["generated", "failed"].includes(report.status);
  const canInvite = canAny(actor, ["users.manage", "reports.generate"]);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Informe · ${report.owner_name}`}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <ReportStatus status={report.status} />
              {report.sent_at ? <span>Enviado {formatDateTime(report.sent_at)}</span> : null}
              <Link href="/crm/informes" className="underline underline-offset-4">
                Volver
              </Link>
            </span>
          }
          actions={<PrintButton />}
        />
        <div className="mb-4 flex flex-col gap-3">
          {sp.existente ? <Alert tone="info">Ya existía un informe para ese propietario y período: se muestra el existente.</Alert> : null}
          {sp.actualizado ? <Alert tone="success">Informe regenerado con los datos actuales.</Alert> : null}
          {report.last_error ? <Alert tone="danger">Último envío fallido: {report.last_error}</Alert> : null}
          {canSend ? (
            report.portalUser?.is_active ? (
              <ActionForm action={sendReportAction} submitLabel={report.status === "failed" ? "Reintentar envío" : `Enviar a ${report.portalUser.email}`} confirm="¿Enviar el informe al propietario? Lo va a poder ver en el portal.">
                <input type="hidden" name="id" value={report.id} />
              </ActionForm>
            ) : (
              <Alert tone="warning">
                <span className="block">El propietario no tiene acceso al portal: invitalo para poder enviarle el informe.</span>
                {canInvite ? (
                  <span className="mt-2 block">
                    <ActionForm action={inviteOwnerAction} submitLabel="Invitar al portal" size="sm" inline>
                      <input type="hidden" name="contactId" value={report.owner_contact_id} />
                    </ActionForm>
                  </span>
                ) : null}
              </Alert>
            )
          ) : null}
        </div>
      </div>
      <ReportView data={report.data as unknown as ReportData} />
    </>
  );
}
