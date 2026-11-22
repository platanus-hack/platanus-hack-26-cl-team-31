import { expect, it } from "vitest";

import { createFlowDirectory } from "./directory.js";

it("resolves an OAuth client without a user ID only while its owner is unambiguous", () => {
  const directory = createFlowDirectory({ agents: [{ agentId: "shared", userId: "ana" }] });
  expect(directory.agent("shared")?.userId).toBe("ana");

  directory.add({ agents: [{ agentId: "shared", userId: "bob" }] });
  expect(directory.agent("shared")).toBeUndefined();
});
