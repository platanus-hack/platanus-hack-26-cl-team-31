import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const identityPath = (directory, person) => join(directory, `${person}.json`);

export async function readIdentityToken(directory, person) {
  const content = await readFile(identityPath(directory, person), "utf8");
  let token;
  try {
    token = JSON.parse(content)?.mcpServers?.coordination?.env?.AGENT_TOKEN;
  } catch {
    // A parse error may include part of the secret. Report only a configuration error.
  }
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new Error("Credencial de demo inválida.");
  return token;
}
