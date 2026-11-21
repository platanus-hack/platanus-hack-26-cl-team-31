import type { OwnerActivityQuery } from "@team-31/protocol/http";
import type {
  ActivityItem,
  ContactGroupChange, ContactGroups, OwnerVault, VaultCatalog, VaultChange, VaultQuery, VaultReceipt, VaultResult,
  AdminActor,
  Capability,
  Circle,
  Grant,
  GrantInput,
  Address,
  AgentConnection,
  PublicAgent, PublicProfile,
  AgentContacts,
  AskArguments,
  ChannelName,
  ContactsView,
  ConnectInput,
  ContactTag,
  InboxItem,
  InvitationAnswer,
  Owner,
  OwnerDecision,
  OwnerPendingItem,
  Principal,
  ReplyInput,
  ReplyReceipt,
  RequesterView,
  Sharing,
  WakeTarget,
} from "@team-31/protocol";

// A first authorized call registers the agent and emits presence, including reads of
// capabilities, inbox, status and contacts when they succeed with no items.
export interface AgentPort {
  searchPublicProfiles(p: Principal, query: string): Promise<PublicProfile[]>;
  networkUsers(p: Principal, after?: Address, q?: string): Promise<{ addresses: Address[]; nextCursor?: Address }>;
  connect(p: Principal): Promise<void>;
  contactGroups(p: Principal): Promise<ContactGroups>;
  changeContactGroup(p: Principal, input: ContactGroupChange): Promise<{ groupId: string }>;
  vaultCatalog(p: Principal): Promise<VaultCatalog>;
  vaultMembers(p: Principal, categoryId: string): Promise<{ members: Address[] }>;
  changeVault(p: Principal, change: VaultChange): Promise<VaultReceipt>;
  queryVault(p: Principal, query: VaultQuery): Promise<VaultResult>;
  capabilities(p: Principal, to: Address): Promise<{ tools: Capability[] }>;
  ask(p: Principal, input: AskArguments): Promise<RequesterView>;
  inbox(p: Principal, includeInvitations?: boolean): Promise<InboxItem[]>;
  reply(p: Principal, input: ReplyInput): Promise<ReplyReceipt>;
  status(p: Principal, requestId: string): Promise<RequesterView>;
  // The caller's contacts and joined circles, so its agent knows whom it can ask.
  contacts(p: Principal): Promise<AgentContacts>;
  connectWake(p: Principal, target: WakeTarget): Promise<AgentConnection>;
  disconnectWake(p: Principal, subscriptionId: string): Promise<void>;
}

export interface OwnerPort {
  searchPublicProfiles(o: Owner, query: string): Promise<PublicProfile[]>;
  directory(o: Owner): Promise<AgentContacts>;
  queryVault(o: Owner, query: VaultQuery): Promise<VaultResult>;
  contactGroups(o: Owner): Promise<ContactGroups & VaultCatalog>;
  vault(o: Owner): Promise<OwnerVault>;
  changeVault(o: Owner, change: VaultChange): Promise<VaultReceipt>;
  me(o: Owner): Promise<{ userId: string; address?: Address; displayName?: string }>;
  claimAddress(o: Owner, localPart: string): Promise<Address>;
  grants(o: Owner): Promise<Grant[]>;
  // Returns the live grant for this grantee and category, creating one if needed.
  setGrant(o: Owner, input: GrantInput): Promise<Grant>;
  revokeGrant(o: Owner, grantId: string): Promise<void>;
  pending(o: Owner): Promise<OwnerPendingItem[]>;
  activity(o: Owner, query?: number | OwnerActivityQuery): Promise<ActivityItem[]>;
  // A channel marks where the owner wrote the request: the broker notifies it when the request
  // waits for the recipient's owner or closes.
  ask(o: Owner, input: AskArguments, channel?: ChannelName): Promise<RequesterView>;
  status(o: Owner, requestId: string): Promise<RequesterView>;
  decide(o: Owner, requestId: string, decision: OwnerDecision): Promise<void>;
  agentDirectory(o: Owner): Promise<PublicAgent[]>;
  agents(o: Owner): Promise<AgentConnection[]>;
  setWake(o: Owner, agentId: string, target: WakeTarget): Promise<void>;
  setChannel(o: Owner, name: ChannelName, target: WakeTarget): Promise<void>;
  ping(o: Owner, agentId: string): Promise<{ requestId: string }>;
  revokeAgent(o: Owner, agentId: string): Promise<void>;
  // With a tag and no share, the invitation offers the tag's preset and the contact gets the tag.
  connect(o: Owner, input: ConnectInput): Promise<RequesterView>;
  /** @deprecated Pass an invitation object with to, share and tag. */
  connect(o: Owner, to: Address, share?: Sharing, tag?: ContactTag): Promise<RequesterView>;
  contacts(o: Owner): Promise<ContactsView>;
  setSharing(o: Owner, contact: Address, sharing: Sharing): Promise<void>;
  // Tags the contact and replaces its sharing with the tag's preset.
  setContactTag(o: Owner, contact: Address, tag: ContactTag): Promise<void>;
  // Contacts with the tag that still match its old preset follow the new one.
  setTagPreset(o: Owner, tag: ContactTag, sharing: Sharing): Promise<void>;
  answerInvitation(o: Owner, requestId: string, answer: InvitationAnswer): Promise<void>;
  // Circles the owner joined or is invited to.
  circles(o: Owner): Promise<Circle[]>;
  // The creator joins at once. Only the creator invites, removes others and deletes.
  createCircle(o: Owner, name: string): Promise<Circle>;
  deleteCircle(o: Owner, circleId: string): Promise<void>;
  inviteToCircle(o: Owner, circleId: string, address: Address): Promise<void>;
  // Accepts the owner's pending invitation.
  joinCircle(o: Owner, circleId: string): Promise<void>;
  // A member leaves with their own address. The creator removes any other address.
  removeFromCircle(o: Owner, circleId: string, address: Address): Promise<void>;
  removeContact(o: Owner, contact: Address): Promise<void>;
  /** @deprecated Use removeContact. */
  removeFriend(o: Owner, contact: Address): Promise<void>;
}

// Operational mutations for apps/admin. The broker keeps the invariant that each request ends in
// exactly one final state, so the admin never writes sideband.* directly. `reason` is 10 to 500 chars.
export interface AdminPort {
  // Only for an `awaiting_agent` request that has not expired. Queues the next wake attempt.
  rewake(a: AdminActor, requestId: string, reason: string): Promise<void>;
  // Closes a pending request as `expired` through the same path as the expiry sweep.
  expire(a: AdminActor, requestId: string, reason: string): Promise<void>;
  // Same as OwnerPort.revokeAgent, for any user.
  revokeAgent(a: AdminActor, userId: string, agentId: string, reason: string): Promise<void>;
}
