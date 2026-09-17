import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireStaffPage } from "@/server/next/context";
import { can, canAny } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getContractDetail } from "@/server/rentals/queries";
import { centsToString, toCents } from "@/server/rentals/decimal";
import { monthLabel, todayInSalta } from "@/server/rentals/dates";
import { pctFromCoefficient } from "@/server/rentals/adjustment-calc";
import { DOCUMENT_KIND_LABEL, INDEX_LABEL, PAYMENT_METHOD_LABEL } from "@/server/rentals/schema";
import { Alert, Badge, Card, EmptyState, Field, Input, PageHeader, Select, Table, Textarea, formatDate, formatDateTime, formatMoney } from "@/components/ui";
import { ActionForm } from "@/components/rentals/action-form";
import { AdjustmentStatus, ContractStatus, ObligationStatus, PROPERTY_STATUS_LABEL, SettlementStatus } from "@/components/rentals/status";
import {
  activateContractAction,
  applyAdjustmentAction,
  approveSettlementAction,
  cancelSettlementAction,
  deleteDocumentAction,
  documentVisibilityAction,
  endContractAction,
  generateSettlementAction,
  changeOwnerEmailAction,
  inviteOwnerAction,
  setOwnerAccessAction,
  paySettlementAction,
  proposeAdjustmentAction,
  rejectAdjustmentAction,
  renewContractAction,
  updateNotesAction,
  voidPaymentAction,
} from "../actions";
import { PaymentForm } from "../payment-form";
import { ContractFields } from "../contract-fields";

export const metadata: Metadata = { title: "Contrato de alquiler" };

const ROLE_LABEL: Record<string, string> = { owner: "Propietario", tenant: "Inquilino", guarantor: "Garante" };

