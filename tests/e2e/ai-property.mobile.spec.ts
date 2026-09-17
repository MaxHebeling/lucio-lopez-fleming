/**
 * E2E AI Property + IA de visitas (mobile 390): guía del tour, captación paso a paso en el home (un único lead) y brief
 * «Antes de la visita» en Mis visitas. Sin clave de IA; axe, consola limpia y sin scroll horizontal.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { cleanupE2eContact, e2ePool } from "./db";
import { AGENT_PASSWORD, axeSerious, createAgent, createVisit, loginCrm, pickVisitProperty, shot, watchProblems } from "./visits-helpers";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});
test.describe.configure({ mode: "serial" });

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("tour 390: «¿dónde está la pileta?» → Ir a la Piscina", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await watchProblems(page);
  await page.goto("/demo/tour-360");
  await page.getByRole("tab", { name: /Tour 360/ }).click();
  await page.getByRole("button", { name: "Entrar al tour 360°" }).click();
  const dialog = page.getByTestId("tour-dialog");
  await expect(page.locator(".tour-root")).toHaveAttribute("data-state", "open", { timeout: 30_000 });
  await dialog.getByRole("button", { name: "Preguntá" }).click();
  await dialog.getByLabel("Preguntá por un ambiente o un dato").fill("¿dónde está la pileta?");
  await dialog.getByRole("button", { name: "Preguntar" }).click();
  await expect(dialog.getByText("Desde la Entrada podés ir al Living, luego a la Galería y luego a la Piscina.")).toBeVisible();
  const axe = await new AxeBuilder({ page }).include(".tour-sheet").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  await shot(page, "ai-07-tour-guia-390");
  await dialog.getByRole("button", { name: "Ir a la Piscina" }).click();
  await expect(page.locator("#tour-title")).toHaveText("Piscina", { timeout: 45_000 });
  expect(problems.filter((p) => !/Failed to fetch/.test(p))).toEqual([]);
});

test("home 390: «Quiero vender mi propiedad» paso a paso crea un único lead sell_my_property", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await watchProblems(page);
  const email = `e2e-owner-steps-${Date.now()}@prueba.test`;
  try {
    await page.goto("/");
    const form = page.locator("#vender form");
    await form.scrollIntoViewIfNeeded();
    await expect(form.getByText("Paso 1 de 6")).toBeVisible();
    // El paso de fotos no aparece sin storage S3 (sin botones muertos).
    await expect(form.getByText(/¿Querés sumar fotos\?/)).toBeHidden();
    await form.getByRole("button", { name: "Siguiente" }).click();
    await expect(form.getByText("Contanos dónde está la propiedad")).toBeVisible();
    await form.getByLabel("Barrio o localidad").fill("Villa San Lorenzo");
    await form.getByRole("button", { name: "Siguiente" }).click();
    await expect(form.getByRole("group", { name: "¿Qué tipo de propiedad es?" })).toBeVisible();
    await form.getByRole("radiogroup", { name: "Tipo de propiedad" }).getByRole("radio").first().check();
    await shot(page, "ai-08-captacion-paso2-390");
    await form.getByRole("button", { name: "Siguiente" }).click();
    await form.getByLabel(/Superficie aproximada/).fill("210");
    await form.getByRole("button", { name: "Siguiente" }).click();
    await form.getByLabel(/Dormitorios/).fill("3");
    await form.getByRole("button", { name: "Siguiente" }).click();
    await form.getByRole("radio", { name: "Muy bueno" }).check();
    await form.getByRole("button", { name: "Siguiente" }).click();
    await expect(form.getByText("Paso 6 de 6")).toBeVisible();
    await expect(form.getByText("No damos valores automáticos: un asesor te va a contactar para una tasación profesional.")).toBeVisible();
    await form.getByLabel("Nombre y apellido").fill("Propietaria Pasos E2E");
    await form.getByLabel("Email").fill(email);
    // Axe acotado a la sección bajo prueba: la portada completa ya la revisa mobile.spec.ts (en reposo, sin las
    // animaciones de entrada que al hacer scroll dan falsos positivos de contraste a mitad del fundido).
    const axe = await new AxeBuilder({ page }).include("#vender").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "ai-09-captacion-contacto-390");
    await form.getByRole("button", { name: "Quiero vender mi propiedad" }).dblclick();
    await expect(form.getByRole("status")).toContainText("Recibimos los datos de tu propiedad");
    const leads = await pool.query<{ source_key: string; operation_interest: string; message: string }>(
      "select l.source_key, l.operation_interest, l.message from leads l join contact_emails ce on ce.contact_id = l.contact_id where ce.email = $1",
      [email],
    );
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0]).toMatchObject({ source_key: "web_appraisal", operation_interest: "sell_my_property" });
    expect(leads.rows[0]!.message).toContain("Ubicación: Villa San Lorenzo");
    expect(leads.rows[0]!.message).toContain("Superficie aproximada: 210 m²");
    expect(leads.rows[0]!.message).toContain("Dormitorios: 3");
    expect(leads.rows[0]!.message).toContain("Estado: Muy bueno");
    expect(problems).toEqual([]);
  } finally {
    await cleanupE2eContact(pool, email);
  }
});

test("Mis visitas 390: brief «Antes de la visita» con lo NO REGISTRADO", async ({ browser }) => {
  test.setTimeout(120_000);
  const property = await pickVisitProperty(pool);
  const agent = await createAgent(pool, "Brief Agente E2E");
  const visit = await createVisit(pool, { agentId: agent.id, property, clientFirstName: "Lucía", startsInMinutes: 90 });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-AR", timezoneId: "America/Argentina/Salta" });
  const page = await ctx.newPage();
  const problems = await watchProblems(page);
  await loginCrm(page, agent.email, AGENT_PASSWORD);
  await page.goto(`/crm/mis-visitas/${visit.id}`);
  const brief = page.getByTestId("visit-brief");
  await expect(brief).toBeVisible();
  await expect(brief.getByRole("region", { name: "Cliente" })).toContainText("Lucía Prueba E2E");
  await expect(brief.getByRole("region", { name: "Propiedad" })).toContainText(`#${property.code}`);
  await expect(brief.getByRole("region", { name: "No registrado" })).toBeVisible();
  // «Actualizar» lo prepara y guarda (sin IA: determinista).
  await page.getByRole("button", { name: "Actualizar" }).click();
  await expect(brief.getByText(/Preparado/)).toBeVisible({ timeout: 20_000 });
  expect(await axeSerious(page, "brief de visita")).toEqual([]);
  expect(await noOverflow(page)).toBeLessThanOrEqual(0);
  await shot(page, "ai-10-brief-visita-390");
  expect(problems).toEqual([]);
  await ctx.close();
});
