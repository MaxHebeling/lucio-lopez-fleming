/**
 * Registro de herramientas del AI Core, separado por dominio (knowledge, sales, property, operations, executive).
 *
 * Reglas (código, no prompt):
 *  1. Cada herramienta declara `permissions` (alcanza con uno) y `capability` ∈ read | suggest | draft | execute.
 *  2. En esta fase NINGUNA herramienta puede ser `execute`: registrarla falla.
 *  3. Antes de ofrecerla al modelo y otra vez antes de ejecutarla se verifica, con el actor autenticado, el permiso
 *     y que la capability esté permitida en ese modo. El modelo nunca decide permisos.
 *  4. La entrada se valida con zod. Nada de lo que devuelve una herramienta `suggest`/`draft` se persiste sin
 *     confirmación humana (esas herramientas solo devuelven propuestas).
 */
import { z } from "zod";
import type { Database } from "../../db";
import { can, type StaffActor } from "../../auth/actor";
import { AppError } from "../../errors";
import { errorFields, log } from "../../log";
import { AIGovernanceError, type GovernanceCode } from "./errors";
import { toolInputJsonSchema } from "./governance";
import type { AIToolSpec } from "./types";
import type { ScreenContext } from "./context";

export const CAPABILITIES = ["read", "suggest", "draft", "execute"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const AI_DOMAINS = ["knowledge", "sales", "property", "operations", "executive"] as const;
export type AIDomain = (typeof AI_DOMAINS)[number];

/** Política de la Fase 1: la IA lee, sugiere y prepara borradores; no ejecuta operaciones. */
export const PHASE_ALLOWED_CAPABILITIES: ReadonlySet<Capability> = new Set(["read", "suggest", "draft"]);

export type ToolRunContext = {
  db: Database;
  actor: StaffActor;
  now: Date;
  screen: ScreenContext | null;
};

export type ToolItem = { label: string; detail?: string | null; href?: string | null; badge?: string | null };

/** Resultado determinista de una herramienta: son los HECHOS que ve el usuario, con su origen. */
export type ToolResult = {
  title: string;
  summary: string;
  items: ToolItem[];
  total: number;
  truncated: boolean;
  source: { label: string; href: string | null };
  /** Alcance aplicado: propio (lo asignado a uno) o de todo el equipo. */
  scope: "own" | "all" | null;
  /** Contenido libre cargado por personas (descripciones, notas): se envía al modelo como datos no confiables. */
  untrusted?: Array<{ source: string; text: string }>;
};

export type QuickQuery = {
  id: string;
  label: string;
  keywords: RegExp[];
  /** Solo tiene sentido con un registro de este tipo abierto en pantalla. */
  requiresEntity?: "property";
  /** Feature flag del módulo: con el flag apagado la consulta rápida no se ofrece. */
  flag?: string;
};

/** Flags encendidos (para filtrar consultas rápidas de módulos apagados). */
export type EnabledFlags = ReadonlySet<string>;

export type AIToolDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  domain: AIDomain;
  description: string;
  capability: Capability;
  permissions: string[];
  input: S;
  /** Consulta rápida determinista (chip del modo Analista), disponible sin modelo. */
  quick?: QuickQuery;
  run(ctx: ToolRunContext, input: z.infer<S>): Promise<ToolResult>;
};

export type ToolInvocation =
  | { ok: true; name: string; result: ToolResult; ms: number }
  | { ok: false; name: string; code: GovernanceCode | "not_found" | "failed"; message: string; ms: number };

export class ToolRegistry {
  private readonly tools = new Map<string, AIToolDefinition>();

