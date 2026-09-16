import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { getActor } from "@/server/next/context";
import { AppError } from "@/server/errors";
import { errorFields, log } from "@/server/log";
import { ownerDocumentFile } from "@/server/owners/portal";
import { fileDownloadResponse } from "@/server/rentals/documents";

export const dynamic = "force-dynamic";

/** Descarga de un documento marcado como visible, solo si pertenece a una propiedad o contrato del propietario. */
export async function GET(req: NextRequest, ctx: RouteContext<"/propietarios/documentos/[source]/[id]">) {
  const { source, id } = await ctx.params;
  const actor = await getActor();
  if (actor.kind !== "owner") return NextResponse.redirect(new URL("/propietarios/login", req.url), 303);
  if (source !== "propiedad" && source !== "contrato") return new NextResponse("No encontrado", { status: 404 });
  try {
    const file = await ownerDocumentFile(getDb(), actor, source, id);
    if (!file) return new NextResponse("No encontrado", { status: 404 });
    const ext = file.content_type === "application/pdf" ? "pdf" : file.content_type.split("/")[1];
    return await fileDownloadResponse(file, `${file.title}.${ext}`);
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.status });
    log.error("owners.document_download_failed", { documentId: id, requestId: actor.requestId, ...errorFields(e) });
    return new NextResponse("No se pudo descargar el documento", { status: 500 });
  }
}
