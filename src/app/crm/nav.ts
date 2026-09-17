/**
 * Navegación del CRM. Cada ítem declara el permiso que lo habilita: el menú se filtra por permisos,
 * pero la autorización real ocurre en cada página y servicio (requireStaffPage / requirePermission).
 */
/** `icon`: emoji de color que acompaña cada acceso (decorativo: el nombre accesible es el label). */
/** `flag`: feature flag que además debe estar encendido para mostrar el acceso. */
export type NavItem = { href: string; label: string; icon: string; permission: string; group: "operacion" | "comercial" | "alquileres" | "marketing" | "sistema"; flag?: string };

export const CRM_NAV: NavItem[] = [
  { href: "/crm", label: "Tablero", icon: "🏠", permission: "dashboard.read", group: "operacion" },
  { href: "/crm/propiedades", label: "Propiedades", icon: "🏘️", permission: "properties.read", group: "operacion" },
  { href: "/crm/contactos", label: "Contactos", icon: "👥", permission: "contacts.read", group: "operacion" },
  { href: "/crm/agenda", label: "Agenda", icon: "📅", permission: "agenda.manage", group: "operacion" },
  { href: "/crm/mis-visitas", label: "Mis visitas", icon: "🚗", permission: "visits.operate", group: "operacion", flag: "visits_operations" },
  { href: "/crm/centro-operativo", label: "Centro operativo", icon: "🛰️", permission: "visits.monitor", group: "operacion", flag: "visits_operations" },
  { href: "/crm/tareas", label: "Tareas", icon: "✅", permission: "tasks.manage", group: "operacion" },
  { href: "/crm/leads", label: "Leads", icon: "🎯", permission: "leads.read_own", group: "comercial" },
  { href: "/crm/pipeline", label: "Pipeline", icon: "📊", permission: "opportunities.read_own", group: "comercial" },
  { href: "/crm/conversaciones", label: "Conversaciones", icon: "💬", permission: "conversations.read", group: "comercial" },
  { href: "/crm/alquileres", label: "Contratos", icon: "📄", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/alquileres/cobros", label: "Cobros", icon: "💳", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/alquileres/liquidaciones", label: "Liquidaciones", icon: "🧾", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/alquileres/indices", label: "Índices", icon: "📈", permission: "rentals.read", group: "alquileres" },
  { href: "/crm/informes", label: "Informes", icon: "📑", permission: "reports.read", group: "alquileres" },
  { href: "/crm/marketing", label: "Contenido", icon: "📣", permission: "marketing.read", group: "marketing" },
  { href: "/crm/publicaciones", label: "Portales", icon: "🌐", permission: "publications.manage", group: "marketing" },
  { href: "/crm/automatizaciones", label: "Automatizaciones", icon: "⚙️", permission: "automations.read", group: "sistema" },
  { href: "/crm/integraciones", label: "Integraciones", icon: "🔗", permission: "integrations.read", group: "sistema" },
  { href: "/crm/migracion", label: "Migración", icon: "🔄", permission: "migration.read", group: "sistema" },
  { href: "/crm/usuarios", label: "Usuarios", icon: "👤", permission: "users.read", group: "sistema" },
  { href: "/crm/auditoria", label: "Auditoría", icon: "🛡️", permission: "audit.read", group: "sistema" },
  { href: "/crm/sistema/jobs", label: "Jobs", icon: "🧰", permission: "automations.read", group: "sistema" },
];

/** Con "leads.read_all" también se ve Leads; con "opportunities.read_all", Pipeline. */
export const NAV_PERMISSION_ALIASES: Record<string, string[]> = {
  "leads.read_own": ["leads.read_all"],
  "opportunities.read_own": ["opportunities.read_all"],
  "agenda.manage": ["agenda.read_all"],
  "tasks.manage": ["tasks.read_all"],
};
