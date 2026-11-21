export { SCOPES } from "./scopes.js";

/** Native MCP clients may omit Origin; a declared browser origin must match exactly. */
export function acceptsMcpOrigin(origin: string | undefined, expected: string): boolean {
  return origin === undefined || origin === expected;
}
