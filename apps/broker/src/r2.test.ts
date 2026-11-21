import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import { createR2Storage } from "./r2.js";
import type { BrokerEnv } from "./env.js";

const storage = createR2Storage({ R2_ACCOUNT_ID: "a".repeat(32), R2_BUCKET: "test-vault",
  R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test-secret" } as BrokerEnv)!;
afterEach(() => { vi.restoreAllMocks(); });

it("firma PUT sobre staging con longitud obligatoria y GET sobre el documento, ambos por 60 s", async () => {
  const put = new URL(await storage.uploadUrl("object", 12));
  const get = new URL(await storage.downloadUrl("object", false));
  expect(put.pathname).toBe("/test-vault/staging/object");
  expect(put.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-length");
  expect(get.pathname).toBe("/test-vault/documents/object");
  for (const url of [put, get]) expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
});

it("solo almacena los mismos bytes que verificó: tamaño, longitud real y SHA-256", async () => {
  const bytes = Buffer.from([0, 255, 1]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const send = vi.fn<(command: { input: object }) => Promise<unknown>>();
  vi.spyOn(S3Client.prototype, "send").mockImplementation(send);
  for (const [size, content, digest] of [[4, bytes, hash], [3, bytes.subarray(1), hash], [3, bytes, "0".repeat(64)]] as const) {
    send.mockResolvedValueOnce({ ContentLength: size, Body: Readable.from([content]) });
    await expect(storage.verifyAndStore("object", 3, digest)).rejects.toMatchObject({ code: "invalid_input" });
  }
  expect(send).toHaveBeenCalledTimes(3);
  send.mockResolvedValueOnce({ ContentLength: 3, Body: Readable.from([bytes]) }).mockResolvedValueOnce({});
  await storage.verifyAndStore("object", 3, hash);
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ input: { Key: "documents/object", Body: bytes } });
});
