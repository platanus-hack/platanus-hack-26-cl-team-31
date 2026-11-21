import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BrokerError, type DocumentStorage } from "@team-31/broker";
import { MAX_VAULT_DOCUMENT_BYTES } from "@team-31/protocol";
import type { BrokerEnv } from "./env.js";
import type { BrokerServiceTelemetry } from "./telemetry.js";

export function createR2Storage(env: BrokerEnv, telemetry?: BrokerServiceTelemetry["shared"]): DocumentStorage | undefined {
  if (!env.R2_ACCOUNT_ID) return;
  const Bucket = env.R2_BUCKET!;
  const s3 = new S3Client({
    region: "auto", endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
    forcePathStyle: true, maxAttempts: 1, requestChecksumCalculation: "WHEN_REQUIRED",
  });
  type Operation = "sign_upload" | "verify_upload" | "store" | "cache_legacy" | "sign_download";
  const trace = <T>(operation: Operation, run: () => Promise<T>) =>
    telemetry ? telemetry.span("broker.vault.storage", { attrs: { operation } }, run) : run();
  const put = (Key: string, Body: Buffer) => s3.send(new PutObjectCommand({
    Bucket, Key, Body, ContentType: "application/octet-stream", ContentDisposition: "attachment", CacheControl: "no-store",
  }), { abortSignal: AbortSignal.timeout(4000) });

  return {
    uploadUrl: (key, sizeBytes) => trace("sign_upload", () => getSignedUrl(s3, new PutObjectCommand({
      Bucket, Key: `staging/${key}`, ContentLength: sizeBytes,
    }), { expiresIn: 60, signableHeaders: new Set(["content-length"]) })),
    verifyAndStore: (key, sizeBytes, sha256) => trace("verify_upload", async () => {
      // Read the same bytes we commit. A still-valid PUT can overwrite staging, never the final object.
      const object = await s3.send(new GetObjectCommand({ Bucket, Key: `staging/${key}` }),
        { abortSignal: AbortSignal.timeout(4000) });
      const stream = object.Body;
      if (!stream) throw new BrokerError("invalid_input", "Primero sube el archivo al enlace temporal.");
      const chunks: Buffer[] = [];
      let length = 0;
      try {
        if (object.ContentLength !== sizeBytes || sizeBytes > MAX_VAULT_DOCUMENT_BYTES) {
          throw new BrokerError("invalid_input", "El tamaño del archivo no coincide.");
        }
        for await (const chunk of stream as AsyncIterable<Uint8Array>) {
          length += chunk.length;
          if (length > sizeBytes) throw new BrokerError("invalid_input", "El archivo supera el tamaño declarado.");
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        if ("destroy" in stream) stream.destroy();
      }
      const bytes = Buffer.concat(chunks);
      if (length !== sizeBytes || createHash("sha256").update(bytes).digest("hex") !== sha256) {
        throw new BrokerError("invalid_input", "El contenido del archivo no coincide con el SHA-256 declarado.");
      }
      await trace("store", () => put(`documents/${key}`, bytes));
    }),
    async cacheLegacy(key, bytes) { await trace("cache_legacy", () => put(`legacy/${key}`, bytes)); },
    downloadUrl: (key, legacy) => trace("sign_download", () => getSignedUrl(s3, new GetObjectCommand({
      Bucket, Key: `${legacy ? "legacy" : "documents"}/${key}`, ResponseContentDisposition: "attachment",
    }), { expiresIn: 60 })),
  };
}
