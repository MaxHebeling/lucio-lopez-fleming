import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
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

test("galería 1440: el foco no escapa del diálogo ni cae en flechas deshabilitadas", async ({ page }) => {
  const { slug } = await publishedSlug();
  await page.goto(`/propiedades/${slug}`);
  // Mosaico: cada foto visible es un tab stop (≤ 5) y las ocultas no.
  const region = page.getByRole("region", { name: /^Fotos de / });
  const tabbable = await region.evaluate((el) => Array.from(el.querySelectorAll("button")).filter((b) => b.tabIndex >= 0 && b.getClientRects().length > 0).length);
  expect(tabbable).toBeGreaterThan(0);
  expect(tabbable).toBeLessThanOrEqual(5);

  const opener = page.getByRole("button", { name: /Ver las \d+ fotos/ });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /Galería/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cerrar galería" })).toBeFocused();
  // En la primera foto "anterior" está deshabilitada: el ciclo es Cerrar ↔ Siguiente.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement) && !(document.activeElement as HTMLButtonElement).disabled)).toBe(true);
  }
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("pipeline: «Mover a…» deja el foco en el control de la tarjeta en su nueva columna", async ({ page }) => {
  const r = await pool.query<{ id: string; stages: Array<{ id: string; name: string; outcome: string }> }>(
    `with p as (select id from pipelines where key = 'ventas'),
       c as (insert into contacts (organization_id, display_name) select id, 'Pipeline Foco E2E' from organizations order by created_at limit 1 returning id, organization_id)
     insert into opportunities (organization_id, contact_id, pipeline_id, stage_id, title)
       select c.organization_id, c.id, (select id from p), (select s.id from pipeline_stages s where s.pipeline_id = (select id from p) order by s.sort_order limit 1), 'Foco E2E ${Date.now()}' from c
     returning id, (select json_agg(json_build_object('id', s.id, 'name', s.name, 'outcome', s.outcome) order by s.sort_order) from pipeline_stages s where s.pipeline_id = (select id from p)) as stages`,
  );
  const opp = r.rows[0]!;
  const target = opp.stages.find((s, i) => i > 0 && s.outcome === "open")!;
  try {
    await page.goto("/crm/login");
    await page.fill("#email", process.env.E2E_ADMIN_EMAIL ?? "admin@llf.local");
    await page.fill("#password", process.env.E2E_ADMIN_PASSWORD ?? "Admin-local-2026");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/crm$/);
    await page.goto("/crm/pipeline?pipeline=ventas");
    const select = page.locator(`#mv-${opp.id}`);
    await select.selectOption(target.id);
    await select.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(`#mv-${opp.id} + button`)).toBeFocused();
    await page.keyboard.press("Enter");
    const column = page.getByRole("region", { name: "Tablero de oportunidades", exact: true }).locator("section", { has: page.locator(`#mv-${opp.id}`) });
    await expect(column).toHaveAttribute("aria-label", new RegExp(`^${target.name}:`));
    await expect(page.locator(`#mv-${opp.id}`)).toBeFocused();
    await expect.poll(async () => (await pool.query("select stage_id from opportunities where id = $1", [opp.id])).rows[0].stage_id).toBe(target.id);
    await expect(page.locator(`#mv-${opp.id}`)).toBeFocused();
  } finally {
    const c = await pool.query<{ contact_id: string }>("select contact_id from opportunities where id = $1", [opp.id]);
    await pool.query("delete from opportunity_stage_history where opportunity_id = $1", [opp.id]).catch(() => undefined);
    await pool.query("delete from activities where entity_type = 'opportunity' and entity_id = $1", [opp.id]).catch(() => undefined);
    await pool.query("delete from opportunities where id = $1", [opp.id]);
    await pool.query("delete from contacts where id = $1", [c.rows[0]!.contact_id]).catch(() => undefined);
  }
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

test("formulario: un rechazo del servidor conserva lo escrito y el reintento crea un único lead con la misma clave", async ({ page }) => {
  const { slug } = await publishedSlug();
  const stamp = Date.now();
  const email = `e2e-retry-${stamp}@prueba.test`;
  try {
    await page.goto(`/propiedades/${slug}`);
    const form = page.locator("#consulta form").first();
    const submit = form.getByRole("button", { name: "Enviar consulta" });
    const keyInput = form.locator('input[name="idempotencyKey"]');
    await expect(keyInput).toHaveValue(/^[A-Za-z0-9-]{16,}$/);
    const key = await keyInput.inputValue();
    await form.getByLabel("Nombre y apellido").fill("Reintento E2E");
    await form.getByLabel("Mensaje").fill(`Mensaje que no se pierde ${stamp}`);

    // Sin teléfono ni email: se frena en el navegador, sin viajar al servidor.
    await submit.click();
    await expect(form.getByText("Dejanos un teléfono o un email para responderte")).toBeVisible();
    await expect(form.getByLabel("Teléfono / WhatsApp")).toBeFocused();

    // Teléfono inválido: lo rechaza el servidor y todo lo escrito sigue ahí.
    await form.getByLabel("Teléfono / WhatsApp").fill("12");
    await form.getByLabel("Email").fill(email);
    await submit.click();
    await expect(form.getByText("Revisá el teléfono (con código de área)")).toBeVisible();
    await expect(form.getByLabel("Nombre y apellido")).toHaveValue("Reintento E2E");
    await expect(form.getByLabel("Email")).toHaveValue(email);
    await expect(form.getByLabel("Mensaje")).toHaveValue(`Mensaje que no se pierde ${stamp}`);
    await expect(form.getByLabel("Teléfono / WhatsApp")).toHaveValue("12");
    await expect(keyInput).toHaveValue(key);

    // Corrección y reintento: mismo envío, misma clave; queda un solo lead.
    await form.getByLabel("Teléfono / WhatsApp").fill(`387 5${String(stamp).slice(-6)}`);
    await submit.click();
    await expect(form.getByRole("status")).toContainText("Recibimos tu consulta");
    // Tras el éxito: formulario limpio y clave nueva (la próxima consulta es otra).
    await expect(form.getByLabel("Nombre y apellido")).toHaveValue("");
    await expect(keyInput).not.toHaveValue(key);

    const leads = await pool.query<{ idempotency_key: string | null }>("select l.idempotency_key from leads l join contact_emails ce on ce.contact_id = l.contact_id where ce.email = $1", [email]);
    expect(leads.rows).toEqual([{ idempotency_key: `web:${key}` }]);
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
    ["/company/", "/empresa"],
    ["/contact", "/contacto"],
  ]) {
    const res = await request.get(from!, { maxRedirects: 0 });
    expect(res.status(), from).toBe(301);
    expect(res.headers()["location"]).toMatch(new RegExp(`${to}$`));
  }
  // Barra final en rutas propias: un solo salto a la URL sin barra
  const slash = await request.get("/propiedades/venta/", { maxRedirects: 0 });
  expect(slash.status()).toBe(308);
  expect(slash.headers()["location"]).toMatch(/\/propiedades\/venta$/);
  expect((await request.get("/tasaciones")).status()).toBe(200);

  // Código del sitio anterior de una propiedad hoy no publicada → 301 a la búsqueda por su tipo (y operación/zona)
  const gone = await pool.query<{ path: string; type_key: string }>(
    "select r.path, p.type_key from property_redirects r join properties p on p.id = r.property_id where not p.is_published and r.path like '/luciolopez-%' limit 1",
  );
  if (gone.rows[0]) {
    const res = await request.get(gone.rows[0].path, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"]).toMatch(new RegExp(`/propiedades(/venta|/alquiler)?\\?tipo=${gone.rows[0].type_key}`));
  }
  // Código inexistente → 404 real con la página del sitio (enlaces para seguir)
  const missing = await request.get("/luciolopez-9999999", { maxRedirects: 0 });
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("Ver propiedades");
});

test("reduced motion: todo visible y sin atributo de movimiento activo", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("heading", { name: /a los cerros del valle/ }).scrollIntoViewIfNeeded();
  const hidden = await page.evaluate(() => Array.from(document.querySelectorAll("[data-reveal]")).filter((el) => Number(getComputedStyle(el).opacity) < 1).length);
  expect(hidden).toBe(0);
  // Sin movimiento: la portada no queda fija debajo, no se carga el motor de scroll y el manifiesto no se atenúa.
  expect(await page.locator("[data-hero]").evaluate((el) => getComputedStyle(el).position)).not.toBe("sticky");
  // Recorrido en versión estable: nunca fijado; fila editorial de 3–4 escenas con su texto y el acceso a la ficha.
  const journey = page.locator("[data-journey]");
  await expect(journey).not.toHaveAttribute("data-pinned", "");
  const shown = await journey.locator(".jr-scene").evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== "none").length);
  expect(shown).toBeGreaterThanOrEqual(3);
  expect(shown).toBeLessThanOrEqual(4);
  await expect(journey.getByRole("link", { name: /Ver la propiedad|Explorar propiedades/ }).first()).toBeVisible();
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => document.documentElement.classList.contains("lenis"))).toBe(false);
  await expect(journey).not.toHaveAttribute("data-pinned", "");
  expect(await page.evaluate(() => Array.from(document.querySelectorAll(".word")).every((w) => getComputedStyle(w).opacity === "1"))).toBe(true);
  await ctx.close();
});

