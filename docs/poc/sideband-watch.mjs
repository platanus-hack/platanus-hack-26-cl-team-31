// Revisa la bandeja y emite un aviso nuevo con el ID de la solicitud.
import { setTimeout as delay } from "node:timers/promises";

export async function* watchInbox(call, { intervalMs = 10000, signal } = {}) {
  let previous = new Set();
  while (!signal?.aborted) {
    const { solicitudes } = await call("sideband_inbox");
    const current = new Set(solicitudes.map(({ request_id }) => request_id));
    for (const requestId of current) {
      if (!previous.has(requestId)) yield { requestId };
    }
    previous = current;
    try {
      await delay(intervalMs, undefined, { signal });
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    }
  }
}
