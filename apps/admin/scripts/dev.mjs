// pnpm dev --filter @team-31/admin: Vite (SPA en ADMIN_PORT, con proxy de /api y /mcp) y el
// servidor admin con tsx watch (ADMIN_API_PORT) en paralelo. Si uno termina, se detienen ambos.
import { spawn } from "node:child_process"

const adminPort = process.env.ADMIN_PORT ?? "4400"
const processes = [
  ["web", "vite", ["--host", "127.0.0.1", "--port", adminPort, "--strictPort"]],
  ["api", "tsx", ["watch", "--clear-screen=false", "server/index.ts"]],
].map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: "inherit", env: process.env })
  child.on("exit", (code, signal) => {
    if (stopping) return
    console.error(`[admin:dev] ${name} terminó (${signal ?? code}); deteniendo el resto.`)
    stop(code ?? 1)
  })
  return child
})

let stopping = false
function stop(code = 0) {
  stopping = true
  for (const child of processes) if (child.exitCode === null) child.kill("SIGTERM")
  process.exitCode = code
}

process.once("SIGINT", () => stop(0))
process.once("SIGTERM", () => stop(0))
