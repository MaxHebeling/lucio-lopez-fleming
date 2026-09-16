import { requireStaffPage } from "@/server/next/context";
import { PageHeader } from "@/components/ui";

export default async function Dashboard() {
  const actor = await requireStaffPage("dashboard.read");
  return <PageHeader title="Tablero" description={`Hola, ${actor.fullName}.`} />;
}
