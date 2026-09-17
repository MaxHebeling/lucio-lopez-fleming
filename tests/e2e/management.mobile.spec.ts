/**
 * E2E 390 de la IA de gestión: «Resumen de hoy» en el Tablero y Tareas sugeridas en celular, sin desborde horizontal,
 * axe sin violaciones serias y consola limpia.
 */
import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";
import { ADMIN_EMAIL, ADMIN_PASSWORD, adminId, axeSerious, finishedVisitWithoutReport, loginCrm, overdueFollowUp, shot, watchProblems } from "./management-helpers";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

test("mobile 390: Resumen de hoy legible y bandeja de Tareas sugeridas", async ({ page }) => {
  const problems = await watchProblems(page);
  const admin = await adminId(pool, ADMIN_EMAIL);
  await overdueFollowUp(pool, admin, "Seguimiento vencido E2E mobile");
  await finishedVisitWithoutReport(pool, admin);
  await loginCrm(page, ADMIN_EMAIL, ADMIN_PASSWORD, pool);
  const card = page.getByRole("region", { name: "Resumen de hoy" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: /seguimientos? vencidos?/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "05-tablero-resumen-390");
  expect(await axeSerious(page, "tablero 390")).toEqual([]);

  await page.goto("/crm/tareas-sugeridas");
  await expect(page.getByRole("heading", { level: 1, name: "Tareas sugeridas" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shot(page, "06-tareas-sugeridas-390");
  expect(await axeSerious(page, "tareas sugeridas 390")).toEqual([]);
  expect(problems).toEqual([]);
});
