import { expect, test } from "@playwright/test";

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
