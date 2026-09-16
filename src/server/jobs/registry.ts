import type { Database } from "../db";
import type { SystemActor } from "../auth/actor";

export type JobContext = {
  db: Database;
  actor: SystemActor;
  jobId: string;
  attempt: number;
  signal: AbortSignal;
};

/** Un handler debe ser idempotente: puede ejecutarse más de una vez para el mismo payload. */
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

/** Error que no tiene sentido reintentar (datos inválidos, entidad borrada, etc.). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()].sort();
}
