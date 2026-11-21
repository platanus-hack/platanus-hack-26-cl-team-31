import { routes } from "@team-31/protocol/http";

import { getStreamSession } from "../../../../lib/auth";
import { brokerFetch, brokerUrl, signServiceToken } from "../../../../lib/broker";
import { getTelemetry, observeRoute } from "../../../../lib/telemetry";
import { activityStream } from "./activity-stream";

const route = "/cable/stream";
const streamHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

function emptyResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function GET(request: Request) {
  return observeRoute(request, route, async () => {
    const session = await getStreamSession(request.headers);
    if (!session) return emptyResponse(401);
    const telemetry = getTelemetry();
    telemetry.identify({ userId: session.user.id });

    try {
      const token = await signServiceToken({ userId: session.user.id });
      const upstream = await brokerFetch()(new URL(routes.ownerStream.path, brokerUrl()), {
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

      const hasAccess = async () => {
        try {
          const current = await getStreamSession(request.headers);
          if (current?.session.id === session.session.id && current.user.id === session.user.id) return true;
          telemetry.emit("auth.token.rejected", { userId: session.user.id, attrs: { issuer: "web_session", reason: "access_ended" } });
        } catch (error) {
          telemetry.error("cable.session", error, { userId: session.user.id });
        }
        return false;
      };
      return new Response(activityStream(upstream.body, request.signal, hasAccess), { headers: streamHeaders });
    } catch (error) {
      // A browser that leaves before the broker answers is not an error.
      if (request.signal.aborted) return emptyResponse(502);
      const errorId = telemetry.error(`GET ${route}`, error);
      return emptyResponse(502, { "X-Error-Id": errorId });
    }
  });
}
