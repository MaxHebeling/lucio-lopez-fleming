import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { apiRoute } from "@/server/next/api";
import { clientIpFromHeaders } from "@/server/auth/ip";
import { AppError } from "@/server/errors";
import { OWNER_PHOTO_MAX_BYTES, uploadOwnerPhoto } from "@/server/site/owner-capture";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Foto opcional de «Quiero vender mi propiedad» (una por pedido). Solo mismo origen, flag `owner_capture_photos` y
 * storage S3. Devuelve un token que el formulario envía con el lead; la foto nunca es pública.
 */
export const POST = apiRoute("site.owner_photo", async (req: NextRequest) => {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return json({ error: { message: "Origen no permitido" } }, 403);
  if (Number(req.headers.get("content-length") ?? 0) > OWNER_PHOTO_MAX_BYTES + 64_000) return json({ error: { message: "La foto supera 4 MB" } }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: { message: "Elegí una foto" } }, 400);
  try {
    const r = await uploadOwnerPhoto(getDb(), new Uint8Array(await file.arrayBuffer()), { ip: clientIpFromHeaders((n) => req.headers.get(n)) });
    return json({ data: r });
  } catch (e) {
    if (e instanceof AppError) return json({ error: { message: e.message } }, e.code === "rate_limited" ? 429 : e.code === "unavailable" ? 404 : 400);
    throw e;
  }
});
