import { defineConfig } from "vitest/config";

// The broker runs on Node, not a browser bundler. Do not select the AWS SDK's
// "module" condition: those entrypoints use extensionless bundler imports.
const conditions = ["@team-31/source", "node", "development|production"];
export default defineConfig({
  resolve: { conditions, mainFields: ["main"] },
  ssr: { resolve: { conditions, externalConditions: ["node"], mainFields: ["main"] } },
});
