import { expect, it } from "vitest";

import { createFlowDirectory } from "./directory.js";

it("resolves an OAuth client without a user ID only while its owner is unambiguous", () => {
  const directory = createFlowDirectory({ agents: [{ agentId: "shared", userId: "ana" }] });
  expect(directory.agent("shared")?.userId).toBe("ana");

  directory.add({ agents: [{ agentId: "shared", userId: "bob" }] });
  expect(directory.agent("shared")).toBeUndefined();
});

it("evicts the oldest request references while keeping refreshed and recent ones", () => {
  const ref = (id: string, toAddress = `${id}@sideband.app`) => ({ id, fromAddress: "ana@sideband.app", toAddress });
  const directory = createFlowDirectory({ requests: [ref("old"), ref("refresh"), ref("buffered")] }, { requestLimit: 3 });

  directory.add({ requests: [ref("refresh", "updated@sideband.app"), ref("new")] });

  expect(directory.request("old")).toBeUndefined();
  expect(directory.request("refresh")?.toAddress).toBe("updated@sideband.app");
  expect(directory.request("buffered")?.toAddress).toBe("buffered@sideband.app");
  expect(directory.request("new")?.toAddress).toBe("new@sideband.app");
});
