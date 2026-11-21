import type { AgentContacts, AskInput, TagsView, VaultCatalog, PublicProfile, RequiredRelation, RequesterView, VaultQuery, VaultResult } from "@team-31/protocol";
import { Category, Sharing } from "@team-31/protocol";
import { z } from "zod";

export const MessageInput = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  continuationId: z.string().min(1).max(256).optional(),
});
export type MessageInput = z.infer<typeof MessageInput>;

const literal = z.string().trim().min(1).max(256);
const selector = z.object({
  scope: z.enum(["address", "contacts", "friend", "family", "work", "circle", "unspecified"]),
  count: z.enum(["one", "many"]),
  person: literal.optional(),
  circle: literal.optional(),
});
export type Selector = z.infer<typeof selector>;
const argumentsDraft = z.object({
  interest: literal.optional(),
  date: z.string().optional(), start: z.string().optional(), durationMinutes: z.number().optional(), timezone: z.string().optional(),
  text: z.string().max(1000).optional(), category: Category.optional(), share: Sharing.optional(),
});
export const Intent = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ask"), selector, tool: z.enum(["availability", "interest_check", "question", "connect"]), args: argumentsDraft }),
  z.object({ action: z.literal("vault"), selector, categoryName: literal.optional() }),
  z.object({ action: z.literal("profiles"), query: literal.optional() }),
  z.object({ action: z.literal("status"), recipient: literal.optional(), requestId: literal.optional() }),
  z.object({ action: z.literal("contacts") }),
  z.object({ action: z.literal("clarify") }),
]);
export type Intent = z.infer<typeof Intent>;
export type InterpretMessage = (text: string, context: {
  at: string; timezone?: string; expected?: string; draft?: Intent;
}) => Promise<Intent>;

export type ReceiptRef = Pick<RequesterView, "to" | "requestId">;
export interface TurnOperations {
  invitationTags?(): Promise<TagsView & VaultCatalog>;
  contacts(): Promise<AgentContacts>;
  ask(input: AskInput): Promise<RequesterView>;
  status(requestId: string): Promise<RequesterView>;
  queryVault?(input: VaultQuery): Promise<VaultResult>;
  searchProfiles?(query: string): Promise<PublicProfile[]>;
  recentSent?(): Promise<ReceiptRef[]>;
}
export interface TurnOwner { userId: string; binding: string; agentId?: string; deliveryId?: string }
export interface TurnContext extends TurnOwner { ops: TurnOperations; timezone?: string; now?: Date }
export type Choice = { label: string; value: string };
export type MessageReply =
  | { kind: "clarification"; question: string; continuationId: string; choices?: Choice[] }
  | { kind: "requests"; items: RequesterView[]; confirmed?: ReceiptRef[]; unconfirmedCount: number; continuationId: string; errorId?: string }
  | { kind: "contacts"; data: AgentContacts }
  | { kind: "profiles"; items: PublicProfile[] }
  | { kind: "vault"; data: VaultResult }
  | { kind: "unavailable"; reason: "unsupported" | "expired" | "empty_selection" };

export type Relation = RequiredRelation;
export type RoutedAsk = AskInput & { idempotencyKey: string };
export type Field = "invitationTag" | "intent" | "scope" | "person" | "circle" | "categoryId" | "requestId" | "query"
  | keyof z.infer<typeof argumentsDraft>;
export type ReadPlan = { action: "contacts" } | { action: "profiles"; query: string }
  | { action: "vault"; selector: Selector; circleId?: string; categoryId?: string; empty?: true };
export type TurnState =
  | { phase: "read"; plan: ReadPlan }
  | { phase: "clarify"; at: string; intent: Intent; field: Field; choices?: Choice[]; refs?: ReceiptRef[]; circleId?: string; invitationTag?: string | null; timezone?: string; relativeDays?: number }
  | { phase: "dispatch"; jobs: RoutedAsk[]; refs: ReceiptRef[]; receipts?: Exclude<RequesterView, { decision: "allow" }>[] }
  | { phase: "requests"; refs: ReceiptRef[]; receipts?: Exclude<RequesterView, { decision: "allow" }>[] };

export interface TurnSession {
  id: string; continuationId: string; previous?: TurnState; replay?: boolean;
  save(state: TurnState): Promise<void>;
}
export interface TurnStore {
  run(owner: TurnOwner, continuationId: string | undefined, turn: (session: TurnSession) => Promise<MessageReply>): Promise<MessageReply | undefined>;
}
