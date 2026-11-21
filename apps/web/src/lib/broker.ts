import "server-only";

import { mintServiceToken, parseServicePrivateKey } from "@team-31/auth/service";
import { createOwnerClient, type OwnerPort } from "@team-31/broker/client";
import type { Owner } from "@team-31/protocol";
import { tracedFetch } from "@team-31/telemetry";

import { getTelemetry } from "./telemetry";

export function brokerUrl(): string {
  const baseUrl = process.env.BROKER_URL;
  if (!baseUrl) throw new Error("Falta configurar BROKER_URL.");
  return baseUrl;
}

export async function signServiceToken(owner: Owner): Promise<string> {
  const privateKey = parseServicePrivateKey(process.env.WEB_SERVICE_PRIVATE_KEY, "web");
  return mintServiceToken({ iss: "web", sub: owner.userId, privateKey });
}

/** fetch for internal calls to the broker: adds the traceparent of the active trace. */
export function brokerFetch(): typeof fetch {
  return tracedFetch(getTelemetry());
}

export function ownerClient(): OwnerPort {
  const telemetry = getTelemetry();
  const client = createOwnerClient({ baseUrl: brokerUrl(), getServiceToken: signServiceToken, fetch: brokerFetch() });
  // Server components and actions have no http.request span: each call outside a trace starts
  // one with the owner, so the broker's span shares its trace_id and the web's user_id.
  const traced = Object.entries(client).map(([name, method]) => [
    name,
    (owner: Owner, ...rest: unknown[]) => {
      const call = () => (method as (owner: Owner, ...rest: unknown[]) => unknown)(owner, ...rest);
      return telemetry.context() ? call() : telemetry.context({ userId: owner.userId }, call);
    },
  ]);
  return Object.fromEntries(traced) as OwnerPort;
}
