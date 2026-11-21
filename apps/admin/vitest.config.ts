import { defineConfig, mergeConfig } from "vitest/config"
import shared from "../../vitest.shared.ts"

// Pruebas del servidor admin. Las que usan Postgres (TEST_DATABASE_URL) comparten el esquema
// `admin`, así que los archivos corren en serie.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
      environment: "node",
      fileParallelism: false,
    },
  }),
)
