import { getAuth } from "@/lib/auth";
import { getTelemetry, observeRoute } from "@/lib/telemetry";
import { connection } from "next/server";

const route = "/api/auth/[...all]";
const consentPath = "/api/auth/oauth2/consent";

export async function GET(request: Request) {
  await connection();
  return observeRoute(request, route, () => getAuth().handler(request));
}

export function POST(request: Request) {
  return observeRoute(request, route, async () => {
    if (new URL(request.url).pathname !== consentPath) return getAuth().handler(request);
    const decision = await consentDecision(request.clone());
    // The consent handler needs the same session: this read only adds user_id to the events.
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (session) getTelemetry().identify({ userId: session.user.id });
    const response = await getAuth().handler(request);
    // Only a consent that Better Auth accepted (signed query, active session) is recorded.
    if (decision && response.ok) {
      getTelemetry().emit("auth.oauth.consent", { attrs: { clientId: decision.clientId, granted: decision.accept } });
    }
    return response;
  });
}

// Reads only accept and client_id from the consent body; the signed query is never recorded.
async function consentDecision(request: Request): Promise<{ clientId: string; accept: boolean } | undefined> {
  try {
    const body = await request.json() as { accept?: unknown; oauth_query?: unknown };
    const clientId = typeof body.oauth_query === "string" ? new URLSearchParams(body.oauth_query).get("client_id") : null;
    if (!clientId || typeof body.accept !== "boolean") return undefined;
    return { clientId, accept: body.accept };
  } catch {
    // Better Auth answers the invalid body itself.
    return undefined;
  }
}
