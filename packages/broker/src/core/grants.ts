import { randomUUID } from "node:crypto";
import { basicSharing, categoryOf, type Address, type Category } from "@team-31/protocol";
import type { BrokerDeps } from "../ports.js";
import type { RequestRow, StoreTx } from "../store/store.js";
import type { RecordEvent } from "./events.js";

// Whoever reads the vault category of that id may ask about it. A shared circle adds the basic categories.
// A stable rule code for telemetry, independent of the display text.
export async function sharingRule(tx: StoreTx, toUserId: string, toAddress: Address, from: Address, category: Category) {
  if (await tx.canReadVault(toUserId, from, category)) return "grant";
  if (basicSharing.includes(category) && await tx.shareCircle(toAddress, from)) return "circle";
  return "no_grant";
}

export async function stillAuthorized(tx: StoreTx, row: RequestRow, toUserId: string): Promise<boolean> {
  // Invitations, connection tests and one-time owner approvals have their own consent flow.
  if (row.tool === "connect" || row.fromUserId === null || row.approvedOnce) return true;
  const category = categoryOf(row.tool, row.args);
  return category !== undefined && await sharingRule(tx, toUserId, row.toAddress, row.fromAddress, category) !== "no_grant";
}

export function createGrantWriter(clock: BrokerDeps["clock"], record: RecordEvent) {
  async function putGrant(tx: StoreTx, userId: string, address: Address, category: Category) {
    const grant = await tx.putGrant({
      id: randomUUID(), grantorUserId: userId, granteeAddress: address, category, createdAt: clock.now(),
    });
    record(tx, "broker.grant.set", { userId, attrs: { grantId: grant.id, category } });
    return grant;
  }

  async function revokeGrant(tx: StoreTx, userId: string, grantId: string) {
    const revoked = await tx.revokeGrant(grantId, userId, clock.now());
    if (revoked) record(tx, "broker.grant.revoked", { userId, attrs: { grantId } });
    return revoked;
  }

  return { putGrant, revokeGrant };
}
