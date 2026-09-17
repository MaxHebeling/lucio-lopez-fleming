import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { AppError } from "@/server/errors";
import { requirePermission } from "@/server/auth/actor";
import { createUploadIntent } from "@/server/storage/direct-upload";
import { assertTourStorage } from "@/server/tours/media";
import { tourIdForProperty } from "@/server/tours/upload";

export const dynamic = "force-dynamic";

const body = z.object({ contentType: z.string().max(100), size: z.number().int().positive() });

/** Paso 1 de la subida directa de panorámicas y planos (ver src/server/storage/direct-upload.ts). */
export const POST = apiRoute("tours.upload.intent", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) throw new AppError("forbidden", "Origen no permitido");
  const actor = await getActor();
  if (actor.kind !== "staff") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  requirePermission(actor, "properties.manage_media");
  assertTourStorage();
  const { id } = await ctx.params;
  await tourIdForProperty(getDb(), id);
  const input = body.parse(await req.json());
  const intent = await createUploadIntent({ userId: actor.userId, entity: id, purpose: "virtual-tour", contentType: input.contentType, size: input.size });
  return NextResponse.json({ ok: true, data: intent });
});
