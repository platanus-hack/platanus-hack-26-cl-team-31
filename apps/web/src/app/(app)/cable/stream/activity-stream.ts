import { routes } from "@team-31/protocol/http";

// NX-09 writes blank-line-delimited frames with activity snapshots and version IDs.
const frameEnd = /\r?\n\r?\n/;
const versionId = /^[A-Za-z0-9_-]{43}$/;

function filteredFrame(frame: string): string | undefined {
  let event = "";
  let id = "";
  let retry = "";
  let heartbeat = false;
  const data: string[] = [];

  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      heartbeat = true;
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "retry") retry = value;
    if (field === "data") data.push(value);
  }

  if (data.length === 0) {
    if (/^\d{1,5}$/.test(retry)) return `retry: ${retry}\n\n`;
    if (heartbeat) return ": heartbeat\n\n";
    return;
  }
  if (event !== "activity") return;

  let payload: unknown;
  try {
    payload = JSON.parse(data.join("\n"));
  } catch {
    return;
  }

  // The sent branch of ActivityItem strips private reasons and unknown fields.
  const item = routes.ownerStream.response.safeParse(payload);
  if (!item.success) return;

  const version = versionId.test(id) ? `id: ${id}\n` : "";
  return `event: activity\n${version}data: ${JSON.stringify(item.data)}\n\n`;
}

export function activityStream(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      let separator: RegExpExecArray | null;
      while ((separator = frameEnd.exec(buffer))) {
        const output = filteredFrame(buffer.slice(0, separator.index));
        buffer = buffer.slice(separator.index + separator[0].length);
        if (output) controller.enqueue(encoder.encode(output));
      }
    },
  }), { signal });
}
