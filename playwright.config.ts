import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// E2E_PORT permite correr suites en paralelo desde distintos worktrees sin pisarse (por defecto 3106).
const PORT = Number(process.env.E2E_PORT ?? 3106);

/**
 * E2E del sitio público contra `next start` (build de producción) en :3106 y la base de .env.local (llf_dev_web,
 * con el inventario real importado). Correr: pnpm build && pnpm test:e2e (reutiliza un server ya levantado).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-AR",
    timezoneId: "America/Argentina/Salta",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: `pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
