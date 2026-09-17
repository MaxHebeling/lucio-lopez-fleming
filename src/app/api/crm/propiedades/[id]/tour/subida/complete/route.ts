import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";
import { AppError } from "@/server/errors";
import { consumeDirectUpload, verifyUploadToken } from "@/server/storage/direct-upload";
import { TOUR_MAX_BYTES } from "@/server/tours/media";
import { processTourUpload, tourUploadMetaSchema } from "@/server/tours/upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = tourUploadMetaSchema.extend({ token: z.string().max(2000) });

/** Paso 3 de la subida directa: valida el token, procesa el archivo (mismas validaciones) y borra el temporal. */
export const POST = apiRoute("tours.upload.complete", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) throw new AppError("forbidden", "Origen no permitido");
  const actor = await getActor();
  if (actor.kind !== "staff") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  const { id } = await ctx.params;
  const input = body.parse(await req.json());
  const token = verifyUploadToken(input.token, { userId: actor.userId, entity: id, purpose: "virtual-tour" });
  const result = await consumeDirectUpload(token.k, TOUR_MAX_BYTES, (bytes) => processTourUpload(getDb(), actor, id, bytes, { target: input.target, name: input.name, fileName: input.fileName }));
  revalidatePublicSiteInRequest();
  return NextResponse.json({ ok: true, data: result }, { status: 201 });
});
