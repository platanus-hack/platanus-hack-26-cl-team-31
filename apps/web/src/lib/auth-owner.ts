"use server";

import "server-only";

import { requireSession } from "./auth";
import { ownerClient } from "./broker";
import { webTelemetry } from "./telemetry";

export async function getOwnerAddress() {
  const { user } = await requireSession();
  if (!process.env.WEB_SERVICE_PRIVATE_KEY) return undefined;
  webTelemetry().identify({ userId: user.id });
  return (await ownerClient().me({ userId: user.id })).address;
}
