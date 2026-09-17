/** E2E mobile 390 del «✦ Asistente IA»: botón flotante que no tapa el encabezado, panel usable y sin desborde. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026";

test("mobile 390: botón flotante, Menú visible, panel a pantalla completa, consulta rápida y sin desborde", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.goto("/crm/login");
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/crm$/);

  const menu = page.getByRole("button", { name: "Menú" });
  const launcher = page.getByRole("button", { name: "Asistente IA" });
  await expect(menu).toBeVisible();
  await expect(launcher).toBeVisible();
  // El botón flotante no se superpone con el encabezado ni genera scroll horizontal
  const [menuBox, launcherBox] = [await menu.boundingBox(), await launcher.boundingBox()];
  expect(launcherBox!.y).toBeGreaterThan(menuBox!.y + menuBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Asistente IA" });
  await expect(dialog).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(389);
  await dialog.getByRole("tab", { name: /Analista/ }).click();
  await dialog.getByRole("button", { name: "Tareas vencidas" }).click();
  await expect(dialog.getByRole("region", { name: "Hechos: Tareas vencidas" })).toBeVisible();
  const serious = (await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => v.id)).toEqual([]);
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();
  expect(problems).toEqual([]);
});
