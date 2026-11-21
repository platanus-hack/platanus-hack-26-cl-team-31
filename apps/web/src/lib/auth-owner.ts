import "server-only";

import { mintServiceToken } from "@team-31/auth/service";
import { createOwnerClient } from "@team-31/broker/client";

export async function getOwnerAddress(userId: string) {
  const baseUrl = process.env.BROKER_URL;
  const serviceKey = process.env.WEB_SERVICE_PRIVATE_KEY;
  if (!serviceKey) return undefined;
  if (!baseUrl) {
    throw new Error("Configura BROKER_URL y WEB_SERVICE_PRIVATE_KEY para consultar la dirección.");
  }

  const privateKey = JSON.parse(serviceKey);
  const ownerClient = createOwnerClient({
    baseUrl,
    getServiceToken: ({ userId }) => mintServiceToken({ iss: "web", sub: userId, privateKey }),
  });
  return (await ownerClient.me({ userId })).address;
}
