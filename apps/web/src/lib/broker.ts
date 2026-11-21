import "server-only";

import { mintServiceToken } from "@team-31/auth/service";
import { createOwnerClient, type OwnerPort } from "@team-31/broker/client";
import type { Owner } from "@team-31/protocol";

export function brokerUrl(): string {
  const baseUrl = process.env.BROKER_URL;
  if (!baseUrl) throw new Error("Falta configurar BROKER_URL.");
  return baseUrl;
}

export async function getServiceToken(owner: Owner): Promise<string> {
  const serviceKey = process.env.WEB_SERVICE_PRIVATE_KEY;
  if (!serviceKey) throw new Error("Falta configurar WEB_SERVICE_PRIVATE_KEY.");
  return mintServiceToken({ iss: "web", sub: owner.userId, privateKey: JSON.parse(serviceKey) });
}

export function ownerClient(): OwnerPort {
  return createOwnerClient({ baseUrl: brokerUrl(), getServiceToken });
}
