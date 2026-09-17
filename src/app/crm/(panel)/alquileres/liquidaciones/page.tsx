import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { contractsForSettlement, listSettlements } from "@/server/rentals/queries";
import { monthLabel, todayInSalta } from "@/server/rentals/dates";
import { SETTLEMENT_STATUS_LABEL } from "@/server/rentals/schema";
import { Card, EmptyState, Field, Input, PageHeader, Select, Table, buttonClass, formatMoney } from "@/components/ui";
import { ActionForm } from "@/components/rentals/action-form";
import { SettlementStatus } from "@/components/rentals/status";
import { approveSettlementAction, generateSettlementAction, paySettlementAction } from "../actions";
import { ListLimitNotice } from "@/components/crm/list-limit-notice";

export const metadata: Metadata = { title: "Liquidaciones" };

export default async function SettlementsPage({ searchParams }: PageProps<"/crm/alquileres/liquidaciones">) {
  const actor = await requireStaffPage("rentals.read");
  const sp = await searchParams;
  const status = typeof sp.estado === "string" && sp.estado in SETTLEMENT_STATUS_LABEL ? sp.estado : undefined;
  const month = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : undefined;
  const db = getDb();
  const [rows, contracts] = await Promise.all([listSettlements(db, actor, { status, month }), can(actor, "settlements.generate") ? contractsForSettlement(db, actor) : Promise.resolve([])]);
  const canApprove = can(actor, "settlements.approve");

  return (
    <>
      <PageHeader title="Liquidaciones" description="Liquidaciones a propietarios: cobrado, honorario de administración, deducciones y neto." />
      {can(actor, "settlements.generate") ? (
        <Card title="Generar liquidación" className="mb-5">
          {contracts.length === 0 ? (
            <p className="text-sm text-stone">No hay contratos vigentes o cerrados para liquidar.</p>
          ) : (
            <ActionForm action={generateSettlementAction} submitLabel="Generar para todos los propietarios del contrato">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Contrato" htmlFor="contractId">
                  <Select id="contractId" name="contractId" required defaultValue="">
                    <option value="">Elegí un contrato</option>
                    {contracts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.property_title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Mes" htmlFor="month" hint="Cobros hasta fin de mes aún no liquidados">
                  <Input id="month" name="month" type="month" required defaultValue={todayInSalta().slice(0, 7)} />
                </Field>
                <Field label="Deducción (opcional)" htmlFor="deductionDescription" hint="Con varios propietarios, cargala desde la ficha">
                  <Input id="deductionDescription" name="deductionDescription" maxLength={200} />
                </Field>
                <Field label="Monto deducción" htmlFor="deductionAmount">
                  <Input id="deductionAmount" name="deductionAmount" type="number" inputMode="decimal" min="0.01" step="0.01" />
                </Field>
              </div>
            </ActionForm>
          )}
        </Card>
      ) : null}

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Estado" htmlFor="estado">
          <Select id="estado" name="estado" defaultValue={status ?? ""} className="w-44">
            <option value="">Todos</option>
            {Object.entries(SETTLEMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mes" htmlFor="mes">
          <Input id="mes" name="mes" type="month" defaultValue={month} className="w-44" />
        </Field>
        <button type="submit" className={buttonClass("secondary")}>
          Filtrar
        </button>
        {status || month ? (
          <Link href="/crm/alquileres/liquidaciones" className={buttonClass("ghost")}>
            Limpiar
          </Link>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState title="No hay liquidaciones" description="Generalas por contrato y mes cuando haya cobros registrados." />
      ) : (
        <>
          <ListLimitNotice shown={rows.length} limit={300} noun="liquidaciones" />
          <Table label="Liquidaciones">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Contrato</th>
              <th>Propietario</th>
              <th className="text-right">Cobrado</th>
              <th className="text-right">Honorario</th>
              <th className="text-right">Deducciones</th>
              <th className="text-right">Neto</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="whitespace-nowrap capitalize">{monthLabel(s.period_start)}</td>
                <td>
                  <Link href={`/crm/alquileres/${s.contract_id}`} className="font-semibold underline-offset-4 hover:underline">
                    {s.code}
                  </Link>
                </td>
                <td>{s.owner_name}</td>
                <td className="whitespace-nowrap text-right">{formatMoney(s.gross_collected, s.currency)}</td>
                <td className="whitespace-nowrap text-right">{formatMoney(s.management_fee_amount, s.currency)}</td>
                <td className="whitespace-nowrap text-right">{formatMoney(s.other_deductions, s.currency)}</td>
                <td className="whitespace-nowrap text-right font-semibold">{formatMoney(s.net_amount, s.currency)}</td>
                <td>
                  <SettlementStatus status={s.status} />
                </td>
                <td>
                  {canApprove && s.status === "draft" ? (
                    <ActionForm action={approveSettlementAction} submitLabel="Aprobar" size="sm" variant="secondary">
                      <input type="hidden" name="id" value={s.id} />
                    </ActionForm>
                  ) : canApprove && s.status === "approved" ? (
                    <ActionForm action={paySettlementAction} submitLabel="Marcar pagada" size="sm" variant="secondary" confirm="¿Confirmás que se pagó al propietario?">
                      <input type="hidden" name="id" value={s.id} />
                    </ActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          </Table>
        </>
      )}
    </>
  );
}
