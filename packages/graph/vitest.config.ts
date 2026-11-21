import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared";

// Los tests property-style recorren muchos grafos aleatorios: dan más margen que 5 s.
// Sin aislamiento por archivo: código puro, sin mocks ni estado global de módulo.
export default mergeConfig(shared, defineConfig({ test: { testTimeout: 60_000, isolate: false } }));
