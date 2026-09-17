import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { revalidatePublicSiteInRequest } from "@/server/site/revalidate";
import { AppError } from "@/server/errors";
import { addPropertyImage, MAX_IMAGE_BYTES } from "@/server/properties/media";
import { consumeDirectUpload, verifyUploadToken } from "@/server/storage/direct-upload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ token: z.string().max(2000), kind: z.enum(["image", "floor_plan"]).default("image"), altText: z.string().max(300).nullable().optional(), name: z.string().max(200).optional() });

/** Paso 3 de la subida directa: valida el token, procesa la foto (misma validación que la subida normal) y borra el temporal. */
export const POST = apiRoute("properties.media.complete", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) throw new AppError("forbidden", "Origen no permitido");
  const actor = await getActor();
  if (actor.kind !== "staff") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  const { id } = await ctx.params;
  const input = body.parse(await req.json());
  const token = verifyUploadToken(input.token, { userId: actor.userId, entity: id, purpose: "property-media" });
  const result = await consumeDirectUpload(token.k, MAX_IMAGE_BYTES, (bytes) =>
    addPropertyImage(getDb(), actor, id, bytes, { kind: input.kind, altText: input.altText ?? null, originalName: input.name ?? null }),
  );
  revalidatePublicSiteInRequest();
  return NextResponse.json({ ok: true, data: result }, { status: 201 });
});
