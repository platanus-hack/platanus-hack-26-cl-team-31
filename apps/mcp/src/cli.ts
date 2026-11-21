#!/usr/bin/env node
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { WAKE_EVENT } from "@team-31/protocol";
import { z } from "zod";
import { startReceiver } from "./watch/listener.js";
import { authorize } from "./watch/oauth.js";
import { connect } from "./watch/remote.js";
import { openTunnel } from "./watch/tunnel.js";

const help = `Uso: sideband watch --mcp-url <URL> [--check | --webhook-origin <https://host> --port <puerto>]

Recibe avisos firmados en la terminal. Usa cloudflared si no indicas un túnel propio.
--check verifica el catálogo MCP sin abrir un túnel ni crear una suscripción.`;

function secureUrl(value: string | undefined): URL {
  const parsed = z.url({ protocol: /^https$/ }).safeParse(value);
  if (!parsed.success) throw new Error("Indica una URL HTTPS válida.");
  const url = new URL(parsed.data);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("No incluyas credenciales, query ni fragmentos en la URL.");
  }
  return url;
}

const errorDetails = z.object({ reason: z.string().regex(/^[a-z_]{1,64}$/).optional(), errorId: z.uuid().optional() });
function describe(error: unknown, fallback: string) {
  if (!(error instanceof McpError)) return fallback;
  const details = errorDetails.safeParse(error.data);
  const { reason, errorId } = details.success ? details.data : {};
  return `${fallback} (MCP ${error.code}${reason ? `: ${reason}` : ""}${errorId ? `; errorId ${errorId}` : ""}).`;
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true, options: {
      help: { type: "boolean", short: "h" },
      check: { type: "boolean" },
      "mcp-url": { type: "string" },
      "webhook-origin": { type: "string" },
      port: { type: "string" },
    },
  });
  if (values.help || positionals.length === 0) return console.log(help);
  if (positionals.length !== 1 || positionals[0] !== "watch") throw new Error(help);
  const url = secureUrl(values["mcp-url"]);
  const origin = values["webhook-origin"] === undefined ? undefined : secureUrl(values["webhook-origin"]);
  const port = values.port === undefined ? undefined : Number(values.port);
  if (origin && (origin.pathname !== "/" || !port)) throw new Error("Con --webhook-origin indica solo el origen HTTPS y agrega --port.");
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("Puerto inválido.");

  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.on("SIGINT", stop).on("SIGTERM", stop);
  let stage = "No se pudo iniciar la autorización OAuth";
  let remote: Awaited<ReturnType<typeof connect>> | undefined;
  let receiver: Awaited<ReturnType<typeof startReceiver>> | undefined;
  let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined;
  let id: string | undefined;
  try {
    const authProvider = await authorize(url, shutdown.signal, (link) => {
      console.log(`Autoriza Sideband en tu navegador y vuelve acá:\n${link.href}`);
    });
    stage = "No se pudo conectar al MCP";
    remote = await connect(url, { authProvider });
    stage = "No se pudo verificar el catálogo de eventos";
    if (!await remote.supportsWebhook()) throw new Error("Evento no disponible.");
    if (values.check) return console.log(`${WAKE_EVENT}: webhook disponible.`);
    if (shutdown.signal.aborted) return;

    stage = "No se pudo abrir el receptor local";
    receiver = await startReceiver((requestId) => {
      console.log(`${new Date().toLocaleTimeString("es-CL", { hour12: false })}  Nueva solicitud · ${requestId}`);
    }, port);
    let webhookOrigin = origin;
    if (!webhookOrigin) {
      try {
        tunnel = await openTunnel(receiver.origin, shutdown.signal);
        webhookOrigin = tunnel.origin;
      } catch (error) {
        stage = error instanceof Error ? error.message : "No se pudo abrir el túnel HTTPS";
        throw error;
      }
    }
    if (shutdown.signal.aborted) return;
    const callback = new URL(receiver.path, webhookOrigin);
    stage = "El MCP no pudo suscribir el webhook";
    const subscription = await remote.subscribe(callback, receiver.secret);
    id = subscription.id;
    console.log("Escuchando solicitudes nuevas… (Ctrl+C para salir)");

    stage = "Se cerró el túnel HTTPS; ejecuta sideband watch de nuevo";
    await Promise.race([
      setTimeout(Math.max(0, Date.parse(subscription.refreshBefore) - Date.now()), undefined, { signal: shutdown.signal })
        .then(() => { stage = "Venció la suscripción; ejecuta sideband watch de nuevo"; throw new Error(); }),
      ...(tunnel ? [tunnel.exited.then(() => { throw new Error(); })] : []),
    ]);
  } catch (error) {
    if (!shutdown.signal.aborted) throw new Error(describe(error, stage));
  } finally {
    if (id) {
      try {
        await remote?.unsubscribe(id);
      } catch (error) {
        console.warn(describe(error, "No se pudo cancelar la suscripción. Puedes revocar «Sideband Terminal» en Sideband"));
        process.exitCode = 1;
      }
    }
    shutdown.abort();
    await Promise.allSettled([tunnel?.close(), receiver?.close(), remote?.close()]);
    process.off("SIGINT", stop).off("SIGTERM", stop);
  }
}

await main().catch((error: unknown) => {
  console.warn(error instanceof Error ? error.message : "No se pudo iniciar Sideband.");
  process.exitCode = 1;
});
