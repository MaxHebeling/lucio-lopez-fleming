import { hash, verify } from "@node-rs/argon2";
import { invalid } from "../errors";

// argon2id con parámetros OWASP: 19 MiB, 2 iteraciones, 1 hilo.
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function passwordPolicyError(plain: string): string | null {
  if (typeof plain !== "string" || plain.length < 10) return "La contraseña debe tener al menos 10 caracteres";
  if (plain.length > 128) return "La contraseña es demasiado larga";
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) return "La contraseña debe combinar letras y números";
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  const err = passwordPolicyError(plain);
  if (err) throw invalid(err, { password: [err] });
  return hash(plain, OPTS);
}

export async function verifyPassword(hashValue: string | null, plain: string): Promise<boolean> {
  if (!hashValue) return false;
  try {
    return await verify(hashValue, plain);
  } catch {
    // Hash corrupto o con formato inválido: se trata como contraseña incorrecta.
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Hash de relleno para igualar tiempos cuando el email no existe (evita enumeración por tiempo). */
export function dummyHash(): Promise<string> {
  dummy ??= hash("sin-usuario-llf-2026", OPTS);
  return dummy;
}
