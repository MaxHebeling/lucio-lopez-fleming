/**
 * E2E AI Property (desktop 1440) contra el build de producción SIN ANTHROPIC_API_KEY (estado real de hoy):
 * calidad de la publicación con links, etiquetado de ambientes, orden sugerido aplicado (confirmación + auditoría),
 * borradores de marketing, ficha imprimible, análisis de inventario, guía «Preguntá» del tour 360°; axe y consola limpia.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { e2ePool } from "./db";
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginCrm, shot, watchProblems } from "./visits-helpers";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});
test.describe.configure({ mode: "serial" });

async function axeIn(page: Page, selector: string) {
  const r = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${selector}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`);
}

async function propertyWithPhotos() {
  const r = await pool.query<{ id: string; code: number }>(
    `select p.id, p.code from properties p
      where p.is_published and not p.is_demo and p.deleted_at is null
        and (select count(*) from property_media m where m.property_id = p.id and m.kind = 'image' and m.deleted_at is null and m.status <> 'failed') >= 3
      order by p.code desc limit 1`,
  );
  return r.rows[0]!;
}

test("CRM 1440: calidad de la publicación, ambientes, orden sugerido, borradores y ficha imprimible", async ({ page, context }) => {
  test.setTimeout(180_000);
  const problems = await watchProblems(page);
  const prop = await propertyWithPhotos();
  await pool.query("delete from property_media_rooms where property_id = $1", [prop.id]);
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`/crm/propiedades/${prop.id}`);

  // Calidad: si no hay informe todavía, se calcula en el momento.
  const quality = page.getByTestId("quality-panel");
  if (!(await quality.isVisible())) {
    await page.getByRole("button", { name: "Calcular ahora" }).click();
    await expect(quality).toBeVisible({ timeout: 30_000 });
  }
  await expect(quality.getByRole("meter", { name: /Calidad de la publicación: \d+ de 100/ })).toBeVisible();
  await expect(quality.getByRole("heading", { name: /Qué falta/ })).toBeVisible();
  await expect(quality.getByText(/fotos? no analizadas?: fotos? externas?/).first()).toBeVisible();
  expect(await axeIn(page, "#calidad")).toEqual([]);
  await shot(page, "ai-01-ficha-calidad-1440");

  // Multimedia: etiquetar la tercera foto como Fachada → aparece la sugerencia de orden y portada.
  const cards = page.locator("#multimedia ol.grid > li");
  const third = cards.nth(2);
  const thirdImg = await third.locator("img").first().getAttribute("src");
  await third.getByLabel("Ambiente").selectOption("fachada");
  const director = page.getByTestId("photo-director");
  await expect(director.getByRole("button", { name: "Aplicar orden sugerido" })).toBeVisible({ timeout: 20_000 });
  await expect(director.getByText(/Portada sugerida: fachada/)).toBeVisible();
  expect(await axeIn(page, "#multimedia")).toEqual([]);
  await director.scrollIntoViewIfNeeded();
  await shot(page, "ai-02-director-fotos-1440");
  page.once("dialog", (d) => void d.accept());
  await director.getByRole("button", { name: "Aplicar orden sugerido" }).click();
  await expect(director.getByText("El orden y la portada actuales coinciden con los sugeridos.")).toBeVisible({ timeout: 20_000 });
  await expect(cards.first().getByText("Portada")).toBeVisible();
  expect(await cards.first().locator("img").first().getAttribute("src")).toBe(thirdImg);
  const audit = await pool.query("select 1 from audit_logs where entity_id = $1 and action = 'PROPERTY_MEDIA_SUGGESTED_ORDER_APPLIED'", [prop.id]);
  expect(audit.rowCount).toBe(1);

  // Link «Completar» lleva a la sección exacta.
  const completar = quality.getByRole("link", { name: "Completar" }).first();
  expect(await completar.getAttribute("href")).toMatch(/^(#[a-z]+|\/crm\/propiedades\/[0-9a-f-]{36}(\/editar|\/tour)?(#[A-Za-z]+)?)$/);

  // Marketing: borradores con plantillas (sin clave), en borrador; ficha imprimible con datos públicos.
  const marketing = page.getByTestId("marketing-panel");
  await marketing.getByRole("button", { name: "Generar borradores" }).click();
  await expect(marketing.getByRole("heading", { name: "WhatsApp" })).toBeVisible({ timeout: 20_000 });
  await expect(marketing.getByLabel("Mensaje")).toHaveValue(/Ficha completa: http/);
  await expect(marketing.getByText("Revisar, elegir fotos y aprobar").first()).toBeVisible();
  const posts = await pool.query<{ status: string }>("select status from social_posts where property_id = $1 and template_key like 'ai_director_%'", [prop.id]);
  expect(posts.rows.map((r) => r.status)).toEqual(["draft", "draft"]);
  expect(await axeIn(page, "#marketing")).toEqual([]);
  await page.locator("#marketing").scrollIntoViewIfNeeded();
  await shot(page, "ai-03-marketing-1440");

  const [sheet] = await Promise.all([context.waitForEvent("page"), marketing.getByRole("link", { name: "Ficha imprimible" }).click()]);
  const sheetProblems = await watchProblems(sheet);
  await sheet.waitForLoadState("networkidle");
  await expect(sheet.getByTestId("printable-sheet")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Imprimir / Guardar PDF" })).toBeVisible();
  await expect(sheet.getByText(`${prop.code}`, { exact: true })).toBeVisible();
  await expect(sheet.getByText(/Propietari/)).toHaveCount(0);
  const sheetAxe = await new AxeBuilder({ page: sheet }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(sheetAxe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await shot(sheet, "ai-04-ficha-imprimible-1440");
  expect(sheetProblems).toEqual([]);
  await sheet.close();
  expect(problems).toEqual([]);
});

test("CRM 1440: listado filtrado por calidad y análisis de inventario", async ({ page }) => {
  const problems = await watchProblems(page);
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/crm/propiedades?sort=quality_asc&quality=low");
  await expect(page.getByRole("heading", { level: 1, name: "Propiedades" })).toBeVisible();
  await expect(page.getByLabel("Calidad de la publicación")).toHaveValue("low");
  await page.getByRole("link", { name: "Análisis de inventario" }).click();
  await expect(page).toHaveURL(/\/crm\/propiedades\/inventario$/);
  await expect(page.getByRole("region", { name: "Análisis de inventario" })).toBeVisible();
  await expect(page.getByText(/no indican la causa/)).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await shot(page, "ai-05-inventario-1440");
  expect(problems).toEqual([]);
});

test("tour 360° 1440: «¿Dónde está el jardín?» → Ir a la Galería (paso a paso) con teclado y axe", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await watchProblems(page);
  await page.goto("/demo/tour-360");
  await page.getByRole("tab", { name: /Tour 360/ }).click();
  await page.getByRole("button", { name: "Entrar al tour 360°" }).click();
  const dialog = page.getByTestId("tour-dialog");
  await expect(page.locator(".tour-root")).toHaveAttribute("data-state", "open", { timeout: 30_000 });
  await dialog.getByRole("button", { name: "Preguntá" }).click();
  const input = dialog.getByLabel("Preguntá por un ambiente o un dato");
  await input.fill("¿Dónde está el jardín?");
  await page.keyboard.press("Enter");
  const answer = dialog.getByRole("status").filter({ hasText: "Galería" });
  await expect(answer).toContainText("No hay una escena de jardín en el tour; lo más cercano es la Galería. Desde la Entrada podés ir al Living y luego a la Galería.");
  expect(await axeIn(page, ".tour-sheet")).toEqual([]);
  await shot(page, "ai-06-tour-guia-1440");
  await dialog.getByRole("button", { name: "Ir a la Galería" }).click();
  await expect(page.locator("#tour-title")).toHaveText("Galería", { timeout: 30_000 });
  // Dato no registrado → respuesta honesta y CTA real.
  await dialog.getByRole("button", { name: "Preguntá" }).click();
  await dialog.getByLabel("Preguntá por un ambiente o un dato").fill("¿Cuánto son las expensas?");
  await dialog.getByRole("button", { name: "Preguntar" }).click();
  await expect(dialog.getByText("No está registrado en la ficha ni en el tour. Consultalo con el asesor.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Consultar al asesor" })).toBeVisible();
  expect(problems.filter((p) => !/Failed to fetch/.test(p))).toEqual([]);
});
