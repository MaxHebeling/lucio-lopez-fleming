import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { isEnabled } from "@/server/flags";
import { tryVisitScope } from "@/server/visits/access";
import { getVisitDetail } from "@/server/visits/queries";
import { MAX_CHECKIN_ATTEMPTS } from "@/server/visits/service";
import { getVisitSettings } from "@/server/visits/settings";
import { buildVisitBrief, structureVisitReport } from "@/server/visits/ai-extension";
import { CHECKIN_REASON_LABEL, formatDistance, type CheckinReason } from "@/server/visits/geofence";
import { FOLLOW_UP_DELAY_HOURS, INTEREST_LABEL, type Interest } from "@/server/visits/rules";
import { isTerminal } from "@/server/visits/state";
import { VISIT_EVENT_LABEL, type VisitEventKind } from "@/server/visits/timeline";
import { utcToLocalInput } from "@/server/crm/time";
import { crmImageSource } from "@/server/media/crm-preview";
import { Card, formatDateTime } from "@/components/ui";
import { ContactButtons } from "@/components/crm/contact-actions";
import { ClientLinkPanel } from "@/components/visits/client-link-panel";
import { FollowUpPanel, ThanksPanel } from "@/components/visits/closing-panels";
import { ReportForm } from "@/components/visits/report-form";
import { CheckinBadge, VisitStatusBadge } from "@/components/visits/visit-badges";
import { VisitFlow } from "@/components/visits/visit-flow";
import { logOutreachAction } from "../../_shared/actions";
import { orNotFound, requireUuid } from "../../_shared/load";

export const metadata: Metadata = { title: "Visita" };

const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Salta" });
const hhmm = (d: Date) => utcToLocalInput(d).slice(11);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function eventDetail(kind: VisitEventKind, data: Record<string, unknown>): string | null {
  const reason = typeof data.reason === "string" ? (CHECKIN_REASON_LABEL[data.reason as CheckinReason] ?? null) : null;
  switch (kind) {
    case "checked_in":
    case "checkin_retry":
    case "location_problem": {
      const verification = data.verification === "verified" ? "Verificado" : data.verification === "needs_review" ? "Para revisar" : "Sin ubicación";
      const dist = typeof data.distanceM === "number" ? formatDistance(data.distanceM) : null;
      return [verification, dist, data.verification === "verified" ? null : reason].filter(Boolean).join(" · ");
    }
    case "report_saved":
    case "report_confirmed":
      return typeof data.interest === "string" ? `Interés ${INTEREST_LABEL[data.interest as Interest]?.toLowerCase() ?? data.interest}` : null;
    case "thanks_marked_sent":
      return data.channel === "whatsapp" ? "Por WhatsApp" : data.channel === "copy" ? "Copiado" : null;
    case "rescheduled":
      return typeof data.startsAt === "string" ? `Nuevo horario: ${formatDateTime(data.startsAt)}` : null;
    case "cancelled":
    case "finished":
      return data.via === "agenda" ? "Desde la Agenda" : null;
    default:
      return null;
  }
}

