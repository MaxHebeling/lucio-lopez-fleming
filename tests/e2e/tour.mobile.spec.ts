/** Tour 360° en mobile (390): portada, escena, barra de ambientes deslizable, plano como hoja inferior, sin desborde y axe. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } });

test("mobile 390: demo del tour 360° con barra de ambientes, plano y cierre", async ({ page }) => {
  test.setTimeout(150_000);
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(e.message));

  await page.goto("/demo/tour-360");
  await expect(page.getByText("DEMO INTERACTIVA — PROPIEDAD FICTICIA")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const serious = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`)).toEqual([]);

  await page.getByRole("tab", { name: /Tour 360/ }).tap();
  await page.getByRole("button", { name: "Entrar al tour 360°" }).tap();
  const dialog = page.getByTestId("tour-dialog");
  await expect(page.locator(".tour-root")).toHaveAttribute("data-state", "open", { timeout: 30_000 });
  const canvas = page.locator(".tour-viewer canvas").first();
  await expect.poll(async () => Math.max(...(await sharp(await canvas.screenshot()).stats()).channels.map((c) => c.stdev)), { timeout: 20_000 }).toBeGreaterThan(8);

  // En touch las etiquetas de los puntos se ven sin hover y el área táctil es ≥ 44 px.
  const hotspot = page.locator(".tour-hotspot-btn").first();
  const box = await hotspot.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(Number(await hotspot.locator(".tour-hotspot-label").evaluate((el) => getComputedStyle(el).opacity))).toBe(1);

  // Barra de ambientes: deslizable, con scroll-snap; tocar un ambiente cambia de escena.
  const rooms = dialog.getByRole("navigation", { name: "Ambientes" });
  const list = rooms.locator("ul");
  expect(await list.evaluate((el) => getComputedStyle(el).scrollSnapType)).toContain("x");
  expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const piscina = rooms.getByRole("button", { name: "Piscina" });
  await piscina.scrollIntoViewIfNeeded();
  await piscina.tap();
  await expect(page.locator("#tour-title")).toHaveText("Piscina");

  // Plano como hoja inferior.
  await dialog.getByRole("button", { name: "Plano", exact: true }).tap();
  const plan = dialog.getByRole("region", { name: "Plano" });
  await expect(plan).toBeVisible();
  const sheet = await plan.boundingBox();
  expect(Math.round(sheet!.y + sheet!.height)).toBeGreaterThanOrEqual(840);
  await plan.getByRole("button", { name: "Ir a Galería" }).tap();
  await expect(page.locator("#tour-title")).toHaveText("Galería");

  expect((await new AxeBuilder({ page }).include("[data-testid='tour-dialog']").withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await dialog.getByRole("button", { name: "Salir del tour" }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(problems).toEqual([]);
});
