import { defineConfig } from "vitest/config"

// Pruebas del servidor admin. Las que usan Postgres (TEST_DATABASE_URL) comparten el esquema
// `admin`, así que los archivos corren en serie.
export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
})
