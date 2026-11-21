import { createServer } from "node:http";
import { createTelemetry } from "@team-31/telemetry";
import pg from "pg";
import { availabilityTools } from "./availability.js";
import { contactTools } from "./contacts.js";
import { createCoordinationHandler } from "./http.js";
import { meetingTools } from "./meetings.js";

const tools = [...availabilityTools, ...meetingTools, ...contactTools];
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL requerida");
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
// Sink from TELEMETRY_SINK (TELEMETRY_DATABASE_URL or DATABASE_URL); emits service.started and the heartbeat.
const telemetry = createTelemetry({service: "coordination", version: process.env.npm_package_version});

const server = createServer(createCoordinationHandler({pool, tools, telemetry}));
const port = Number(process.env.COORDINATION_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("COORDINATION_PORT requerido");
server.listen(port, process.env.COORDINATION_HOST ?? "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") {
    console.log("Coordinación lista en puerto", address.port);
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void telemetry.shutdown().finally(() => pool.end()).finally(() => process.exit());
  });
}
