// Runs in the owner's process. The only network dependency is their authenticated broker client.
import {
  ToolArgs, ToolResultSchemas, toolExecution, WakeNotice, type InboxItem, type Principal, type RuntimeTool,
} from "@team-31/protocol";
import type { AgentPort } from "../ports.js";
import { filterResult } from "../policy/index.js";

type Args<K extends RuntimeTool> = ReturnType<(typeof ToolArgs)[K]["parse"]>;
type Result<K extends RuntimeTool> = ReturnType<(typeof ToolResultSchemas)[K]["parse"]>;

// Bind only read-only, retryable operations. Credentials stay inside the owner's callback.
type ReadContext = Pick<InboxItem, "from" | "allowedFields" | "ownerAuthorization"> & {
  purpose?: string;
};

export function localReadTool<K extends RuntimeTool>(
  name: K,
  read: (args: Args<K>, context: ReadContext) => Promise<Result<K> | null>,
) {
  if (toolExecution[name] !== "owner_runtime") throw new Error("La herramienta debe estar en el contrato del runtime.");
  return {
    name,
    async execute(input: unknown, context: ReadContext) {
      const args: Args<K> = ToolArgs[name].parse(input) as Args<K>;
      const value = await read(args, context);
      return value === null ? null : filterResult(name, value, context.allowedFields).result;
    },
  };
}

export function createOwnerRuntime(
  agent: Pick<AgentPort, "inbox" | "reply">,
  principal: Principal,
  approved: ReturnType<typeof localReadTool>[],
) {
  const active = new Set<string>();
  return async function onWake(notice: unknown) {
    const { requestId } = WakeNotice.parse(notice);
    if (active.has(requestId)) return;
    active.add(requestId);
    try {
      const item = (await agent.inbox(principal)).find(entry => entry.requestId === requestId);
      if (!item || Date.parse(item.expiresAt) <= Date.now()) return;
      const binding = approved.find(tool => tool.name === item.tool);
      const reply = { requestId, nonce: item.nonce };
      // A grant must cover the required result before the connector may read private data.
      const hasRequiredFields = Object.entries(ToolResultSchemas[item.tool].shape)
        .every(([field, schema]) => schema.safeParse(undefined).success || item.allowedFields.includes(field));
      if (item.from.startsWith("system@")) {
        await agent.reply(principal, { ...reply, outcome: "no_data" });
        return;
      }
      if (!binding || !hasRequiredFields) {
        await agent.reply(principal, { ...reply, outcome: "declined" });
        return;
      }
      const result = await binding.execute(item.args, {
        from: item.from, allowedFields: item.allowedFields, ownerAuthorization: item.ownerAuthorization,
        purpose: item.senderMessage.purpose,
      });
      await agent.reply(principal, result === null
        ? { ...reply, outcome: "no_data" }
        : { ...reply, outcome: "answered", result });
    } finally {
      active.delete(requestId);
    }
  };
}
