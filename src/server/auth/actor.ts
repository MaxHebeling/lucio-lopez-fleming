/**
 * Actor = quién ejecuta una operación. Toda función de servicio recibe un Actor y autoriza en el servidor:
 * ocultar un botón no es seguridad.
 */
import { forbidden, AppError } from "../errors";

type Common = { organizationId: string; requestId?: string; ip?: string | null };

export type StaffActor = Common & {
  kind: "staff";
  userId: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: ReadonlySet<string>;
  branchIds: string[];
  sessionId?: string;
  mustChangePassword?: boolean;
};

export type OwnerActor = Common & {
  kind: "owner";
  userId: string;
  email: string;
  fullName: string;
  contactId: string;
  sessionId?: string;
  mustChangePassword?: boolean;
};

export type SystemActor = Common & { kind: "system"; name: string };
export type AnonymousActor = Common & { kind: "anonymous" };
export type Actor = StaffActor | OwnerActor | SystemActor | AnonymousActor;

export function can(actor: Actor, permission: string): boolean {
  if (actor.kind === "system") return true;
  if (actor.kind !== "staff") return false;
  return actor.roles.includes("super_admin") || actor.permissions.has(permission);
}

export function canAny(actor: Actor, permissions: string[]): boolean {
  return permissions.some((p) => can(actor, p));
}

export function requirePermission(actor: Actor, permission: string): void {
  if (actor.kind === "anonymous") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  if (!can(actor, permission)) throw forbidden();
}

export function requireStaff(actor: Actor): asserts actor is StaffActor {
  if (actor.kind === "anonymous") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  if (actor.kind !== "staff") throw forbidden();
}

export function requireOwner(actor: Actor): asserts actor is OwnerActor {
  if (actor.kind === "anonymous") throw new AppError("unauthenticated", "Iniciá sesión para continuar");
  if (actor.kind !== "owner") throw forbidden();
}

/** Id de usuario para columnas created_by/updated_by (null para sistema/anónimo). */
export function actorUserId(actor: Actor): string | null {
  return actor.kind === "staff" || actor.kind === "owner" ? actor.userId : null;
}

export function auditActorKind(actor: Actor): "user" | "owner" | "system" | "anonymous" {
  return actor.kind === "staff" ? "user" : actor.kind;
}

export function systemActor(organizationId: string, name: string): SystemActor {
  return { kind: "system", organizationId, name };
}
