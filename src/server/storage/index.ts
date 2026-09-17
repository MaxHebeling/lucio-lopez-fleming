/**
 * Object storage. Los bytes nunca van a SQL: la tabla `files` guarda metadatos y la clave.
 * - local: disco (solo desarrollo/tests); privados se sirven por /api/files/[id] con autorización.
 * - s3: cualquier S3 compatible (Supabase Storage, Cloudflare R2, AWS). Privados → URL firmada de corta vida.
 */
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AwsClient } from "aws4fetch";
import { RetryableError, isRetryableStatus, retry, withTimeout } from "../resilience";

export type Visibility = "public" | "private";

export interface StorageDriver {
  readonly name: "local" | "s3";
  bucketFor(visibility: Visibility): string;
  put(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(bucket: string, key: string): Promise<Uint8Array>;
  /** Metadatos sin descargar el contenido. null si el objeto no existe. */
  head(bucket: string, key: string): Promise<{ size: number; contentType: string | null } | null>;
  remove(bucket: string, key: string): Promise<void>;
  /** URL para leer. Públicos: estable. Privados: firmada y temporal (s3) o ruta autorizada (local). */
  url(bucket: string, key: string, visibility: Visibility, fileId: string, expiresSeconds?: number): Promise<string>;
  /** URL firmada para que el navegador suba directo (evita el límite de body de la plataforma). null = no soportado. */
  presignPut(bucket: string, key: string, contentType: string, expiresSeconds?: number): Promise<string | null>;
  /** Origen (scheme+host) al que sube el navegador, para la CSP. null si no hay subida directa. */
  directUploadOrigin(): string | null;
}

const LOCAL_ROOT = resolve(process.cwd(), ".storage");

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9/_.-]{1,512}$/.test(key) || key.includes("..")) throw new Error("Clave de storage inválida");
  return key;
}