test("sin JavaScript el contenido y el buscador siguen ahí", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Buenos negocios/ })).toBeVisible();
  await expect(page.getByRole("search", { name: "Buscar propiedades" })).toBeVisible();
  // Recorrido de la portada: sin JS, fila estable con texto real y link visible (ficha o propiedades).
  await expect(page.locator("[data-journey] .jr-scene[data-static]").first()).toBeVisible();
  await expect(page.locator("[data-journey]").getByRole("link", { name: /Ver la propiedad|Explorar propiedades/ }).first()).toBeVisible();
  // Servicios: sin JS se leen todos los paneles; la captación de propietarios sigue siendo un formulario usable.
  for (const name of ["Venta de inmuebles y lotes", "Alquileres", "Administración de alquileres", "Tasaciones"]) {
    await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator("#vender form")).toBeVisible();
  await page.goto("/propiedades");
  await expect(page.locator("article").first()).toBeVisible();
  await ctx.close();
});

test("accesibilidad (axe) 1440: home, listado, ficha, contacto, tasaciones y empresa sin violaciones serias", async ({ page }) => {
  test.setTimeout(150_000);
  const { slug } = await publishedSlug();
  for (const path of ["/", "/propiedades", `/propiedades/${slug}`, "/contacto", "/tasaciones", "/empresa"]) {
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

test("home: portada con la foto de la oficina (explícita y con prioridad alta), destacadas reales y buscador con precio", async ({ page }) => {
  await page.goto("/");
  const cover = page.locator("[data-hero] .cover-img");
  await expect(cover).toBeVisible();
  expect(await cover.getAttribute("src")).toContain("oficina-modular");
  expect(await cover.getAttribute("alt")).toMatch(/Oficina modular/);
  expect(await cover.getAttribute("fetchpriority")).toBe("high");
  expect(await cover.getAttribute("loading")).not.toBe("lazy");
  // LCP: ni la foto ni ningún contenedor parten de opacity 0 (la entrada solo escala).
  const opacities = await cover.evaluate((img) => {
    const out: number[] = [];
    for (let el: Element | null = img; el && el !== document.body; el = el.parentElement) out.push(Number(getComputedStyle(el).opacity));
    return out;
  });
  expect(Math.min(...opacities)).toBe(1);
  // Las fotos del recorrido nunca compiten con la portada.
  const journeyImgs = page.locator("[data-journey] .jr-img");
  expect(await journeyImgs.count()).toBeGreaterThan(0);
  expect(await journeyImgs.evaluateAll((imgs) => imgs.every((i) => i.getAttribute("loading") === "lazy" && i.getAttribute("fetchpriority") !== "high"))).toBe(true);

  const featured = page.getByRole("region", { name: /Propiedades para mirar dos veces/ }).or(page.locator('section[aria-labelledby="destacadas-title"]'));
  await expect(featured).toBeVisible();
  const links = featured.locator('h3 a[href^="/propiedades/"]');
  await expect(links).toHaveCount(3);
  // Las destacadas son publicadas de verdad: la primera abre su ficha.
  const href = await links.first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);

  const search = page.getByRole("search", { name: "Buscar propiedades" });
  await search.getByLabel("Operación").selectOption("venta");
  await search.getByLabel("Precio hasta").selectOption("250000");
  await search.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/\/propiedades\/venta\?.*moneda=USD.*precio_max=250000|\/propiedades\/venta\?.*precio_max=250000.*moneda=USD/);
});

test("servicios 1440: índice interactivo con teclado (foco cambia la lámina, Tab entra a su CTA)", async ({ page }) => {
  await page.goto("/");
  const list = page.locator(".svc-list");
  await list.scrollIntoViewIfNeeded();
  await expect(list).toHaveAttribute("data-layout", "index");
  const first = list.getByRole("button", { name: "Venta de inmuebles y lotes", exact: true });
  const second = list.getByRole("button", { name: "Alquileres", exact: true });
  await first.focus();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /propiedades? en venta/ })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("region", { name: "Alquileres", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Venta de inmuebles y lotes", exact: true })).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /propiedades? en alquiler/ })).toBeFocused();
});

test("captación: «Quiero vender mi propiedad» crea un único lead sell_my_property en el CRM", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-owner-${stamp}@prueba.test`;
  try {
    await page.goto("/");
    await page.getByRole("link", { name: "Quiero vender mi propiedad" }).first().click();
    const form = page.locator("#vender form");
    await expect(form.getByRole("radio", { name: "Vender" })).toBeInViewport();
    await expect(form.getByRole("radio", { name: "Vender" })).toBeChecked();
    // Paso a paso (flag owner_capture_steps): sin ubicación no avanza; sin teléfono ni email, error propio.
    const next = form.getByRole("button", { name: "Siguiente" });
    await next.click();
    await expect(form.getByText("Contanos dónde está la propiedad")).toBeVisible();
    await form.getByLabel("Barrio o localidad").fill("Villa San Lorenzo");
    await next.click();
    await form.getByRole("radiogroup", { name: "Tipo de propiedad" }).getByRole("radio").nth(1).check();
    // Cada paso espera su render: los clics encadenados no deben adelantarse al estado.
    for (let n = 3; n <= 6; n++) {
      await next.click();
      await expect(form.getByText(`Paso ${n} de 6`)).toBeVisible();
    }
    const submit = form.getByRole("button", { name: "Quiero vender mi propiedad" });
    const name = form.getByLabel("Nombre y apellido");
    await name.fill("Propietaria E2E");
    await expect(name).toHaveValue("Propietaria E2E");
    await submit.click();
    await expect(form.getByText("Dejanos un teléfono o un email para responderte")).toBeVisible();
    const emailInput = form.getByLabel("Email");
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await form.getByLabel("Contanos algo más (opcional)").fill(`Casa con pileta ${stamp}`);
    await expect(form.getByLabel("Teléfono / WhatsApp")).toHaveValue("");
    await submit.dblclick();
    await expect(form.getByRole("status")).toContainText("Recibimos los datos de tu propiedad");
    const leads = await pool.query<{ source_key: string; operation_interest: string; message: string; idempotency_key: string | null }>(
      `select l.source_key, l.operation_interest, l.message, l.idempotency_key from leads l
       join contact_emails ce on ce.contact_id = l.contact_id where ce.email = $1`,
      [email],
    );
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0]).toMatchObject({ source_key: "web_appraisal", operation_interest: "sell_my_property" });
    expect(leads.rows[0]!.message).toContain("Ubicación: Villa San Lorenzo");
    expect(leads.rows[0]!.idempotency_key).toMatch(/^web:/);
    // Tras el éxito el objetivo vuelve a "Vender" y el botón a su texto.
    await expect(form.getByRole("button", { name: "Quiero vender mi propiedad" })).toBeVisible();
  } finally {
    await cleanupE2eContact(pool, email);
  }
});

test("tasación: el formulario de /tasaciones crea un lead web_appraisal", async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-tasacion-${stamp}@prueba.test`;
  try {
    await page.goto("/tasaciones");
    const form = page.locator("form", { has: page.getByRole("button", { name: "Pedir tasación" }) });
    await form.getByLabel("Nombre y apellido").fill("Tasación E2E");
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Dirección o zona").fill("Tres Cerritos");
    await form.getByRole("button", { name: "Pedir tasación" }).click();
    await expect(form.getByRole("status")).toContainText("Recibimos tu pedido de tasación");
    const leads = await pool.query<{ source_key: string; operation_interest: string }>(
      "select l.source_key, l.operation_interest from leads l join contact_emails ce on ce.contact_id = l.contact_id where ce.email = $1",
      [email],
    );
    expect(leads.rows).toEqual([{ source_key: "web_appraisal", operation_interest: "appraisal" }]);
  } finally {
    await cleanupE2eContact(pool, email);
  }
});

