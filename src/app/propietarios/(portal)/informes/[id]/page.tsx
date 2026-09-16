import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getOwnerReport } from "@/server/owners/portal";
import type { ReportData } from "@/server/reports/service";
import { PrintButton } from "@/components/rentals/print-button";
import { ReportView } from "@/components/rentals/report-view";
import { UUID } from "../../ui";

export default async function OwnerReportPage({ params }: PageProps<"/propietarios/informes/[id]">) {
  const actor = await requireOwnerPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let report;
  try {
    report = await getOwnerReport(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/propietarios/informes" className="text-sm underline underline-offset-4">
          ← Informes
        </Link>
        <PrintButton />
      </div>
      <ReportView data={report.data as unknown as ReportData} />
    </>
  );
}
