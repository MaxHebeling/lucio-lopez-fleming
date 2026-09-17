import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listReceivables, type ReceivableFilter } from "@/server/rentals/queries";
import { centsToString, toCents } from "@/server/rentals/decimal";
import { monthLabel, todayInSalta } from "@/server/rentals/dates";
import { EmptyState, Field, Input, PageHeader, buttonClass, cx, formatDate, formatMoney } from "@/components/ui";
import { ObligationStatus } from "@/components/rentals/status";
import { PaymentForm } from "../payment-form";
import { ListLimitNotice } from "@/components/crm/list-limit-notice";

export const metadata: Metadata = { title: "Cobros" };

const TABS: Array<{ key: ReceivableFilter; label: string }> = [
  { key: "all", label: "Pendientes (40 días)" },
  { key: "overdue", label: "Vencidas" },
  { key: "due_soon", label: "Vencen en 10 días" },
];

export default async function ReceivablesPage({ searchParams }: PageProps<"/crm/alquileres/cobros">) {
  const actor = await requireStaffPage("rentals.read");
  const sp = await searchParams;
  const filter = TABS.some((t) => t.key === sp.ver) ? (sp.ver as ReceivableFilter) : "all";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const rows = await listReceivables(getDb(), actor, filter, q);
  const today = todayInSalta();
  const canPay = can(actor, "rentals.register_payment");
  const totals = new Map<string, bigint>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0n) + toCents(r.amount) - toCents(r.paid_amount));

  return (
    <>
      <PageHeader
        title="Cobros"
        description={
          rows.length
            ? `Saldo en la vista: ${[...totals.entries()].map(([cur, cents]) => formatMoney(centsToString(cents), cur)).join(" · ")}`
            : "Cuotas pendientes y vencidas de todos los contratos."
        }
      />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Filtro de cuotas" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/crm/alquileres/cobros?ver=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              aria-current={filter === t.key ? "page" : undefined}
              className={cx(buttonClass(filter === t.key ? "primary" : "secondary", "sm"))}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="ver" value={filter} />
          <Field label="Buscar" htmlFor="q">
            <Input id="q" name="q" defaultValue={q} placeholder="Contrato o propiedad" className="w-56" />
          </Field>
          <button type="submit" className={buttonClass("secondary")}>
            Buscar
          </button>
        </form>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No hay cuotas para cobrar en esta vista" description="Cuando haya cuotas pendientes o vencidas aparecen acá." />
      ) : (
        <>
          <ListLimitNotice total={rows[0]?.total_count} shown={rows.length} limit={500} noun="cuotas" />
          <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const remaining = centsToString(toCents(r.amount) - toCents(r.paid_amount));
            return (
              <li key={r.id} className={cx("rounded-[var(--radius-lg)] border bg-white p-4", r.status === "overdue" ? "border-danger/40" : "border-line")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <Link href={`/crm/alquileres/${r.contract_id}`} className="font-semibold underline-offset-4 hover:underline">
                        {r.code}
                      </Link>{" "}
                      · <span className="capitalize">{monthLabel(r.period_start)}</span>
                    </p>
                    <p className="truncate text-xs text-stone">
                      {r.property_title} · {r.tenants ?? "Sin inquilino"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatMoney(remaining, r.currency)}</p>
                    <p className="text-xs text-stone">
                      de {formatMoney(r.amount, r.currency)} · vence {formatDate(r.due_date)}
                    </p>
                  </div>
                  <ObligationStatus status={r.status} />
                </div>
                {canPay ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-ink-2">Registrar cobro</summary>
                    <div className="mt-3">
                      <PaymentForm obligationId={r.id} remaining={remaining} currency={r.currency} today={today} initialKey={randomUUID()} />
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
          </ul>
        </>
      )}
    </>
  );
}
