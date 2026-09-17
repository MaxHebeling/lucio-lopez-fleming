/**
 * E2E mobile (390): agente en la calle + cliente con el link.
 * agente: ver visita → salgo → confirmar llegada (geolocalización simulada) → iniciar → finalizar → informe →
 * seguimiento → agradecimiento. Cliente: abre el link, ve el estado actualizarse y al final la tarjeta.
 */
import { expect, test } from "@playwright/test";
import { e2ePool } from "./db";
import { AGENT_PASSWORD, axeSerious, createAgent, createVisit, loginCrm, pickVisitProperty, shot, watchProblems } from "./visits-helpers";

const pool = e2ePool();
test.afterAll(async () => {
  await pool.end();
});

test.describe.configure({ mode: "serial" });

test("mobile 390: flujo completo del agente y link del cliente en vivo", async ({ browser }) => {
  test.setTimeout(180_000);
  const property = await pickVisitProperty(pool);
  const agent = await createAgent(pool, "Julieta Agente E2E");
  const visit = await createVisit(pool, { agentId: agent.id, property, clientFirstName: "Mariana", startsInMinutes: 10 });

  // Agente: teléfono con ubicación concedida, a ~30 m de la propiedad.
  const agentCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "es-AR",
    timezoneId: "America/Argentina/Salta",
    permissions: ["geolocation"],
    geolocation: { latitude: property.lat + 0.00027, longitude: property.lng, accuracy: 12 },
  });
  const page = await agentCtx.newPage();
  const agentProblems = await watchProblems(page);
  await loginCrm(page, agent.email, AGENT_PASSWORD);
  await page.goto("/crm/mis-visitas");
  const card = page.getByRole("link", { name: new RegExp(`Cód\\. ${property.code}`) }).first();
  await expect(card).toBeVisible();
  await shot(page, "01-agente-mis-visitas-390");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/crm/mis-visitas/${visit.id}$`));
  await expect(page.getByRole("button", { name: "Salgo para allá" })).toBeVisible();
  expect(await axeSerious(page, "detalle de visita")).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Link del cliente (se muestra una sola vez)
  await page.getByRole("button", { name: "Generar link para el cliente" }).click();
  const linkInput = page.getByLabel("Link del cliente");
  await expect(linkInput).toBeVisible();
  const url = await linkInput.inputValue();
  expect(url).toMatch(/\/visita\/[A-Za-z0-9_-]{43}$/);
  const path = new URL(url).pathname;
  await shot(page, "02-agente-detalle-link-390");

  // Cliente: otro teléfono, sin sesión
  const clientCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-AR", timezoneId: "America/Argentina/Salta" });
  const client = await clientCtx.newPage();
  const clientProblems = await watchProblems(client);
  const res = await client.goto(path);
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  expect(res?.headers()["cache-control"]).toContain("no-store");
  expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(client.getByRole("heading", { level: 1, name: "Hola, Mariana." })).toBeVisible();
  await expect(client.getByText("Tu visita está programada")).toBeVisible();
  await client.waitForLoadState("networkidle");
  expect(await axeSerious(client, "link del cliente")).toEqual([]);
  await shot(client, "10-cliente-programada-390");

  // Salgo para allá → el cliente lo ve sin recargar (polling)
  await page.getByRole("button", { name: "Salgo para allá" }).click();
  await expect(page.getByRole("button", { name: "Confirmar llegada" })).toBeVisible();
  await expect(client.getByText("Tu asesor está en camino")).toBeVisible({ timeout: 30_000 });
  await shot(client, "11-cliente-en-camino-390");

  // Confirmar llegada: consentimiento → ubicación → verificado
  await page.getByRole("button", { name: "Confirmar llegada" }).click();
  const consent = page.getByRole("dialog", { name: "Confirmar llegada" });
  await expect(consent.getByText(/ubicación de tu teléfono una sola vez/)).toBeVisible();
  await shot(page, "03-agente-consentimiento-390");
  await consent.getByRole("button", { name: "Usar mi ubicación" }).click();
  const done = page.getByRole("dialog", { name: "Llegada registrada" });
  await expect(done.getByText(/Check-in verificado · aprox\. \d+ m de la propiedad/)).toBeVisible();
  await done.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("button", { name: "Iniciar visita" })).toBeVisible();
  await expect(client.getByText("Tu asesor ya está en la propiedad")).toBeVisible({ timeout: 30_000 });
  await expect(client.getByText(/Llegada confirmada \d{2}:\d{2}/)).toBeVisible();
  await shot(client, "12-cliente-llegada-390");
  await shot(page, "04-agente-checkin-390");

  await page.getByRole("button", { name: "Iniciar visita" }).click();
  await expect(page.getByRole("button", { name: "Finalizar visita" })).toBeVisible();
  await expect(client.getByText("La visita está en curso")).toBeVisible({ timeout: 30_000 });
  await shot(client, "13-cliente-en-curso-390");

  await page.getByRole("button", { name: "Finalizar visita" }).click();
  await page.getByRole("button", { name: "Sí, finalizar" }).click();
  await expect(page.getByRole("form", { name: "Informe post-visita" })).toBeVisible();
  // El cliente deja de ver el estado en vivo: solo el cierre
  await expect(client.getByRole("heading", { name: "Esta visita ha finalizado." })).toBeVisible({ timeout: 30_000 });
  await expect(client.getByText("Tu asesor está en camino")).toHaveCount(0);
  await expect(client.getByText(/Llegada confirmada/)).toHaveCount(0);

  // Informe
  const report = page.getByRole("form", { name: "Informe post-visita" });
  await report.getByLabel("¿Cómo fue la visita?").fill("Le encantó la luz del living. Duda por las expensas.");
  await report.getByText("Alto", { exact: true }).click();
  await report.getByLabel("Objeciones").fill("Expensas");
  await report.getByLabel("Siguiente paso").fill("Enviar detalle de expensas");
  await shot(page, "05-agente-informe-390");
  await report.getByRole("button", { name: "Confirmar informe" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Informe confirmado$/ })).toBeVisible();

  // Seguimiento (sugerido por interés alto)
  const follow = page.getByRole("form", { name: "Crear tarea de seguimiento" });
  await expect(follow.getByLabel("Fecha y hora del seguimiento")).not.toHaveValue("");
  // Interés alto → sugerido 24 h después de finalizar (no 48 h de la sugerencia sin interés)
  const due = await follow.getByLabel("Fecha y hora del seguimiento").inputValue();
  const finished = (await pool.query<{ finished_at: Date }>("select finished_at from appointments where id = $1", [visit.id])).rows[0]!.finished_at;
  const hoursAhead = (new Date(`${due}:00-03:00`).getTime() - finished.getTime()) / 3_600_000;
  expect(hoursAhead).toBeGreaterThan(23.9);
  expect(hoursAhead).toBeLessThan(24.2);
  await follow.getByRole("button", { name: "Crear tarea de seguimiento" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Tarea de seguimiento creada$/ })).toBeVisible();
  const task = await pool.query<{ kind: string; assigned_user_id: string }>("select t.kind, t.assigned_user_id from appointments a join tasks t on t.id = a.follow_up_task_id where a.id = $1", [visit.id]);
  expect(task.rows[0]).toEqual({ kind: "follow_up", assigned_user_id: agent.id });

  // Agradecimiento: plantilla editable, guardar y marcar como enviado (nada se envía solo)
  const thanks = page.getByLabel("Mensaje de agradecimiento");
  await expect(thanks).toHaveValue(/^Hola Mariana, muchas gracias/);
  await thanks.fill("Hola Mariana, gracias por venir hoy. Te paso el detalle de expensas mañana. Julieta.");
  await page.getByRole("button", { name: "Guardar mensaje" }).click();
  await expect(page.getByRole("button", { name: "Mensaje guardado" })).toBeVisible();
  await page.getByRole("button", { name: "Marcar como enviado" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Marcado como enviado · / })).toBeVisible();
  await shot(page, "06-agente-cierre-390");

  await client.reload();
  await expect(client.getByText("Hola Mariana, gracias por venir hoy.", { exact: false })).toBeVisible();
  await expect(client.getByText("Gracias por confiar en Lucio López Fleming.")).toBeVisible();
  expect(await axeSerious(client, "tarjeta de agradecimiento")).toEqual([]);
  await shot(client, "14-cliente-tarjeta-390");

  // Timeline sin coordenadas y link abierto registrado
  const kinds = (await pool.query<{ kind: string }>("select kind from appointment_events where appointment_id = $1 order by id", [visit.id])).rows.map((r) => r.kind);
  expect(kinds).toEqual(expect.arrayContaining(["client_link_created", "client_link_opened", "en_route", "checked_in", "started", "finished", "report_confirmed", "followup_created", "thanks_marked_sent"]));

  expect(agentProblems).toEqual([]);
  expect(clientProblems).toEqual([]);
  await agentCtx.close();
  await clientCtx.close();
});

test("mobile 390: GPS denegado → reportar problema de ubicación sin bloquear la visita", async ({ browser }) => {
  const property = await pickVisitProperty(pool);
  const agent = await createAgent(pool, "Tomás Agente E2E");
  const visit = await createVisit(pool, { agentId: agent.id, property, clientFirstName: "Lucía", startsInMinutes: 5 });
  // Sin permiso de geolocalización: el navegador lo deniega.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-AR", timezoneId: "America/Argentina/Salta" });
  const page = await ctx.newPage();
  const problems = await watchProblems(page);
  await loginCrm(page, agent.email, AGENT_PASSWORD);
  await page.goto(`/crm/mis-visitas/${visit.id}`);
  await page.getByRole("button", { name: "Confirmar llegada" }).click();
  const consent = page.getByRole("dialog", { name: "Confirmar llegada" });
  await consent.getByRole("button", { name: "Usar mi ubicación" }).click();
  await expect(consent.getByText(/No se dio permiso de ubicación|El teléfono no pudo obtener la ubicación|El GPS tardó demasiado/)).toBeVisible({ timeout: 20_000 });
  await consent.getByRole("button", { name: "Reportar problema de ubicación" }).click();
  const dialog = page.getByRole("dialog", { name: "Problema de ubicación" });
  await dialog.getByLabel("Motivo").selectOption("permission_denied");
  await shot(page, "07-agente-gps-denegado-390");
  await dialog.getByRole("button", { name: "Registrar llegada sin ubicación" }).click();
  await expect(page.getByText("Llegada registrada sin ubicación").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar visita" })).toBeVisible();
  const ck = await pool.query("select verification_status, reason, latitude, longitude from appointment_checkins where appointment_id = $1", [visit.id]);
  expect(ck.rows).toEqual([{ verification_status: "no_location", reason: "permission_denied", latitude: null, longitude: null }]);
  // Otro agente no ve esta visita (IDOR → 404)
  const other = await createAgent(pool, "Otro Agente E2E");
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  await loginCrm(p2, other.email, AGENT_PASSWORD);
  const r = await p2.goto(`/crm/mis-visitas/${visit.id}`);
  expect(r?.status()).toBe(404);
  expect(problems).toEqual([]);
  await ctx.close();
  await ctx2.close();
});
