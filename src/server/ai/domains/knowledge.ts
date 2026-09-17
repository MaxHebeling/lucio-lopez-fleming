/** Dominio Conocimiento: búsqueda en la guía del CRM (filtrada por permisos del actor). */
import { z } from "zod";
import type { ToolRegistry } from "../core/registry";
import { hrefForRoute } from "../core/context";
import { excerpt, searchKnowledge } from "../knowledge/retrieval";

export function registerKnowledgeTools(registry: ToolRegistry): void {
  registry.register({
    name: "search_crm_guide",
    domain: "knowledge",
    capability: "read",
    permissions: ["ai.copilot"],
    description: "Busca en la guía del CRM cómo se hace algo (pantalla, pasos y permiso requerido). Solo devuelve secciones que el usuario puede ver.",
    input: z.object({ query: z.string().trim().min(2).max(300) }),
    async run({ db, actor, screen }, input) {
      const hits = await searchKnowledge(db, actor, input.query, { limit: 4, module: screen?.module });
      return {
        title: "Guía del CRM",
        summary: hits.length ? `Encontré ${hits.length} sección(es) de la guía.` : "La guía del CRM no tiene una sección sobre eso.",
        items: hits.map((h) => ({ label: h.heading, detail: excerpt(h.body, 400), href: hrefForRoute(h.route, screen), badge: h.documentTitle })),
        total: hits.length,
        truncated: false,
        source: { label: "Guía del CRM", href: null },
        scope: null,
      };
    },
  });
}
