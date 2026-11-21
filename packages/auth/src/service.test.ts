import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { mintServiceToken, verifyServiceToken } from "./service.js";

const mcp = await generateKeyPair("EdDSA", { extractable: true });
const web = await generateKeyPair("EdDSA", { extractable: true });
const publicKeys = { mcp: await exportJWK(mcp.publicKey), web: await exportJWK(web.publicKey) };
const sub = "user-1";
const azp = "agent-1";

describe("JWT de servicio", () => {
  let mcpToken: string;
  let webToken: string;

  beforeAll(async () => {
    mcpToken = await mintServiceToken({
      iss: "mcp", sub, azp, scopes: ["nexo:inbox"], privateKey: await exportJWK(mcp.privateKey),
    });
    webToken = await mintServiceToken({ iss: "web", sub, privateKey: await exportJWK(web.privateKey) });
  });

  it("firma y verifica la identidad de agente con una vigencia de 60 segundos", async () => {
    const claims = decodeJwt(mcpToken);
    expect(decodeProtectedHeader(mcpToken).alg).toBe("EdDSA");
    expect(claims).toMatchObject({ iss: "mcp", aud: "broker", sub, azp, scope: "nexo:inbox" });
    expect(claims.exp! - claims.iat!).toBe(60);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    await expect(verifyServiceToken(mcpToken, { publicKeys, expectedIss: "mcp" })).resolves.toEqual({
      userId: sub, agentId: azp, scopes: ["nexo:inbox"],
    });
  });

  it("firma y verifica la identidad de dueño", async () => {
    const claims = decodeJwt(webToken);
    expect(claims).not.toHaveProperty("azp");
    expect(claims).not.toHaveProperty("scope");
    await expect(verifyServiceToken(webToken, { publicKeys, expectedIss: "web" })).resolves.toEqual({ userId: sub });
  });

  it("rechaza emisores cruzados incluso si comparten clave", async () => {
    await expect(verifyServiceToken(webToken, {
      expectedIss: "mcp",
      publicKeys: { mcp: publicKeys.web },
    })).rejects.toMatchObject({ claim: "iss" });
  });

  it.each([
    { test: "expirado", aud: "broker", lifetime: -1, agent: azp, claim: "exp" },
    { test: "con otra audiencia", aud: "web", lifetime: 60, agent: azp, claim: "aud" },
  ])("rechaza un JWT $test", async ({ aud, lifetime, agent, claim }) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ azp: agent, scope: "nexo:inbox" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("mcp")
      .setAudience(aud)
      .setSubject(sub)
      .setJti("test-token")
      .setIssuedAt(now)
      .setExpirationTime(now + lifetime)
      .sign(mcp.privateKey);

    await expect(verifyServiceToken(token, { publicKeys, expectedIss: "mcp" })).rejects.toMatchObject({ claim });
  });

  it("rechaza un JWT de MCP sin azp", async () => {
    const token = await new SignJWT({ scope: "nexo:inbox" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("mcp")
      .setAudience("broker")
      .setSubject(sub)
      .setJti("test-token")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(mcp.privateKey);

    await expect(verifyServiceToken(token, { publicKeys, expectedIss: "mcp" })).rejects.toThrow("identidad");
  });
});
