"use server";

import { BrokerError } from "@team-31/broker/client";
import { LocalPart } from "@team-31/protocol";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ownerClient } from "@/lib/broker";
import { onboardingFlow, type OnboardingSource } from "@/lib/onboarding-flow";
import { getTelemetry, observeWebRequest } from "@/lib/telemetry";

import { getOwner } from "../owner";

import { actionError, type Feedback } from "../action-feedback";

export async function claimAddress(source: OnboardingSource, _: Feedback, form: FormData): Promise<Feedback> {
  const owner = await getOwner();
  const localPart = LocalPart.safeParse(form instanceof FormData ? form.get("localPart") : undefined);
  if (!localPart.success) {
    return { error: "Usa de 2 a 31 caracteres, con letras minúsculas, números, puntos, guiones o guiones bajos. Empieza con una letra o número." };
  }

  const flow = onboardingFlow(source);
  const feedback = await observeWebRequest("POST", "/onboarding", async (span) => {
    const telemetry = getTelemetry();
    telemetry.identify({ userId: owner.userId });
    try {
      await ownerClient().claimAddress(owner, localPart.data);
      if (flow.source === "invite") {
        telemetry.emit("web.invite.progress", { attrs: { step: "address_claimed" } });
      }
    } catch (error) {
      const errorId = telemetry.error("action claimAddress", error);
      span.setErrorId(errorId);
      const message = error instanceof BrokerError && error.code === "conflict"
        ? "Esa dirección ya está tomada"
        : actionError("claimAddress", error, "No se pudo guardar la dirección. Intenta de nuevo.");
      return { error: message, errorId };
    }
  });
  if (feedback) return feedback;

  revalidatePath("/", "layout");
  redirect(flow.destination);
}
