import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { getActor } from "@/server/next/context";
import { AppError, toPublicError } from "@/server/errors";
import { errorFields, log } from "@/server/log";
import { MAX_DOCUMENT_BYTES, uploadContractDocument } from "@/server/rentals/documents";

/** Subida de documentos privados del contrato (multipart). Autoriza el servicio (rentals.manage). */
export async function POST(req: NextRequest, ctx: RouteContext<"/crm/alquileres/[id]/documentos">) {
  const { id } = await ctx.params;
  const back = (params: Record<string, string>) => {
    const url = new URL(`/crm/alquileres/${encodeURIComponent(id)}`, req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.hash = "documentos";
    return NextResponse.redirect(url, 303);
  };
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return NextResponse.json({ error: "origin" }, { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await getActor();
  if (actor.kind !== "staff") return NextResponse.redirect(new URL("/crm/login", req.url), 303);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_DOCUMENT_BYTES + 64_000) return back({ documento_error: "El archivo supera los 4 MB" });
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return back({ documento_error: "Elegí un archivo" });
    if (file.size > MAX_DOCUMENT_BYTES) return back({ documento_error: "El archivo supera los 4 MB" });
    await uploadContractDocument(getDb(), actor, id, {
      title: fd.get("title"),
      kind: fd.get("kind"),
      visibleToOwner: fd.get("visibleToOwner"),
      bytes: new Uint8Array(await file.arrayBuffer()),
      originalName: file.name,
    });
    return back({ documento: "subido" });
  } catch (e) {
    if (!(e instanceof AppError)) log.error("rentals.document_upload_failed", { contractId: id, requestId: actor.requestId, ...errorFields(e) });
    const msg = e instanceof AppError ? e.message : (e as { name?: string }).name === "ZodError" ? "Revisá título y tipo del documento" : toPublicError(e).message;
    return back({ documento_error: msg.slice(0, 200) });
  }
}
