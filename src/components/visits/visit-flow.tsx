"use client";

/**
 * Acciones grandes del agente según el estado de la visita. El check-in pide la ubicación UNA vez, recién después de
 * explicar para qué (consentimiento), con alta precisión y timeout. Si el GPS falla o se deniega, se ofrece reportar el
 * problema: la visita nunca se bloquea. No hay seguimiento en segundo plano (no se usa watchPosition).
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Select, Textarea, cx } from "@/components/ui";
import { Modal } from "@/components/crm/dialog-button";
import { useAction } from "@/components/crm/use-action";
import { CHECKIN_REASON_LABEL, formatDistance, LOCATION_PROBLEM_REASONS, type CheckinReason, type LocationProblemReason } from "@/server/visits/geofence";
import { checkInAction, enRouteAction, finishVisitAction, locationProblemAction, startVisitAction } from "@/app/crm/(panel)/mis-visitas/actions";

type LastCheckin = { attempt: number; status: string; reason: string; distanceM: number | null } | null;

const big = "h-14 w-full text-base";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function checkinSummary(c: { status: string; reason: string; distanceM: number | null }): { tone: "success" | "warning" | "info"; title: string; detail: string } {
  const reason = CHECKIN_REASON_LABEL[c.reason as CheckinReason] ?? c.reason;
  if (c.status === "verified") return { tone: "success", title: `Check-in verificado${c.distanceM !== null ? ` · ${formatDistance(c.distanceM)} de la propiedad` : ""}`, detail: "" };
  if (c.status === "needs_review") return { tone: "warning", title: "Check-in requiere revisión", detail: `${reason}${c.distanceM !== null ? ` (${formatDistance(c.distanceM)})` : ""}.` };
  return { tone: "info", title: "Llegada registrada sin ubicación", detail: `${reason}.` };
}

export function VisitFlow({
  appointmentId,
  status,
  isAssigned,
  canManage,
  lastCheckin,
  attempts,
  maxAttempts,
  radiusM,
  retentionDays,
}: {
  appointmentId: string;
  status: string;
  isAssigned: boolean;
  canManage: boolean;
  lastCheckin: LastCheckin;
  attempts: number;
  maxAttempts: number;
  radiusM: number;
  retentionDays: number;
}) {
  const router = useRouter();
  const enRoute = useAction(enRouteAction);
  const start = useAction(startVisitAction);
  const finish = useAction(finishVisitAction);
  const [dialog, setDialog] = useState<null | "consent" | "problem">(null);
  const [problemReason, setProblemReason] = useState<LocationProblemReason>("permission_denied");
  const [confirmFinish, setConfirmFinish] = useState(false);

  const canCheckIn = isAssigned && (status === "scheduled" || status === "confirmed" || status === "en_route");
  const canRetry = isAssigned && status === "checked_in" && lastCheckin !== null && lastCheckin.status !== "verified" && attempts < maxAttempts;
  const error = enRoute.error ?? start.error ?? finish.error;

  const openProblem = (reason: LocationProblemReason) => {
    setProblemReason(reason);
    setDialog("problem");
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {lastCheckin && (status === "checked_in" || status === "in_progress" || status === "completed") ? <CheckinBanner c={lastCheckin} /> : null}

      {!isAssigned && (status === "scheduled" || status === "confirmed" || status === "en_route" || status === "checked_in") ? (
        <p className="text-sm text-stone">La salida, la llegada y el inicio los registra el agente asignado desde su teléfono.</p>
      ) : null}

      {isAssigned && (status === "scheduled" || status === "confirmed") ? (
        <Button className={big} disabled={enRoute.pending} aria-busy={enRoute.pending} onClick={() => enRoute.run({ appointmentId })}>
          {enRoute.pending ? "Registrando…" : "Salgo para allá"}
        </Button>
      ) : null}
      {canCheckIn ? (
        <Button className={big} variant={status === "en_route" ? "primary" : "secondary"} onClick={() => setDialog("consent")}>
          Confirmar llegada
        </Button>
      ) : null}
      {isAssigned && status === "checked_in" ? (
        <Button className={big} disabled={start.pending} aria-busy={start.pending} onClick={() => start.run({ appointmentId })}>
          {start.pending ? "Iniciando…" : "Iniciar visita"}
        </Button>
      ) : null}
      {canRetry ? (
        <Button className="h-12 w-full" variant="secondary" onClick={() => setDialog("consent")}>
          Reintentar verificación de llegada ({attempts}/{maxAttempts})
        </Button>
      ) : null}
      {canManage && status === "in_progress" ? (
        confirmFinish ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line bg-paper p-3">
            <p className="text-sm font-semibold">¿Finalizar la visita? El cliente verá que terminó y vas a poder cargar el informe.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="h-12" onClick={() => setConfirmFinish(false)}>
                Volver
              </Button>
              <Button className="h-12" disabled={finish.pending} aria-busy={finish.pending} onClick={() => finish.run({ appointmentId }).then((r) => r.ok && setConfirmFinish(false))}>
                {finish.pending ? "Finalizando…" : "Sí, finalizar"}
              </Button>
            </div>
          </div>
        ) : (
          <Button className={big} onClick={() => setConfirmFinish(true)}>
            Finalizar visita
          </Button>
        )
      ) : null}
      {canCheckIn || canRetry ? (
        <button type="button" className="self-start text-sm font-semibold text-ink-2 underline underline-offset-4" onClick={() => openProblem("position_unavailable")}>
          Reportar problema de ubicación
        </button>
      ) : null}

      {dialog === "consent" ? (
        <ConsentDialog
          appointmentId={appointmentId}
          radiusM={radiusM}
          retentionDays={retentionDays}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
          onFallback={openProblem}
        />
      ) : null}
      {dialog === "problem" ? (
        <ProblemDialog
          appointmentId={appointmentId}
          initialReason={problemReason}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

export function CheckinBanner({ c }: { c: NonNullable<LastCheckin> }) {
  const s = checkinSummary(c);
  return (
    <div role="status" className={cx("rounded-[var(--radius-md)] border px-4 py-3 text-sm", s.tone === "success" ? "border-success/30 bg-[#eef6f0] text-success" : s.tone === "warning" ? "border-warning/30 bg-[#fbf4e6] text-warning" : "border-line bg-white text-ink-2")}>
      <p className="font-semibold">{s.title}</p>
      {s.detail ? <p className="mt-0.5">{s.detail}</p> : null}
    </div>
  );
}

const GEO_ERROR: Record<number, LocationProblemReason> = { 1: "permission_denied", 2: "position_unavailable", 3: "timeout" };

function ConsentDialog({
  appointmentId,
  radiusM,
  retentionDays,
  onClose,
  onDone,
  onFallback,
}: {
  appointmentId: string;
  radiusM: number;
  retentionDays: number;
  onClose: () => void;
  onDone: () => void;
  onFallback: (reason: LocationProblemReason) => void;
}) {
  const key = useRef(newKey());
  const action = useAction(checkInAction);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<LocationProblemReason | null>(null);
  const [result, setResult] = useState<{ status: string; reason: string; distanceM: number | null } | null>(null);

  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGeoError("unsupported");
      return;
    }
    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        void action
          .run({ appointmentId, idempotencyKey: key.current, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, deviceTimestamp: Math.round(pos.timestamp) })
          .then((r) => {
            if (r.ok) setResult(r.data.checkin);
          });
      },
      (err) => {
        setLocating(false);
        setGeoError(GEO_ERROR[err.code] ?? "position_unavailable");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  if (result) {
    const s = checkinSummary(result);
    return (
      <Modal title="Llegada registrada" onClose={onDone}>
        <div className="flex flex-col gap-4">
          <CheckinBanner c={{ ...result, attempt: 0 }} />
          {s.tone !== "success" ? <p className="text-sm text-stone">No bloquea la visita: podés iniciarla. Queda marcado para que el equipo lo revise.</p> : null}
          <Button className="h-12" onClick={onDone}>
            Continuar
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Confirmar llegada" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <p>
          Para confirmar tu llegada vamos a pedir la <strong>ubicación de tu teléfono una sola vez</strong>. Se compara con la ubicación de la propiedad (radio de {radiusM} m) y se guarda
          solo como registro de este check-in.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-stone">
          <li>No hay seguimiento en segundo plano ni antes ni después de la visita.</li>
          <li>El cliente no ve tu ubicación: solo que llegaste.</li>
          <li>Las coordenadas se anonimizan a los {retentionDays} días; queda el resultado y la distancia.</li>
        </ul>
        {action.error ? <Alert tone="danger">{action.error}</Alert> : null}
        {geoError ? (
          <Alert tone="warning">
            {CHECKIN_REASON_LABEL[geoError]}. Podés reintentar o reportar el problema: la visita sigue igual.
          </Alert>
        ) : null}
        <Button className="h-12" disabled={locating || action.pending} aria-busy={locating || action.pending} onClick={locate}>
          {locating ? "Obteniendo ubicación…" : action.pending ? "Registrando…" : geoError ? "Reintentar" : "Usar mi ubicación"}
        </Button>
        <Button variant="secondary" className="h-12" onClick={() => onFallback(geoError ?? "position_unavailable")}>
          Reportar problema de ubicación
        </Button>
      </div>
    </Modal>
  );
}

const REASON_OPTIONS: LocationProblemReason[] = [...LOCATION_PROBLEM_REASONS];

function ProblemDialog({ appointmentId, initialReason, onClose, onDone }: { appointmentId: string; initialReason: LocationProblemReason; onClose: () => void; onDone: () => void }) {
  const key = useRef(newKey());
  const action = useAction(locationProblemAction);
  const [reason, setReason] = useState<LocationProblemReason>(initialReason);
  const [detail, setDetail] = useState("");
  const detailErrors = action.fieldErrors?.detail;
  return (
    <Modal title="Problema de ubicación" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run({ appointmentId, idempotencyKey: key.current, reason, detail }).then((r) => {
            if (r.ok) onDone();
          });
        }}
      >
        <p className="text-sm text-stone">Se registra tu llegada sin ubicación y con el motivo. La visita sigue normalmente.</p>
        {action.error && !detailErrors ? <Alert tone="danger">{action.error}</Alert> : null}
        <Field label="Motivo" htmlFor="loc-reason">
          <Select id="loc-reason" value={reason} onChange={(e) => setReason(e.target.value as LocationProblemReason)}>
            {REASON_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {CHECKIN_REASON_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={reason === "other" ? "Detalle (obligatorio)" : "Detalle (opcional)"} htmlFor="loc-detail" error={detailErrors}>
          <Textarea id="loc-detail" rows={3} maxLength={500} value={detail} onChange={(e) => setDetail(e.target.value)} aria-invalid={detailErrors ? true : undefined} />
        </Field>
        <Button type="submit" className="h-12" disabled={action.pending} aria-busy={action.pending}>
          {action.pending ? "Registrando…" : "Registrar llegada sin ubicación"}
        </Button>
      </form>
    </Modal>
  );
}
