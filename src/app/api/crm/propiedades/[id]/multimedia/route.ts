import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { AppError, invalid } from "@/server/errors";
import { addPropertyImage, MAX_IMAGE_BYTES } from "@/server/properties/media";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Subida de UNA foto por request (multipart/form-data: file, kind, altText).
 * Route Handler y no Server Action: las acciones tienen un límite de 1 MB de body.
 * La autorización real está en `addPropertyImage` (properties.manage_media).
 */
export const POST = apiRoute("properties.media.upload", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  // CSRF: la cookie de sesión es SameSite=Lax, pero además exigimos mismo origen.
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) throw new AppError("forbidden", "Origen no permitido");
  const actor = await getActor();
  if (actor.kind !== "staff") throw new AppError("unauthenticated", "Iniciá sesión para continuar");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES + 64 * 1024) throw invalid("La foto supera el tamaño máximo", { file: ["Archivo demasiado grande"] });

  const { id } = await ctx.params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw invalid("No recibimos el archivo", { file: ["Archivo inválido"] });
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw invalid("Elegí una foto", { file: ["Elegí una foto"] });
  if (file.size > MAX_IMAGE_BYTES) throw invalid("La foto supera el tamaño máximo", { file: ["Archivo demasiado grande"] });
  const kind = form.get("kind") === "floor_plan" ? "floor_plan" : "image";
  const altText = typeof form.get("altText") === "string" ? String(form.get("altText")) : null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await addPropertyImage(getDb(), actor, id, bytes, { kind, altText, originalName: file.name });
  return NextResponse.json({ ok: true, data: result }, { status: 201 });
});
