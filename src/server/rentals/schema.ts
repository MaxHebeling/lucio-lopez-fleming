import { z } from "zod";
import { isIsoDate } from "./dates";
import { normalizeMoneyInput } from "./decimal";

export const CURRENCIES = ["ARS", "USD"] as const;
export const INDEX_KEYS = ["ICL", "CER", "IPC", "CASA_PROPIA"] as const;
export const PAYMENT_METHODS = ["cash", "transfer", "check", "deposit", "other"] as const;
export const DOCUMENT_KINDS = ["contract", "addendum", "guarantee", "inventory", "receipt", "other"] as const;

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Vigente",
  ended: "Finalizado",
  terminated: "Rescindido",
  renewed: "Renovado",
};
export const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  partially_paid: "Pago parcial",
  paid: "Pagada",
  overdue: "Vencida",
  waived: "Anulada",
};
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  check: "Cheque",
  deposit: "Depósito",
  other: "Otro",
};
export const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  approved: "Aprobada",
  paid: "Pagada",
  cancelled: "Cancelada",
};
export const ADJUSTMENT_STATUS_LABEL: Record<string, string> = { proposed: "Propuesto", applied: "Aplicado", rejected: "Rechazado" };
export const INDEX_LABEL: Record<string, string> = {
  ICL: "ICL (BCRA)",
  CER: "CER (BCRA)",
  IPC: "IPC (INDEC)",
  CASA_PROPIA: "Casa Propia",
};
export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  contract: "Contrato",
  addendum: "Addenda",
  guarantee: "Garantía",
  inventory: "Inventario",
  receipt: "Comprobante",
  other: "Otro",
};

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const isoDate = (label = "Fecha") =>
  z.string().refine(isIsoDate, { message: `${label} inválida` });

export const moneyString = (label = "Monto") =>
  z.preprocess(
    (v) => (typeof v === "number" ? String(v) : v),
    z.string({ message: `${label} requerido` }).transform((s, ctx) => {
      const n = normalizeMoneyInput(s);
      if (n === null) {
        ctx.addIssue({ code: "custom", message: `${label}: usá números con hasta 2 decimales` });
        return z.NEVER;
      }
      return n;
    }),
  );

const positiveMoney = (label: string) =>
  moneyString(label).refine((s) => s !== "0.00", { message: `${label} debe ser mayor a cero` });

const optionalMoney = (label: string) => z.preprocess(emptyToUndefined, moneyString(label).optional());

export const pctString = (label: string, max = 100) =>
  z.preprocess(
    (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(",", ".") : v),
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, `${label}: número con hasta 2 decimales`)
      .refine((s) => Number(s) <= max, `${label}: máximo ${max}`),
  );

const intFromForm = (min: number, max: number, label: string) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number({ message: `${label} requerido` }).int().min(min, `${label}: mínimo ${min}`).max(max, `${label}: máximo ${max}`));

export const partyInputSchema = z.union([
  z.object({ contactId: z.uuid(), sharePct: z.preprocess(emptyToUndefined, pctString("Porcentaje").optional()) }),
  z.object({
    name: z.string().trim().min(2, "Nombre requerido").max(200),
    email: z.preprocess(emptyToUndefined, z.email("Email inválido").max(254).optional()),
    phone: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
    sharePct: z.preprocess(emptyToUndefined, pctString("Porcentaje").optional()),
  }),
]);
export type PartyInput = z.infer<typeof partyInputSchema>;

const contractCode = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9-]{3,40}$/, "Código: 3 a 40 caracteres, letras, números y guiones"));

export const contractFinancialSchema = z.object({
  startDate: isoDate("Fecha de inicio").refine((s) => s.endsWith("-01"), "El contrato debe empezar el día 1 del mes"),
  endDate: isoDate("Fecha de fin"),
  currency: z.enum(CURRENCIES),
  initialRent: positiveMoney("Alquiler inicial"),
  paymentDueDay: intFromForm(1, 28, "Día de vencimiento"),
  depositAmount: optionalMoney("Depósito"),
  depositCurrency: z.preprocess(emptyToUndefined, z.enum(CURRENCIES).optional()),
  commissionAmount: optionalMoney("Comisión"),
  managementFeePct: z.preprocess((v) => (v === "" || v == null ? "0" : v), pctString("Honorario de administración")),
  adjustmentIndexKey: z.preprocess(emptyToUndefined, z.enum(INDEX_KEYS).optional()),
  adjustmentPeriodMonths: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(1).max(36).optional()),
  lateFeeDailyPct: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^\d(\.\d{1,4})?$/, "Interés diario: hasta 4 decimales")
      .refine((s) => Number(s) <= 5, "Interés diario: máximo 5%")
      .optional(),
  ),
});

