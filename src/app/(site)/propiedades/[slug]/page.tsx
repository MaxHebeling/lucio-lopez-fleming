import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { ArrowRight, Check, MapPin, Phone } from "lucide-react";
import { getDb } from "@/server/db";
import { getPublicPropertyBySlug, getSimilarProperties, type PublicPropertyDetail } from "@/server/properties/public";
import { OPERATION_NOUN, OPERATION_TO_SLUG, filtersToQuery, formatArea, telHref, whatsappHref } from "@/server/properties/public-helpers";
import { getSiteInfo } from "@/server/site/info";
import { Gallery } from "@/components/site/property/Gallery";
import { ShareButton } from "@/components/site/property/ShareButton";
import { propertyJsonLd } from "@/components/site/property/property-schema";
import { LeadForm } from "@/components/site/LeadForm";
import { PropertyCard } from "@/components/site/PropertyCard";
import { PriceBlock, StatusBadge } from "@/components/site/property-bits";
import { StaticMap } from "@/components/site/StaticMap";
import { WhatsAppIcon } from "@/components/site/icons";
import { JsonLd } from "@/components/site/JsonLd";
import { pageMetadata, siteUrl } from "@/components/site/seo";

const lookup = cache(async (slug: string) => {
  await connection();
  return getPublicPropertyBySlug(getDb(), slug);
});

async function resolve(slug: string): Promise<PublicPropertyDetail> {
  const r = await lookup(slug);
  if (r.kind === "redirect") permanentRedirect(`/propiedades/${r.slug}`);
  if (r.kind === "archived") {
    const q = filtersToQuery({ tipo: r.typeKey, zona: r.zoneSlug ?? undefined });
    permanentRedirect(r.operation === "sale" || r.operation === "rent" ? `/propiedades/${OPERATION_TO_SLUG[r.operation]}${q}` : `/propiedades${q}`);
  }
  if (r.kind === "not_found") notFound();
  return r.property;
}

function metaDescription(p: PublicPropertyDetail): string {
  if (p.seoDescription) return p.seoDescription;
  const facts = [
    p.bedrooms ? `${p.bedrooms} dormitorios` : null,
    p.bathrooms ? `${p.bathrooms} baños` : null,
    formatArea(p.coveredAreaM2 ?? p.totalAreaM2 ?? p.landAreaM2),
  ].filter(Boolean);
  const price = p.prices[0] && !p.prices[0].priceHidden && p.prices[0].amount !== null ? `${p.prices[0].currency === "USD" ? "USD" : "$"} ${new Intl.NumberFormat("es-AR").format(p.prices[0].amount)}` : "Precio a consultar";
  const lead = `${p.headline}${facts.length ? `: ${facts.join(", ")}` : ""}. ${price}. Cód. ${p.code}.`;
  const desc = p.description ? ` ${p.description.replace(/\s+/g, " ")}` : "";
  return `${lead}${desc}`.slice(0, 158).replace(/\s+\S*$/, "…");
}

export async function generateMetadata({ params }: PageProps<"/propiedades/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = await resolve(slug);
  return pageMetadata({
    title: p.seoTitle ?? `${p.headline} · Cód. ${p.code}`,
    description: metaDescription(p),
    path: `/propiedades/${p.slug}`,
    image: p.cover ? { url: p.cover.url, alt: p.cover.alt } : null,
  });
}

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="border-t border-line py-3">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">{label}</dt>
      <dd className="tabular mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function Paragraphs({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}|\r\n\r\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="prose-llf max-w-[68ch] text-[1.0625rem] leading-relaxed text-ink-2">
      {blocks.map((b, i) => (
        <p key={i} className="whitespace-pre-line">
          {b}
        </p>
      ))}
    </div>
  );
}

