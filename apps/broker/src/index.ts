import { serve } from "@hono/node-server";
import { composeBroker } from "./compose.js";
import { readEnv, type BrokerEnv } from "./env.js";
import { createHttpServer } from "./http/server.js";
import { createBrokerTelemetry, type BrokerServiceTelemetry } from "./telemetry.js";
import { startWorker } from "./worker.js";

async function start(env: BrokerEnv, telemetry: BrokerServiceTelemetry) {
  const { broker, close } = await composeBroker(env, telemetry);
  const shutdown = new AbortController();
  const app = createHttpServer({
    broker, publicKeys: env.SERVICE_JWT_PUBLIC_KEYS, shutdown: shutdown.signal, telemetry: telemetry.http,
  });
  const server = serve({ fetch: app.fetch, hostname: env.BROKER_HOST, port: env.BROKER_PORT }, ({ address, port }) => {
    console.info(`[broker] HTTP escuchando en ${address}:${port}`);
  });
  const stopWorker = startWorker(broker, telemetry.worker, telemetry.runInWorker);

  async function stop() {
    if (shutdown.signal.aborted) return;
    shutdown.abort();
    const stopHttp = new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await Promise.all([stopWorker(), stopHttp]);
      await close();
    } catch (error) {
      telemetry.http.error("shutdown", error);
      process.exitCode = 1;
    }
    await telemetry.shutdown();
  }

  server.on("error", (error) => {
    telemetry.http.error("http.listen", error);
    process.exitCode = 1;
    void stop();
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

let env: BrokerEnv | undefined;
try {
  env = readEnv(process.env);
} catch (error) {
  // Configuration errors name only the variables; telemetry may not be configured yet.
  console.error("[broker]", error instanceof Error ? error.message : "Configuración inválida.");
  process.exitCode = 1;
}

if (env) {
  const telemetry = createBrokerTelemetry();
  try {
    await start(env, telemetry);
  } catch (error) {
    telemetry.http.error("startup", error);
    process.exitCode = 1;
    await telemetry.shutdown();
  }
}
