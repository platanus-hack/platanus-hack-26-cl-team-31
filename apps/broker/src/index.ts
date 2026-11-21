import { serve } from "@hono/node-server";
import { composeBroker } from "./compose.js";
import { readEnv, type BrokerEnv } from "./env.js";
import { createHttpServer } from "./http/server.js";
import { logFailure } from "./log.js";
import { startWorker } from "./worker.js";

async function start(env: BrokerEnv) {
  const { broker, close } = await composeBroker(env);
  const shutdown = new AbortController();
  const app = createHttpServer({ broker, publicKeys: env.SERVICE_JWT_PUBLIC_KEYS, shutdown: shutdown.signal });
  const server = serve({ fetch: app.fetch, hostname: env.BROKER_HOST, port: env.BROKER_PORT }, ({ address, port }) => {
    console.info(`[broker] HTTP escuchando en ${address}:${port}`);
  });
  const stopWorker = startWorker(broker);

  async function stop() {
    if (shutdown.signal.aborted) return;
    shutdown.abort();
    const stopHttp = new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await Promise.all([stopWorker(), stopHttp]);
      await close();
    } catch (error) {
      logFailure("shutdown", error);
      process.exitCode = 1;
    }
  }

  server.on("error", (error) => {
    logFailure("http.listen", error);
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
  console.error("[broker]", error instanceof Error ? error.message : "Configuración inválida.");
  process.exitCode = 1;
}

if (env) {
  try {
    await start(env);
  } catch (error) {
    logFailure("startup", error);
    process.exitCode = 1;
  }
}