export default async function PropertyPage({ params }: PageProps<"/propiedades/[slug]">) {
  const { slug } = await params;
  const p = await resolve(slug);
  const db = getDb();
  const [info, similar] = await Promise.all([getSiteInfo(), getSimilarProperties(db, p, 4)]);
  const base = siteUrl();
  const url = `${base}/propiedades/${p.slug}`;
  const main = p.prices[0];
  const closed = p.status === "sold" || p.status === "rented";
  const waNumber = p.advisor?.whatsappE164 ?? info.whatsappE164;
  const waText = `Hola, me interesa la propiedad Cód. ${p.code} (${p.headline}): ${url}`;
  const wa = whatsappHref(waNumber, waText);
  const phone = p.branch?.phone ?? info.mainPhone;
  const phoneHref = telHref(phone);
  const bool = (v: boolean | null) => (v === null ? null : v ? "Sí" : "No");

  return (
    <article className="pb-28 lg:pb-24">
      <div className="container-site pt-6 lg:pt-10">
        <nav aria-label="Migas de pan" className="text-sm text-ink-2">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/" className="hover:underline">
                Inicio
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link href={main ? `/propiedades/${main.operation === "sale" ? "venta" : main.operation === "rent" ? "alquiler" : ""}`.replace(/\/$/, "") : "/propiedades"} className="hover:underline">
                {main ? `Propiedades en ${OPERATION_NOUN[main.operation]}` : "Propiedades"}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="tabular">
              Cód. {p.code}
            </li>
          </ol>
        </nav>

        <header className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-8">
            <p className="eyebrow text-brick">
              {p.typeName}
              {main ? ` · ${OPERATION_NOUN[main.operation]}` : ""}
            </p>
            <h1 className="display mt-4 text-[clamp(2.4rem,5.6vw,4.75rem)] leading-[0.98]">{p.headline}</h1>
            {p.subtitle ? <p className="mt-3 text-lg text-ink-2">{p.subtitle}</p> : null}
            <p className="mt-4 flex items-start gap-2 text-ink-2">
              <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-brick" strokeWidth={1.6} />
              <span>{[p.street, p.zone.label].filter(Boolean).join(" · ") || "Salta"}</span>
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:col-span-4 lg:items-end lg:text-right">
            <StatusBadge status={p.status} />
            <PriceBlock prices={p.prices} size="lg" />
            {main?.expenses ? (
              <p className="tabular text-sm text-ink-2">
                Expensas: {main.expenses.currency === "USD" ? "USD" : "$"} {new Intl.NumberFormat("es-AR").format(main.expenses.amount)}
              </p>
            ) : null}
          </div>
        </header>

        {closed ? (
          <div className="mt-6 rounded-[var(--radius-lg)] border border-line bg-white p-5" role="status">
            <p className="font-semibold">Esta propiedad ya fue {p.status === "sold" ? "vendida" : "alquilada"}.</p>
            <p className="mt-1 text-ink-2">
              Te mostramos opciones parecidas más abajo, o{" "}
              <a href="#consulta" className="underline underline-offset-4">
                contanos qué buscás
              </a>
              .
            </p>
          </div>
        ) : null}
      </div>

      <div className="container-site mt-8">
        {p.photos.length ? (
          <Gallery photos={p.photos} title={p.headline} />
        ) : (
          <div className="grid aspect-[16/7] place-items-center rounded-[var(--radius-lg)] bg-paper-2 text-ink-2">Fotos a pedido: consultanos.</div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="tabular text-sm text-ink-2">Código de propiedad: {p.code}</p>
          <ShareButton url={url} title={p.headline} />
        </div>
      </div>

      <div className="container-site mt-12 grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="min-w-0 lg:col-span-7 xl:col-span-8">
          <section aria-labelledby="datos-title">
            <h2 id="datos-title" className="display text-4xl">
              Datos clave
            </h2>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              <Fact label="Superficie total" value={formatArea(p.totalAreaM2)} />
              <Fact label="Cubierta" value={formatArea(p.coveredAreaM2)} />
              <Fact label="Descubierta" value={formatArea(p.uncoveredAreaM2)} />
              <Fact label="Terreno" value={formatArea(p.landAreaM2)} />
              <Fact label="Ambientes" value={p.rooms} />
              <Fact label="Dormitorios" value={p.bedrooms} />
              <Fact label="Baños" value={p.bathrooms} />
              <Fact label="Toilettes" value={p.toilets} />
              <Fact label="Cocheras" value={p.garages} />
              <Fact label="Antigüedad" value={p.ageYears === null ? null : p.ageYears === 0 ? "A estrenar" : `${p.ageYears} años`} />
              <Fact label="Orientación" value={p.orientation} />
              <Fact label="Disposición" value={p.disposition} />
              <Fact label="Estado" value={p.condition} />
              <Fact label="Apto crédito" value={p.creditEligible ? "Sí" : null} />
              <Fact label="Apto profesional" value={p.professionalUse ? "Sí" : null} />
              <Fact label="Acepta mascotas" value={p.typeCategory === "residential" ? bool(p.allowsPets) : null} />
              {p.attributes.map((a) => (
                <Fact key={a.label} label={a.label} value={a.value} />
              ))}
            </dl>
          </section>

          {p.description ? (
            <section aria-labelledby="descripcion-title" className="mt-14">
              <h2 id="descripcion-title" className="display text-4xl">
                Descripción
              </h2>
              <div className="mt-6">
                <Paragraphs text={p.description} />
              </div>
            </section>
          ) : null}

          {p.features.length ? (
            <section aria-labelledby="caracteristicas-title" className="mt-14">
              <h2 id="caracteristicas-title" className="display text-4xl">
                Características
              </h2>
              <div className="mt-6 grid gap-8 sm:grid-cols-2">
                {p.features.map((g) => (
                  <div key={g.key}>
                    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-2">{g.label}</h3>
                    <ul className="mt-3 grid gap-2">
                      {g.items.map((item) => (
                        <li key={item} className="flex items-center gap-2">
                          <Check aria-hidden className="size-4 text-brick" strokeWidth={2} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {p.coordinates ? (
            <section aria-labelledby="ubicacion-title" className="mt-14">
              <h2 id="ubicacion-title" className="display text-4xl">
                Ubicación
              </h2>
              <StaticMap
                className="mt-6"
                lat={p.coordinates.lat}
                lng={p.coordinates.lng}
                approximate={p.coordinates.approximate}
                label={p.coordinates.approximate ? `Mapa de la zona aproximada: ${p.zone.label ?? "Salta"}` : `Mapa: ${[p.street, p.zone.label].filter(Boolean).join(", ")}`}
              />
            </section>
          ) : null}
        </div>

        <aside className="lg:col-span-5 xl:col-span-4" aria-label="Contacto por esta propiedad">
          <div className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)]">
            <div id="consulta" className="scroll-mt-24 rounded-[20px] border border-line bg-white p-5 sm:p-7">
              <p className="eyebrow text-brick">{closed ? "Buscá algo parecido" : "Consultá por esta propiedad"}</p>
              {p.advisor ? (
                <p className="mt-4 text-ink-2">
                  Te atiende <span className="font-semibold text-ink">{p.advisor.name}</span>
                </p>
              ) : p.branch ? (
                <p className="mt-4 text-ink-2">
                  Te atendemos desde <span className="font-semibold text-ink">{p.branch.name}</span>
                </p>
              ) : null}
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                    <WhatsAppIcon className="size-5" /> WhatsApp
                  </a>
                ) : null}
                {phone && phoneHref ? (
                  <a href={phoneHref} className="btn btn-outline">
                    <Phone aria-hidden className="size-4" /> Llamar
                  </a>
                ) : null}
              </div>
              <div className="mt-6 border-t border-line pt-6">
                <LeadForm kind="property" propertyCode={p.code} operation={main?.operation} compact defaultMessage={`Hola, quiero más información sobre la propiedad Cód. ${p.code}.`} />
              </div>
              {!closed ? (
                <details className="group mt-6 border-t border-line pt-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-semibold">
                    Pedir una visita
                    <span aria-hidden className="text-xl transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <div className="mt-4">
                    <LeadForm kind="visit" propertyCode={p.code} operation={main?.operation} compact submitLabel="Pedir visita" />
                  </div>
                </details>
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      {similar.length ? (
        <section className="container-site mt-24 border-t border-line pt-16" aria-labelledby="similares-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="similares-title" className="display text-[clamp(2.2rem,4.5vw,3.75rem)] leading-none">
              {closed ? "Opciones parecidas disponibles" : "También te puede interesar"}
            </h2>
            <Link href={`/propiedades${main && main.operation !== "temporary_rent" ? `/${OPERATION_TO_SLUG[main.operation]}` : ""}${filtersToQuery({ tipo: p.typeKey })}`} className="link-arrow">
              Ver más opciones así <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <ul className="mt-10 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {similar.map((s) => (
              <li key={s.code}>
                <PropertyCard p={s} sizes="(min-width: 1024px) 23vw, (min-width: 640px) 46vw, 92vw" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Barra de contacto fija en mobile */}
      <div className="contact-bar flex gap-2 lg:hidden">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-primary flex-1">
            <WhatsAppIcon className="size-5" /> WhatsApp
          </a>
        ) : phone && phoneHref ? (
          <a href={phoneHref} className="btn btn-primary flex-1">
            <Phone aria-hidden className="size-4" /> Llamar
          </a>
        ) : null}
        <a href="#consulta" className="btn btn-ink flex-1">
          Consultar
        </a>
      </div>

      <JsonLd data={propertyJsonLd(p, url, base, info)} />
    </article>
  );
}
