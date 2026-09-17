import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";
import { AppError, invalid } from "@/server/errors";
import { TOUR_MAX_BYTES } from "@/server/tours/media";
import { processTourUpload, tourUploadMetaSchema } from "@/server/tours/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Subida de una panorámica (nueva escena) o del plano, por request (multipart: file, target, name).
 * Con storage S3 el editor usa la subida directa (intent/complete) y no pasa por acá.
 */
export const POST = apiRoute("tours.upload", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) throw new AppError("forbidden", "Origen no permitido");
  const actor = await getActor();
  if (actor.kind !== "staff") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > TOUR_MAX_BYTES + 64 * 1024) throw invalid("El archivo supera el tamaño máximo", { file: ["Archivo demasiado grande"] });
  const { id } = await ctx.params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw invalid("No recibimos el archivo", { file: ["Archivo inválido"] });
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw invalid("Elegí un archivo", { file: ["Elegí un archivo"] });
  if (file.size > TOUR_MAX_BYTES) throw invalid("El archivo supera el tamaño máximo", { file: ["Archivo demasiado grande"] });
  const meta = tourUploadMetaSchema.parse({ target: form.get("target"), name: form.get("name") ?? undefined, fileName: file.name });
  const result = await processTourUpload(getDb(), actor, id, new Uint8Array(await file.arrayBuffer()), meta);
  revalidatePublicSiteInRequest();
  return NextResponse.json({ ok: true, data: result }, { status: 201 });
});
