// QA visual local: node scripts/site/shots.mjs <ruta> <anchos coma> [--full] [--reduced]
import { chromium } from "@playwright/test";
const [, , path = "/", widthsArg = "390,768,1440", ...flags] = process.argv;
const out = process.env.SHOTS_DIR ?? "/tmp";
const browser = await chromium.launch();
for (const w of widthsArg.split(",").map(Number)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : w < 1000 ? 1024 : 900 }, deviceScaleFactor: 1, reducedMotion: flags.includes("--reduced") ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:3106${path}`, { waitUntil: "networkidle" });
  if (flags.includes("--full")) {
    // bajar de a poco para disparar lazy + revelados
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 700) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
  } else await page.waitForTimeout(1800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const name = `${out}/${path.replace(/[^a-z0-9]+/gi, "_") || "home"}-${w}${flags.includes("--full") ? "-full" : ""}.png`;
  await page.screenshot({ path: name, fullPage: flags.includes("--full") });
  console.log(name, "overflowX:", overflow, errors.length ? `errors: ${errors.slice(0, 3).join(" | ")}` : "");
  await ctx.close();
}
await browser.close();
