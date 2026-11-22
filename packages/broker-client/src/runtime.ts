// Runs in the owner's process. The only network dependency is their authenticated broker client.
import {
  isSystemSender, ToolArgs, ToolResultSchemas, toolExecution, WakeNotice, type Category, type InboxItem, type Principal, type RuntimeTool,
} from "@team-31/protocol";
import type { AgentPort } from "./ports.js";
import { filterResult } from "./filter.js";

type Args<K extends RuntimeTool> = ReturnType<(typeof ToolArgs)[K]["parse"]>;
type Result<K extends RuntimeTool> = ReturnType<(typeof ToolResultSchemas)[K]["parse"]>;

// Bind only read-only, retryable operations. Credentials stay inside the owner's callback.
type ReadContext = Pick<InboxItem, "from" | "allowedFields" | "ownerAuthorization"> & {
  purpose?: string;
};

const readTools = ["availability", "interest_check"] as const satisfies readonly RuntimeTool[];

export function localReadTool<K extends (typeof readTools)[number]>(
  name: K,
  read: (args: Args<K>, context: ReadContext) => Promise<Result<K> | null>,
) {
  if (!readTools.some(tool => tool === name)) {
    throw new Error("La herramienta no admite un conector de lectura local.");
  }
  return {
    name,
    async execute(input: unknown, context: ReadContext) {
      const args: Args<K> = ToolArgs[name].parse(input) as Args<K>;
      const value = await read(args, context);
      return value === null ? null : filterResult(name, value, context.allowedFields).result;
    },
  };
}

// A category reader is selected before the question text is used. Its only input is
// the authenticated requester, never a sender-supplied path, selector or free-text query.
// Only exact answers prepared by the owner can leave this binding.
export function localQuestionSource(category: Category, read: (from: InboxItem["from"]) => Promise<ReadonlyMap<string, string>>) {
  return {
    name: "question" as const,
    category,
    async execute(input: unknown, context: ReadContext) {
      const args = ToolArgs.question.parse(input);
      if (category !== context.ownerAuthorization.category || args.category !== category) return null;
      const answer = (await read(context.from)).get(args.text);
      return answer === undefined ? null : ToolResultSchemas.question.parse({ answer });
    },
  };
}

export function createOwnerRuntime(
  agent: Pick<AgentPort, "inbox" | "reply">,
  principal: Principal,
  approved: (ReturnType<typeof localReadTool> | ReturnType<typeof localQuestionSource>)[],
) {
  const active = new Map<string, Promise<void>>();
  async function processNotice(requestId: string) {
    const item = (await agent.inbox(principal)).find(entry => entry.requestId === requestId);
    if (!item || Date.parse(item.expiresAt) <= Date.now()) return;
    if (toolExecution[item.tool] === "owner_decision") return;
    const reply = { requestId, nonce: item.nonce };
    if (isSystemSender(item.from)) {
      await agent.reply(principal, { ...reply, outcome: "no_data" });
      return;
    }
    if (item.tool === "connect") {
      await agent.reply(principal, { ...reply, outcome: "needs_owner" });
      return;
    }
    const binding = approved.find(tool => tool.name === item.tool &&
      (tool.name !== "question" || tool.category === item.ownerAuthorization.category));
    // A grant must cover the required result before the connector may read private data.
    const hasRequiredFields = Object.entries(ToolResultSchemas[item.tool].shape)
      .every(([field, schema]) => schema.safeParse(undefined).success || item.allowedFields.includes(field));
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
  }
  return async function onWake(notice: unknown) {
    const { requestId } = WakeNotice.parse(notice);
    const existing = active.get(requestId);
    if (existing) return existing;
    const processing = processNotice(requestId).finally(() => active.delete(requestId));
    active.set(requestId, processing);
    return processing;
  };
}