test("motor de escenas desktop: Lenis y el recorrido fijado se activan sin romper anclas ni el foco", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("lenis")), { timeout: 8000 }).toBe(true);
  await expect(page.locator("[data-journey]")).toHaveAttribute("data-pinned", "", { timeout: 8000 });
  expect(await page.locator("[data-jr-stage]").evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  // Ancla interna: el enlace de la portada lleva a la captación (atraviesa el recorrido).
  await page.getByRole("link", { name: "Quiero vender mi propiedad" }).first().click();
  await expect.poll(() => page.locator("#vender").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
  // Volver con teclado al buscador de la portada lo deja a la vista (no queda tapado por el recorrido).
  await page.getByRole("search", { name: "Buscar propiedades" }).getByLabel("Operación").focus();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
});

/** Lleva el scroll a una fracción del recorrido fijado de la portada. */
async function scrollJourney(page: Page, fraction: number) {
  await page.evaluate((f) => {
    const root = document.querySelector<HTMLElement>("[data-journey]")!;
    const top = root.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.round(top + (root.offsetHeight - window.innerHeight) * f));
  }, fraction);
}

test("recorrido desktop: avanza con el scroll, el indicador cambia y el cierre lleva a la ficha real de la 2605", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));
  const property = (await pool.query<{ slug: string; available: boolean }>("select slug, (is_published and status = 'available' and deleted_at is null) as available from properties where code = 2605")).rows[0];
  test.skip(!property?.available, "la base e2e no tiene la Cód. 2605 disponible");
  await page.goto("/");
  const journey = page.locator("[data-journey]");
  await expect(journey).toHaveAttribute("data-journey", "property");
  await expect(journey).toHaveAttribute("data-pinned", "", { timeout: 8000 });
  const count = page.locator("[data-jr-count]");
  await expect(count).toHaveText("01");
  await expect(page.locator('[data-jr-step][aria-current="step"]')).toHaveText("Portada");

  // Scroll lento: el indicador avanza escena por escena.
  const seen = new Set<string>();
  for (const f of [0.05, 0.15, 0.3, 0.45, 0.6, 0.75]) {
    await scrollJourney(page, f);
    await page.waitForTimeout(450);
    seen.add((await count.textContent()) ?? "");
  }
  expect(seen.size).toBeGreaterThanOrEqual(4);
  await expect(page.locator('[data-jr-step][aria-current="step"]')).not.toHaveText("Portada");

  // Salto rápido al final: cierre sobre papel con la ficha real.
  await scrollJourney(page, 1);
  await expect(count).toHaveText("07", { timeout: 5000 });
  const cta = journey.getByRole("link", { name: /Ver la propiedad/ });
  await expect(cta).toHaveAttribute("href", `/propiedades/${property!.slug}`);
  await expect.poll(() => cta.evaluate((el) => Number(getComputedStyle(el.closest(".jr-caption")!).opacity))).toBeGreaterThan(0.95);
  expect((await page.request.get(`/propiedades/${property!.slug}`)).status()).toBe(200);

  // Salto rápido al inicio: vuelve la portada.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(count).toHaveText("01", { timeout: 5000 });
  expect(problems).toEqual([]);
});

