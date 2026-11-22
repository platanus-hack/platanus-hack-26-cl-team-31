import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { configureBroker, startBroker } from "./contact-stack.mjs";

it("identifica el broker aunque otro listener responda al sondeo", async () => {
  const cleanup = new AsyncDisposableStack();
  cleanup.defer(() => vi.unstubAllEnvs());
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("TELEMETRY_SINK", "off");
  try {
    configureBroker();
    const other = createServer((req, res) => res.end("otro listener"));
    other.listen(Number(process.env.BROKER_PORT), "127.0.0.1");
    await once(other, "listening");
    cleanup.defer(() => new Promise(resolve => other.close(resolve)));
    await startBroker(cleanup);
    expect(Number(process.env.BROKER_PORT)).not.toBe(other.address().port);
  } finally {
    await cleanup.disposeAsync();
  }
}, 30_000);
