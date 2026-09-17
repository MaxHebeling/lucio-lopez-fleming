import Image from "next/image";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { getRequestMeta } from "@/server/next/context";
import { getClientVisitView, type AuthorizedContact } from "@/server/visits/public";
import { Monogram } from "@/components/experience/Monogram";
import { ClientLiveStatus } from "@/components/visits/client-live-status";

export const dynamic = "force-dynamic";

const dayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Salta" });
const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Salta" });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Brand() {
  return (
    <div className="vx-brand">
      <Monogram className="h-9 w-auto text-brick" />
      <span className="vx-brand-name">
        Lucio López Fleming<span className="vx-brand-tag">Buenos negocios</span>
      </span>
    </div>
  );
}

function ContactActions({ contact }: { contact: AuthorizedContact }) {
  if (!contact.whatsappUrl && !contact.phoneHref) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {contact.whatsappUrl ? (
        <a href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer" className="vx-btn vx-btn-primary">
          Contactar por WhatsApp
        </a>
      ) : null}
      {contact.phoneHref ? (
        <a href={contact.phoneHref} className="vx-btn vx-btn-ghost">
          Llamar
        </a>
      ) : null}
    </div>
  );
}

/**
 * Link temporal del cliente. Cualquier caso negativo (token inexistente, vencido, revocado, rotado, rate limit o flags
 * apagados) termina en el mismo 404 genérico.
 */
export default async function ClientVisitPage({ params }: PageProps<"/visita/[token]">) {
  const { token } = await params;
  const meta = await getRequestMeta();
  const view = await getClientVisitView(getDb(), token, { ip: meta.ip, userAgent: meta.userAgent, countOpen: true });
  if (!view) notFound();

  if (view.kind === "closed") {
    return (
      <main className="vx">
        <div className="vx-wrap">
          <Brand />
          <article className="vx-card flex flex-col gap-6" aria-labelledby="vx-closed-title">
            <Monogram className="h-12 w-auto self-start text-paper" />
            <div>
              <p className="vx-eyebrow">{view.clientFirstName ? `Gracias, ${view.clientFirstName}` : "Gracias"}</p>
              <h1 id="vx-closed-title" className="vx-display vx-h2 mt-3">
                Esta visita ha finalizado.
              </h1>
              <p className="mt-3 text-base text-paper/85">Gracias por confiar en Lucio López Fleming.</p>
            </div>
            {view.message ? <blockquote className="vx-quote whitespace-pre-line">{view.message}</blockquote> : null}
            <p className="border-t border-paper/20 pt-5 text-sm">
              <span className="vx-display block text-2xl">{view.agent.fullName}</span>
              <span className="mt-1 block text-[0.68rem] font-bold uppercase tracking-[0.22em] text-paper/70">Asesor · Lucio López Fleming</span>
            </p>
            <ContactActions contact={view.contact} />
          </article>
          <p className="vx-foot">Este enlace es personal y vence en poco tiempo. Nunca muestra la ubicación de tu asesor.</p>
        </div>
      </main>
    );
  }

  const starts = new Date(view.startsAt);
  const ends = new Date(view.endsAt);
  return (
    <main className="vx">
      <div className="vx-wrap">
        <Brand />
        <section>
          <p className="vx-eyebrow">Tu visita</p>
          <h1 className="vx-display vx-h1">{view.clientFirstName ? `Hola, ${view.clientFirstName}.` : "Hola."}</h1>
          <p className="mt-4 text-base text-ink-2">
            {capitalize(dayFmt.format(starts))} · de {timeFmt.format(starts)} a {timeFmt.format(ends)}
          </p>
        </section>

        <ClientLiveStatus token={token} initial={{ phase: view.phase, checkedInAt: view.checkedInAt }} />

        <article aria-labelledby="vx-property-title" className="flex flex-col gap-4">
          {view.property.coverUrl ? (
            <div className="vx-photo">
              <Image src={view.property.coverUrl} alt={`Foto de ${view.property.title}`} fill priority sizes="(min-width: 600px) 544px, calc(100vw - 2.5rem)" className="object-cover" />
            </div>
          ) : null}
          <div>
            <p className="vx-eyebrow">La propiedad · Cód. {view.property.code}</p>
            <h2 id="vx-property-title" className="vx-display vx-h2 mt-3">
              {view.property.title}
            </h2>
            {view.property.street || view.property.zone ? <p className="mt-3 text-base text-ink-2">{[view.property.street, view.property.zone].filter(Boolean).join(" · ")}</p> : null}
          </div>
        </article>

        <section aria-labelledby="vx-advisor-title" className="flex flex-col gap-4 border-t border-line pt-6">
          <div>
            <p className="vx-eyebrow">Tu asesor</p>
            <h2 id="vx-advisor-title" className="vx-display vx-h2 mt-3">
              {view.agent.fullName}
            </h2>
            {view.contact.source === "company" ? <p className="mt-2 text-sm text-stone">Contacto de la inmobiliaria</p> : null}
          </div>
          <ContactActions contact={view.contact} />
        </section>

        <p className="vx-foot">Este enlace es personal y vence después de la visita. Solo muestra el estado: nunca la ubicación de tu asesor.</p>
      </div>
    </main>
  );
}
