import { randomUUID } from "node:crypto";
import { Address, CircleName, type Circle } from "@team-31/protocol";
import { BrokerError, notFound } from "../errors.js";
import type { BrokerDeps, OwnerPort } from "../ports.js";
import type { CircleMemberRow, CircleRow, StoreTx } from "../store/store.js";
import type { RecordEvent } from "./events.js";

async function toCircle(tx: StoreTx, row: CircleRow): Promise<Circle> {
  const owner = (await tx.getUser(row.ownerUserId))?.address;
  if (!owner) throw new BrokerError("internal", "El círculo no tiene creador con dirección.");
  const members = await tx.listCircleMembers(row.id);
  return {
    id: row.id, name: row.name, owner,
    members: members.map(({ address, joinedAt }) => ({ address, joined: joinedAt !== undefined })),
  };
}

export async function listCircles(tx: StoreTx, address: Address): Promise<Circle[]> {
  return Promise.all((await tx.listCircles(address)).map((row) => toCircle(tx, row)));
}

async function ownedCircle(tx: StoreTx, userId: string, circleId: string) {
  const circle = await tx.getCircle(circleId);
  if (circle?.ownerUserId !== userId) throw notFound();
  return circle;
}

type CirclePort = Pick<OwnerPort, "circles" | "createCircle" | "deleteCircle" | "inviteToCircle" | "joinCircle" | "removeFromCircle">;

export function createCirclePort(
  { store, clock }: Pick<BrokerDeps, "store" | "clock">,
  record: RecordEvent,
  denyUnauthorizedInboxRequests: (tx: StoreTx, userId: string) => Promise<void>,
): CirclePort {
  async function denyUnauthorizedRequestsForMembers(tx: StoreTx, members: CircleMemberRow[]) {
    for (const { address } of members) {
      const user = await tx.getUserByAddress(address);
      if (user) await denyUnauthorizedInboxRequests(tx, user.userId);
    }
  }

  // Addresses stay out of telemetry: only the circle and what happened to it.
  function recordCircle(tx: StoreTx, userId: string, circleId: string, action: "created" | "deleted" | "invited" | "joined" | "removed") {
    record(tx, "broker.circle.changed", { userId, attrs: { circleId, action } });
  }

  return {
    circles(o) {
      return store.tx(async (tx) => {
        const address = (await tx.getUser(o.userId))?.address;
        return address ? listCircles(tx, address) : [];
      });
    },

    async createCircle(o, name) {
      const parsed = CircleName.safeParse(name);
      if (!parsed.success) throw new BrokerError("invalid_input", "El nombre del círculo debe tener entre 1 y 60 caracteres.");
      return store.tx(async (tx) => {
        const address = (await tx.getUser(o.userId))?.address;
        if (!address) throw new BrokerError("invalid_input", "Primero elige tu dirección en la App Sideband.");
        const row = { id: randomUUID(), ownerUserId: o.userId, name: parsed.data, createdAt: clock.now() };
        await tx.insertCircle(row);
        await tx.inviteCircleMember(row.id, address);
        await tx.joinCircle(row.id, address, row.createdAt);
        recordCircle(tx, o.userId, row.id, "created");
        return toCircle(tx, row);
      });
    },

    deleteCircle(o, circleId) {
      return store.tx(async (tx) => {
        const circle = await ownedCircle(tx, o.userId, circleId);
        const members = await tx.listCircleMembers(circle.id);
        await tx.deleteCircle(circle.id);
        recordCircle(tx, o.userId, circle.id, "deleted");
        await denyUnauthorizedRequestsForMembers(tx, members);
      });
    },

    async inviteToCircle(o, circleId, address) {
      if (!Address.safeParse(address).success) throw new BrokerError("invalid_input", "La dirección no es válida.");
      await store.tx(async (tx) => {
        const circle = await ownedCircle(tx, o.userId, circleId);
        await tx.inviteCircleMember(circle.id, address);
        recordCircle(tx, o.userId, circle.id, "invited");
      });
    },

    joinCircle(o, circleId) {
      return store.tx(async (tx) => {
        const address = (await tx.getUser(o.userId))?.address;
        if (!address) throw notFound();
        if (await tx.joinCircle(circleId, address, clock.now())) {
          recordCircle(tx, o.userId, circleId, "joined");
          return;
        }
        // A repeated join succeeds. Without an invitation the circle stays hidden.
        const members = await tx.listCircleMembers(circleId);
        if (!members.some((member) => member.address === address)) throw notFound();
      });
    },

    removeFromCircle(o, circleId, address) {
      return store.tx(async (tx) => {
        const circle = await tx.getCircle(circleId);
        const own = (await tx.getUser(o.userId))?.address;
        const isOwner = circle?.ownerUserId === o.userId;
        if (!circle || (!isOwner && own !== address)) throw notFound();
        if (isOwner && own === address) {
          throw new BrokerError("conflict", "Quien creó el círculo no puede salir. Elimínalo.");
        }
        const members = await tx.listCircleMembers(circle.id);
        if (!await tx.removeCircleMember(circle.id, address)) {
          // Removing someone twice succeeds. A stranger gets no hint that the circle exists.
          if (isOwner) return;
          throw notFound();
        }
        recordCircle(tx, o.userId, circle.id, "removed");
        await denyUnauthorizedRequestsForMembers(tx, members);
      });
    },
  };
}
