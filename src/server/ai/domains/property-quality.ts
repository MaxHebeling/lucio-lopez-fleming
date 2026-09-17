/**
 * Dominio Propiedades (Fase 3): calidad de la publicación para el copiloto. AMPLÍA `property_completeness` (que queda
 * igual): usa el informe determinista del job `ai.property_quality` (score con pesos, faltantes con link, inconsistencias,
 * descripción, precio con muestra y fotos). Solo lectura; nunca expone dirección, coordenadas ni propietarios.
 */
import { z } from "zod";
import { isEnabled } from "../../flags";
import type { ToolRegistry, ToolResult } from "../core/registry";
import type { Criterion, Finding } from "../property/quality-rules";
import { plural } from "./shared";

const QA_FLAG = "ai_property_quality";
const SEVERITY_BADGE: Record<Finding["severity"], string> = { error: "Importante", warning: "A revisar", info: "Sugerencia" };

const empty = (summary: string): ToolResult => ({ title: "Calidad de la publicación", summary, items: [], total: 0, truncated: false, source: { label: "Propiedades", href: "/crm/propiedades" }, scope: "all" });

export function registerPropertyQualityTools(registry: ToolRegistry): void {
  registry.register({
    name: "property_quality",
    domain: "property",
    capability: "read",
    permissions: ["properties.read"],
    description:
      "Calidad de la publicación de UNA propiedad (la abierta en pantalla o la del código): score 0–100 con pesos, qué falta (con link a la sección exacta), inconsistencias de datos, descripción, precio contra comparables (solo con muestra suficiente) y fotos repetidas/oscuras/borrosas. Informe determinista: no es una tasación.",
    input: z.object({ code: z.number().int().positive().optional() }),
    quick: { id: "calidad_ficha", label: "Calidad de esta publicación", requiresEntity: "property", flag: QA_FLAG, keywords: [/\bcalidad\b.*\b(ficha|publicacion|propiedad)\b/, /\b(avisos|inconsistencias)\b.*\b(ficha|propiedad)\b/] },
    async run({ db, actor, screen }, input): Promise<ToolResult> {
      if (!(await isEnabled(db, QA_FLAG))) return empty("El informe de calidad está desactivado.");
      const byScreen = !input.code && screen?.entity?.type === "property" ? screen.entity.id : undefined;
      if (!input.code && !byScreen) return empty("Abrí la ficha de una propiedad (o indicá su código) para ver su calidad.");
      let q = db
        .selectFrom("property_quality_reports as q")
        .innerJoin("properties as p", "p.id", "q.property_id")
        .select(["p.id", "p.code", "q.score", "q.completeness_score", "q.criteria", "q.findings", "q.computed_at"])
        .where("p.organization_id", "=", actor.organizationId)
        .where("p.deleted_at", "is", null)
        .where("p.is_demo", "=", false);
      q = byScreen ? q.where("p.id", "=", byScreen) : q.where("p.code", "=", input.code!);
      const r = await q.executeTakeFirst();
      if (!r) return empty("No hay informe de calidad para esa propiedad en lo que podés ver (se calcula al guardar cambios y cada noche).");
      const missing = (r.criteria as unknown as Criterion[]).filter((c) => !c.ok);
      const notices = (r.findings as unknown as Finding[]).filter((f) => !f.code.startsWith("missing_"));
      return {
        title: `Calidad de la publicación #${r.code}`,
        summary: `Score ${r.score}/100 (completitud ${r.completeness_score}/100): ${plural(missing.length, "faltante", "faltantes")} y ${plural(notices.length, "aviso", "avisos")}.`,
        items: [
          ...missing.map((c) => ({ label: `Falta: ${c.label}`, detail: `${c.weight} puntos`, badge: "Falta", href: c.href })),
          ...notices.slice(0, 10).map((f) => ({ label: f.title, detail: f.detail, badge: SEVERITY_BADGE[f.severity], href: f.href })),
        ],
        total: missing.length + notices.length,
        truncated: notices.length > 10,
        source: { label: `Propiedad #${r.code}`, href: `/crm/propiedades/${r.id}#calidad` },
        scope: "all",
      };
    },
  });

  registry.register({
    name: "low_quality_properties",
    domain: "property",
    capability: "read",
    permissions: ["properties.read"],
    description: "Publicaciones activas con peor score de calidad (0–100), de menor a mayor, con la cantidad de faltantes y avisos. Datos del informe determinista.",
    input: z.object({ published_only: z.boolean().default(true), max_score: z.number().int().min(1).max(100).default(70) }),
    quick: { id: "peor_calidad", label: "Publicaciones con peor calidad", flag: QA_FLAG, keywords: [/\b(peor|baja)\b.*\bcalidad\b/, /\bcalidad\b.*\b(publicaciones|fichas)\b/] },
    async run({ db, actor }, input): Promise<ToolResult> {
      if (!(await isEnabled(db, QA_FLAG))) return empty("El informe de calidad está desactivado.");
      let q = db
        .selectFrom("property_quality_reports as q")
        .innerJoin("properties as p", "p.id", "q.property_id")
        .select(["p.id", "p.code", "p.title", "q.score", "q.missing_count", "q.warning_count"])
        .where("p.organization_id", "=", actor.organizationId)
        .where("p.deleted_at", "is", null)
        .where("p.is_demo", "=", false)
        .where("p.status", "in", ["draft", "available", "reserved", "paused"])
        .where("q.score", "<=", input.max_score);
      if (input.published_only) q = q.where("p.is_published", "=", true);
      const rows = await q.orderBy("q.score").orderBy("p.code").limit(200).execute();
      const shown = rows.slice(0, 15);
      return {
        title: "Publicaciones con peor calidad",
        summary: rows.length ? `${plural(rows.length, "publicación", "publicaciones")} con score ${input.max_score} o menos.` : `Ninguna publicación con score ${input.max_score} o menos.`,
        items: shown.map((r) => ({ label: `#${r.code} · ${r.title}`, detail: `Calidad ${r.score}/100 · ${plural(r.missing_count, "faltante", "faltantes")} · ${plural(r.warning_count, "aviso", "avisos")}`, badge: null, href: `/crm/propiedades/${r.id}#calidad` })),
        total: rows.length,
        truncated: rows.length > shown.length,
        source: { label: "Propiedades por calidad", href: "/crm/propiedades?sort=quality_asc" },
        scope: "all",
      };
    },
  });
}
