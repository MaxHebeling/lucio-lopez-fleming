import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getPropertyDetail, propertyFormOptions } from "@/server/properties/queries";
import { Alert, PageHeader } from "@/components/ui";
import { PropertyForm } from "../../_components/property-form";

export const metadata: Metadata = { title: "Editar propiedad" };

export default async function EditPropertyPage({ params }: PageProps<"/crm/propiedades/[id]/editar">) {
  const actor = await requireStaffPage("properties.update");
  const { id } = await params;
  const db = getDb();
  const detail = await getPropertyDetail(db, actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const options = await propertyFormOptions(db, actor);
  const p = detail.property;
  return (
    <>
      <PageHeader title={`Editar #${p.code}`} description={p.title} />
      {p.source === "adinco_import" ? (
        <div className="mb-4">
          <Alert tone="info">Esta propiedad vino de la migración: los campos que edites quedan protegidos y una reimportación no los pisa.</Alert>
        </div>
      ) : null}
      <PropertyForm
        mode="edit"
        propertyId={p.id}
        options={options}
        initialChain={detail.location}
        canCreateLocation
        initial={{ ...p, featureKeys: detail.features.map((f) => f.key) }}
      />
    </>
  );
}
