import { randomUUID } from "node:crypto";
import { basicSharing, Category, categoryOf, type Address, type Sharing } from "@team-31/protocol";
import type { BrokerDeps } from "../ports.js";
import type { GrantRow, RequestRow, StoreTx } from "../store/store.js";
import type { RecordEvent } from "./events.js";

// A stable rule code for telemetry, independent of the display text.
export async function sharingRule(tx: StoreTx, toUserId: string, toAddress: Address, from: Address, category: Category) {
  if (await tx.getGrant(toUserId, from, category)) return "grant";
  if (basicSharing.includes(category) && await tx.shareCircle(toAddress, from)) return "circle";
  return "no_grant";
}

export async function stillAuthorized(tx: StoreTx, row: RequestRow, toUserId: string): Promise<boolean> {
  // Invitations, connection tests and one-time owner approvals have their own consent flow.
  if (row.tool === "connect" || row.fromUserId === null || row.approvedOnce) return true;
  if (row.tool === "vault_access") return (await tx.listContactAddresses(toUserId)).includes(row.fromAddress);
  const category = categoryOf(row.tool, row.args);
  return category !== undefined && await sharingRule(tx, toUserId, row.toAddress, row.fromAddress, category) !== "no_grant";
}

// In catalog order, so the answer does not depend on how the store sorts grants.
export function categoriesOf(grants: GrantRow[]): Sharing {
  return Category.options.filter((category) => grants.some((grant) => grant.category === category));
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

  async function applySharing(tx: StoreTx, userId: string, address: Address, sharing: Sharing) {
    for (const category of Category.options) {
      const live = await tx.getGrant(userId, address, category);
      if (sharing.includes(category)) {
        if (!live) await putGrant(tx, userId, address, category);
      } else if (live) {
        await revokeGrant(tx, userId, live.id);
      }
    }
  }

  return { putGrant, revokeGrant, applySharing };
}
