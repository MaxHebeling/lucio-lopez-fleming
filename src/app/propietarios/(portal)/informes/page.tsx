import Link from "next/link";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { listOwnerReports } from "@/server/owners/portal";
import { formatDate, formatDateTime } from "@/components/ui";
import { Empty, Section } from "../ui";

export default async function OwnerReportsPage() {
  const actor = await requireOwnerPage();
  const rows = await listOwnerReports(getDb(), actor);
  return (
    <Section title="Informes">
      {rows.length === 0 ? (
        <Empty>Cuando la inmobiliaria te envíe un informe, lo vas a ver acá.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/propietarios/informes/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-paper">
                <span>
                  <span className="block font-semibold">
                    {formatDate(r.period_start)} al {formatDate(r.period_end)}
                  </span>
                  <span className="block text-xs text-stone">{r.property_title ?? "Todas tus propiedades"}</span>
                </span>
                <span className="text-xs text-stone">Generado {formatDateTime(r.generated_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
