import type { StorageDriver, Visibility } from "../../src/server/storage";

/** Storage en memoria para tests (mismo contrato que local/s3). */
export class MemoryStorage implements StorageDriver {
  readonly name = "local" as const;
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  bucketFor(v: Visibility) {
    return v === "public" ? "public" : "private";
  }
  async put(bucket: string, key: string, body: Uint8Array, contentType: string) {
    this.objects.set(`${bucket}/${key}`, { body, contentType });
  }
  async get(bucket: string, key: string) {
    const o = this.objects.get(`${bucket}/${key}`);
    if (!o) throw new Error("no existe");
    return o.body;
  }
  async remove(bucket: string, key: string) {
    this.objects.delete(`${bucket}/${key}`);
  }
  /** Con `direct` simula un bucket S3 que acepta subidas firmadas. */
  direct = false;
  async presignPut(bucket: string, key: string) {
    return this.direct ? `https://storage.test/${bucket}/${key}?firmado=1` : null;
  }
  directUploadOrigin() {
    return this.direct ? "https://storage.test" : null;
  }
  async url(_b: string, _k: string, _v: Visibility, fileId: string) {
    return `/api/files/${fileId}`;
  }
}
