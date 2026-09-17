/**
 * E2E del tour virtual 360° (desktop 1440): ficha sin tour intacta, demo completa (portada → escena → hotspot → plano →
 * guiado → CTA → cierre), teclado, "atrás", analítica, consola/CSP limpias, axe y el editor del CRM.
 * WebGL en Chromium headless: SwiftShader (--use-angle=swiftshader --enable-unsafe-swiftshader).
 */
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { e2ePool } from "./db";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } });
test.describe.configure({ mode: "serial" });

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026";
const DEMO_DIR = resolve(import.meta.dirname, "../../public/tours/demo/residencia");

/** Errores de consola, errores de página y violaciones de CSP (escuchadas desde antes de cargar). */
async function watch(page: Page) {
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

async function axeSerious(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** El canvas del visor muestra una imagen real (no negro ni un color plano). */
async function expectCanvasRendered(page: Page) {
  const canvas = page.locator(".tour-viewer canvas").first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(
      async () => {
        const png = await canvas.screenshot();
        const stats = await sharp(png).stats();
        return Math.max(...stats.channels.map((c) => c.stdev));
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(8);
}

async function demoTourId(): Promise<string> {
  const r = await pool.query<{ id: string }>("select t.id from virtual_tours t join properties p on p.id = t.property_id where p.is_demo and p.slug = 'residencia-demo-360'");
  if (!r.rows[0]) throw new Error("Falta la demo: correr pnpm seed:demo-tour (scripts/e2e.sh lo hace)");
  return r.rows[0].id;
}

test("ficha SIN tour: sin pestañas ni código del visor; la galería queda igual", async ({ page }) => {
  const r = await pool.query<{ slug: string }>(
    `select p.slug from properties p where p.is_published and not p.is_demo and p.deleted_at is null and p.status = 'available'
       and not exists (select 1 from virtual_tours t where t.property_id = p.id)
       and (select count(*) from property_media m where m.property_id = p.id and m.status <> 'failed' and m.deleted_at is null and m.kind = 'image') >= 5
     order by p.code desc limit 1`,
  );
  const scripts: string[] = [];
  page.on("request", (req) => {
    if (req.resourceType() === "script") scripts.push(req.url());
  });
  await page.goto(`/propiedades/${r.rows[0]!.slug}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: /^Fotos de / })).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Entrar al tour 360°" })).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain("tour-launch");
  // Ningún chunk cargado contiene el visor (PSV/three).
  for (const url of scripts.filter((u) => u.includes("/_next/static/"))) {
    const body = await (await page.request.get(url)).text();
    expect(body.includes("PhotoSphereViewer"), `chunk con el visor en la ficha sin tour: ${url}`).toBe(false);
  }
});

test("demo 1440: portada → escena → hotspot → plano → guiado → CTA → cerrar; teclado, atrás, analítica y consola limpia", async ({ page }) => {
  test.setTimeout(180_000);
  const problems = await watch(page);
  const tourId = await demoTourId();
  const since = new Date();

  const res = await page.goto("/demo/tour-360");
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByText("DEMO INTERACTIVA — PROPIEDAD FICTICIA")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Recorré la propiedad antes de visitarla." })).toBeVisible();
  await expect(page.getByText("Explorá cada ambiente de forma interactiva.")).toBeVisible();

  // Pestañas accesibles con teclado.
  const fotos = page.getByRole("tab", { name: "Fotos" });
  await fotos.focus();
  await page.keyboard.press("ArrowRight");
  const tourTab = page.getByRole("tab", { name: /Tour 360/ });
  await expect(tourTab).toHaveAttribute("aria-selected", "true");
  await expect(tourTab).toBeFocused();

  const enter = page.getByRole("button", { name: "Entrar al tour 360°" });
  await expect(page.getByText("Viví la propiedad antes de visitarla.")).toBeVisible();
  await enter.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await enter.click();

  const dialog = page.getByTestId("tour-dialog");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tour-root")).toHaveAttribute("data-state", "open", { timeout: 30_000 });
  await expectCanvasRendered(page);
  await expect(dialog.getByRole("button", { name: "Salir del tour" })).toBeFocused();

  // Hotspot → Living.
  await page.locator(".tour-hotspot-btn[data-kind='scene']").first().click();
  await expect(page.locator("#tour-title")).toHaveText("Living");
  await expect(page.locator(".tour-room[aria-current='true']")).toContainText("Living");

  // Hotspots navegables con Tab: foco en un punto + Enter cambia de escena.
  await expect(page.locator(".psv-marker--visible .tour-hotspot-btn[data-kind='scene']").first()).toBeVisible();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.classList.contains("tour-hotspot-btn") === true && (document.activeElement as HTMLElement).dataset.kind === "scene");
  }
  expect(reached).toBe(true);
  const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  await page.keyboard.press("Enter");
  await expect(page.locator("#tour-title")).not.toHaveText("Living");
  expect(focusedLabel.length).toBeGreaterThan(0);

  // Plano → saltar a Dormitorio.
  await dialog.getByRole("button", { name: "Plano", exact: true }).click();
  const plan = dialog.getByRole("region", { name: "Plano" });
  await expect(plan.getByText("PLANO DEMOSTRATIVO")).toBeVisible();
  await plan.getByRole("button", { name: /^Ir a Dormitorio/ }).click();
  await expect(page.locator("#tour-title")).toHaveText(/^Dormitorio/);
  await expect(plan).toBeHidden();

  // Recorrido guiado: arranca desde el principio, siguiente / anterior.
  await dialog.getByRole("button", { name: "Ambientes", exact: true }).click();
  await dialog.getByRole("region", { name: "Ambientes" }).getByRole("button", { name: /Entrada/ }).click();
  await expect(page.locator("#tour-title")).toHaveText("Entrada");
  await dialog.getByRole("button", { name: "Recorrido guiado" }).click();
  const guided = dialog.getByRole("group", { name: "Recorrido guiado" });
  await expect(guided).toContainText("1 de 8");
  await guided.getByRole("button", { name: /Siguiente/ }).click();
  await expect(guided).toContainText("2 de 8");
  await expect(page.locator("#tour-title")).toHaveText("Living");
  await guided.getByRole("button", { name: /Siguiente/ }).click();
  await expect(guided).toContainText("3 de 8 · Cocina");
  await guided.getByRole("button", { name: /Anterior/ }).click();
  await expect(guided).toContainText("2 de 8");
  await guided.getByRole("button", { name: "Salir del recorrido" }).click();
  await expect(guided).toBeHidden();

  // CTA en la demo: explica y lleva a propiedades reales / contacto (no crea leads).
  await dialog.getByRole("button", { name: "Agendar visita" }).click();
  const cta = dialog.getByRole("region", { name: "Así se agenda una visita" });
  await expect(cta).toContainText("propiedad ficticia");
  await expect(cta.getByRole("link", { name: "Ver propiedades reales" })).toHaveAttribute("href", "/propiedades");
  await expect(cta.getByRole("link", { name: "Contactanos" })).toHaveAttribute("href", "/contacto");
  await expect(cta.locator("form")).toHaveCount(0);
  expect(await axeSerious(page, "tour abierto")).toEqual([]);
  await page.keyboard.press("Escape"); // cierra el panel
  await expect(cta).toBeHidden();
  await page.keyboard.press("Escape"); // cierra el tour
  await expect(dialog).toBeHidden();
  await expect(enter).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(4);
  await expect(page).toHaveURL(/\/demo\/tour-360$/);

  // "Atrás" del navegador cierra el tour sin salir de la página.
  await enter.click();
  await expect(page.locator(".tour-root")).toHaveAttribute("data-state", "open", { timeout: 30_000 });
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/demo\/tour-360$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Analítica registrada (sin PII): apertura, escenas, hotspot, plano, guiado, CTA y cierre con duración.
  await expect
    .poll(
      async () => {
        const r = await pool.query<{ name: string; n: number }>("select name, count(*)::int as n from site_events where tour_id = $1 and occurred_at >= $2 group by name", [tourId, since]);
        return r.rows.map((x) => x.name).sort();
      },
      { timeout: 15_000 },
    )
    .toEqual(["virtual_tour_closed", "virtual_tour_cta_clicked", "virtual_tour_floorplan_opened", "virtual_tour_guided_started", "virtual_tour_hotspot_clicked", "virtual_tour_opened", "virtual_tour_scene_viewed"]);
  const closed = await pool.query<{ props: { durationMs?: number } }>("select props from site_events where tour_id = $1 and name = 'virtual_tour_closed' and occurred_at >= $2 limit 1", [tourId, since]);
  expect(closed.rows[0]!.props.durationMs).toBeGreaterThan(0);

  expect(problems).toEqual([]);
});

test("demo 1440: accesibilidad (axe) de la ficha demo sin violaciones serias", async ({ page }) => {
  await page.goto("/demo/tour-360");
  await page.waitForLoadState("networkidle");
  expect(await axeSerious(page, "/demo/tour-360")).toEqual([]);
  await page.getByRole("tab", { name: /Tour 360/ }).click();
  expect(await axeSerious(page, "/demo/tour-360 (portada del tour)")).toEqual([]);
  await page.getByRole("tab", { name: "Plano" }).click();
  expect(await axeSerious(page, "/demo/tour-360 (plano)")).toEqual([]);
});

test("CRM: crear tour, subir escenas, hotspot en la vista actual, publicar y verlo en la ficha", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = await watch(page);
  const r = await pool.query<{ id: string; slug: string }>(
    `select p.id, p.slug from properties p where p.is_published and not p.is_demo and p.deleted_at is null and p.status = 'available'
       and not exists (select 1 from virtual_tours t where t.property_id = p.id)
     order by p.code asc limit 1`,
  );
  const prop = r.rows[0]!;
  try {
    await page.goto("/crm/login");
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/crm$/);

    await page.goto(`/crm/propiedades/${prop.id}`);
    await expect(page.getByText("SIN TOUR", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Crear tour" }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/propiedades/${prop.id}/tour$`));
    await page.getByRole("button", { name: "Crear tour" }).click();
    await expect(page.getByLabel("Nombre del ambiente")).toBeVisible();

    for (const [name, file] of [
      ["Living", "living-360.jpg"],
      ["Cocina", "cocina-360.jpg"],
    ]) {
      await page.getByLabel("Nombre del ambiente").fill(name!);
      await page.getByLabel("Panorámica 360°").setInputFiles(resolve(DEMO_DIR, file!));
      await page.getByRole("button", { name: "Subir escena" }).click();
      await expect(page.getByText(`«${name}» agregada.`)).toBeVisible({ timeout: 60_000 });
    }
    await expect(page.getByRole("list", { name: "Escenas del tour" }).getByRole("listitem")).toHaveCount(2);
    await expectCanvasRendered(page);

    // Hotspot en el centro de la vista actual → a la cocina.
    await page.getByLabel("Tipo").selectOption("scene");
    await page.getByLabel("Destino").selectOption({ label: "Cocina" });
    await page.getByLabel("Texto del punto").fill("Ir a la cocina");
    await page.getByRole("button", { name: "Agregar en el centro de la vista" }).click();
    await expect(page.getByText(/Ir a la cocina · lleva a Cocina/)).toBeVisible();
    await page.getByRole("button", { name: "Usar vista actual como vista inicial" }).click();
    await expect(page.getByText("Vista inicial guardada.")).toBeVisible();

    await page.getByRole("button", { name: "Publicar tour" }).click();
    await expect(page.getByText(/Tour publicado/)).toBeVisible();
    await expect(page.getByText("PUBLICADO").first()).toBeVisible();

    const saved = await pool.query<{ status: string; scenes: number; hotspots: number }>(
      `select t.status, (select count(*)::int from virtual_tour_scenes s where s.tour_id = t.id) as scenes,
         (select count(*)::int from virtual_tour_hotspots h join virtual_tour_scenes s on s.id = h.scene_id where s.tour_id = t.id) as hotspots
       from virtual_tours t where t.property_id = $1`,
      [prop.id],
    );
    expect(saved.rows[0]).toEqual({ status: "published", scenes: 2, hotspots: 1 });
    const audit = await pool.query<{ n: number }>("select count(*)::int as n from audit_logs where entity_type = 'virtual_tour' and action = 'VIRTUAL_TOUR_PUBLISHED' and metadata->>'propertyId' = $1", [prop.id]);
    expect(audit.rows[0]!.n).toBe(1);

    // La ficha pública ya muestra la pestaña y la portada del tour (el CRM invalidó la caché).
    await page.goto(`/propiedades/${prop.slug}`);
    await expect(page.getByRole("tab", { name: /Tour 360/ })).toBeVisible();
    await page.getByRole("tab", { name: /Tour 360/ }).click();
    await page.getByRole("button", { name: "Entrar al tour 360°" }).click();
    await expect(page.locator(".tour-root")).toHaveAttribute("data-state", "open", { timeout: 30_000 });
    await expect(page.locator("#tour-title")).toHaveText("Living");
    await page.locator(".tour-hotspot-btn[data-kind='scene']").first().click();
    await expect(page.locator("#tour-title")).toHaveText("Cocina");
    // En una propiedad real, «Agendar visita» abre el formulario real de visita.
    await page.getByRole("button", { name: "Agendar visita" }).click();
    await expect(page.getByRole("region", { name: "Agendar visita" }).getByRole("button", { name: "Pedir visita" })).toBeVisible();
    await page.getByRole("button", { name: "Salir del tour" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(problems.filter((p) => !/Download the React DevTools/.test(p))).toEqual([]);
  } finally {
    await pool.query("update files set deleted_at = now() where storage_key like 'tours/' || (select id::text from virtual_tours where property_id = $1) || '/%'", [prop.id]);
    await pool.query("delete from virtual_tours where property_id = $1", [prop.id]);
    await page.request.post("/api/site/revalidate", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, data: { tags: ["site:properties"], reason: "e2e-tour-cleanup" } });
  }
});
