import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { cleanupE2eContact, e2ePool } from "./db";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

async function publishedSlug(minPhotos = 5): Promise<{ slug: string; code: number }> {
  const r = await pool.query<{ slug: string; code: number }>(
    `select p.slug, p.code from properties p
     where p.is_published and p.deleted_at is null and p.status = 'available'
       and (select count(*) from property_media m where m.property_id = p.id and m.status <> 'failed' and m.deleted_at is null) >= $1
     order by p.code desc limit 1`,
    [minPhotos],
  );
  return r.rows[0]!;
}

test("home: hero, buscador y búsqueda de casas en venta", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Buenos negocios/ })).toBeVisible();
  const search = page.getByRole("search", { name: "Buscar propiedades" });
  await expect(search).toBeVisible();
  await search.getByLabel("Operación").selectOption("venta");
  await search.getByLabel("Tipo").selectOption("casa");
  await search.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/\/propiedades\/venta\?tipo=casa$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Casas en venta/);
  const count = await page.locator("#resultados-conteo").innerText();
  expect(Number(count.match(/^[\d.]+/)?.[0]?.replace(/\./g, ""))).toBeGreaterThan(0);
});

test("listado: filtros por URL compartible, chips y estado vacío útil", async ({ page }) => {
  await page.goto("/propiedades");
  const panel = page.getByRole("complementary", { name: "Filtros" });
  await panel.getByRole("radio", { name: "Alquiler" }).check({ force: true });
  await panel.getByLabel("Tipo de propiedad").selectOption("departamento");
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page).toHaveURL(/\/propiedades\/alquiler\?tipo=departamento/);
  await expect(page.getByRole("list", { name: "Filtros activos" })).toContainText("Departamentos");
  await page.goto("/propiedades/venta?q=zzzz-no-existe");
  await expect(page.getByRole("heading", { name: "No encontramos propiedades con esos filtros." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contanos qué buscás" })).toBeVisible();
});

test("ficha: datos, galería con teclado y 404 de no publicadas", async ({ page }) => {
  const { slug, code } = await publishedSlug();
  await page.goto(`/propiedades/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(`Código de propiedad: ${code}`)).toBeVisible();
  const opener = page.getByRole("button", { name: /Ver las \d+ fotos/ });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: /Galería/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/^Foto 1 de \d+$/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(/^Foto 2 de \d+$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  const unpublished = await pool.query<{ slug: string }>("select slug from properties where not is_published and status <> 'archived' and deleted_at is null limit 1");
  if (unpublished.rows[0]) {
    const res = await page.goto(`/propiedades/${unpublished.rows[0].slug}`);
    expect(res?.status()).toBe(404);
  }
  const missing = await page.goto("/propiedades/esta-no-existe-999999");
  expect(missing?.status()).toBe(404);
});

test("consulta desde la ficha crea el lead en el CRM (una sola vez)", async ({ page }) => {
  const { slug, code } = await publishedSlug();
  const stamp = Date.now();
  const email = `e2e-${stamp}@prueba.test`;
  try {
    await page.goto(`/propiedades/${slug}?utm_source=e2e&utm_campaign=playwright`);
    const form = page.locator("#consulta form").first();
    await form.getByLabel("Nombre y apellido").fill("Prueba E2E");
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Mensaje").fill(`Consulta automática ${stamp}`);
    const submit = form.getByRole("button", { name: "Enviar consulta" });
    await submit.dblclick();
    await expect(form.getByRole("status")).toContainText("Recibimos tu consulta");
    const leads = await pool.query<{ source_key: string; code: number; utm: Record<string, string>; idempotency_key: string | null }>(
      `select l.source_key, p.code, l.utm, l.idempotency_key from leads l
       join contact_emails ce on ce.contact_id = l.contact_id join properties p on p.id = l.property_id
       where ce.email = $1`,
      [email],
    );
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0]).toMatchObject({ source_key: "web_property", code, utm: { utm_source: "e2e", utm_campaign: "playwright" } });
    expect(leads.rows[0]!.idempotency_key).toMatch(/^web:/);
  } finally {
    await cleanupE2eContact(pool, email);
  }
});

test("redirecciones del sitio anterior", async ({ request }) => {
  const r = await pool.query<{ path: string; slug: string }>(
    "select r.path, p.slug from property_redirects r join properties p on p.id = r.property_id where p.is_published and r.path like '/luciolopez-%' limit 1",
  );
  const legacy = await request.get(r.rows[0]!.path, { maxRedirects: 0 });
  expect(legacy.status()).toBe(301);
  expect(legacy.headers()["location"]).toMatch(new RegExp(`/propiedades/${r.rows[0]!.slug}$`));
  for (const [from, to] of [
    ["/properties", "/propiedades"],
    ["/properties/operation/forSale", "/propiedades/venta"],
    ["/properties/operation/forRent", "/propiedades/alquiler"],
    ["/company", "/empresa"],
    ["/contact", "/contacto"],
  ]) {
    const res = await request.get(from!, { maxRedirects: 0 });
    expect(res.status(), from).toBe(301);
    expect(res.headers()["location"]).toMatch(new RegExp(`${to}$`));
  }
  expect((await request.get("/tasaciones")).status()).toBe(200);
});

test("reduced motion: todo visible y sin atributo de movimiento activo", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("heading", { name: /Explorá por zona/ }).scrollIntoViewIfNeeded();
  const hidden = await page.evaluate(() => Array.from(document.querySelectorAll("[data-reveal]")).filter((el) => Number(getComputedStyle(el).opacity) < 1).length);
  expect(hidden).toBe(0);
  await ctx.close();
});

test("sin JavaScript el contenido y el buscador siguen ahí", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Buenos negocios/ })).toBeVisible();
  await expect(page.getByRole("search", { name: "Buscar propiedades" })).toBeVisible();
  await page.goto("/propiedades");
  await expect(page.locator("article").first()).toBeVisible();
  await ctx.close();
});

test("accesibilidad (axe): home, listado, ficha y contacto sin violaciones serias", async ({ page }) => {
  const { slug } = await publishedSlug();
  for (const path of ["/", "/propiedades", `/propiedades/${slug}`, "/contacto"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Revelar todo (los revelados pendientes bajarían la opacidad en el análisis de contraste)
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
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
