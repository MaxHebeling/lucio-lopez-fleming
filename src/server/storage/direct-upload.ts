/**
 * Subida directa navegador → storage (S3) para archivos grandes.
 * 1) intent: el servidor autoriza y devuelve una URL PUT firmada (10 min) + un token HMAC atado a usuario, entidad y clave.
 * 2) el navegador sube a un prefijo temporal privado.
 * 3) complete: el servidor verifica el token, consulta el tamaño con HEAD (sin descargar), lee el objeto, lo valida/procesa
 *    como cualquier subida y borra el temporal.
 * El contenido nunca se confía por lo que declara el cliente: se revalida en el paso 3.
 */
import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { safeEqual } from "../auth/tokens";
import { invalid } from "../errors";
import { ALLOWED_UPLOADS, storage } from "./index";

type TokenPayload = { k: string; u: string; e: string; p: string; exp: number };

/** En producción el secreto es propio y obligatorio (no se reutiliza CRON_SECRET); en desarrollo se tolera el fallback. */
function secret(): string {
  const own = process.env.UPLOAD_SIGNING_SECRET;
  const s = process.env.APP_ENV === "production" ? own : (own ?? process.env.CRON_SECRET);
  if (!s || s.length < 32) throw new Error("Falta UPLOAD_SIGNING_SECRET (≥ 32 caracteres) para subidas directas");
  return s;
}

export function signUploadToken(payload: TokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyUploadToken(token: string, expect: { userId: string; entity: string; purpose: string }, now = Date.now()): TokenPayload {
  const [body, mac] = token.split(".");
  if (!body || !mac) throw invalid("Subida inválida");
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) throw invalid("Subida inválida");
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
  if (p.exp < now) throw invalid("La subida venció. Probá de nuevo.");
  if (p.u !== expect.userId || p.e !== expect.entity || p.p !== expect.purpose) throw invalid("Subida inválida");
  if (!/^uploads\/tmp\/[a-z0-9/_-]+\.[a-z0-9]+$/i.test(p.k)) throw invalid("Subida inválida");
  return p;
}

export async function createUploadIntent(input: { userId: string; entity: string; purpose: string; contentType: string; size: number }): Promise<
  { mode: "direct"; uploadUrl: string; token: string } | { mode: "proxy" }
> {
  const allowed = ALLOWED_UPLOADS[input.contentType];
  if (!allowed) throw invalid("Formato no admitido");
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > allowed.maxBytes) throw invalid("El archivo supera el tamaño máximo");
  const driver = storage();
  const key = `uploads/tmp/${input.purpose}/${randomUUID()}.${allowed.ext}`;
  const url = await driver.presignPut(driver.bucketFor("private"), key, input.contentType, 600);
  if (!url) return { mode: "proxy" };
  return { mode: "direct", uploadUrl: url, token: signUploadToken({ k: key, u: input.userId, e: input.entity, p: input.purpose, exp: Date.now() + 15 * 60_000 }) };
}

/** Verifica tamaño (HEAD), lee el objeto subido, lo entrega a `consume` y borra el temporal pase lo que pase. */
export async function consumeDirectUpload<T>(key: string, maxBytes: number, consume: (bytes: Uint8Array) => Promise<T>): Promise<T> {
  const driver = storage();
  const bucket = driver.bucketFor("private");
  try {
    // Tamaño primero (HEAD): nunca se descarga a memoria un objeto más grande que el máximo.
    const meta = await driver.head(bucket, key);
    if (!meta) throw invalid("No recibimos el archivo. Probá de nuevo.");
    if (meta.size > maxBytes) throw invalid("El archivo supera el tamaño máximo");
    const bytes = await driver.get(bucket, key);
    // Revalida con los bytes reales por si el objeto cambió entre HEAD y GET.
    if (bytes.byteLength > maxBytes) throw invalid("El archivo supera el tamaño máximo");
    return await consume(bytes);
  } finally {
    await driver.remove(bucket, key).catch(() => undefined);
  }
}
