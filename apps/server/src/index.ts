import { createServer } from "node:http";
import { createTelemetry } from "@team-31/telemetry";
import pg from "pg";
import { createCoordinationHandler } from "./http.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL requerida");
const port = Number(process.env.COORDINATION_PORT);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("COORDINATION_PORT requerido");

const telemetry = createTelemetry({
  service: "coordination",
  version: process.env.npm_package_version,
});
const pool = new pg.Pool({ connectionString: databaseUrl });
pool.on("error", (error) => telemetry.error("coordination.pool", error));
const handle = createCoordinationHandler({ pool, telemetry });
const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => {
    telemetry.error("coordination.http", error);
    response.destroy();
  });
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    void pool.end().catch((error: unknown) => {
      telemetry.error("coordination.shutdown", error);
      process.exitCode = 1;
    }).finally(() => telemetry.shutdown());
  });
}

server.on("error", (error) => {
  telemetry.error("coordination.listen", error);
  process.exitCode = 1;
  stop();
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
server.listen(port, process.env.COORDINATION_HOST ?? "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") {
    telemetry.emit("service.listening", { attrs: { address: address.address, port: address.port } });
    process.send?.({ type: "listening", port: address.port });
    console.log("Coordinación lista en puerto", address.port);
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    void telemetry.shutdown().finally(() => pool.end()).finally(() => process.exit());
  });
}
