import { SharingRules } from "./rules.js";

export const fixtureUsers = {
  simon: { userId: "user-simon", address: "simon@nexo.app" },
  diego: { userId: "user-diego", address: "diego@nexo.app" },
  adolfo: { userId: "user-adolfo", address: "adolfo@nexo.app" },
} as const;

export const fixtureSharingRules = SharingRules.parse({
  publicProfile: { displayName: "Simón" },
  circles: {
    amigos: [fixtureUsers.diego.address],
    trabajo: [fixtureUsers.diego.address, fixtureUsers.adolfo.address],
  },
  grants: {
    amigos: [{ tool: "availability", fields: ["available", "freeSlots"] }],
    trabajo: [{ tool: "availability", fields: ["available"] }],
  },
});
