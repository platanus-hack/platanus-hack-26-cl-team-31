import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";
import { deferred } from "./deferred.js";

export async function openTunnel(localOrigin: URL, signal: AbortSignal) {
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", localOrigin.origin], {
    stdio: ["ignore", "ignore", "pipe"],
    // Let the CLI unsubscribe before Ctrl+C takes down the tunnel.
    detached: process.platform !== "win32",
  });
  const ready = deferred<URL>();
  const exited = deferred<void>();
  const logs = createInterface({ input: child.stderr });
  let origin: URL | undefined;
  let connected = false;
  logs.on("line", (line) => {
    const publicUrl = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
    if (publicUrl) origin = new URL(publicUrl);
    if (line.includes("Registered tunnel connection")) connected = true;
    if (origin && connected) ready.resolve(origin);
  });
  child.once("error", (error: NodeJS.ErrnoException) => {
    ready.reject(new Error(error.code === "ENOENT" ?
      "Falta cloudflared. En macOS: brew install cloudflared." : "No se pudo iniciar cloudflared."));
  });
  child.once("close", () => {
    ready.reject(new Error("Cloudflare Tunnel se cerró antes de quedar listo."));
    exited.resolve();
  });
  async function close() {
    child.kill("SIGTERM");
    const done = await Promise.race([exited.promise.then(() => true), setTimeout(1_000, false, { ref: false })]);
    if (!done) child.kill("SIGKILL");
    await exited.promise;
    logs.close();
  }
  const startup = AbortSignal.any([signal, AbortSignal.timeout(40_000)]);
  const abort = () => ready.reject(new Error("No se pudo abrir el túnel HTTPS a tiempo."));
  startup.addEventListener("abort", abort, { once: true });
  if (startup.aborted) abort();
  try {
    return { origin: await ready.promise, exited: exited.promise, close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    startup.removeEventListener("abort", abort);
  }
}
