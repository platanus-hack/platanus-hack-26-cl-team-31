import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createTestDatabase } from "@team-31/test-db"
import { expect, it } from "vitest"

const execute = promisify(execFile)
const entry = fileURLToPath(new URL("./index.ts", import.meta.url))

it.skipIf(!process.env.TEST_DATABASE_URL)("drains the admin server after its listener cannot bind", async () => {
  const db = await createTestDatabase("admin_startup")
  const occupied = createServer()
  try {
    occupied.listen(0, "127.0.0.1")
    await once(occupied, "listening")
    const address = occupied.address()
    if (!address || typeof address === "string") throw new Error("Missing test port")
    await expect(execute(process.execPath, ["--conditions=@team-31/source", "--import", "tsx", entry], {
      env: {
        PATH: process.env.PATH, NODE_ENV: "test", ADMIN_API_PORT: String(address.port),
        ADMIN_URL: `http://127.0.0.1:${address.port}`, DATABASE_URL: db.url,
        ADMIN_AUTH_SECRET: randomBytes(32).toString("hex"), TELEMETRY_SINK: "console",
      },
      timeout: 10_000,
    })).rejects.toMatchObject({ code: 1, killed: false, signal: null, stdout: expect.stringContaining("http.listen") })
  } finally {
    await new Promise<void>((done) => occupied.close(() => done()))
    await db.drop()
  }
}, 20_000)
