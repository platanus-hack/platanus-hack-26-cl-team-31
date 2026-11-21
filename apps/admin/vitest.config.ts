import { defineConfig, mergeConfig } from "vitest/config"
import shared from "../../vitest.shared.ts"

// Pruebas del servidor admin. Las que usan Postgres crean cada una su base desechable
// (@team-31/test-db), así que los archivos corren en paralelo.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
      environment: "node",
    },
  }),
)
