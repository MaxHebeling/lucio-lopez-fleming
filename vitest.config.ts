import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(import.meta.dirname, "src"),
  // `server-only` lanza fuera de React Server Components; en tests es un módulo vacío.
  "server-only": resolve(import.meta.dirname, "tests/helpers/empty.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          setupFiles: ["tests/helpers/integration-setup.ts"],
          // Una sola base de pruebas: los archivos corren en serie y cada uno parte de datos limpios.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
