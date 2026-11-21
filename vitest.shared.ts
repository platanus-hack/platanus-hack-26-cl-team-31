import { defineConfig } from "vitest/config";

// Config base de Vitest para todos los paquetes del monorepo (cada `vitest.config.ts` la extiende).
//
// Los paquetes de `packages/*` exportan su código fuente bajo la condición "@team-31/source"
// (junto a `types`). Con ella los tests importan `src/` de las dependencias del workspace en vez
// de `dist/`, así `pnpm test` no espera el build de cada dependencia. Node, Next y el build de
// producción ignoran esa condición y siguen usando `dist/`.
const conditions = ["@team-31/source", "module", "node", "development|production"];

export default defineConfig({
  resolve: { conditions: ["@team-31/source", "module", "browser", "development|production"] },
  ssr: { resolve: { conditions } },
});
