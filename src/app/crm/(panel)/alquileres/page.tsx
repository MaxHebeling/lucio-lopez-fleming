import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { listContracts } from "@/server/rentals/queries";
import { CONTRACT_STATUS_LABEL, INDEX_LABEL } from "@/server/rentals/schema";
import { Alert, ButtonLink, EmptyState, Field, Input, PageHeader, Select, Table, buttonClass, formatDate, formatMoney } from "@/components/ui";
import { ContractStatus } from "@/components/rentals/status";

export const metadata: Metadata = { title: "Contratos de alquiler" };

export default async function ContractsPage({ searchParams }: PageProps<"/crm/alquileres">) {
  const actor = await requireStaffPage("rentals.read");
  const sp = await searchParams;
  const status = typeof sp.estado === "string" && sp.estado in CONTRACT_STATUS_LABEL ? sp.estado : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : undefined;
  const expiring = sp.vencen === "60" ? 60 : undefined;
  const rows = await listContracts(getDb(), actor, { status, q, expiringDays: expiring });
  const hasFilters = Boolean(status || q || expiring);

  return (
    <>
      <PageHeader
        title="Contratos de alquiler"
        description="Contratos administrados: estado, vencimientos, próximos ajustes y cuotas vencidas."
        actions={can(actor, "rentals.manage") ? <ButtonLink href="/crm/alquileres/nuevo">Nuevo contrato</ButtonLink> : null}
      />
      <form method="get" className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px_180px_auto] sm:items-end">
        <Field label="Buscar" htmlFor="q">
          <Input id="q" name="q" defaultValue={q} placeholder="Código, propiedad o parte" />
        </Field>
        <Field label="Estado" htmlFor="estado">
          <Select id="estado" name="estado" defaultValue={status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vencimiento" htmlFor="vencen">
          <Select id="vencen" name="vencen" defaultValue={expiring ? "60" : ""}>
            <option value="">Cualquiera</option>
            <option value="60">Vencen en 60 días</option>
          </Select>
        </Field>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("secondary")}>
            Filtrar
          </button>
          {hasFilters ? (
            <Link href="/crm/alquileres" className={buttonClass("ghost")}>
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No hay contratos con esos filtros" : "Todavía no hay contratos"}
          description={hasFilters ? "Probá con otros filtros." : "Cargá el primer contrato para empezar a generar cuotas, cobros y liquidaciones."}
          action={!hasFilters && can(actor, "rentals.manage") ? <ButtonLink href="/crm/alquileres/nuevo">Nuevo contrato</ButtonLink> : undefined}
        />
      ) : (
        <>
          {rows.some((r) => r.adjustment_pending_note) ? (
            <div className="mb-4">
              <Alert tone="warning">Hay ajustes vencidos sin calcular por falta de valores de índice. Revisá la ficha de cada contrato marcado.</Alert>
            </div>
          ) : null}
          <Table>
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Propiedad</th>
                <th>Inquilino/s</th>
                <th>Estado</th>
                <th>Vigencia</th>
                <th className="text-right">Alquiler</th>
                <th>Próximo ajuste</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-paper">
                  <td>
                    <Link href={`/crm/alquileres/${r.id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
                      {r.code}
                    </Link>
                    {r.overdue_count > 0 ? <span className="ml-2 text-xs font-semibold text-danger">{r.overdue_count} vencida(s)</span> : null}
                  </td>
                  <td className="max-w-[240px] truncate" title={r.property_title}>
                    <span className="text-stone">#{r.property_code}</span> {r.property_title}
                  </td>
                  <td className="max-w-[200px] truncate">{r.tenants ?? "—"}</td>
                  <td>
                    <ContractStatus status={r.status} />
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {formatDate(r.start_date)} → {formatDate(r.end_date)}
                  </td>
                  <td className="whitespace-nowrap text-right font-semibold">{formatMoney(r.current_rent, r.currency)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {r.next_adjustment_date ? (
                      <>
                        {formatDate(r.next_adjustment_date)} · {INDEX_LABEL[r.adjustment_index_key ?? ""] ?? r.adjustment_index_key}
                        {r.proposed_adjustments > 0 ? <span className="ml-1 font-semibold text-warning">(para revisar)</span> : null}
                        {r.adjustment_pending_note ? <span className="ml-1 font-semibold text-danger">(faltan índices)</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-stone">{rows.length} contrato(s){rows.length === 300 ? " · se muestran los primeros 300: afiná la búsqueda" : ""}</p>
        </>
      )}
    </>
  );
}
