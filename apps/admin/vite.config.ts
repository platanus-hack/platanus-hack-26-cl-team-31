import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// En desarrollo Vite sirve la SPA en ADMIN_PORT y reenvía la API y el MCP al
// servidor admin (server/), que escucha en ADMIN_API_PORT. En producción el
// servidor admin sirve todo desde un solo puerto. Ver docs/admin.md.
const apiTarget = `http://127.0.0.1:${process.env.ADMIN_API_PORT ?? "4450"}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@shared": resolve(import.meta.dirname, "./shared"),
    },
  },
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/mcp": { target: apiTarget, changeOrigin: false },
    },
  },
  build: { outDir: "dist/client" },
})
