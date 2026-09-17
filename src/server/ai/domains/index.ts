/**
 * Registro por defecto del AI Core: cinco dominios lógicos en un mismo proceso (sin microservicios).
 * Fases siguientes agregan herramientas en su dominio (siempre con permiso y capability; `execute` requiere
 * cambiar explícitamente la política de fase en registry.ts y documentarlo en docs/ai/GOVERNANCE.md).
 */
import { ToolRegistry } from "../core/registry";
import { registerExecutiveTools } from "./executive";
import { registerKnowledgeTools } from "./knowledge";
import { registerOperationsTools } from "./operations";
import { registerPropertyTools } from "./property";
import { registerPropertyQualityTools } from "./property-quality";
import { registerSalesTools } from "./sales";

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerKnowledgeTools(registry);
  registerSalesTools(registry);
  registerPropertyTools(registry);
  registerPropertyQualityTools(registry);
  registerOperationsTools(registry);
  registerExecutiveTools(registry);
  return registry;
}

let cached: ToolRegistry | undefined;

export function defaultRegistry(): ToolRegistry {
  cached ??= createDefaultRegistry();
  return cached;
}
