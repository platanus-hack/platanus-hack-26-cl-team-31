// Entrega un access token de MCP para un titular de prueba, sin navegador. El token lo emite el
// mismo flujo OAuth que usaría una persona (ver lib/dev-token.ts); el MCP lo verifica por JWKS con
// createMcpGuard, sin saber ni poder saber que vino de aquí.
//
// Solo existe con SIDEBAND_DEV_AUTH=1, que getDevAuth() prohíbe en producción; sin la bandera
// responde 404, igual que /api/dev-login.
import { getAuth } from "../../../lib/auth";
import { getAuthBaseUrl, getDevAuth, getMcpResource } from "../../../lib/auth-env.mjs";
import { devOwnerEmail } from "../../../lib/dev-owner";
import { mintDevToken } from "../../../lib/dev-token";
import { getTelemetry, observeRoute } from "../../../lib/telemetry";

const ROUTE = "/api/dev-token";
const noStore = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  return observeRoute(request, ROUTE, async () => {
    if (!getDevAuth()) return Response.json({ error: { code: "not_found" } }, { status: 404, headers: noStore });
    return Response.json({ enabled: true }, { headers: noStore });
  });
}

export async function POST(request: Request): Promise<Response> {
  return observeRoute(request, ROUTE, async () => {
    if (!getDevAuth()) return Response.json({ error: { code: "not_found" } }, { status: 404, headers: noStore });

    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(getAuthBaseUrl()).origin) {
      return Response.json({ error: { code: "forbidden" } }, { status: 403, headers: noStore });
    }

    const body: unknown = await request.json().catch(() => undefined);
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    const email = devOwnerEmail(name);
    if (!email) return Response.json({ error: { code: "invalid_name" } }, { status: 400, headers: noStore });

    const scopes = Array.isArray(fields.scopes) && fields.scopes.every((scope) => typeof scope === "string")
      ? (fields.scopes as string[])
      : undefined;

    const token = await mintDevToken(getAuth(), {
      baseUrl: getAuthBaseUrl(),
      resource: getMcpResource(),
      email,
      name,
      scopes,
    });
    getTelemetry().identify({ userId: token.userId, agentId: token.clientId });

    // El token solo viaja en el cuerpo: nunca se registra ni se deja en una cookie del navegador.
    return Response.json({ email, ...token }, { headers: noStore });
  });
}
