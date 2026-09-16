"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";

const INDEX_OPTIONS = [
  ["", "Sin ajuste"],
  ["ICL", "ICL (BCRA)"],
  ["CER", "CER (BCRA)"],
  ["IPC", "IPC (INDEC, carga manual)"],
  ["CASA_PROPIA", "Casa Propia (carga manual)"],
] as const;

export type ContractDefaults = Partial<{
  code: string;
  startDate: string;
  endDate: string;
  currency: string;
  initialRent: string;
  paymentDueDay: number;
  depositAmount: string;
  depositCurrency: string;
  commissionAmount: string;
  managementFeePct: string;
  adjustmentIndexKey: string;
  adjustmentPeriodMonths: number;
  lateFeeDailyPct: string;
  notes: string;
}>;

/** Campos económicos del contrato (alta y renovación). Validación real: en el servidor. */
export function ContractFields({ errors = {}, defaults = {}, withCode = true }: { errors?: Record<string, string[]>; defaults?: ContractDefaults; withCode?: boolean }) {
  const e = (k: string) => errors[k];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {withCode ? (
        <Field label="Código" htmlFor="code" hint="Vacío = se genera (ALQ-propiedad-AAAAMM)" error={e("code")}>
          <Input id="code" name="code" defaultValue={defaults.code} maxLength={40} className="uppercase" />
        </Field>
      ) : null}
      <Field label="Inicio" htmlFor="startDate" hint="Siempre el día 1 del mes" error={e("startDate")}>
        <Input id="startDate" name="startDate" type="date" required defaultValue={defaults.startDate} />
      </Field>
      <Field label="Fin" htmlFor="endDate" hint="Las cuotas van hasta el mes anterior" error={e("endDate")}>
        <Input id="endDate" name="endDate" type="date" required defaultValue={defaults.endDate} />
      </Field>
      <Field label="Moneda" htmlFor="currency" error={e("currency")}>
        <Select id="currency" name="currency" defaultValue={defaults.currency ?? "ARS"}>
          <option value="ARS">Pesos (ARS)</option>
          <option value="USD">Dólares (USD)</option>
        </Select>
      </Field>
      <Field label="Alquiler inicial" htmlFor="initialRent" error={e("initialRent")}>
        <Input id="initialRent" name="initialRent" type="number" inputMode="decimal" min="0.01" step="0.01" required defaultValue={defaults.initialRent} />
      </Field>
      <Field label="Día de vencimiento" htmlFor="paymentDueDay" error={e("paymentDueDay")}>
        <Input id="paymentDueDay" name="paymentDueDay" type="number" min={1} max={28} required defaultValue={defaults.paymentDueDay ?? 10} />
      </Field>
      <Field label="Honorario administración %" htmlFor="managementFeePct" error={e("managementFeePct")}>
        <Input id="managementFeePct" name="managementFeePct" type="number" inputMode="decimal" min="0" max="100" step="0.01" defaultValue={defaults.managementFeePct ?? ""} />
      </Field>
      <Field label="Índice de ajuste" htmlFor="adjustmentIndexKey" error={e("adjustmentIndexKey")}>
        <Select id="adjustmentIndexKey" name="adjustmentIndexKey" defaultValue={defaults.adjustmentIndexKey ?? ""}>
          {INDEX_OPTIONS.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ajusta cada" htmlFor="adjustmentPeriodMonths" error={e("adjustmentPeriodMonths")}>
        <Select id="adjustmentPeriodMonths" name="adjustmentPeriodMonths" defaultValue={defaults.adjustmentPeriodMonths ? String(defaults.adjustmentPeriodMonths) : ""}>
          <option value="">—</option>
          {[1, 2, 3, 4, 6, 12].map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? "mes" : "meses"}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Depósito" htmlFor="depositAmount" error={e("depositAmount")}>
        <Input id="depositAmount" name="depositAmount" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={defaults.depositAmount} />
      </Field>
      <Field label="Moneda del depósito" htmlFor="depositCurrency" error={e("depositCurrency")}>
        <Select id="depositCurrency" name="depositCurrency" defaultValue={defaults.depositCurrency ?? ""}>
          <option value="">Igual al contrato</option>
          <option value="ARS">Pesos (ARS)</option>
          <option value="USD">Dólares (USD)</option>
        </Select>
      </Field>
      <Field label="Comisión" htmlFor="commissionAmount" error={e("commissionAmount")}>
        <Input id="commissionAmount" name="commissionAmount" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={defaults.commissionAmount} />
      </Field>
      <Field label="Interés por mora diario %" htmlFor="lateFeeDailyPct" hint="Informativo" error={e("lateFeeDailyPct")}>
        <Input id="lateFeeDailyPct" name="lateFeeDailyPct" type="number" inputMode="decimal" min="0" max="5" step="0.0001" defaultValue={defaults.lateFeeDailyPct} />
      </Field>
      <Field label="Notas internas" htmlFor="notes" error={e("notes")} className="sm:col-span-2 lg:col-span-4">
        <Textarea id="notes" name="notes" maxLength={5000} defaultValue={defaults.notes} />
      </Field>
    </div>
  );
}
