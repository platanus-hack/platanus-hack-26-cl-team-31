import { defineConfig } from "vitest/config";

// Los tests property-style recorren muchos grafos aleatorios: dan más margen que 5 s.
export default defineConfig({ test: { testTimeout: 60_000 } });
