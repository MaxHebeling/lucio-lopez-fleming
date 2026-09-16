/**
 * Registro de acciones de automatización. Cada acción DEBE ser idempotente usando `dedupeBase`
 * (único por automatización + evento): si el job se reintenta, no duplica tareas ni avisos.
 */
import type { Database } from "../db";
import type { SystemActor } from "../auth/actor";

export type AutomationEvent = {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  actorUserId: string | null;
};

export type ActionContext = {
  db: Database;
  actor: SystemActor;
  event: AutomationEvent;
  automationKey: string;
  dedupeBase: string;
};

export type ActionHandler = (params: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>;

const actions = new Map<string, ActionHandler>();

export function registerAction(type: string, handler: ActionHandler): void {
  actions.set(type, handler);
}

export function getAction(type: string): ActionHandler | undefined {
  return actions.get(type);
}

export function registeredActionTypes(): string[] {
  return [...actions.keys()].sort();
}
