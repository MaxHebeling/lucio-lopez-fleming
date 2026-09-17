import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

test("mobile 390: menú accesible y búsqueda con filtros", async ({ page }) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Abrir menú" });
  await menuButton.click();
  const menu = page.getByRole("dialog", { name: "Menú" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Tasaciones" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();

  const search = page.getByRole("search", { name: "Buscar propiedades" });
  await search.getByLabel("Operación").selectOption("alquiler");
  await search.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/\/propiedades\/alquiler/);

  await page.getByRole("button", { name: /^Filtros/ }).click();
  const filters = page.getByRole("dialog", { name: "Filtros" });
  await expect(filters).toBeVisible();
  await filters.getByLabel("Tipo de propiedad").selectOption("departamento");
  await filters.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/\/propiedades\/alquiler\?tipo=departamento/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("mobile 390: el carrusel de la ficha es un solo tab stop y se recorre con flechas", async ({ page }) => {
  const r = await pool.query<{ slug: string }>(
    `select p.slug from properties p where p.is_published and p.deleted_at is null and p.status = 'available'
       and (select count(*) from property_media m where m.property_id = p.id and m.status <> 'failed' and m.deleted_at is null and m.kind = 'image') >= 5
     order by p.code desc limit 1`,
  );
  await page.goto(`/propiedades/${r.rows[0]!.slug}`);
  const region = page.getByRole("region", { name: /^Fotos de / });
  await expect.poll(() => region.evaluate((el) => Array.from(el.querySelectorAll("button")).filter((b) => b.tabIndex >= 0).length)).toBe(1);
  const first = region.getByRole("button", { name: /^Ampliar foto 1 de / });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  const second = region.getByRole("button", { name: /^Ampliar foto 2 de / });
  await expect(second).toBeFocused();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  // Tab sale del carrusel (no recorre las demás fotos)
  await page.keyboard.press("Tab");
  expect(await region.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  // Enter en la foto abre la galería; el foco queda atrapado en lo visible (flechas ocultas en mobile)
  await second.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Galería/ });
  await expect(dialog.getByText(/^Foto 2 de \d+$/)).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cerrar galería" })).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(second).toBeFocused();
});

test("mobile 390: portada, servicios en acordeón y sin desborde", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Buenos negocios/ })).toBeVisible();
  const list = page.locator(".svc-list");
  await list.scrollIntoViewIfNeeded();
  await expect(list).toHaveAttribute("data-layout", "accordion");
  const alquileres = list.getByRole("button", { name: "Alquileres", exact: true });
  await expect(alquileres).toHaveAttribute("aria-expanded", "false");
  await alquileres.click();
  await expect(alquileres).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("region", { name: "Alquileres", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Venta de inmuebles y lotes", exact: true })).toBeHidden();
  await alquileres.press("Enter");
  await expect(alquileres).toHaveAttribute("aria-expanded", "false");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Motor de escenas: nunca en mobile.
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
});

test("mobile 390: accesibilidad (axe) de home, listado, ficha, contacto, tasaciones y empresa", async ({ page }) => {
  test.setTimeout(150_000);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const slug = (await pool.query<{ slug: string }>("select slug from properties where is_published and status = 'available' order by code desc limit 1")).rows[0]!.slug;
  for (const path of ["/", "/propiedades", `/propiedades/${slug}`, "/contacto", "/tasaciones", "/empresa"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
});
