import "server-only";
import { cache } from "react";

import { requireSession } from "./auth";
import { ownerClient } from "./broker";
import { getTelemetry } from "./telemetry";

export const getOwnerUser = cache(async () => {
  const { user } = await requireSession();
  getTelemetry().identify({ userId: user.id });
  return user;
});

export const getOwnerAccount = cache(async () => {
  const user = await getOwnerUser();
  const owner = process.env.WEB_SERVICE_PRIVATE_KEY ? await ownerClient().me({ userId: user.id }) : undefined;
  return { user, address: owner?.address, displayName: owner?.displayName };
});

export async function getOwnerAddress() {
  return (await getOwnerAccount()).address;
}
