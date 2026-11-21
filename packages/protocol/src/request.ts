import { z } from "zod";
import { Address } from "./address.js";
import { ToolArgs, ToolName, ToolResult, ToolResultSchemas } from "./tools.js";
import { Sharing } from "./sharing.js";

const askBase = z.object({
  to: Address,
  purpose: z.string().max(200).optional(),
});

export const AskInput = z.discriminatedUnion("tool", [
  askBase.extend({ tool: z.literal("interest_check"), args: ToolArgs.interest_check }),
  askBase.extend({ tool: z.literal("profile"), args: ToolArgs.profile }),
  askBase.extend({ tool: z.literal("availability"), args: ToolArgs.availability }),
  askBase.extend({ tool: z.literal("question"), args: ToolArgs.question }),
  askBase.extend({ tool: z.literal("connect"), args: ToolArgs.connect }),
]);
export type AskInput = z.infer<typeof AskInput>;

export const BotOutcome = z.enum(["answered", "no_data", "needs_owner", "declined"]);
export type BotOutcome = z.infer<typeof BotOutcome>;

export const FinalOutcome = z.enum([
  "answered",
  "no_data",
  "declined",
  "denied",
  "expired",
  "delivery_failed",
]);
export type FinalOutcome = z.infer<typeof FinalOutcome>;

export const RequestStatus = z.enum(["awaiting_agent", "awaiting_owner", ...FinalOutcome.options]);
export type RequestStatus = z.infer<typeof RequestStatus>;

const requesterBase = z.object({
  requestId: z.string(),
  to: Address,
  tool: ToolName,
  expiresAt: z.iso.datetime({ offset: true }),
});

const finalRequesterBase = requesterBase.extend({
  final: z.literal(true),
  signature: z.string().min(1),
});

export const RequesterView = z.discriminatedUnion("decision", [
  requesterBase.extend({
    final: z.literal(false),
    decision: z.literal("pending"),
    waitingFor: z.enum(["agent", "owner"]),
  }),
  finalRequesterBase.extend({
    decision: z.literal("allow"),
    outcome: z.literal("answered"),
    result: ToolResult,
  }),
  finalRequesterBase.extend({
    decision: z.literal("unanswered"),
    outcome: z.enum(["no_data", "expired", "delivery_failed"]),
  }),
  finalRequesterBase.extend({ decision: z.literal("deny") }),
]).refine(
  (view) => view.decision !== "allow" || ToolResultSchemas[view.tool].safeParse(view.result).success,
  { error: "El resultado no corresponde a la herramienta.", path: ["result"] },
);
export type RequesterView = z.infer<typeof RequesterView>;

export const RequesterViewSchema = RequesterView;

export const SenderMessage = z.object({
  text: z.string(),
  purpose: z.string().max(200).optional(),
  trusted: z.literal(false),
});
export type SenderMessage = z.infer<typeof SenderMessage>;

export const InboxItem = z.object({
  requestId: z.string(),
  nonce: z.string(),
  tool: ToolName,
  from: Address,
  args: z.unknown(),
  expiresAt: z.iso.datetime({ offset: true }),
  allowedFields: z.array(z.string()),
  ownerAuthorization: z.object({
    rule: z.string(),
    guidance: z.string(),
    verifiedBy: z.literal("broker"),
  }),
  senderMessage: SenderMessage,
  howToReply: z.string(),
}).refine(
  (item) => ToolArgs[item.tool].safeParse(item.args).success,
  { error: "Los argumentos no corresponden a la herramienta.", path: ["args"] },
);
export type InboxItem = z.infer<typeof InboxItem>;

export const ReplyArguments = z.object({
  requestId: z.string(),
  nonce: z.string(),
  outcome: BotOutcome,
  // Recipient's grants for an accepted invitation. These never travel in result.
  share: Sharing.optional(),
  result: z.unknown().optional(),
  internalReason: z.string().max(300).optional(),
});

export const ReplyInput = z.discriminatedUnion("outcome", [
  ReplyArguments.extend({
    outcome: z.literal("answered"),
    result: z.custom<NonNullable<unknown> | null>((value) => value !== undefined, {
      error: "Incluye un resultado para la solicitud respondida.",
    }),
  }),
  ReplyArguments.extend({ outcome: BotOutcome.exclude(["answered"]) }),
]);
export type ReplyInput = z.infer<typeof ReplyInput>;

export const ReplyReceipt = z.object({
  requestId: z.string(),
  status: RequestStatus,
  deliveredFields: z.array(z.string()),
  droppedFields: z.array(z.string()),
});
export type ReplyReceipt = z.infer<typeof ReplyReceipt>;
