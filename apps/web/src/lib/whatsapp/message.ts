import type { OwnerPort } from "@team-31/broker-client";
import type { MessageReply, TurnContext } from "@team-31/message-flow";
import type { createMessageRuntime } from "@team-31/message-flow/runtime";
import type { Owner, RequesterView } from "@team-31/protocol";

type Runtime = Pick<NonNullable<ReturnType<typeof createMessageRuntime>>, "handleMessage" | "latestContinuation">;

export function whatsappMessage(
  runtime: Runtime, broker: OwnerPort, owner: Owner, linkId: string,
  delivery: { id: string; timestamp: number },
  onResult: (action: "ask" | "status", view: RequesterView) => void,
): (text: string) => Promise<MessageReply> {
  const binding = `whatsapp:${linkId}`;
  const context: TurnContext = {
    userId: owner.userId, binding, deliveryId: delivery.id, now: new Date(delivery.timestamp * 1000),
    ops: {
      invitationGroups: () => broker.contactGroups(owner),
      contacts: () => broker.directory(owner),
      ask: async input => {
        const view = await broker.ask(owner, input, "whatsapp");
        onResult("ask", view);
        return view;
      },
      status: async requestId => {
        const view = await broker.status(owner, requestId);
        onResult("status", view);
        return view;
      },
      recentSent: async () => (await broker.activity(owner, 100)).filter(item => item.direction === "sent")
        .map(({ requestId, to }) => ({ requestId, to })),
      queryVault: input => broker.queryVault(owner, input),
      searchProfiles: query => broker.searchPublicProfiles(owner, query),
    },
  };
  return async text => {
    const retry = /^\/?continuar$/iu.test(text);
    const continuationId = await runtime.latestContinuation(owner.userId, binding, retry ? "dispatch" : "clarify");
    if (retry && !continuationId) return { kind: "unavailable", reason: "expired" };
    return runtime.handleMessage(context, { text, continuationId });
  };
}
