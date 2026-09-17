import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/server/next/context";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { getTourEditor } from "@/server/tours/queries";
import { whatsappHref } from "@/server/properties/public-helpers";
import { siteUrl } from "@/components/site/seo";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { TourEditor } from "./tour-editor";

export const metadata: Metadata = { title: "Tour virtual" };

export default async function TourEditorPage({ params }: PageProps<"/crm/propiedades/[id]/tour">) {
  const actor = await requireStaffPage("properties.read");
  const { id } = await params;
  const data = await getTourEditor(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const p = data.property;
  const status = data.tour ? (data.tour.status === "published" ? "PUBLICADO" : "BORRADOR") : "SIN TOUR";
  return (
    <>
      <nav aria-label="Migas de pan" className="mb-2 text-sm text-stone">
        <Link href="/crm/propiedades" className="underline-offset-4 hover:underline">
          Propiedades
        </Link>{" "}
        /{" "}
        <Link href={`/crm/propiedades/${p.id}`} className="underline-offset-4 hover:underline">
          #{p.code}
        </Link>{" "}
        / Tour virtual
      </nav>
      <PageHeader
        title="Tour virtual 360°"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">#{p.code}</span>
            <span>{p.title}</span>
            <Badge tone={status === "PUBLICADO" ? "success" : status === "BORRADOR" ? "warning" : "neutral"}>{status}</Badge>
            {p.is_demo ? <Badge tone="warning">DEMO</Badge> : null}
          </span>
        }
      />
      <div className="mb-4 flex flex-col gap-2">
        {p.is_demo ? (
          <Alert tone="warning">
            Es el tour de la propiedad DEMO: se edita desde <code>public/tours/demo/residencia/manifest.json</code> y se carga con <code>pnpm seed:demo-tour</code>. Acá solo se puede
            previsualizar.
          </Alert>
        ) : null}
        {data.tour?.status === "published" && !p.is_published && !p.is_demo ? <Alert tone="warning">El tour está publicado, pero la propiedad no: no se ve en el sitio hasta publicarla.</Alert> : null}
        {!data.storage.configured && data.permissions.canEdit ? <Alert tone="warning">{data.storage.message}</Alert> : null}
      </div>
      <TourEditor
        data={data}
        shareUrl={p.is_demo ? `${siteUrl()}/demo/tour-360` : `${siteUrl()}/propiedades/${p.slug}`}
        whatsappUrl={whatsappHref(process.env.SITE_WHATSAPP_E164 ?? null, `Hola, estoy viendo el tour 360° de la propiedad Cód. ${p.code}`)}
      />
    </>
  );
}
