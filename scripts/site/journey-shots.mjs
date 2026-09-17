// QA visual del recorrido de la portada (docs/WEB_EXPERIENCE.md §4.1).
// Uso: SHOTS_DIR=/ruta BASE_URL=http://localhost:3120 node scripts/site/journey-shots.mjs [anchos desktop] [anchos flujo]
// Desktop (motor GSAP): capturas al 0, 15, 30, 45, 60, 75, 90 y 100 % del recorrido. Flujo (mobile/tablet): varias
// alturas del hero. Informa desborde horizontal, errores de consola y si cargó el motor.
import { chromium, devices } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3120";
const out = process.env.SHOTS_DIR ?? "/tmp";
const desktop = (process.argv[2] ?? "1440,1920").split(",").filter(Boolean).map(Number);
const flow = (process.argv[3] ?? "390,320,768").split(",").filter(Boolean).map(Number);
const STOPS = (process.env.STOPS ?? "0,15,30,45,60,75,90,100").split(",").map(Number);

const browser = await chromium.launch();
for (const w of desktop) {
  const h = w >= 1900 ? 1080 : w >= 1400 ? 900 : w >= 1200 ? 800 : 768;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const pinned = await page
    .waitForSelector(".jr[data-pinned]", { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  const range = await page.evaluate(() => {
    const r = document.querySelector(".jr");
    const top = r.getBoundingClientRect().top + window.scrollY;
    return { top, len: r.offsetHeight - window.innerHeight };
  });
  for (const p of STOPS) {
    const y = Math.round(range.top + (range.len * p) / 100);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(1800);
    const state = await page.evaluate(() => ({ active: document.querySelector(".jr")?.getAttribute("data-active-index"), count: document.querySelector("[data-jr-count]")?.textContent }));
    await page.screenshot({ path: `${out}/journey-${w}-${String(p).replace(".", "_").padStart(3, "0")}.png` });
    console.log(`${w} ${p}% y=${y} active=${state.active} count=${state.count}`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${w}: pinned=${pinned} overflowX=${overflow} track=${range.len}px`, errors.length ? `errors: ${errors.slice(0, 3).join(" | ")}` : "sin errores");
  await ctx.close();
}
for (const w of flow) {
  const ctx = await browser.newContext(
    w < 768 ? { ...devices["Pixel 7"], viewport: { width: w, height: w < 360 ? 640 : 844 } } : { viewport: { width: w, height: 1024 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const vh = await page.evaluate(() => window.innerHeight);
  const total = await page.evaluate(() => {
    const r = document.querySelector(".jr");
    return r.offsetHeight;
  });
  let i = 0;
  for (let y = 0; y < total; y += Math.round(vh * 0.7)) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/flow-${w}-${String(i++).padStart(2, "0")}.png` });
  }
  const info = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, lenis: document.documentElement.classList.contains("lenis"), pinned: Boolean(document.querySelector(".jr[data-pinned]")) }));
  console.log(`flow ${w}: shots=${i} heroHeight=${total}`, JSON.stringify(info), errors.length ? `errors: ${errors.slice(0, 3).join(" | ")}` : "sin errores");
  await ctx.close();
}
await browser.close();