type Calc = {
  start?: { requestedDate: string; usedDate: string; value: string };
  end?: { requestedDate: string; usedDate: string; value: string };
  months?: Array<{ month: string; coefficient: string }>;
  periodStart?: string;
};

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-stone">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-[var(--radius-md)] border border-line bg-paper/60 px-3 py-2 [&[open]]:bg-white">
      <summary className="cursor-pointer select-none text-sm font-semibold text-ink-2">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export default async function ContractPage({ params, searchParams }: PageProps<"/crm/alquileres/[id]">) {
  const actor = await requireStaffPage("rentals.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let detail;
  try {
    detail = await getContractDetail(getDb(), actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  }
  const { contract: c, parties, obligations, payments, adjustments, settlements, documents, renewals, renewalOf, ownerUsers } = detail;
  const today = todayInSalta();
  const canManage = can(actor, "rentals.manage");
  const canPay = can(actor, "rentals.register_payment");
  const canVoid = can(actor, "rentals.void_payment");
  const canAdjust = can(actor, "rentals.adjust");
  const canGenerate = can(actor, "settlements.generate");
  const canApprove = can(actor, "settlements.approve");
  const canInvite = canAny(actor, ["users.manage", "reports.generate"]);
  const canManageAccess = can(actor, "users.manage");
  const owners = parties.filter((p) => p.role === "owner");
  const hasProposed = adjustments.some((a) => a.status === "proposed");
  const due = obligations.filter((o) => ["pending", "partially_paid", "overdue"].includes(o.status));
  const overdue = obligations.filter((o) => o.status === "overdue");
  const debt = overdue.reduce((a, o) => a + toCents(o.amount) - toCents(o.paid_amount), 0n);

  return (
    <>
      <PageHeader
        title={`Contrato ${c.code}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ContractStatus status={c.status} />
            <span>
              #{c.property_code} · {c.property_title}
            </span>
            <span className="text-xs">({PROPERTY_STATUS_LABEL[c.property_status] ?? c.property_status})</span>
            <Link href="/crm/alquileres" className="underline underline-offset-4">
              Volver
            </Link>
          </span>
        }
        actions={
          c.status === "draft" && canManage ? (
            <ActionForm action={activateContractAction} submitLabel="Activar contrato" pendingLabel="Activando…" confirm="¿Activar el contrato? Se generan las cuotas y la propiedad pasa a alquilada.">
              <input type="hidden" name="id" value={c.id} />
            </ActionForm>
          ) : null
        }
      />

      <div className="flex flex-col gap-5">
        {c.adjustment_pending_note ? <Alert tone="warning">{c.adjustment_pending_note}. Cargá los valores en Índices o esperá la próxima descarga del BCRA.</Alert> : null}
        {hasProposed ? <Alert tone="warning">Hay un ajuste propuesto esperando revisión (sección Ajustes).</Alert> : null}
        {overdue.length ? (
          <Alert tone="danger">
            {overdue.length} cuota(s) vencida(s) · saldo vencido {formatMoney(centsToString(debt), c.currency)}
          </Alert>
        ) : null}

        <Card title="Resumen">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Summary label="Vigencia">
              {formatDate(c.start_date)} → {formatDate(c.end_date)}
            </Summary>
            <Summary label="Alquiler vigente">
              <span className="font-semibold">{formatMoney(c.current_rent, c.currency)}</span>
              {c.current_rent !== c.initial_rent ? <span className="block text-xs text-stone">Inicial {formatMoney(c.initial_rent, c.currency)}</span> : null}
            </Summary>
            <Summary label="Vence el día">{c.payment_due_day} de cada mes</Summary>
            <Summary label="Honorario">{c.management_fee_pct}%</Summary>
            <Summary label="Ajuste">{c.adjustment_index_key ? `${INDEX_LABEL[c.adjustment_index_key] ?? c.adjustment_index_key} cada ${c.adjustment_period_months} mes(es)` : "Sin ajuste"}</Summary>
            <Summary label="Próximo ajuste">{c.next_adjustment_date ? formatDate(c.next_adjustment_date) : "—"}</Summary>
            <Summary label="Depósito">{c.deposit_amount ? formatMoney(c.deposit_amount, c.deposit_currency ?? c.currency) : "—"}</Summary>
            <Summary label="Comisión">{c.commission_amount ? formatMoney(c.commission_amount, c.currency) : "—"}</Summary>
            <Summary label="Mora diaria">{c.late_fee_daily_pct ? `${c.late_fee_daily_pct}%` : "—"}</Summary>
            {renewalOf ? (
              <Summary label="Renueva a">
                <Link className="underline" href={`/crm/alquileres/${renewalOf.id}`}>
                  {renewalOf.code}
                </Link>
              </Summary>
            ) : null}
            {renewals.length ? (
              <Summary label="Renovación">
                {renewals.map((r) => (
                  <Link key={r.id} className="block underline" href={`/crm/alquileres/${r.id}`}>
                    {r.code}
                  </Link>
                ))}
              </Summary>
            ) : null}
            {c.termination_reason || c.ended_reason ? <Summary label="Motivo de cierre">{c.termination_reason ?? c.ended_reason}</Summary> : null}
          </dl>
          {canManage ? (
            <div className="mt-4">
              <Disclosure summary={c.notes ? "Notas internas" : "Agregar notas internas"}>
                <ActionForm action={updateNotesAction} submitLabel="Guardar notas" size="sm">
                  <input type="hidden" name="id" value={c.id} />
                  <label htmlFor="notes" className="sr-only">
                    Notas
                  </label>
                  <Textarea id="notes" name="notes" defaultValue={c.notes ?? ""} maxLength={5000} />
                </ActionForm>
              </Disclosure>
            </div>
          ) : c.notes ? (
            <p className="mt-4 whitespace-pre-line text-sm text-ink-2">{c.notes}</p>
          ) : null}
        </Card>

        <Card title="Partes">
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {parties.map((p) => {
              const portal = ownerUsers.find((u) => u.contact_id === p.contact_id);
              return (
                <li key={`${p.role}-${p.contact_id}`} className="rounded-[var(--radius-md)] border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{p.display_name}</span>
                    <Badge>{ROLE_LABEL[p.role] ?? p.role}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-stone">
                    {[p.email, p.phone].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                    {p.role === "owner" && p.share_pct ? ` · ${p.share_pct}%` : ""}
                  </p>
                  {p.role === "owner" ? (
                    <div className="mt-2 text-xs">
                      {portal ? (
                        <p className="text-ink-2">
                          Portal: {portal.email} ·{" "}
                          {!portal.is_active ? (
                            <Badge tone="danger">Acceso desactivado</Badge>
                          ) : portal.has_password ? (
                            portal.last_login_at ? (
                              `último ingreso ${formatDateTime(portal.last_login_at)}`
                            ) : (
                              "sin ingresos"
                            )
                          ) : (
                            "invitación pendiente"
                          )}
                        </p>
                      ) : (
                        <p className="text-stone">Sin acceso al portal</p>
                      )}
                      {canInvite && !portal ? (
                        <div className="mt-2">
                          <Disclosure summary="Invitar al portal">
                            <ActionForm action={inviteOwnerAction} submitLabel="Enviar invitación" size="sm" variant="secondary">
                              <input type="hidden" name="contactId" value={p.contact_id} />
                              <p className="text-xs text-stone">Escribí el email con el que va a ingresar. Verificalo con el propietario: no se toma de la ficha del contacto.</p>
                              <Field label="Email de acceso" htmlFor={`invite-email-${p.contact_id}`}>
                                <Input id={`invite-email-${p.contact_id}`} name="email" type="email" autoComplete="off" required className="h-8" />
                              </Field>
                              <Field label="Repetí el email" htmlFor={`invite-confirm-${p.contact_id}`}>
                                <Input id={`invite-confirm-${p.contact_id}`} name="confirmEmail" type="email" autoComplete="off" required className="h-8" />
                              </Field>
                            </ActionForm>
                          </Disclosure>
                        </div>
                      ) : null}
                      {canInvite && portal?.is_active ? (
                        <div className="mt-2">
                          <ActionForm action={inviteOwnerAction} submitLabel={`Reenviar invitación a ${portal.email}`} size="sm" variant="secondary" inline>
                            <input type="hidden" name="contactId" value={p.contact_id} />
                          </ActionForm>
                        </div>
                      ) : null}
                      {canManageAccess && portal ? (
                        <div className="mt-2 flex flex-col gap-2">
                          {portal.is_active ? (
                            <Disclosure summary="Desactivar acceso al portal">
                              <ActionForm action={setOwnerAccessAction} submitLabel="Desactivar acceso" size="sm" variant="danger" confirm="¿Desactivar el acceso? Se cierran sus sesiones y los links pendientes dejan de servir.">
                                <input type="hidden" name="userId" value={portal.id} />
                                <input type="hidden" name="active" value="false" />
                                <Field label="Motivo (opcional)" htmlFor={`access-reason-${portal.id}`}>
                                  <Input id={`access-reason-${portal.id}`} name="reason" maxLength={500} className="h-8" />
                                </Field>
                              </ActionForm>
                            </Disclosure>
                          ) : (
                            <ActionForm action={setOwnerAccessAction} submitLabel="Reactivar acceso" size="sm" variant="secondary" inline confirm="¿Reactivar el acceso al portal de este propietario?">
                              <input type="hidden" name="userId" value={portal.id} />
                              <input type="hidden" name="active" value="true" />
                            </ActionForm>
                          )}
                          <Disclosure summary="Cambiar email de acceso">
                            <ActionForm action={changeOwnerEmailAction} submitLabel="Cambiar email" size="sm" variant="secondary" confirm="¿Cambiar el email de acceso? Se cierran sus sesiones abiertas.">
                              <input type="hidden" name="userId" value={portal.id} />
                              <Field label="Email nuevo" htmlFor={`owner-email-${portal.id}`}>
                                <Input id={`owner-email-${portal.id}`} name="email" type="email" autoComplete="off" required className="h-8" />
                              </Field>
                              <Field label="Repetí el email nuevo" htmlFor={`owner-email-confirm-${portal.id}`}>
                                <Input id={`owner-email-confirm-${portal.id}`} name="confirmEmail" type="email" autoComplete="off" required className="h-8" />
                              </Field>
                            </ActionForm>
                          </Disclosure>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title={`Cuotas (${obligations.length})`}>
          {obligations.length === 0 ? (
            <EmptyState title="Sin cuotas" description={c.status === "draft" ? "Se generan al activar el contrato." : "No hay cuotas para este contrato."} />
          ) : (
            <Table className="border-0">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Vence</th>
                  <th className="text-right">Monto</th>
                  <th className="text-right">Pagado</th>
                  <th>Estado</th>
                  <th>Cobro</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o) => {
                  const remaining = centsToString(toCents(o.amount) - toCents(o.paid_amount));
                  const open = ["pending", "partially_paid", "overdue"].includes(o.status);
                  return (
                    <tr key={o.id} className={o.status === "overdue" ? "bg-[#fbeeed]/50" : undefined}>
                      <td className="whitespace-nowrap capitalize">{monthLabel(o.period_start)}</td>
                      <td className="whitespace-nowrap">{formatDate(o.due_date)}</td>
                      <td className="whitespace-nowrap text-right">{formatMoney(o.amount, o.currency)}</td>
                      <td className="whitespace-nowrap text-right">{formatMoney(o.paid_amount, o.currency)}</td>
                      <td>
                        <ObligationStatus status={o.status} />
                      </td>
                      <td className="min-w-[160px]">
                        {open && canPay ? (
                          <Disclosure summary={`Cobrar (saldo ${formatMoney(remaining, o.currency)})`}>
                            <PaymentForm obligationId={o.id} remaining={remaining} currency={o.currency} today={today} initialKey={randomUUID()} />
                          </Disclosure>
                        ) : (
                          <span className="text-xs text-stone">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {due.length ? <p className="mt-2 text-xs text-stone">{due.length} cuota(s) con saldo pendiente.</p> : null}
        </Card>

        <Card title={`Cobros (${payments.length})`}>
          {payments.length === 0 ? (
            <p className="text-sm text-stone">Todavía no se registraron cobros.</p>
          ) : (
            <Table className="border-0">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Período</th>
                  <th className="text-right">Monto</th>
                  <th>Medio</th>
                  <th>Registró</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={p.voided_at ? "text-stone line-through decoration-stone/50" : undefined}>
                    <td className="whitespace-nowrap">{formatDate(p.paid_on)}</td>
                    <td className="whitespace-nowrap capitalize">{monthLabel(p.period_start)}</td>
                    <td className="whitespace-nowrap text-right">{formatMoney(p.amount, p.currency)}</td>
                    <td>
                      {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                      {p.reference ? <span className="block text-xs text-stone">{p.reference}</span> : null}
                    </td>
                    <td className="text-xs">{p.received_by_name ?? "—"}</td>
                    <td className="min-w-[160px] no-underline">
                      {p.voided_at ? (
                        <span className="text-xs no-underline">Anulado: {p.void_reason}</span>
                      ) : canVoid ? (
                        <Disclosure summary="Anular">
                          <ActionForm action={voidPaymentAction} submitLabel="Anular cobro" variant="danger" size="sm" confirm="¿Anular este cobro? Queda registrado y no se puede deshacer.">
                            <input type="hidden" name="paymentId" value={p.id} />
                            <Field label="Motivo" htmlFor={`void-${p.id}`}>
                              <Input id={`void-${p.id}`} name="reason" required minLength={3} maxLength={1000} />
                            </Field>
                          </ActionForm>
                        </Disclosure>
                      ) : (
                        <Badge tone="success">Vigente</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card
          title="Ajustes"
          actions={
            canAdjust && c.status === "active" && c.next_adjustment_date && !hasProposed ? (
              <ActionForm action={proposeAdjustmentAction} submitLabel={`Calcular ajuste del ${formatDate(c.next_adjustment_date)}`} size="sm" variant="secondary" pendingLabel="Calculando…">
                <input type="hidden" name="id" value={c.id} />
              </ActionForm>
            ) : null
          }
        >
          {adjustments.length === 0 ? (
            <p className="text-sm text-stone">{c.adjustment_index_key ? "Sin ajustes calculados todavía." : "Este contrato no tiene ajuste por índice."}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {adjustments.map((a) => {
                const calc = (a.calculation ?? {}) as Calc;
                return (
                  <li key={a.id} className="rounded-[var(--radius-md)] border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        Desde {formatDate(a.effective_date)} · {formatMoney(a.previous_amount, c.currency)} → {formatMoney(a.new_amount, c.currency)}
                      </span>
                      <AdjustmentStatus status={a.status} />
                    </div>
                    <p className="mt-1 text-xs text-ink-2">
                      {INDEX_LABEL[a.index_key ?? ""] ?? a.index_key} · factor {a.factor} · redondeo a centavos (mitad hacia arriba)
                    </p>
                    {calc.start && calc.end ? (
                      <p className="mt-1 text-xs text-stone">
                        Inicio del período {formatDate(calc.start.requestedDate)}: valor {calc.start.value}
                        {calc.start.usedDate !== calc.start.requestedDate ? ` (publicado el ${formatDate(calc.start.usedDate)})` : ""} · Fecha de ajuste {formatDate(calc.end.requestedDate)}: valor {calc.end.value}
                        {calc.end.usedDate !== calc.end.requestedDate ? ` (publicado el ${formatDate(calc.end.usedDate)})` : ""}
                      </p>
                    ) : null}
                    {calc.months?.length ? (
                      <p className="mt-1 text-xs text-stone">Variaciones: {calc.months.map((m) => `${monthLabel(m.month)} ${pctFromCoefficient(m.coefficient, 2)}%`).join(" · ")}</p>
                    ) : null}
                    {a.status === "applied" ? <p className="mt-1 text-xs text-stone">Aplicado por {a.applied_by_name ?? "—"} el {formatDateTime(a.applied_at)}</p> : null}
                    {a.status === "rejected" ? (
                      <p className="mt-1 text-xs text-stone">
                        Rechazado por {a.rejected_by_name ?? "—"}: {a.rejected_reason}
                      </p>
                    ) : null}
                    {a.status === "proposed" && canAdjust ? (
                      <div className="mt-3 flex flex-wrap items-start gap-3">
                        <ActionForm action={applyAdjustmentAction} submitLabel="Aplicar ajuste" size="sm" confirm={`¿Aplicar el nuevo alquiler de ${a.new_amount}? Se actualizan las cuotas futuras impagas.`}>
                          <input type="hidden" name="id" value={a.id} />
                        </ActionForm>
                        <Disclosure summary="Rechazar">
                          <ActionForm action={rejectAdjustmentAction} submitLabel="Rechazar" size="sm" variant="danger">
                            <input type="hidden" name="adjustmentId" value={a.id} />
                            <Field label="Motivo" htmlFor={`rej-${a.id}`}>
                              <Input id={`rej-${a.id}`} name="reason" required minLength={3} />
                            </Field>
                            <label className="flex items-center gap-2 text-xs">
                              <input type="checkbox" name="skipPeriod" className="size-4" /> No ajustar en esta fecha (pasar al próximo período)
                            </label>
                          </ActionForm>
                        </Disclosure>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Liquidaciones">
          {canGenerate && c.status !== "draft" ? (
            <div className="mb-4">
              <Disclosure summary="Generar liquidación">
                <ActionForm action={generateSettlementAction} submitLabel="Generar" size="sm">
                  <input type="hidden" name="contractId" value={c.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Mes" htmlFor="month" hint="Incluye cobros hasta fin de mes no liquidados">
                      <Input id="month" name="month" type="month" defaultValue={today.slice(0, 7)} required />
                    </Field>
                    {owners.length > 1 ? (
                      <Field label="Propietario" htmlFor="ownerContactId">
                        <Select id="ownerContactId" name="ownerContactId" defaultValue="">
                          <option value="">Todos</option>
                          {owners.map((o) => (
                            <option key={o.contact_id} value={o.contact_id}>
                              {o.display_name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ) : null}
                    <Field label="Deducción (opcional)" htmlFor="deductionDescription">
                      <Input id="deductionDescription" name="deductionDescription" placeholder="Ej.: reparación" maxLength={200} />
                    </Field>
                    <Field label="Monto deducción" htmlFor="deductionAmount">
                      <Input id="deductionAmount" name="deductionAmount" type="number" inputMode="decimal" min="0.01" step="0.01" />
                    </Field>
                  </div>
                </ActionForm>
              </Disclosure>
            </div>
          ) : null}
          {settlements.length === 0 ? (
            <p className="text-sm text-stone">Sin liquidaciones.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {settlements.map((s) => (
                <li key={s.id} className="rounded-[var(--radius-md)] border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold capitalize">
                      {monthLabel(s.period_start)} · {s.owner_name}
                    </span>
                    <SettlementStatus status={s.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-2">
                    Cobrado {formatMoney(s.gross_collected, s.currency)} · Honorario {formatMoney(s.management_fee_amount, s.currency)} · Deducciones {formatMoney(s.other_deductions, s.currency)} ·{" "}
                    <strong>Neto {formatMoney(s.net_amount, s.currency)}</strong>
                  </p>
                  {s.cancelled_reason ? <p className="mt-1 text-xs text-stone">Cancelada: {s.cancelled_reason}</p> : null}
                  <div className="mt-2">
                    <Disclosure summary={`Detalle (${s.lines.length} líneas)`}>
                      <ul className="flex flex-col gap-1 text-xs">
                        {s.lines.map((l) => (
                          <li key={l.id} className="flex justify-between gap-3">
                            <span>{l.description}</span>
                            <span className="whitespace-nowrap font-semibold">{formatMoney(l.amount, s.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </Disclosure>
                  </div>
                  <div className="mt-2 flex flex-wrap items-start gap-2">
                    {s.status === "draft" && canApprove ? (
                      <ActionForm action={approveSettlementAction} submitLabel="Aprobar" size="sm">
                        <input type="hidden" name="id" value={s.id} />
                      </ActionForm>
                    ) : null}
                    {s.status === "approved" && canApprove ? (
                      <ActionForm action={paySettlementAction} submitLabel="Marcar pagada" size="sm" confirm="¿Confirmás que se pagó al propietario?">
                        <input type="hidden" name="id" value={s.id} />
                      </ActionForm>
                    ) : null}
                    {(s.status === "draft" && canGenerate) || (s.status === "approved" && canApprove) ? (
                      <Disclosure summary="Cancelar">
                        <ActionForm action={cancelSettlementAction} submitLabel="Cancelar liquidación" size="sm" variant="danger">
                          <input type="hidden" name="settlementId" value={s.id} />
                          <Field label="Motivo" htmlFor={`cancel-${s.id}`}>
                            <Input id={`cancel-${s.id}`} name="reason" required minLength={3} />
                          </Field>
                        </ActionForm>
                      </Disclosure>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Documentos" className="scroll-mt-20">
          <span id="documentos" />
          {sp.documento === "subido" ? (
            <div className="mb-3">
              <Alert tone="success">Documento subido.</Alert>
            </div>
          ) : null}
          {typeof sp.documento_error === "string" ? (
            <div className="mb-3">
              <Alert tone="danger">{sp.documento_error.slice(0, 200)}</Alert>
            </div>
          ) : null}
          {canManage ? (
            <form action={`/crm/alquileres/${c.id}/documentos`} method="post" encType="multipart/form-data" className="mb-4 grid grid-cols-1 gap-3 rounded-[var(--radius-md)] border border-dashed border-line p-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_1fr_auto_auto] lg:items-end">
              <Field label="Título" htmlFor="doc-title">
                <Input id="doc-title" name="title" required minLength={2} maxLength={200} />
              </Field>
              <Field label="Tipo" htmlFor="doc-kind">
                <Select id="doc-kind" name="kind" defaultValue="contract">
                  {Object.entries(DOCUMENT_KIND_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Archivo (PDF o imagen, hasta 4 MB)" htmlFor="doc-file">
                <Input id="doc-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="h-auto py-1.5" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="visibleToOwner" className="size-4" /> Visible para propietarios
              </label>
              <button type="submit" className="h-10 rounded-[var(--radius-md)] bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-2">
                Subir
              </button>
            </form>
          ) : null}
          {documents.length === 0 ? (
            <p className="text-sm text-stone">Sin documentos.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <a href={`/crm/alquileres/${c.id}/documentos/${d.id}`} className="font-semibold underline underline-offset-4">
                      {d.title}
                    </a>
                    <span className="ml-2 text-xs text-stone">
                      {DOCUMENT_KIND_LABEL[d.kind] ?? d.kind} · {Math.max(1, Math.round(Number(d.size_bytes) / 1024))} KB · {formatDate(d.created_at)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.visible_to_owner ? "info" : "neutral"}>{d.visible_to_owner ? "Visible para propietarios" : "Solo equipo"}</Badge>
                    {canManage ? (
                      <>
                        <ActionForm action={documentVisibilityAction} submitLabel={d.visible_to_owner ? "Ocultar" : "Mostrar al propietario"} size="sm" variant="ghost">
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="visible" value={d.visible_to_owner ? "false" : "true"} />
                        </ActionForm>
                        <ActionForm action={deleteDocumentAction} submitLabel="Eliminar" size="sm" variant="ghost" confirm="¿Eliminar el documento?">
                          <input type="hidden" name="id" value={d.id} />
                        </ActionForm>
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canManage && c.status === "active" ? (
          <Card title="Cierre y renovación">
            <div className="flex flex-col gap-3">
              <Disclosure summary="Finalizar o rescindir">
                <ActionForm action={endContractAction} submitLabel="Cerrar contrato" variant="danger" confirm="¿Cerrar el contrato? Las cuotas posteriores sin pagos se anulan.">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="Tipo" htmlFor="end-kind">
                      <Select id="end-kind" name="kind" defaultValue="ended">
                        <option value="ended">Finalización</option>
                        <option value="terminated">Rescisión</option>
                      </Select>
                    </Field>
                    <Field label="Fecha efectiva" htmlFor="end-date">
                      <Input id="end-date" name="effectiveDate" type="date" defaultValue={today} required />
                    </Field>
                    <Field label="Motivo" htmlFor="end-reason">
                      <Input id="end-reason" name="reason" required minLength={3} maxLength={1000} />
                    </Field>
                  </div>
                </ActionForm>
              </Disclosure>
              {renewals.length === 0 ? (
                <Disclosure summary="Renovar (nuevo contrato vinculado)">
                  <ActionForm action={renewContractAction} submitLabel="Crear renovación (borrador)">
                    <input type="hidden" name="id" value={c.id} />
                    <ContractFields
                      defaults={{
                        startDate: c.end_date,
                        currency: c.currency,
                        initialRent: c.current_rent,
                        paymentDueDay: c.payment_due_day,
                        managementFeePct: c.management_fee_pct,
                        adjustmentIndexKey: c.adjustment_index_key ?? "",
                        adjustmentPeriodMonths: c.adjustment_period_months ?? undefined,
                        lateFeeDailyPct: c.late_fee_daily_pct ?? undefined,
                      }}
                    />
                  </ActionForm>
                </Disclosure>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