export default async function VisitPage({ params }: PageProps<"/crm/mis-visitas/[id]">) {
  const actor = await requireStaffPage();
  const db = getDb();
  if (!(await isEnabled(db, "visits_operations"))) notFound();
  if (!tryVisitScope(actor)) redirect("/crm?sin-permiso=1");
  const id = requireUuid((await params).id);
  const d = await orNotFound(getVisitDetail(db, actor, id));
  const [settings, linkEnabled] = await Promise.all([getVisitSettings(db), isEnabled(db, "client_visit_link")]);
  const v = d.visit;
  const terminal = isTerminal(v.status);
  const img = d.property.cover ? crmImageSource(d.property.cover) : null;
  const address = [[d.property.address_street, d.property.address_number].filter(Boolean).join(" "), d.property.location_name].filter(Boolean).join(", ");
  const mapsQuery = d.property.hasCoordinates ? `${d.property.latitude},${d.property.longitude}` : address ? `${address}, Salta, Argentina` : null;
  const mapsUrl = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}` : null;
  const clientWa = d.phones.find((p) => p.phone_e164 && p.is_whatsapp)?.phone_e164 ?? d.phones.find((p) => p.phone_e164)?.phone_e164 ?? null;
  const last = d.checkins[0] ?? null;
  // Puntos de extensión de IA: hoy devuelven null y no se muestra nada.
  const [brief, proposal] = await Promise.all([
    terminal ? Promise.resolve(null) : buildVisitBrief({ appointmentId: v.id }),
    d.report?.status === "draft" ? structureVisitReport(d.report.body) : Promise.resolve(null),
  ]);
  const interest = (d.report?.interest as Interest | null) ?? null;
  const delayH = FOLLOW_UP_DELAY_HOURS[interest ?? "medium"];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <nav aria-label="Migas" className="text-sm">
        <Link href="/crm/mis-visitas" className="text-stone underline-offset-4 hover:underline">
          ← Mis visitas
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <p className="text-sm text-stone">{capitalize(dayFmt.format(v.starts_at))}</p>
        <h1 className="text-3xl font-bold tabular-nums tracking-tight">
          {hhmm(v.starts_at)} – {hhmm(v.ends_at)}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <VisitStatusBadge status={v.status} />
          <CheckinBadge c={last ? { status: last.verification_status, distance_m: last.distance_m } : null} />
          {!d.permissions.isAssigned ? <span className="text-sm text-stone">Agente: {d.agentName}</span> : null}
        </div>
      </header>

      {brief ? (
        <Card title="Antes de la visita">
          <p className="font-semibold">{brief.headline}</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {brief.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={terminal ? "Estado" : "Siguiente paso"}>
        {v.status === "cancelled" ? <p className="text-sm">La visita fue cancelada{v.cancel_reason ? `: ${v.cancel_reason}` : "."}</p> : null}
        {v.status === "no_show" ? <p className="text-sm">El cliente no se presentó.</p> : null}
        {v.status === "completed" && !last ? <p className="mb-3 text-sm">Visita finalizada. Completá el informe, el seguimiento y el agradecimiento.</p> : null}
        <VisitFlow
          appointmentId={v.id}
          status={v.status}
          isAssigned={d.permissions.isAssigned}
          canManage={d.permissions.canManage}
          lastCheckin={last ? { attempt: last.attempt, status: last.verification_status, reason: last.reason, distanceM: last.distance_m } : null}
          attempts={d.checkins.length}
          maxAttempts={MAX_CHECKIN_ATTEMPTS}
          radiusM={settings.radiusM}
          retentionDays={settings.locationRetentionDays}
        />
      </Card>

      <section aria-label="Propiedad y cliente" className="grid gap-4 sm:grid-cols-2">
        <Card title="Propiedad">
          <div className="flex flex-col gap-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-md)] bg-paper-2">
              {img ? <Image src={img.src} alt={`Foto de ${d.property.title}`} fill unoptimized={!img.optimize} sizes="(min-width: 640px) 360px, 100vw" className="object-cover" /> : null}
            </div>
            <p>
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone">Cód. {d.property.code}</span>
              <Link href={`/crm/propiedades/${d.property.id}`} className="font-semibold underline-offset-4 hover:underline">
                {d.property.title}
              </Link>
              {address ? <span className="block text-sm text-stone">{address}</span> : null}
            </p>
            {mapsUrl ? (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-line bg-white px-4 text-sm font-semibold hover:border-ink">
                Abrir en el mapa
              </a>
            ) : (
              <p className="text-sm text-stone">La propiedad no tiene dirección ni coordenadas cargadas.</p>
            )}
          </div>
        </Card>
        <Card title="Cliente">
          {d.contact ? (
            <div className="flex flex-col gap-3">
              <Link href={`/crm/contactos/${d.contact.id}`} className="text-lg font-semibold underline-offset-4 hover:underline">
                {d.contact.display_name}
              </Link>
              <ContactButtons phone={d.phones[0]} entityType="contact" entityId={d.contact.id} log={logOutreachAction} size="md" />
            </div>
          ) : (
            <p className="text-sm text-stone">La visita no tiene cliente cargado.</p>
          )}
        </Card>
      </section>

      {linkEnabled ? (
        <Card title="Link del cliente">
          <ClientLinkPanel
            appointmentId={v.id}
            active={d.link ? { createdAt: d.link.created_at.toISOString(), lastOpenedAt: d.link.last_opened_at?.toISOString() ?? null, openCount: d.link.open_count, expiresAt: d.link.effectiveExpiresAt.toISOString(), expired: d.link.expired } : null}
            terminal={terminal}
            canManage={d.permissions.canManage}
            clientFirstName={d.clientFirstName}
            clientWhatsappE164={clientWa}
          />
        </Card>
      ) : null}

      {v.status === "completed" ? (
        <>
          <Card title="Informe post-visita">
            {d.permissions.canManage ? (
              <ReportForm
                appointmentId={v.id}
                finishedAt={(v.finished_at ?? v.ends_at).toISOString()}
                proposal={proposal}
                initial={{
                  body: d.report?.body ?? "",
                  interest,
                  positives: d.report?.positives ?? "",
                  objections: d.report?.objections ?? "",
                  nextStep: d.report?.next_step ?? "",
                  followUpAt: d.report?.follow_up_at ? utcToLocalInput(d.report.follow_up_at) : "",
                  status: (d.report?.status as "draft" | "confirmed" | undefined) ?? null,
                }}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm">{d.report?.body ?? "Sin informe."}</p>
            )}
          </Card>
          <Card title="Seguimiento">
            <FollowUpPanel
              // Remonta al cambiar la sugerencia (p. ej. al confirmar el informe con otro interés).
              key={utcToLocalInput(d.report?.follow_up_at ?? d.suggestedFollowUpAt)}
              appointmentId={v.id}
              reportConfirmed={d.report?.status === "confirmed"}
              suggestedLocal={utcToLocalInput(d.report?.follow_up_at ?? d.suggestedFollowUpAt)}
              suggestionHint={`Interés ${interest ? INTEREST_LABEL[interest].toLowerCase() : "sin indicar"}: sugerido ${delayH >= 48 && delayH % 24 === 0 ? `${delayH / 24} días` : `${delayH} h`} después de la visita. Editable.`}
              task={d.followUpTask ? { id: d.followUpTask.id, title: d.followUpTask.title, dueAt: d.followUpTask.due_at?.toISOString() ?? null, status: d.followUpTask.status } : null}
              canCreate={d.permissions.canManage && d.permissions.canCreateTasks}
            />
          </Card>
          <Card title="Agradecimiento">
            <ThanksPanel
              appointmentId={v.id}
              initialMessage={d.thanks?.message ?? d.thanksTemplate}
              saved={Boolean(d.thanks)}
              markedSentAt={d.thanks?.marked_sent_at?.toISOString() ?? null}
              clientWhatsappE164={clientWa}
              canManage={d.permissions.canManage}
            />
          </Card>
        </>
      ) : null}

      {d.checkins.length ? (
        <Card title="Llegada">
          <ol className="flex flex-col divide-y divide-line text-sm">
            {d.checkins.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 py-2">
                <span className="font-semibold">
                  Intento {c.attempt} · {formatDateTime(c.server_at)}
                </span>
                <span className="text-stone">
                  {c.verification_status === "verified" ? "Verificado" : c.verification_status === "needs_review" ? "Para revisar" : "Sin ubicación"} · {CHECKIN_REASON_LABEL[c.reason as CheckinReason] ?? c.reason}
                  {c.distance_m !== null ? ` · ${formatDistance(c.distance_m)}` : ""}
                  {c.accuracy_m !== null ? ` · precisión ±${Math.round(Number(c.accuracy_m))} m` : ""}
                  {c.reason_detail ? ` · «${c.reason_detail}»` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card title="Historial de la visita">
        {d.events.length === 0 ? (
          <p className="text-sm text-stone">Sin movimientos registrados todavía.</p>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            {d.events.map((e) => {
              const detail = eventDetail(e.kind, (e.data ?? {}) as Record<string, unknown>);
              return (
                <li key={e.id} className="grid grid-cols-[6.5rem_1fr] gap-3">
                  <time dateTime={e.occurred_at.toISOString()} className="tabular-nums text-stone">
                    {formatDateTime(e.occurred_at)}
                  </time>
                  <span>
                    <span className="font-semibold">{VISIT_EVENT_LABEL[e.kind]}</span>
                    <span className="block text-stone">{[detail, e.actor_kind === "client" ? "Cliente" : e.actor_kind === "system" ? "Sistema" : e.actor_name].filter(Boolean).join(" · ")}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <p className="text-sm">
        <Link href={`/crm/agenda/${v.id}`} className="text-stone underline underline-offset-4">
          Ver en la Agenda (reprogramar, notas)
        </Link>
      </p>
    </div>
  );
}
