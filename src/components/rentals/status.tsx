import { Badge } from "@/components/ui";
import { ADJUSTMENT_STATUS_LABEL, CONTRACT_STATUS_LABEL, OBLIGATION_STATUS_LABEL, SETTLEMENT_STATUS_LABEL } from "@/server/rentals/schema";

type Tone = "neutral" | "success" | "warning" | "danger" | "brand" | "info";

const CONTRACT_TONE: Record<string, Tone> = { draft: "neutral", active: "success", ended: "info", terminated: "danger", renewed: "info" };
const OBLIGATION_TONE: Record<string, Tone> = { pending: "neutral", partially_paid: "warning", paid: "success", overdue: "danger", waived: "info" };
const SETTLEMENT_TONE: Record<string, Tone> = { draft: "neutral", approved: "info", paid: "success", cancelled: "danger" };
const ADJUSTMENT_TONE: Record<string, Tone> = { proposed: "warning", applied: "success", rejected: "danger" };
const REPORT_TONE: Record<string, Tone> = { generated: "neutral", queued: "info", sent: "success", delivered: "success", failed: "danger", awaiting_credentials: "warning" };
export const REPORT_STATUS_LABEL: Record<string, string> = {
  generated: "Generado",
  queued: "En cola de envío",
  sent: "Enviado",
  delivered: "Entregado",
  failed: "Falló el envío",
  awaiting_credentials: "Email sin configurar",
};
export const PROPERTY_STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  available: "Disponible",
  reserved: "Reservada",
  sold: "Vendida",
  rented: "Alquilada",
  paused: "Pausada",
  archived: "Archivada",
};

export function ContractStatus({ status }: { status: string }) {
  return <Badge tone={CONTRACT_TONE[status] ?? "neutral"}>{CONTRACT_STATUS_LABEL[status] ?? status}</Badge>;
}
export function ObligationStatus({ status }: { status: string }) {
  return <Badge tone={OBLIGATION_TONE[status] ?? "neutral"}>{OBLIGATION_STATUS_LABEL[status] ?? status}</Badge>;
}
export function SettlementStatus({ status }: { status: string }) {
  return <Badge tone={SETTLEMENT_TONE[status] ?? "neutral"}>{SETTLEMENT_STATUS_LABEL[status] ?? status}</Badge>;
}
export function AdjustmentStatus({ status }: { status: string }) {
  return <Badge tone={ADJUSTMENT_TONE[status] ?? "neutral"}>{ADJUSTMENT_STATUS_LABEL[status] ?? status}</Badge>;
}
export function ReportStatus({ status }: { status: string }) {
  return <Badge tone={REPORT_TONE[status] ?? "neutral"}>{REPORT_STATUS_LABEL[status] ?? status}</Badge>;
}
