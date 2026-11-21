"use server";

import { getSession } from "./auth";
import { getTelemetry } from "./telemetry";

const operations = ["share_invite", "copy_invite", "copy_connection", "start_google"] as const;

// Browser errors describe an operation with a fixed code. Never send exception text from the browser.
export async function reportBrowserFailure(operation: typeof operations[number]) {
  if (!operations.includes(operation)) return;
  const session = await getSession();
  return getTelemetry().error(`web.browser.${operation}`, new Error(), { userId: session?.user.id });
}
