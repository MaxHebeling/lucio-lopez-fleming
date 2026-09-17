import type { Metadata } from "next";
import { requireStaffPage } from "@/server/next/context";
import { can } from "@/server/auth/actor";
import { getDb } from "@/server/db";
import { propertyFormOptions } from "@/server/properties/queries";
import { PageHeader } from "@/components/ui";
import { PropertyForm } from "../_components/property-form";

export const metadata: Metadata = { title: "Nueva propiedad" };

export default async function NewPropertyPage() {
  const actor = await requireStaffPage("properties.create");
  const options = await propertyFormOptions(getDb(), actor);
  return (
    <>
      <PageHeader title="Nueva propiedad" description="Se crea como borrador: para publicarla necesita estado Disponible, ubicación, al menos una foto y precio." />
      <PropertyForm mode="create" options={options} canCreateLocation={can(actor, "properties.update")} />
    </>
  );
}
