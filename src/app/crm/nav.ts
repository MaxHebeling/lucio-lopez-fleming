/**
 * Navegación del CRM. Cada ítem declara el permiso que lo habilita: el menú se filtra por permisos,
 * pero la autorización real ocurre en cada página y servicio (requireStaffPage / requirePermission).
 */
export type NavItem = { href: string; label: string; permission: string; group: "operacion" | "comercial" | "alquileres" | "marketing" | "sistema" };

export const CRM_NAV: NavItem[] = [
  { href: "/crm", label: "Tablero", permission: "dashboard.read", group: "operacion" },
  { href: "/crm/propiedades", label: "Propiedades", permission: "properties.read", group: "operacion" },
  { href: "/crm/contactos", label: "Contactos", permission: "contacts.read", group: "operacion" },
  { href: "/crm/agenda", label: "Agenda", permission: "agenda.manage", group: "operacion" },
  { href: "/crm/tareas", label: "Tareas", permission: "tasks.manage", group: "operacion" },
  { href: "/crm/leads", label: "Leads", permission: "leads.read_own", group: "comercial" },
  { href: "/crm/pipeline", label: "Pipeline", permission: "opportunities.read_own", group: "comercial" },
  { href: "/crm/conversaciones", label: "Conversaciones", permission: "conversations.read", group: "comercial" },
  { href: "/crm/alquileres", label: "Contratos", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/alquileres/cobros", label: "Cobros", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/alquileres/liquidaciones", label: "Liquidaciones", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/informes", label: "Informes", permission: "reports.read", group: "alquileres" },
  { href: "/crm/marketing", label: "Contenido", permission: "marketing.read", group: "marketing" },
  { href: "/crm/publicaciones", label: "Portales", permission: "publications.manage", group: "marketing" },
  { href: "/crm/automatizaciones", label: "Automatizaciones", permission: "automations.read", group: "sistema" },
  { href: "/crm/integraciones", label: "Integraciones", permission: "integrations.read", group: "sistema" },
  { href: "/crm/migracion", label: "Migración", permission: "migration.read", group: "sistema" },
  { href: "/crm/usuarios", label: "Usuarios", permission: "users.read", group: "sistema" },
  { href: "/crm/auditoria", label: "Auditoría", permission: "audit.read", group: "sistema" },
  { href: "/crm/sistema/jobs", label: "Jobs", permission: "automations.read", group: "sistema" },
];

/** Con "leads.read_all" también se ve Leads; con "opportunities.read_all", Pipeline. */
export const NAV_PERMISSION_ALIASES: Record<string, string[]> = {
  "leads.read_own": ["leads.read_all"],
  "opportunities.read_own": ["opportunities.read_all"],
  "agenda.manage": ["agenda.read_all"],
};
