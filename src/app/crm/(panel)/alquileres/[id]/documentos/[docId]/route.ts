import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { getActor } from "@/server/next/context";
import { AppError } from "@/server/errors";
import { errorFields, log } from "@/server/log";
import { fileDownloadResponse, staffContractDocument } from "@/server/rentals/documents";

export const dynamic = "force-dynamic";

/** Descarga autorizada de un documento privado del contrato (equipo con rentals.read). */
export async function GET(req: NextRequest, ctx: RouteContext<"/crm/alquileres/[id]/documentos/[docId]">) {
  const { id, docId } = await ctx.params;
  const actor = await getActor();
  if (actor.kind !== "staff") return NextResponse.redirect(new URL("/crm/login", req.url), 303);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(docId)) return new NextResponse("No encontrado", { status: 404 });
  try {
    const doc = await staffContractDocument(getDb(), actor, id, docId);
    const ext = doc.content_type === "application/pdf" ? "pdf" : doc.content_type.split("/")[1];
    return await fileDownloadResponse(doc, `${doc.title}.${ext}`);
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.status });
    log.error("rentals.document_download_failed", { documentId: docId, requestId: actor.requestId, ...errorFields(e) });
    return new NextResponse("No se pudo descargar el documento", { status: 500 });
  }
}
