import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared";

// Sin aislamiento por archivo: los tests no usan vi.mock ni estado global de módulo (spies y
// relojes falsos se restauran en cada test), y reimportar el núcleo por archivo cuesta ~1/3
// del CPU de la suite.
export default mergeConfig(shared, defineConfig({ test: { isolate: false } }));
