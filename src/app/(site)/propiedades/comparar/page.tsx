import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight } from "lucide-react";
import { getDb } from "@/server/db";
import { loadComparison } from "@/server/sales/compare/service";
import { parseCompareCodes, type CompareRow } from "@/server/sales/compare/build";
import { getSiteFlag, siteAiConfigured } from "@/server/site/public-flags";
import { pageMetadata } from "@/components/site/seo";
import { Monogram } from "@/components/experience/Monogram";
import { CompareSummaryButton, CompareViewTracker } from "@/components/site/sales/CompareClient";
import "@/components/site/sales/sales.css";

/** Comparaciones: URL compartible pero NUNCA indexable (combinaciones arbitrarias de fichas). */
export const metadata: Metadata = pageMetadata({
  title: "Comparar propiedades",
  description: "Comparación de propiedades publicadas por Lucio López Fleming Inmobiliaria.",
  path: "/propiedades/comparar",
  noindex: true,
});

const GROUPS: Array<{ key: CompareRow["group"]; label: string }> = [
  { key: "precio", label: "Precio y condiciones" },
  { key: "espacios", label: "Espacios" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "caracteristicas", label: "Características" },
];

export default async function CompararPage({ searchParams }: PageProps<"/propiedades/comparar">) {
  await connection();
  if (!(await getSiteFlag("site_compare"))) notFound();
  const sp = await searchParams;
  const codes = parseCompareCodes(sp.codigos);
  const { comparison, missing } = await loadComparison(getDb(), codes);
  const withoutCode = (code: number) => {
    const rest = codes.filter((c) => c !== code);
    return rest.length ? `/propiedades/comparar?codigos=${rest.join(",")}` : "/propiedades";
  };

  return (
    <div className="container-site pb-28 pt-8 lg:pt-12">
      <nav aria-label="Migas de pan" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/propiedades" className="hover:underline">
              Propiedades
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page">Comparar</li>
        </ol>
      </nav>

      <header className="mt-6 border-b border-line pb-8">
        <p className="eyebrow text-brick">Comparador</p>
        <h1 className="display mt-4 text-[clamp(2.4rem,6vw,4.75rem)] leading-[0.98]">Comparar propiedades</h1>
        <p className="mt-3 max-w-2xl text-ink-2">Datos publicados de cada ficha, lado a lado. Las filas resaltadas son las que cambian entre una y otra.</p>
      </header>

      {missing.length ? (
        <p role="status" className="mt-6 rounded-[var(--radius-lg)] border border-line bg-white p-4 text-sm text-ink-2">
          {missing.length === 1 ? `La propiedad #${missing[0]} ya no está publicada y no se incluye.` : `Las propiedades ${missing.map((c) => `#${c}`).join(", ")} ya no están publicadas y no se incluyen.`}
        </p>
      ) : null}

      {!comparison ? (
        <div className="mt-10 rounded-[var(--radius-lg)] border border-line bg-white p-6 sm:p-10">
          <h2 className="display text-4xl">Elegí al menos dos propiedades.</h2>
          <p className="mt-3 max-w-xl text-ink-2">En el listado o en cada ficha tocá «Comparar» (hasta tres) y después «Comparar» en la barra de abajo.</p>
          <Link href="/propiedades" className="btn btn-ink mt-6">
            Ver propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
          </Link>
        </div>
      ) : (
        <>
          <CompareViewTracker codes={comparison.columns.map((c) => c.code)} />
          {comparison.notes.length ? (
            <section aria-labelledby="diferencias-title" className="mt-10 grid gap-6 lg:grid-cols-12">
              <h2 id="diferencias-title" className="display text-3xl lg:col-span-4">
                Lo que cambia entre estas propiedades
              </h2>
              <div className="lg:col-span-8">
                <ul className="grid gap-2 text-[1.0625rem] leading-relaxed text-ink-2">
                  {comparison.notes.map((n) => (
                    <li key={n} className="border-l-2 border-line pl-3">
                      {n}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-stone">Texto armado automáticamente con los datos publicados (no es una recomendación).</p>
                {siteAiConfigured() ? <CompareSummaryButton codes={comparison.columns.map((c) => c.code)} /> : null}
              </div>
            </section>
          ) : null}

          <div className="relative mt-10 max-w-full overflow-x-auto rounded-[var(--radius-lg)] border border-line" role="region" aria-label="Tabla comparativa (desplazable)" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">Comparación de {comparison.columns.length} propiedades publicadas</caption>
              <thead>
                <tr>
                  <td className="!bg-paper" />
                  {comparison.columns.map((c) => (
                    <th key={c.code} scope="col" className="min-w-[10.5rem] !bg-white align-top font-normal">
                      <div className="media-frame relative aspect-[4/3] overflow-hidden rounded-[var(--radius-md)] bg-paper-2">
                        {c.cover ? <Image src={c.cover.url} alt="" fill sizes="(min-width: 1024px) 22vw, 42vw" className="object-cover" /> : <Monogram className="absolute inset-0 m-auto h-10 w-auto text-line" />}
                      </div>
                      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">
                        {c.zoneLabel ?? c.typeName} · Cód. {c.code}
                      </p>
                      <Link href={`/propiedades/${c.slug}`} className="mt-1 block font-semibold leading-snug underline-offset-4 hover:underline">
                        {c.headline}
                      </Link>
                      <Link href={withoutCode(c.code)} className="mt-2 inline-flex min-h-9 items-center text-xs font-semibold text-ink-2 underline underline-offset-4">
                        Quitar<span className="sr-only"> la propiedad {c.code} de la comparación</span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              {GROUPS.map((g) => {
                const rows = comparison.rows.filter((r) => r.group === g.key);
                if (!rows.length) return null;
                return (
                  <tbody key={g.key}>
                    <tr className="compare-group">
                      <th scope="colgroup" colSpan={comparison.columns.length + 1}>
                        {g.label}
                      </th>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.key} data-differs={r.differs}>
                        <th scope="row">
                          {r.label}
                          {r.differs ? <span className="sr-only"> (distinto)</span> : null}
                        </th>
                        {r.values.map((v, i) => (
                          <td key={i} className={`tabular ${v === null ? "text-stone" : ""}`}>
                            {v ?? "Sin dato"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/propiedades" className="btn btn-outline">
              Seguir buscando
            </Link>
            <Link href="/contacto" className="btn btn-ink">
              Consultar por estas propiedades <ArrowRight aria-hidden className="btn-icon size-4" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
