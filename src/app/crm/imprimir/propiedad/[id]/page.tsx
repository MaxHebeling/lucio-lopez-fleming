import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { isEnabled } from "@/server/flags";
import { loadMarketingFacts } from "@/server/ai/property/marketing-director";
import { crmImageSource } from "@/server/media/crm-preview";
import { formatArea, formatPrice, headlineDetail, propertyHeadline } from "@/server/properties/public-helpers";
import { OPERATION_LABEL, type Operation } from "@/server/properties/schema";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Ficha imprimible", robots: { index: false, follow: false } };

const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
.sheet { max-width: 186mm; margin: 0 auto; background: #fff; color: #141312; }
.sheet h1 { font-family: var(--font-display); font-weight: 400; line-height: 1.02; }
@media screen { body { background: #ebe6de; } .sheet { margin: 24px auto; padding: 14mm; box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); } }
@media screen and (max-width: 640px) { .sheet { margin: 0; padding: 20px 16px; } }
@media print { .no-print { display: none !important; } body { background: #fff; } .sheet { padding: 0; } .avoid-break { break-inside: avoid; } }
`;

/**
 * Ficha imprimible de una propiedad (Imprimir / Guardar como PDF del navegador). SOLO datos públicos: dirección sin
 * altura si está oculta, precio «Consultar» si está oculto, sin propietarios, notas, documentos ni coordenadas.
 * Marca LLF. No agrega dependencias (sin librería de PDF).
 */
export default async function PrintablePropertyPage({ params }: PageProps<"/crm/imprimir/propiedad/[id]">) {
  const actor = await requireStaffPage("properties.read");
  const { id } = await params;
  const db = getDb();
  if (!(await isEnabled(db, "ai_marketing_director"))) notFound();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const facts = await loadMarketingFacts(db, actor, id).catch((e) => {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  });
  const media = await db
    .selectFrom("property_media as m")
    .leftJoin("files as f", (j) => j.onRef("f.id", "=", "m.file_id").on("f.deleted_at", "is", null))
    .select(["m.id", "m.file_id", "m.source_url", "m.alt_text", "f.storage_driver as file_storage_driver", "f.storage_key as file_storage_key", "f.visibility as file_visibility"])
    .where("m.property_id", "=", id)
    .where("m.kind", "=", "image")
    .where("m.deleted_at", "is", null)
    .where("m.status", "in", ["source_only", "verified", "stored"])
    .orderBy("m.is_cover", "desc")
    .orderBy("m.sort_order")
    .limit(5)
    .execute();
  const photos = media.map((m) => ({ id: m.id, alt: m.alt_text, src: crmImageSource(m) })).filter((m) => m.src);
  const op = facts.operations[0]?.operation ?? null;
  const detail = headlineDetail({ category: facts.category, bedrooms: facts.bedrooms, rooms: facts.rooms, coveredAreaM2: facts.areas.coveredM2, landAreaM2: facts.areas.landM2, totalAreaM2: facts.areas.totalM2 });
  const headline = propertyHeadline(facts.typeName, op, facts.zone, detail);
  const data: Array<[string, string | null]> = [
    ["Ambientes", facts.rooms ? String(facts.rooms) : null],
    ["Dormitorios", facts.bedrooms ? String(facts.bedrooms) : null],
    ["Baños", facts.bathrooms ? String(facts.bathrooms) : null],
    ["Cocheras", facts.garages ? String(facts.garages) : null],
    ["Sup. cubierta", formatArea(facts.areas.coveredM2)],
    ["Terreno", formatArea(facts.areas.landM2)],
    ["Sup. total", formatArea(facts.areas.totalM2)],
    ["Apta crédito", facts.creditEligible === null ? null : facts.creditEligible ? "Sí" : "No"],
  ];
  const shown = data.filter(([, v]) => v);
  const place = [facts.street, facts.zone, "Salta"].filter(Boolean).join(", ");

  return (
    <>
      <style>{PRINT_CSS}</style>
      <main className="sheet" data-testid="printable-sheet">
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-line bg-paper px-4 py-3 text-sm">
          <p>Ficha con datos públicos de la propiedad. Usá «Imprimir» y elegí «Guardar como PDF» para enviarla.</p>
          <PrintButton />
        </div>
        <header className="flex items-start justify-between gap-6 border-b border-ink pb-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG de marca local, se imprime tal cual */}
            <img src="/brand/monogram.svg" alt="" width={34} height={40} />
            <div>
              <p className="text-base font-semibold tracking-tight">{facts.orgName}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brick">Buenos negocios{facts.foundedYear ? ` · desde ${facts.foundedYear}` : ""}</p>
            </div>
          </div>
          <p className="text-right text-xs text-ink-2">
            Código
            <span className="block text-2xl font-semibold tabular-nums text-ink">{facts.code}</span>
          </p>
        </header>

        <section className="avoid-break mt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-2">{[facts.typeName, op ? OPERATION_LABEL[op as Operation] : null].filter(Boolean).join(" · ")}</p>
          <h1 className="mt-2 text-[34px]">{headline}</h1>
          {place ? <p className="mt-2 text-sm text-ink-2">{place}</p> : null}
          <ul className="mt-4 flex flex-wrap gap-2">
            {facts.operations.map((o) => (
              <li key={o.operation} className="rounded-full border border-ink px-3 py-1 text-sm font-semibold">
                {OPERATION_LABEL[o.operation as Operation]}: {formatPrice(o.amount, o.currency, o.priceHidden)}
              </li>
            ))}
          </ul>
        </section>

        {photos.length ? (
          <section className="avoid-break mt-6 grid grid-cols-4 gap-2" aria-label="Fotos">
            {photos.map((ph, i) => (
              <div key={ph.id} className={`relative overflow-hidden bg-paper-2 ${i === 0 ? "col-span-4 aspect-[16/9]" : "aspect-[4/3]"}`}>
                <Image src={ph.src!.src} alt={ph.alt || `Foto ${i + 1} de ${headline}`} fill unoptimized={!ph.src!.optimize} sizes={i === 0 ? "720px" : "180px"} className="object-cover" priority={i === 0} />
              </div>
            ))}
          </section>
        ) : null}

        {shown.length ? (
          <section className="avoid-break mt-6" aria-label="Datos principales">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-4 sm:grid-cols-4">
              {shown.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-2">{k}</dt>
                  <dd className="mt-0.5 text-base font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {facts.features.length ? (
          <section className="avoid-break mt-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-2">Características</h2>
            <p className="mt-2 text-sm leading-relaxed">{facts.features.join(" · ")}</p>
          </section>
        ) : null}

        {facts.description ? (
          <section className="mt-5">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-2">Descripción</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{facts.description}</p>
          </section>
        ) : null}

        <footer className="avoid-break mt-8 flex flex-wrap items-end justify-between gap-4 border-t border-ink pt-4 text-xs text-ink-2">
          <p>
            Ficha completa: <span className="font-semibold text-ink">{facts.publicUrl}</span>
          </p>
          <p>Datos publicados por {facts.orgName}. Sujetos a verificación y a cambios sin aviso.</p>
        </footer>
      </main>
    </>
  );
}
