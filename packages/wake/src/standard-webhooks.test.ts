import { describe, expect, it } from "vitest";
import { sign, verify } from "./standard-webhooks.js";

const secret = "whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const id = "evt_req_123";
const timestamp = 1_700_000_000;
const body = '{"event":"sideband.request.created","requestId":"req_123"}';
// Independent HMAC-SHA256 vector calculated with OpenSSL.
const signature = "v1,EvyHo4dwmt/8hRUOLpw1cahz0gv4IXoJTvu7P0VVsuk=";

describe("Standard Webhooks", () => {
  it("firma y verifica el vector conocido", () => {
    expect(sign(secret, id, timestamp, body)).toBe(signature);
    expect(verify(secret, id, timestamp, body, signature)).toBe(true);
  });

  it("verifica los bytes exactos con la llave, id y timestamp indicados", () => {
    expect(verify(secret, id, timestamp, body + " ", signature)).toBe(false);
    expect(verify(secret, id, timestamp + 1, body, signature)).toBe(false);
    expect(verify(secret, "evt_other", timestamp, body, signature)).toBe(false);
    expect(verify("whsec_Zm9v", id, timestamp, body, signature)).toBe(false);
    expect(verify("whsec_", id, timestamp, body, signature)).toBe(false);
  });
});
