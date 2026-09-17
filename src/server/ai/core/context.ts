/**
 * Contexto de pantalla del copiloto. El navegador solo manda la RUTA actual; el servidor deriva módulo y registro
 * y RE-VALIDA con el actor autenticado (mismos loaders y alcance que las páginas del CRM + organización) antes de
 * usarlo. Un registro que el usuario no puede ver se ignora sin revelar si existe.
 * Al modelo solo le llega una etiqueta mínima (nunca teléfonos, emails, documentos ni coordenadas).
 */
import type { Database } from "../../db";
import type { StaffActor } from "../../auth/actor";
import { AppError } from "../../errors";
import { loadAppointment, loadContact, loadLead, loadOpportunity } from "../../crm/entities";
import { loadVisit } from "../../visits/access";
import { can } from "../../auth/actor";

export type ScreenEntityType = "property" | "contact" | "lead" | "opportunity" | "appointment" | "visit";

export type ScreenContext = {
  /** Ruta normalizada con [id] (sin ids reales): /crm/propiedades/[id] */
  pattern: string;
  module: string | null;
  moduleLabel: string | null;
  entity: { type: ScreenEntityType; id: string; label: string } | null;
  /** Había un id en la ruta pero el usuario no puede verlo (o no existe): se ignoró. */
  entityIgnored: boolean;
};

const MODULES: Record<string, { key: string; label: string; entity?: ScreenEntityType }> = {
  "": { key: "dashboard", label: "Tablero" },
  propiedades: { key: "properties", label: "Propiedades", entity: "property" },
  contactos: { key: "contacts", label: "Contactos", entity: "contact" },
  leads: { key: "leads", label: "Leads", entity: "lead" },
  pipeline: { key: "opportunities", label: "Pipeline", entity: "opportunity" },
  agenda: { key: "agenda", label: "Agenda", entity: "appointment" },
  "mis-visitas": { key: "visits", label: "Mis visitas", entity: "visit" },
  "centro-operativo": { key: "visits", label: "Centro operativo" },
  tareas: { key: "tasks", label: "Tareas" },
  conversaciones: { key: "conversations", label: "Conversaciones" },
  alquileres: { key: "rentals", label: "Alquileres" },
  informes: { key: "reports", label: "Informes" },
  marketing: { key: "marketing", label: "Contenido" },
  publicaciones: { key: "publications", label: "Portales" },
  automatizaciones: { key: "automations", label: "Automatizaciones" },
  integraciones: { key: "integrations", label: "Integraciones" },
  usuarios: { key: "users", label: "Usuarios" },
  auditoria: { key: "audit", label: "Auditoría" },
  sistema: { key: "system", label: "Jobs" },
  migracion: { key: "migration", label: "Migración" },
  buscar: { key: "search", label: "Búsqueda" },
  notificaciones: { key: "notifications", label: "Avisos" },
  cuenta: { key: "account", label: "Mi cuenta" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pura: ruta → módulo e id candidato. Rechaza todo lo que no sea una ruta del CRM. */
export function parseCrmPath(raw: string | null | undefined): { module: (typeof MODULES)[string] | null; segment: string | null; id: string | null; pattern: string } | null {
  if (!raw || typeof raw !== "string" || raw.length > 300) return null;
  const path = raw.split(/[?#]/)[0]!.replace(/\/+$/, "");
  if (!/^\/crm(\/[A-Za-z0-9_-]+)*$/.test(path)) return null;
  const parts = path.split("/").slice(2);
  const segment = parts[0] ?? "";
  const moduleDef = MODULES[segment] ?? null;
  const second = parts[1] ?? null;
  const id = second && UUID_RE.test(second) ? second.toLowerCase() : null;
  const pattern = ["/crm", ...parts.map((p) => (UUID_RE.test(p) ? "[id]" : p))].join("/").replace(/\/$/, "") || "/crm";
  return { module: moduleDef, segment, id, pattern };
}

function isHidden(e: unknown): boolean {
  return e instanceof AppError && (e.code === "not_found" || e.code === "forbidden" || e.code === "unauthenticated");
}

async function loadEntity(db: Database, actor: StaffActor, type: ScreenEntityType, id: string): Promise<{ label: string } | null> {
  try {
    switch (type) {
      case "property": {
        if (!can(actor, "properties.read")) return null;
        const p = await db
          .selectFrom("properties")
          .select(["code", "title"])
          .where("id", "=", id)
          .where("organization_id", "=", actor.organizationId)
          .where("deleted_at", "is", null)
          .executeTakeFirst();
        return p ? { label: `Propiedad #${p.code} · ${p.title}` } : null;
      }
      case "contact": {
        const c = await loadContact(db, actor, id);
        return c.organization_id === actor.organizationId ? { label: "Ficha de contacto" } : null;
      }
      case "lead": {
        const l = await loadLead(db, actor, id);
        return l.organization_id === actor.organizationId ? { label: "Lead" } : null;
      }
      case "opportunity": {
        const o = await loadOpportunity(db, actor, id);
        return o.organization_id === actor.organizationId ? { label: `Oportunidad · ${o.title}` } : null;
      }
      case "appointment": {
        const a = await loadAppointment(db, actor, id);
        const u = await db.selectFrom("users").select("organization_id").where("id", "=", a.assigned_user_id).executeTakeFirst();
        return u?.organization_id === actor.organizationId ? { label: `Cita · ${a.title}` } : null;
      }
      case "visit": {
        // Mismo alcance que «Mis visitas» (visits.operate: solo asignadas; visits.monitor: la organización).
        const v = await loadVisit(db, actor, id);
        return { label: `Visita · ${v.title}` };
      }
    }
  } catch (e) {
    if (isHidden(e)) return null;
    throw e;
  }
}

export async function resolveScreenContext(db: Database, actor: StaffActor, rawPath: string | null | undefined): Promise<ScreenContext | null> {
  const parsed = parseCrmPath(rawPath);
  if (!parsed) return null;
  const base: ScreenContext = { pattern: parsed.pattern, module: parsed.module?.key ?? null, moduleLabel: parsed.module?.label ?? null, entity: null, entityIgnored: false };
  const type = parsed.module?.entity;
  if (!parsed.id || !type) return base;
  const found = await loadEntity(db, actor, type, parsed.id);
  if (!found) return { ...base, entityIgnored: true };
  return { ...base, entity: { type, id: parsed.id, label: found.label } };
}

/** Link a una pantalla del CRM: reemplaza [id] si el registro abierto es del tipo correcto; si no, la sección padre. */
export function hrefForRoute(route: string | null, screen: ScreenContext | null): string | null {
  if (!route) return null;
  if (!route.includes("[id]")) return route;
  const parsed = parseCrmPath(route.replace("[id]", "00000000-0000-0000-0000-000000000000"));
  if (screen?.entity && parsed?.module?.entity === screen.entity.type) return route.replace("[id]", screen.entity.id);
  return route.slice(0, route.indexOf("/[id]")) || "/crm";
}
