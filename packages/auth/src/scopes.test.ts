import { expect, it } from "vitest";

import { parseScopes } from "./scopes.js";

it("no concede permisos cuando el claim scope llega como una lista JSON", () => {
  expect(parseScopes(["sideband:ask"])).toEqual([]);
});
