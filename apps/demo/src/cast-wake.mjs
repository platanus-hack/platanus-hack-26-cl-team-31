import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { localReadTool } from "@team-31/broker-client";
import { getDemoTelemetry } from "./contact-broker.mjs";
import { askContactOwner } from "./contact-runtime.mjs";
import { castAvailability, castMember, castPrincipal } from "./cast.mjs";
import { handleDemoWake } from "./contact-wake.mjs";

// Claude Code answers interest_check with the same receipt-checked tool as Ana's contacts.
async function checkInterest(member, interest, root) {
  const directory = join(root, ".agents-local", "cast");
  await mkdir(directory, { recursive: true });
  const source = join(directory, member.id + "-interests.json");
  await writeFile(source, JSON.stringify(member.interests), { mode: 0o600 });
  return askContactOwner(interest, source, root);
}

// The cast answers only structured tools. Health stays in the vault, read through the broker.
export function handleCastWake(request, id, after, root) {
  return handleDemoWake(request, id, after, "cast-wake", async () => {
    const member = castMember(id);
    const span = (tool, work) => getDemoTelemetry().span("coordination.tool.call", { attrs: { tool } }, work);
    return member && {
      principal: castPrincipal(id),
      tools: [
        localReadTool("interest_check", ({ interest }) => span("check_interest", () => checkInterest(member, interest, root))),
        localReadTool("availability", async (args) => span("check_availability", async () => castAvailability(member, args))),
      ],
    };
  });
}
