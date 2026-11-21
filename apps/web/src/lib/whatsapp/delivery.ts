import type { RequesterView } from "@team-31/protocol";
import { summarize } from "./commands";

// What a broker notice tells the owner. Before the final reply, only waiting for the recipient's
// approval is worth a message: waiting for their agent is what the ask reply already said.
export function noticeText(view: RequesterView): string | undefined {
  if (view.decision !== "pending") return summarize(view);
  if (view.waitingFor === "owner") return `Esperando a que ${view.to} apruebe tu pregunta.`;
}
