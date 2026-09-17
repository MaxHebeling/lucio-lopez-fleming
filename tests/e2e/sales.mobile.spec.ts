/** E2E IA Fase 2 · Ventas en mobile 390: concierge, «Preguntale a esta propiedad» y comparador sin desborde horizontal. */
import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";
import { realHouse, serious, shot, watchConsole } from "./sales-helpers";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const w = await page.evaluate(() => [document.scrollingElement!.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]!);
}

test("mobile 390: concierge → listado explicado → ficha con preguntas → comparar", async ({ page }) => {
  const problems = watchConsole(page);
  const house = await realHouse(pool);
  await page.goto("/");
  const box = page.getByRole("searchbox", { name: "Contanos qué buscás" });
  await box.scrollIntoViewIfNeeded();
  await box.fill(`casa ${house.bedrooms} dormitorios`);
  await shot(page, "sitio-390-home-concierge");
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/propiedades\\?tipo=casa&dormitorios=${house.bedrooms}$`));
  await expect(page.getByRole("list", { name: "Filtros aplicados" })).toContainText("Casa");
  await noHorizontalOverflow(page);
  await shot(page, "sitio-390-listado-concierge");

  await page.goto(`/propiedades/${house.slug}`);
  const qa = page.locator("[data-property-qa]");
  await qa.locator("summary").click();
  await qa.getByRole("textbox", { name: "Tu pregunta sobre esta propiedad" }).fill("¿Tiene la escritura al día?");
  await qa.getByRole("button", { name: "Preguntar" }).click();
  await expect(qa.getByRole("region", { name: "Respuesta sobre la propiedad" })).toContainText("Ese dato no está registrado actualmente.");
  await noHorizontalOverflow(page);
  await page.waitForLoadState("networkidle");
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "sitio-390-ficha-preguntale");

  const codes = (await pool.query<{ code: number }>("select code from properties where is_published and not is_demo and deleted_at is null and status = 'available' and code <> $1 order by code desc limit 1", [house.code])).rows;
  await page.goto(`/propiedades/comparar?codigos=${house.code},${codes[0]!.code}`);
  await expect(page.getByRole("region", { name: "Tabla comparativa (desplazable)" })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.waitForLoadState("networkidle");
  expect(await serious(page, "main")).toEqual([]);
  await shot(page, "sitio-390-comparador", true);
  expect(problems).toEqual([]);
});
