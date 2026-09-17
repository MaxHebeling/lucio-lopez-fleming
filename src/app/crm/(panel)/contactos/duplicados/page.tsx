import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { listDuplicateCandidates } from "@/server/contacts/queries";
import { Badge, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { DUPLICATE_REASON_LABEL } from "@/components/crm/labels";

export const metadata: Metadata = { title: "Duplicados" };

export default async function DuplicatesPage() {
  const actor = await requireStaffPage("contacts.merge");
  const rows = await listDuplicateCandidates(getDb(), actor);
  return (
    <>
      <nav aria-label="Migas" className="mb-2 text-sm">
        <Link href="/crm/contactos" className="text-stone underline-offset-4 hover:underline">
          ← Contactos
        </Link>
      </nav>
      <PageHeader title="Posibles duplicados" description="Nada se fusiona solo: compará los dos contactos y decidí." />
      {rows.length === 0 ? (
        <EmptyState title="No hay duplicados para revisar" description="Cuando una carga coincide por email o teléfono con otro contacto, aparece acá." />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-white">
          {rows.map((d) => (
            <li key={d.id}>
              <Link href={`/crm/contactos/duplicados/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-paper">
                <span className="min-w-0 font-semibold">
                  {d.a_name} <span className="font-normal text-stone">y</span> {d.b_name}
                </span>
                <span className="flex items-center gap-2 text-xs text-stone">
                  <Badge tone="warning">{DUPLICATE_REASON_LABEL[d.reason] ?? d.reason}</Badge>
                  {formatDate(d.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