class LocalDriver implements StorageDriver {
  readonly name = "local" as const;
  bucketFor(v: Visibility) {
    return v === "public" ? "public" : "private";
  }
  private path(bucket: string, key: string) {
    return resolve(LOCAL_ROOT, bucket, safeKey(key));
  }
  async put(bucket: string, key: string, body: Uint8Array) {
    const p = this.path(bucket, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(bucket: string, key: string) {
    return new Uint8Array(await readFile(this.path(bucket, key)));
  }
  async head(bucket: string, key: string) {
    try {
      const st = await stat(this.path(bucket, key));
      return st.isFile() ? { size: st.size, contentType: null } : null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async remove(bucket: string, key: string) {
    await rm(this.path(bucket, key), { force: true });
  }
  async presignPut() {
    return null;
  }
  directUploadOrigin() {
    return null;
  }
  async url(_bucket: string, _key: string, _v: Visibility, fileId: string) {
    return `/api/files/${fileId}`;
  }
}

class S3Driver implements StorageDriver {
  readonly name = "s3" as const;
  private client: AwsClient;
  constructor(
    private endpoint: string,
    private publicBucket: string,
    private privateBucket: string,
    private publicBaseUrl: string | undefined,
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
  }
  bucketFor(v: Visibility) {
    return v === "public" ? this.publicBucket : this.privateBucket;
  }
  private objectUrl(bucket: string, key: string) {
    return `${this.endpoint.replace(/\/$/, "")}/${bucket}/${safeKey(key).split("/").map(encodeURIComponent).join("/")}`;
  }
  private async send(method: string, url: string, init: RequestInit = {}) {
    return retry(
      () =>
        withTimeout(20_000, async (signal) => {
          const res = await this.client.fetch(url, { method, ...init, signal });
          if (!res.ok && res.status !== 404) {
            const msg = `S3 ${method} ${res.status}`;
            if (isRetryableStatus(res.status)) throw new RetryableError(msg, res.status);
            throw Object.assign(new Error(msg), { status: res.status });
          }
          return res;
        }),
      { attempts: 3 },
    );
  }
  async put(bucket: string, key: string, body: Uint8Array, contentType: string) {
    await this.send("PUT", this.objectUrl(bucket, key), { body: body as unknown as BodyInit, headers: { "content-type": contentType } });
  }
  async get(bucket: string, key: string) {
    const res = await this.send("GET", this.objectUrl(bucket, key));
    if (res.status === 404) throw new Error("Archivo inexistente en storage");
    return new Uint8Array(await res.arrayBuffer());
  }
  async head(bucket: string, key: string) {
    const res = await this.send("HEAD", this.objectUrl(bucket, key));
    if (res.status === 404) return null;
    const size = Number(res.headers.get("content-length"));
    if (!Number.isFinite(size) || size < 0) throw new Error("S3 HEAD sin content-length");
    return { size, contentType: res.headers.get("content-type") };
  }
  async remove(bucket: string, key: string) {
    await this.send("DELETE", this.objectUrl(bucket, key));
  }
  async presignPut(bucket: string, key: string, contentType: string, expiresSeconds = 600) {
    const u = new URL(this.objectUrl(bucket, key));
    u.searchParams.set("X-Amz-Expires", String(Math.min(expiresSeconds, 3600)));
    const signed = await this.client.sign(u.toString(), { method: "PUT", headers: { "content-type": contentType }, aws: { signQuery: true, allHeaders: true } });
    return signed.url;
  }
  directUploadOrigin() {
    return new URL(this.endpoint).origin;
  }
  async url(bucket: string, key: string, visibility: Visibility, _fileId: string, expiresSeconds = 300) {
    if (visibility === "public" && this.publicBaseUrl) return `${this.publicBaseUrl.replace(/\/$/, "")}/${safeKey(key)}`;
    const u = new URL(this.objectUrl(bucket, key));
    u.searchParams.set("X-Amz-Expires", String(Math.min(expiresSeconds, 3600)));
    const signed = await this.client.sign(u.toString(), { method: "GET", aws: { signQuery: true } });
    return signed.url;
  }
}

let driver: StorageDriver | undefined;

export function storage(): StorageDriver {
  if (driver) return driver;
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "s3") {
    const { STORAGE_ENDPOINT, STORAGE_BUCKET_PUBLIC, STORAGE_BUCKET_PRIVATE, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY } = process.env;
    if (!STORAGE_ENDPOINT || !STORAGE_BUCKET_PUBLIC || !STORAGE_BUCKET_PRIVATE || !STORAGE_ACCESS_KEY || !STORAGE_SECRET_KEY)
      throw new Error("STORAGE_DRIVER=s3 requiere STORAGE_ENDPOINT, STORAGE_BUCKET_PUBLIC, STORAGE_BUCKET_PRIVATE, STORAGE_ACCESS_KEY y STORAGE_SECRET_KEY");
    driver = new S3Driver(STORAGE_ENDPOINT, STORAGE_BUCKET_PUBLIC, STORAGE_BUCKET_PRIVATE, process.env.STORAGE_PUBLIC_BASE_URL, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, process.env.STORAGE_REGION ?? "auto");
  } else {
    if (process.env.VERCEL) throw new Error("En Vercel el storage local no persiste: configurar STORAGE_DRIVER=s3");
    driver = new LocalDriver();
  }
  return driver;
}

export function setStorageForTests(d: StorageDriver | undefined): void {
  driver = d;
}

export function newStorageKey(prefix: string, ext: string): string {
  const d = new Date();
  return `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin"}`;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export const ALLOWED_UPLOADS: Record<string, { ext: string; maxBytes: number; kind: "image" | "video" | "document" }> = {
  "image/jpeg": { ext: "jpg", maxBytes: 15 * 1024 * 1024, kind: "image" },
  "image/png": { ext: "png", maxBytes: 15 * 1024 * 1024, kind: "image" },
  "image/webp": { ext: "webp", maxBytes: 15 * 1024 * 1024, kind: "image" },
  "image/avif": { ext: "avif", maxBytes: 15 * 1024 * 1024, kind: "image" },
  "video/mp4": { ext: "mp4", maxBytes: 200 * 1024 * 1024, kind: "video" },
  "application/pdf": { ext: "pdf", maxBytes: 25 * 1024 * 1024, kind: "document" },
};

/** Verifica la firma real del archivo (no confiar en el content-type declarado por el cliente). */
export function sniffContentType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  const ftyp = String.fromCharCode(...b.slice(4, 12));
  if (ftyp.startsWith("ftypavif")) return "image/avif";
  if (ftyp.startsWith("ftyp")) return "video/mp4";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}
