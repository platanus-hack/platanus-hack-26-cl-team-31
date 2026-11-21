/** Reads at most limit bytes into memory. Returning early cancels the remaining input. */
export async function readWebhookBody(request: Request, limit: number): Promise<Buffer | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    for await (const chunk of request.body as ReadableStream<Uint8Array> & AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > limit) return null;
      if (chunk.byteLength) chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks, size);
}