function refineContract<T extends z.infer<typeof contractFinancialSchema>>(v: T, ctx: z.RefinementCtx) {
  if (v.endDate <= v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "La fecha de fin debe ser posterior al inicio" });
  if (Boolean(v.adjustmentIndexKey) !== Boolean(v.adjustmentPeriodMonths))
    ctx.addIssue({ code: "custom", path: ["adjustmentPeriodMonths"], message: "Indicá índice y periodicidad juntos (o ninguno)" });
  if (v.adjustmentIndexKey && v.currency !== "ARS")
    ctx.addIssue({ code: "custom", path: ["adjustmentIndexKey"], message: "Los índices argentinos solo ajustan contratos en pesos" });
}

export const createContractSchema = contractFinancialSchema
  .extend({
    propertyId: z.uuid("Elegí una propiedad"),
    code: z.preprocess(emptyToUndefined, contractCode.optional()),
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
    owners: z.array(partyInputSchema).min(1, "Agregá al menos un propietario").max(10),
    tenants: z.array(partyInputSchema).min(1, "Agregá al menos un inquilino").max(10),
    guarantors: z.array(partyInputSchema).max(10).default([]),
  })
  .superRefine(refineContract);
export type CreateContractInput = z.input<typeof createContractSchema>;

export const updateDraftContractSchema = contractFinancialSchema
  .extend({ notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()) })
  .superRefine(refineContract);

export const updateNotesSchema = z.object({ notes: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(5000).nullable()) });

export const endContractSchema = z.object({
  kind: z.enum(["ended", "terminated"]),
  effectiveDate: isoDate("Fecha de finalización"),
  reason: z.string().trim().min(3, "Indicá el motivo").max(1000),
});

export const renewContractSchema = contractFinancialSchema
  .extend({
    code: z.preprocess(emptyToUndefined, contractCode.optional()),
    notes: z.preprocess(emptyToUndefined, z.string().trim().max(5000).optional()),
  })
  .superRefine(refineContract);

export const registerPaymentSchema = z.object({
  obligationId: z.uuid(),
  amount: positiveMoney("Monto"),
  paidOn: isoDate("Fecha de pago"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, "Clave de envío inválida: recargá la página"),
});
export type RegisterPaymentInput = z.input<typeof registerPaymentSchema>;

export const voidPaymentSchema = z.object({ paymentId: z.uuid(), reason: z.string().trim().min(3, "Indicá el motivo").max(1000) });

export const manualIndexSchema = z.object({
  indexKey: z.enum(["IPC", "CASA_PROPIA"]),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (AAAA-MM)"),
  variationPct: z.preprocess(
    (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.trim().replace(",", ".") : v),
    z
      .string()
      .regex(/^-?\d{1,3}(\.\d{1,4})?$/, "Variación: número con hasta 4 decimales (p. ej. 2.1)")
      .refine((s) => Number(s) > -100 && Number(s) < 1000, "Variación fuera de rango"),
  ),
});

export const rejectAdjustmentSchema = z.object({
  adjustmentId: z.uuid(),
  reason: z.string().trim().min(3, "Indicá el motivo").max(1000),
  skipPeriod: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
});

export const generateSettlementSchema = z.object({
  contractId: z.uuid(),
  ownerContactId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (AAAA-MM)"),
  deductions: z
    .array(z.object({ description: z.string().trim().min(2).max(200), amount: positiveMoney("Deducción") }))
    .max(20)
    .default([]),
});

export const cancelSettlementSchema = z.object({ settlementId: z.uuid(), reason: z.string().trim().min(3, "Indicá el motivo").max(1000) });