  register<S extends z.ZodType>(def: AIToolDefinition<S>): void {
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(def.name)) throw new Error(`Nombre de herramienta inválido: ${def.name}`);
    if (!PHASE_ALLOWED_CAPABILITIES.has(def.capability)) {
      throw new AIGovernanceError("execute_forbidden", `La herramienta ${def.name} declara capability "${def.capability}", no permitida en esta fase`);
    }
    if (!def.permissions.length) throw new Error(`La herramienta ${def.name} tiene que declarar al menos un permiso`);
    if (this.tools.has(def.name)) throw new Error(`Herramienta duplicada: ${def.name}`);
    this.tools.set(def.name, def as unknown as AIToolDefinition);
  }

  get(name: string): AIToolDefinition | undefined {
    return this.tools.get(name);
  }

  all(): AIToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Herramientas que ESTE actor puede usar con estas capabilities (lo que se le ofrece al modelo o como chip). */
  available(actor: StaffActor, capabilities: readonly Capability[]): AIToolDefinition[] {
    return this.all().filter((t) => capabilities.includes(t.capability) && PHASE_ALLOWED_CAPABILITIES.has(t.capability) && canUseTool(actor, t));
  }

  /** Flags que declaran las consultas rápidas (el servicio los resuelve contra la base). */
  quickFlags(): string[] {
    return [...new Set(this.all().flatMap((t) => (t.quick?.flag ? [t.quick.flag] : [])))];
  }

  private quickAllowed(t: AIToolDefinition, screen: ScreenContext | null, flags: EnabledFlags): boolean {
    return Boolean(t.quick && (!t.quick.requiresEntity || screen?.entity?.type === t.quick.requiresEntity) && (!t.quick.flag || flags.has(t.quick.flag)));
  }

  quickQueries(actor: StaffActor, screen: ScreenContext | null, flags: EnabledFlags = new Set()): Array<{ id: string; label: string; tool: string }> {
    return this.available(actor, ["read"])
      .filter((t) => this.quickAllowed(t, screen, flags))
      .map((t) => ({ id: t.quick!.id, label: t.quick!.label, tool: t.name }));
  }

  byQuickId(id: string): AIToolDefinition | undefined {
    return this.all().find((t) => t.quick?.id === id);
  }

  /** Intención determinista (sin modelo): primera consulta rápida cuyas palabras clave coinciden. */
  matchQuick(actor: StaffActor, question: string, screen: ScreenContext | null, flags: EnabledFlags = new Set()): AIToolDefinition | undefined {
    const q = normalizeForMatch(question);
    return this.available(actor, ["read"]).find((t) => this.quickAllowed(t, screen, flags) && t.quick!.keywords.some((k) => k.test(q)));
  }

  specs(defs: AIToolDefinition[]): AIToolSpec[] {
    return defs.map((t) => ({ name: t.name, description: t.description, inputSchema: toolInputJsonSchema(t.input) }));
  }

  /**
   * Ejecuta una herramienta pedida (por el modelo o por un chip) re-verificando TODO en el servidor.
   * Nunca lanza por gobernanza ni por datos: devuelve { ok: false } para que el turno siga y quede registrado.
   */
  async invoke(ctx: ToolRunContext, name: string, rawInput: unknown, allowed: readonly Capability[]): Promise<ToolInvocation> {
    const t0 = Date.now();
    const fail = (code: GovernanceCode | "not_found" | "failed", message: string): ToolInvocation => ({ ok: false, name, code, message, ms: Date.now() - t0 });
    const def = this.tools.get(name);
    if (!def) return fail("unknown_tool", `Herramienta desconocida: ${name.slice(0, 60)}`);
    if (!allowed.includes(def.capability) || !PHASE_ALLOWED_CAPABILITIES.has(def.capability)) {
      return fail("capability_not_allowed", `La herramienta ${name} (${def.capability}) no está permitida en este modo`);
    }
    if (!canUseTool(ctx.actor, def)) return fail("permission_denied", `Tu rol no tiene permiso para ${name}`);
    const parsed = def.input.safeParse(rawInput ?? {});
    if (!parsed.success) return fail("invalid_input", "Parámetros inválidos para la herramienta");
    try {
      const result = await def.run(ctx, parsed.data);
      return { ok: true, name, result, ms: Date.now() - t0 };
    } catch (e) {
      if (e instanceof AppError && (e.code === "forbidden" || e.code === "unauthenticated")) return fail("permission_denied", e.message);
      if (e instanceof AppError && e.code === "not_found") return fail("not_found", e.message);
      log.error("ai.tool_failed", { tool: name, requestId: ctx.actor.requestId, ...errorFields(e) });
      return fail("failed", "No se pudo consultar el CRM en este momento");
    }
  }
}

export function canUseTool(actor: StaffActor, def: Pick<AIToolDefinition, "permissions">): boolean {
  return def.permissions.some((p) => can(actor, p));
}

export function normalizeForMatch(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
