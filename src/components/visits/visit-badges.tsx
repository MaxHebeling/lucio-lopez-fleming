import { Badge } from "@/components/ui";
import { VISIT_PHASE_LABEL, visitPhase, type VisitPhase } from "@/server/visits/state";
import { formatDistance } from "@/server/visits/geofence";

const PHASE_TONE: Record<VisitPhase, "neutral" | "success" | "danger" | "warning" | "info" | "brand"> = {
  scheduled: "info",
  en_route: "brand",
  checked_in: "success",
  in_progress: "warning",
  completed: "neutral",
  cancelled: "danger",
  no_show: "danger",
};

export function VisitStatusBadge({ status }: { status: string }) {
  const p = visitPhase(status);
  return <Badge tone={PHASE_TONE[p]}>{VISIT_PHASE_LABEL[p]}</Badge>;
}

export function CheckinBadge({ c }: { c: { status: string; distance_m: number | null } | null }) {
  if (!c) return null;
  if (c.status === "verified") return <Badge tone="success">Llegada verificada{c.distance_m !== null ? ` · ${formatDistance(c.distance_m)}` : ""}</Badge>;
  if (c.status === "needs_review") return <Badge tone="warning">Llegada para revisar</Badge>;
  return <Badge tone="neutral">Llegada sin ubicación</Badge>;
}
