/**
 * Datos y utilidades de los E2E del núcleo de visitas. Corren contra la base E2E aislada (copia descartable de la de
 * desarrollo, recreada en cada scripts/e2e.sh): crean sus propios agentes, contactos y visitas con marcas únicas.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { hash } from "@node-rs/argon2";
import { expect, type Page } from "@playwright/test";
import type pg from "pg";

export const AGENT_PASSWORD = "Visitas-e2e-2026";
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026";

export type E2eProperty = { id: string; code: number; lat: number; lng: number };

export async function pickVisitProperty(pool: pg.Pool): Promise<E2eProperty> {
  const r = await pool.query<{ id: string; code: number; latitude: string; longitude: string }>(
    `select p.id, p.code, p.latitude, p.longitude from properties p
      where p.latitude is not null and p.longitude is not null and p.deleted_at is null and not p.is_demo and p.is_published
        and exists (select 1 from property_media m where m.property_id = p.id and m.is_cover and m.deleted_at is null and m.status <> 'failed')
      order by p.code limit 1`,
  );
  const p = r.rows[0]!;
  return { id: p.id, code: p.code, lat: Number(p.latitude), lng: Number(p.longitude) };
}

export async function createAgent(pool: pg.Pool, name: string): Promise<{ id: string; email: string; fullName: string }> {
  const org = (await pool.query<{ id: string }>("select id from organizations where slug = 'lucio-lopez-fleming'")).rows[0]!.id;
  const email = `e2e-visitas-${randomUUID().slice(0, 8)}@prueba.test`;
  const passwordHash = await hash(AGENT_PASSWORD, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const u = await pool.query<{ id: string }>(
    "insert into users(organization_id, kind, email, full_name, password_hash) values ($1, 'staff', $2, $3, $4) returning id",
    [org, email, name, passwordHash],
  );
  await pool.query("insert into user_roles(user_id, role_key) values ($1, 'agente')", [u.rows[0]!.id]);
  return { id: u.rows[0]!.id, email, fullName: name };
}

/** Visita de hoy (a `startsInMinutes`) creada como la crea la Agenda: programada, con propiedad y cliente. */
export async function createVisit(pool: pg.Pool, opts: { agentId: string; property: E2eProperty; clientFirstName: string; startsInMinutes: number; durationMinutes?: number }) {
  const org = (await pool.query<{ id: string }>("select id from organizations where slug = 'lucio-lopez-fleming'")).rows[0]!.id;
  const contact = await pool.query<{ id: string }>("insert into contacts(organization_id, kind, first_name, last_name, display_name) values ($1, 'person', $2, 'Prueba E2E', $3) returning id", [
    org,
    opts.clientFirstName,
    `${opts.clientFirstName} Prueba E2E`,
  ]);
  const digits = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  await pool.query("insert into contact_phones(contact_id, phone_raw, phone_e164, is_whatsapp, is_primary) values ($1, $2, $3, true, true)", [contact.rows[0]!.id, `387${digits}`, `+549387${digits}`]);
  const starts = new Date(Math.round((Date.now() + opts.startsInMinutes * 60_000) / 60_000) * 60_000);
  const ends = new Date(starts.getTime() + (opts.durationMinutes ?? 60) * 60_000);
  const a = await pool.query<{ id: string }>(
    `insert into appointments(kind, title, starts_at, ends_at, property_id, contact_id, assigned_user_id, idempotency_key)
     values ('visit', $1, $2, $3, $4, $5, $6, $7) returning id`,
    [`Visita · Prop. ${opts.property.code} · ${opts.clientFirstName}`, starts, ends, opts.property.id, contact.rows[0]!.id, opts.agentId, randomUUID()],
  );
  return { id: a.rows[0]!.id, contactId: contact.rows[0]!.id };
}

export async function loginCrm(page: Page, email: string, password: string) {
  await page.goto("/crm/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/crm$/);
}

/** Errores de consola, errores de página y violaciones de CSP (escuchadas desde antes de cargar). */
export async function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return problems;
}

export async function axeSerious(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Capturas opcionales para revisión visual: VISITS_SHOTS_DIR=/ruta. */
export async function shot(page: Page, name: string) {
  const dir = process.env.VISITS_SHOTS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true });
}
