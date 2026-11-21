import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { WakeTarget, type WakeKind } from "@team-31/protocol";
import { BrokerError } from "../../errors.js";

const algorithm = "aes-256-gcm";
const nonceBytes = 12;
const tagBytes = 16;

type WakeIdentity = { userId: string; agentId: string; wakeKind: WakeKind };
type StoredWake = { wakeKind: WakeKind; wakePublic: unknown; wakeSecret: Buffer | null };

function keyBytes(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  const canonical = key.toString("base64");
  if (key.length !== 32 || (value !== canonical && value !== canonical.replace(/=+$/, ""))) {
    throw new Error("WAKE_SECRETS_KEY debe contener 32 bytes codificados en base64.");
  }
  return key;
}

function associatedData({ userId, agentId, wakeKind }: WakeIdentity): Buffer {
  return Buffer.from(JSON.stringify([userId, agentId, wakeKind]));
}

export function createWakeCodec(secretsKey: string) {
  const key = keyBytes(secretsKey);

  function encrypt(secret: string, identity: WakeIdentity): Buffer {
    const nonce = randomBytes(nonceBytes);
    const cipher = createCipheriv(algorithm, key, nonce);
    cipher.setAAD(associatedData(identity));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
  }

  function decrypt(secret: Buffer, identity: WakeIdentity): string {
    const decipher = createDecipheriv(algorithm, key, secret.subarray(0, nonceBytes));
    decipher.setAAD(associatedData(identity));
    decipher.setAuthTag(secret.subarray(nonceBytes, nonceBytes + tagBytes));
    return Buffer.concat([
      decipher.update(secret.subarray(nonceBytes + tagBytes)), decipher.final(),
    ]).toString("utf8");
  }

  return {
    encode(input: WakeTarget, identity: Omit<WakeIdentity, "wakeKind">): StoredWake {
      const target = WakeTarget.safeParse(input);
      if (!target.success) throw new BrokerError("invalid_input", "La configuración de aviso no es válida.");
      const configuration = target.data;
      const context = { ...identity, wakeKind: configuration.kind };
      switch (configuration.kind) {
        case "none":
          return { wakeKind: configuration.kind, wakePublic: {}, wakeSecret: null };
        case "openclaw_hooks": {
          const { kind, token, ...wakePublic } = configuration;
          return { wakeKind: kind, wakePublic, wakeSecret: encrypt(token, context) };
        }
        case "grokbot_routine": {
          const { kind, key: secret, ...wakePublic } = configuration;
          return { wakeKind: kind, wakePublic, wakeSecret: encrypt(secret, context) };
        }
        case "standard_webhook":
        case "mcp_events": {
          const { kind, secret, ...wakePublic } = configuration;
          return { wakeKind: kind, wakePublic, wakeSecret: encrypt(secret, context) };
        }
      }
    },

    decode(row: WakeIdentity & StoredWake): WakeTarget {
      try {
        const secret = row.wakeSecret === null ? undefined : decrypt(row.wakeSecret, row);
        const field = row.wakeKind === "openclaw_hooks" ? "token" : row.wakeKind === "grokbot_routine" ? "key" : "secret";
        return WakeTarget.parse({
          ...(row.wakePublic as Record<string, unknown>),
          kind: row.wakeKind,
          [field]: secret,
        });
      } catch {
        throw new BrokerError("internal", "No se pudo leer la configuración de aviso.");
      }
    },
  };
}
