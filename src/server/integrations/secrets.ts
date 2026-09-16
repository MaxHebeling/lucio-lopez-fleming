/**
 * Credenciales rotativas cifradas (AES-256-GCM). La clave vive solo en INTEGRATIONS_ENCRYPTION_KEY
 * (32 bytes en base64 o hex). Sin clave no se guarda nada: la integración queda en awaiting_credentials.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Executor } from "../db";

export function encryptionKey(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export function encryptJson(value: unknown, key: Buffer): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptJson<T>(box: { ciphertext: string; iv: string; auth_tag: string }, key: Buffer): T {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.auth_tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(box.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export async function readCredentials<T>(db: Executor, integrationKey: string, key: Buffer, opts: { forUpdate?: boolean } = {}): Promise<{ value: T; accessExpiresAt: Date | null } | null> {
  let q = db.selectFrom("integration_credentials").select(["ciphertext", "iv", "auth_tag", "access_expires_at"]).where("integration_key", "=", integrationKey);
  if (opts.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) return null;
  return { value: decryptJson<T>(row, key), accessExpiresAt: row.access_expires_at ? new Date(row.access_expires_at) : null };
}

export async function writeCredentials(db: Executor, integrationKey: string, key: Buffer, value: unknown, accessExpiresAt: Date | null): Promise<void> {
  const box = encryptJson(value, key);
  await db
    .insertInto("integration_credentials")
    .values({ integration_key: integrationKey, ciphertext: box.ciphertext, iv: box.iv, auth_tag: box.authTag, access_expires_at: accessExpiresAt?.toISOString() ?? null })
    .onConflict((oc) =>
      oc.column("integration_key").doUpdateSet({ ciphertext: box.ciphertext, iv: box.iv, auth_tag: box.authTag, access_expires_at: accessExpiresAt?.toISOString() ?? null, rotated_at: new Date().toISOString() }),
    )
    .execute();
}