test("recorrido desktop: resize y recarga a mitad mantienen un estado coherente; volver a la home no duplica disparadores", async ({ page }) => {
  await page.goto("/");
  const journey = page.locator("[data-journey]");
  await expect(journey).toHaveAttribute("data-pinned", "", { timeout: 8000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-scroll-triggers"))).not.toBeNull();
  const triggers = await page.evaluate(() => document.documentElement.getAttribute("data-scroll-triggers"));

  await scrollJourney(page, 0.5);
  await expect.poll(() => journey.getAttribute("data-active-index")).not.toBe("0");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  await expect(journey).toHaveAttribute("data-pinned", "");
  const afterResize = Number(await journey.getAttribute("data-active-index"));
  expect(afterResize).toBeGreaterThan(0);
  expect(afterResize).toBeLessThan(7);

  // Recarga a mitad del recorrido: el navegador restaura el scroll y el recorrido retoma en esa escena.
  await page.reload();
  await expect(journey).toHaveAttribute("data-pinned", "", { timeout: 8000 });
  await expect.poll(() => journey.getAttribute("data-active-index"), { timeout: 5000 }).not.toBe("0");

  // Debajo del umbral de desktop el recorrido vuelve al modo liviano (sin fijar) y regresa al volver a agrandar.
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(journey).not.toHaveAttribute("data-pinned", "");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(journey).toHaveAttribute("data-pinned", "");

  // Navegar a otra página y volver atrás: mismos disparadores, un único recorrido fijado.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link").first().click();
  await expect(page).not.toHaveURL(/\/$/);
  await page.goBack();
  await expect(journey).toHaveAttribute("data-pinned", "", { timeout: 8000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-scroll-triggers"))).toBe(triggers);
  await expect(page.locator("[data-journey][data-pinned]")).toHaveCount(1);
});

test("recorrido desktop: con teclado se puede saltar la secuencia y el foco trae a la vista la escena enfocada", async ({ page }) => {
  await page.goto("/");
  const journey = page.locator("[data-journey]");
  await expect(journey).toHaveAttribute("data-pinned", "", { timeout: 8000 });
  const skip = page.getByRole("link", { name: /Saltar recorrido/ });
  await skip.focus();
  await page.keyboard.press("Tab");
  const closing = journey.locator(".jr-scene").last().getByRole("link").first();
  await expect(closing).toBeFocused();
  await expect(page.locator("[data-jr-count]")).toHaveText("07", { timeout: 5000 });
  await expect
    .poll(() =>
      closing.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && Number(getComputedStyle(el.closest(".jr-caption")!).opacity) > 0.95;
      }),
    )
    .toBe(true);

  await page.keyboard.press("Shift+Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator("#manifesto-title").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(700);
  await expect.poll(() => page.locator("#manifesto-title").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeGreaterThan(-50);
});

test.describe("recorrido: respaldo sin la propiedad", () => {
  test.describe.configure({ mode: "serial" });
  const revalidate = (page: Page) =>
    page.request.post("/api/site/revalidate", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, data: { tags: ["site:properties"], reason: "e2e-journey-fallback" } });

  test("si la Cód. 2605 deja de estar publicada, la portada usa fotos de marca, sin su link ni sus fotos", async ({ page }) => {
    test.skip(!process.env.CRON_SECRET, "requiere CRON_SECRET compartido con el servidor (scripts/e2e.sh)");
    const before = (await pool.query<{ slug: string; is_published: boolean }>("select slug, is_published from properties where code = 2605")).rows[0];
    test.skip(!before?.is_published, "la base e2e no tiene la Cód. 2605 publicada");
    try {
      await pool.query("update properties set is_published = false where code = 2605");
      expect((await revalidate(page)).status()).toBe(200);
      await page.goto("/");
      const journey = page.locator("[data-journey]");
      await expect(journey).toHaveAttribute("data-journey", "brand");
      await expect(page.locator(`a[href="/propiedades/${before!.slug}"]`)).toHaveCount(0);
      expect(await page.content()).not.toContain("el-tipal-2605");
      await expect(journey.getByRole("list", { name: "Recorrido por la inmobiliaria" })).toBeAttached();
      await expect(page.getByRole("heading", { level: 1, name: /Buenos negocios/ })).toBeVisible();
    } finally {
      await pool.query("update properties set is_published = true where code = 2605");
      await revalidate(page);
    }
    await page.goto("/");
    await expect(page.locator("[data-journey]")).toHaveAttribute("data-journey", "property");
  });
});
