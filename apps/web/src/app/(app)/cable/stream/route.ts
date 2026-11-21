import { routes } from "@team-31/protocol/http";

import { getSession } from "../../../../lib/auth";
import { brokerUrl, getServiceToken } from "../../../../lib/broker";
import { activityStream } from "./activity-stream";

const streamHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

function emptyResponse(status: number) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return emptyResponse(401);

  try {
    const token = await getServiceToken({ userId: session.user.id });
    const upstream = await fetch(new URL(routes.ownerStream.path, brokerUrl()), {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    });

    const mediaType = upstream.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    if (upstream.status !== 200 || mediaType !== "text/event-stream" || !upstream.body) {
      await upstream.body?.cancel();
      return emptyResponse(502);
    }

    return new Response(activityStream(upstream.body, request.signal), { headers: streamHeaders });
  } catch {
    return emptyResponse(502);
  }
}
