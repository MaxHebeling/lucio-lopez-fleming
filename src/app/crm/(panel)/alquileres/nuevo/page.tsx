import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { propertiesForContract } from "@/server/rentals/queries";
import { EmptyState, PageHeader } from "@/components/ui";
import { ContractForm } from "./contract-form";

export const metadata: Metadata = { title: "Nuevo contrato" };

export default async function NewContractPage({ searchParams }: PageProps<"/crm/alquileres/nuevo">) {
  const actor = await requireStaffPage("rentals.manage");
  const sp = await searchParams;
  const properties = await propertiesForContract(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Nuevo contrato"
        description={
          <Link href="/crm/alquileres" className="underline underline-offset-4">
            ← Volver a contratos
          </Link>
        }
      />
      {properties.length === 0 ? (
        <EmptyState title="No hay propiedades cargadas" description="Primero cargá la propiedad en el módulo de propiedades." />
      ) : (
        <ContractForm properties={properties} initialPropertyId={typeof sp.propiedad === "string" ? sp.propiedad : undefined} />
      )}
    </>
  );
}
