import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { getActor } from "@/server/next/context";
import { AppError, notFound } from "@/server/errors";
import { requirePermission } from "@/server/auth/actor";
import { createUploadIntent } from "@/server/storage/direct-upload";

export const dynamic = "force-dynamic";

const body = z.object({ contentType: z.string().max(100), size: z.number().int().positive() });

/** Paso 1 de la subida directa de fotos (ver src/server/storage/direct-upload.ts). */
export const POST = apiRoute("properties.media.intent", async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const origin = req.headers.get("origin");
  if (!origin || origin !== req.nextUrl.origin) throw new AppError("forbidden", "Origen no permitido");
  const actor = await getActor();
  if (actor.kind !== "staff") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  requirePermission(actor, "properties.manage_media");
  const { id } = await ctx.params;
  const exists = await getDb().selectFrom("properties").select("id").where("id", "=", id).where("deleted_at", "is", null).executeTakeFirst();
  if (!exists) throw notFound("Propiedad");
  const input = body.parse(await req.json());
  const intent = await createUploadIntent({ userId: actor.userId, entity: id, purpose: "property-media", contentType: input.contentType, size: input.size });
  return NextResponse.json({ ok: true, data: intent });
});
