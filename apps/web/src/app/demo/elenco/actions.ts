"use server";

import { revalidatePath } from "next/cache";
import { castMember, castPrincipal } from "@team-31/demo/cast";
import { ownerClient } from "@/lib/broker";
import { getTelemetry } from "@/lib/telemetry";

// Lets you act as a cast member to grant or refuse a vault access request. Development only.
export async function decideForCast(form: FormData) {
  if (process.env.NODE_ENV !== "development") throw new Error("Solo disponible en desarrollo.");
  const member = castMember(String(form.get("member")));
  const kind = form.get("kind");
  if (!member || (kind !== "grant_vault_read" && kind !== "deny")) throw new Error("Decisión inválida.");
  const principal = castPrincipal(member.id);
  try {
    await ownerClient().decide(principal, String(form.get("requestId")), { kind });
  } catch (error) {
    getTelemetry().error("demo.cast.decide", error, { userId: principal.userId });
    throw error;
  }
  revalidatePath("/demo/elenco");
}
