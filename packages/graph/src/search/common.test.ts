import { expect, it } from "vitest";
import type { NodeId } from "../model.js";
import { frontierRequest } from "./common.js";
import { MinHeap } from "./heap.js";

it("pide una sola vez la adyacencia de un nodo presente en ambas fronteras", () => {
  const forward = new MinHeap<NodeId>();
  const backward = new MinHeap<NodeId>();
  forward.push("person:ana", 1);
  backward.push("person:ana", 2);
  backward.push("person:bob", 3);

  const view = { arcs: () => undefined, penalty: () => 0 };
  const request = frontierRequest(view, "person:luz", [forward, backward], () => false, 3);

  expect([...request.ids].sort()).toEqual(["person:ana", "person:bob", "person:luz"]);
});
