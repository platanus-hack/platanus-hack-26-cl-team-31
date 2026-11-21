import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { mintServiceToken, parseServicePrivateKey, verifyServiceToken } from "./service.js";

const mcp = await generateKeyPair("EdDSA", { extractable: true });
const web = await generateKeyPair("EdDSA", { extractable: true });
const admin = await generateKeyPair("EdDSA", { extractable: true });
const publicKeys = {
  mcp: await exportJWK(mcp.publicKey),
  web: await exportJWK(web.publicKey),
  admin: await exportJWK(admin.publicKey),
};
const sub = "user-1";
const azp = "agent-1";

describe("configuración JWT de servicio", () => {
  it("acepta una llave privada Ed25519 configurada como JWK", async () => {
    const key = await exportJWK(web.privateKey);
    expect(parseServicePrivateKey(JSON.stringify(key), "web")).toEqual(key);
  });

  it("identifica la variable de una llave inválida sin incluir su contenido", () => {
    for (const value of [undefined, "contenido privado inválido", JSON.stringify(publicKeys.web)]) {
      expect(() => parseServicePrivateKey(value, "web")).toThrow(
        /^WEB_SERVICE_PRIVATE_KEY debe contener una JWK privada Ed25519\.$/,
      );
    }
  });
});

describe("JWT de servicio", () => {
  let mcpToken: string;
  let webToken: string;

  beforeAll(async () => {
    mcpToken = await mintServiceToken({
      iss: "mcp", sub, azp, scopes: ["sideband:inbox"], privateKey: await exportJWK(mcp.privateKey),
    });
    webToken = await mintServiceToken({ iss: "web", sub, privateKey: await exportJWK(web.privateKey) });
  });

  it("firma y verifica la identidad de agente con una vigencia de 60 segundos", async () => {
    const claims = decodeJwt(mcpToken);
    expect(decodeProtectedHeader(mcpToken).alg).toBe("EdDSA");
    expect(claims).toMatchObject({ iss: "mcp", aud: "broker", sub, azp, scope: "sideband:inbox" });
    expect(claims.exp! - claims.iat!).toBe(60);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    await expect(verifyServiceToken(mcpToken, { publicKeys, expectedIss: "mcp" })).resolves.toEqual({
      userId: sub, agentId: azp, scopes: ["sideband:inbox"],
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
    const token = await new SignJWT({ azp: agent, scope: "sideband:inbox" })
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
    const token = await new SignJWT({ scope: "sideband:inbox" })
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

  describe("emisor admin", () => {
    const email = "ops@sideband.app";
    const mintAdmin = async (options: { sub?: string; email?: string } = {}) => mintServiceToken({
      iss: "admin", sub: options.sub ?? "admin-1", email: options.email ?? email, privateKey: await exportJWK(admin.privateKey),
    });

    it("firma y verifica la identidad del operador con sub y email", async () => {
      const token = await mintAdmin();
      const claims = decodeJwt(token);
      expect(claims).toMatchObject({ iss: "admin", aud: "broker", sub: "admin-1", email });
      expect(claims).not.toHaveProperty("azp");
      expect(claims).not.toHaveProperty("scope");
      expect(claims.exp! - claims.iat!).toBe(60);
      await expect(verifyServiceToken(token, { publicKeys, expectedIss: "admin" })).resolves.toEqual({
        adminId: "admin-1", email,
      });
    });

    it("no mintea sin correo válido ni sin identidad", async () => {
      await expect(mintAdmin({ email: "no-es-correo" })).rejects.toThrow("correo");
      await expect(mintAdmin({ sub: " " })).rejects.toThrow("identidad");
    });

    it("rechaza tokens admin donde se espera mcp o web, y tokens web donde se espera admin", async () => {
      const token = await mintAdmin();
      await expect(verifyServiceToken(token, { publicKeys, expectedIss: "web" })).rejects.toBeTruthy();
      await expect(verifyServiceToken(token, { publicKeys, expectedIss: "mcp" })).rejects.toBeTruthy();
      await expect(verifyServiceToken(webToken, { publicKeys, expectedIss: "admin" })).rejects.toBeTruthy();
      // Even with a shared key, the issuer claim keeps the identities apart.
      await expect(verifyServiceToken(webToken, { expectedIss: "admin", publicKeys: { admin: publicKeys.web } }))
        .rejects.toMatchObject({ claim: "iss" });
      await expect(verifyServiceToken(token, { expectedIss: "web", publicKeys: { web: publicKeys.admin } }))
        .rejects.toMatchObject({ claim: "iss" });
    });

    it("rechaza un JWT admin sin email o sin clave admin configurada", async () => {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "EdDSA" })
        .setIssuer("admin")
        .setAudience("broker")
        .setSubject("admin-1")
        .setJti("test-token")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(admin.privateKey);
      await expect(verifyServiceToken(token, { publicKeys, expectedIss: "admin" })).rejects.toThrow("correo");
      await expect(verifyServiceToken(await mintAdmin(), {
        expectedIss: "admin", publicKeys: { mcp: publicKeys.mcp, web: publicKeys.web },
      })).rejects.toThrow("Ed25519");
    });
  });
});
