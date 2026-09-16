import { requireOwnerPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { listOwnerDocuments } from "@/server/owners/portal";
import { DOCUMENT_KIND_LABEL } from "@/server/rentals/schema";
import { formatDate } from "@/components/ui";
import { Empty, Section } from "../ui";

const PROPERTY_DOC_KIND: Record<string, string> = { deed: "Escritura", plan: "Plano", tax: "Impuestos", authorization: "Autorización", appraisal: "Tasación", contract: "Contrato", other: "Otro" };

export default async function OwnerDocumentsPage() {
  const actor = await requireOwnerPage();
  const docs = await listOwnerDocuments(getDb(), actor);
  return (
    <Section title="Documentos">
      {docs.length === 0 ? (
        <Empty>La inmobiliaria todavía no compartió documentos con vos.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-lg)] border border-line bg-white">
          {docs.map((d) => (
            <li key={`${d.source}-${d.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>
                <span className="block font-semibold">{d.title}</span>
                <span className="block text-xs text-stone">
                  {(d.source === "contrato" ? DOCUMENT_KIND_LABEL[d.kind] : PROPERTY_DOC_KIND[d.kind]) ?? d.kind} · {d.source === "contrato" ? `Contrato ${d.parent_title}` : d.parent_title} · {formatDate(d.created_at)}
                </span>
              </span>
              <a href={`/propietarios/documentos/${d.source}/${d.id}`} className="font-semibold underline underline-offset-4">
                Descargar
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
