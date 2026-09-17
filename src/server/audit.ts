import type { Executor } from "./db";
import { actorUserId, auditActorKind, type Actor } from "./auth/actor";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

/** Registra una acción en audit_logs. Llamar DENTRO de la transacción del cambio. */
export async function audit(db: Executor, actor: Actor, input: AuditInput): Promise<void> {
  await db
    .insertInto("audit_logs")
    .values({
      actor_user_id: actorUserId(actor),
      actor_kind: auditActorKind(actor),
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      ip: actor.ip ?? null,
      request_id: actor.requestId ?? null,
      metadata: JSON.stringify({ ...(input.metadata ?? {}), ...(actor.kind === "system" ? { system: actor.name } : {}) }),
    })
    .execute();
}

/** Diferencia superficial entre dos objetos (solo claves cambiadas), para auditoría legible. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const bv = before[k];
    const av = after[k];
    if (JSON.stringify(normalize(bv)) !== JSON.stringify(normalize(av))) {
      b[k] = bv;
      a[k] = av as T[keyof T];
    }
  }
  return { before: b, after: a };
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return String(v);
  return v ?? null;
}
