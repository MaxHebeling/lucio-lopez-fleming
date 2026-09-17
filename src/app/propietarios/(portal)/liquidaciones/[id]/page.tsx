import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getOwnerSettlement } from "@/server/owners/portal";
import { monthLabel } from "@/server/rentals/dates";
import { formatDate, formatMoney } from "@/components/ui";
import { PrintButton } from "@/components/rentals/print-button";
import { SettlementStatus } from "@/components/rentals/status";
import { UUID } from "../../ui";

export default async function OwnerSettlementPage({ params }: PageProps<"/propietarios/liquidaciones/[id]">) {
  const actor = await requireOwnerPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let data;
  try {
    data = await getOwnerSettlement(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { settlement: s, lines } = data;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/propietarios/liquidaciones" className="text-sm underline underline-offset-4">
          ← Liquidaciones
        </Link>
        <PrintButton />
      </div>
      <article className="rounded-[var(--radius-lg)] border border-line bg-white p-5 sm:p-8">
        <style>{`@media print { @page { size: A4; margin: 14mm; } body { background: #fff !important; } header, nav, footer { display: none !important; } article { border: 0 !important; padding: 0 !important; } }`}</style>
        <p className="font-display text-3xl leading-none">Lucio López Fleming</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-brick">Liquidación al propietario</p>
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold capitalize">{monthLabel(s.period_start)}</h1>
          <SettlementStatus status={s.status} />
        </div>
        <p className="text-sm text-stone">
          {s.property_title} · contrato {s.code}
          {s.paid_at ? ` · pagada el ${formatDate(s.paid_at)}` : s.approved_at ? ` · aprobada el ${formatDate(s.approved_at)}` : ""}
        </p>
        <table className="mt-5 w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="py-2 pr-3">{l.description}</td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatMoney(l.amount, s.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-ink">
            <tr>
              <td className="py-1 text-stone">Cobrado</td>
              <td className="py-1 text-right tabular-nums">{formatMoney(s.gross_collected, s.currency)}</td>
            </tr>
            <tr>
              <td className="py-1 text-stone">Honorario de administración</td>
              <td className="py-1 text-right tabular-nums">− {formatMoney(s.management_fee_amount, s.currency)}</td>
            </tr>
            <tr>
              <td className="py-1 text-stone">Otras deducciones</td>
              <td className="py-1 text-right tabular-nums">− {formatMoney(s.other_deductions, s.currency)}</td>
            </tr>
            <tr className="text-base font-bold">
              <td className="py-2">Neto a cobrar</td>
              <td className="py-2 text-right tabular-nums">{formatMoney(s.net_amount, s.currency)}</td>
            </tr>
          </tfoot>
        </table>
      </article>
    </>
  );
}
