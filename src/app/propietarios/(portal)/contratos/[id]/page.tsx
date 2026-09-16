import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getOwnerContract } from "@/server/owners/portal";
import { monthLabel } from "@/server/rentals/dates";
import { INDEX_LABEL } from "@/server/rentals/schema";
import { formatDate, formatMoney } from "@/components/ui";
import { ContractStatus, ObligationStatus } from "@/components/rentals/status";
import { Empty, Section, UUID } from "../../ui";

export default async function OwnerContractPage({ params }: PageProps<"/propietarios/contratos/[id]">) {
  const actor = await requireOwnerPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let data;
  try {
    data = await getOwnerContract(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { contract: c, sharePct, tenants, obligations, adjustments, documents } = data;
  return (
    <>
      <Link href="/propietarios" className="text-sm underline underline-offset-4">
        ← Inicio
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-ink">{c.property_title}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-stone">
        Contrato {c.code} <ContractStatus status={c.status} />
      </p>
      <dl className="mb-8 mt-4 grid grid-cols-2 gap-3 rounded-[var(--radius-lg)] border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-stone">Vigencia</dt>
          <dd>
            {formatDate(c.start_date)} al {formatDate(c.end_date)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-stone">Alquiler vigente</dt>
          <dd className="font-semibold">{formatMoney(c.current_rent, c.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone">Ajuste</dt>
          <dd>{c.adjustment_index_key ? `${INDEX_LABEL[c.adjustment_index_key] ?? c.adjustment_index_key} cada ${c.adjustment_period_months} mes(es)` : "Sin ajuste"}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone">Próximo ajuste</dt>
          <dd>{c.next_adjustment_date ? formatDate(c.next_adjustment_date) : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone">Inquilino/s</dt>
          <dd>{tenants.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone">Vencimiento</dt>
          <dd>Día {c.payment_due_day}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone">Honorario de administración</dt>
          <dd>{c.management_fee_pct}%</dd>
        </div>
        {sharePct && sharePct !== "100.00" ? (
          <div>
            <dt className="text-xs text-stone">Tu parte</dt>
            <dd>{sharePct}%</dd>
          </div>
        ) : null}
      </dl>

      <Section title="Cuotas">
        {obligations.length === 0 ? (
          <Empty>Sin cuotas.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone">
                <tr>
                  <th className="px-4 py-2">Período</th>
                  <th className="px-4 py-2">Vence</th>
                  <th className="px-4 py-2 text-right">Monto</th>
                  <th className="px-4 py-2 text-right">Cobrado</th>
                  <th className="px-4 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="whitespace-nowrap px-4 py-2 capitalize">{monthLabel(o.period_start)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{formatDate(o.due_date)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">{formatMoney(o.amount, o.currency)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">{formatMoney(o.paid_amount, o.currency)}</td>
                    <td className="px-4 py-2">
                      <ObligationStatus status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {adjustments.length ? (
        <Section title="Ajustes aplicados">
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white text-sm">
            {adjustments.map((a) => (
              <li key={a.effective_date} className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <span>Desde {formatDate(a.effective_date)}</span>
                <span>
                  {formatMoney(a.previous_amount, c.currency)} → <strong>{formatMoney(a.new_amount, c.currency)}</strong>
                  <span className="ml-2 text-xs text-stone">
                    {INDEX_LABEL[a.index_key ?? ""] ?? a.index_key} · factor {a.factor}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Documentos del contrato">
        {documents.length === 0 ? (
          <Empty>No hay documentos compartidos para este contrato.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>{d.title}</span>
                <a href={`/propietarios/documentos/contrato/${d.id}`} className="font-semibold underline underline-offset-4">
                  Descargar
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
