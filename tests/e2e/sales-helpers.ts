import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type pg from "pg";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026";

/** Capturas propias opcionales (E2E_SHOTS=directorio). */
export async function shot(page: Page, name: string, fullPage = false) {
  const dir = process.env.E2E_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
}

export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (m) => {
    // Beacons de analítica cortados por la navegación no son errores de la página.
    if (m.type() === "error" && !/api\/site\/events/.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

export async function serious(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

export async function login(page: Page) {
  await page.goto("/crm/login");
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/\/crm$/);
}

/** Casa publicada y disponible en venta en USD con dormitorios cargados (dato real de la base copiada). */
export async function realHouse(pool: pg.Pool) {
  const r = await pool.query<{ id: string; code: number; slug: string; bedrooms: number; amount: string }>(
    `select p.id, p.code, p.slug, p.bedrooms, o.amount from properties p
       join property_operations o on o.property_id = p.id and o.is_active and o.operation = 'sale' and o.currency = 'USD' and not o.price_hidden
      where p.is_published and not p.is_demo and p.deleted_at is null and p.status = 'available' and p.type_key = 'casa' and p.bedrooms >= 2
        and (select count(*) from property_media m where m.property_id = p.id and m.deleted_at is null and m.status <> 'failed') >= 2
      order by p.code desc limit 1`,
  );
  return r.rows[0]!;
}
