import Link from "next/link";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { listOwnerSettlements } from "@/server/owners/portal";
import { monthLabel } from "@/server/rentals/dates";
import { formatMoney } from "@/components/ui";
import { SettlementStatus } from "@/components/rentals/status";
import { Empty, Section } from "../ui";

export default async function OwnerSettlementsPage() {
  const actor = await requireOwnerPage();
  const rows = await listOwnerSettlements(getDb(), actor);
  return (
    <Section title="Liquidaciones">
      {rows.length === 0 ? (
        <Empty>Todavía no hay liquidaciones aprobadas.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/propietarios/liquidaciones/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4 hover:border-ink">
                <span>
                  <span className="block font-semibold capitalize">{monthLabel(s.period_start)}</span>
                  <span className="block text-xs text-stone">
                    {s.property_title} · contrato {s.code}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="text-right">
                    <span className="block text-xs text-stone">Cobrado {formatMoney(s.gross_collected, s.currency)}</span>
                    <span className="block font-semibold">Neto {formatMoney(s.net_amount, s.currency)}</span>
                  </span>
                  <SettlementStatus status={s.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
