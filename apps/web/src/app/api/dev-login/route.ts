// Login de desarrollo: crea si falta e inicia sesión como un titular de prueba, para levantar N
// identidades sin N cuentas de Google. Solo existe con SIDEBAND_DEV_AUTH=1, que getDevAuth()
// prohíbe en producción; sin la bandera la ruta responde 404.
//
// El consentimiento no se salta: después de iniciar sesión el flujo OAuth sigue igual (/consent).
// Google tampoco cambia: este camino convive con él.
import { getAuth } from "../../../lib/auth";
import { getAuthBaseUrl, getDevAuth } from "../../../lib/auth-env.mjs";
import { devOwnerEmail } from "../../../lib/dev-owner";
import { getTelemetry, observeRoute } from "../../../lib/telemetry";

const ROUTE = "/api/dev-login";
const noStore = { "Cache-Control": "no-store" } as const;

function notFound() {
  return Response.json({ error: { code: "not_found" } }, { status: 404, headers: noStore });
}

/** Le dice a /sign-in si debe ofrecer «Entrar como titular de prueba». */
export async function GET(request: Request): Promise<Response> {
  return observeRoute(request, ROUTE, async () => {
    if (!getDevAuth()) return notFound();
    return Response.json({ enabled: true }, { headers: noStore });
  });
}

export async function POST(request: Request): Promise<Response> {
  return observeRoute(request, ROUTE, async () => {
    if (!getDevAuth()) return notFound();

    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(getAuthBaseUrl()).origin) {
      return Response.json({ error: { code: "forbidden" } }, { status: 403, headers: noStore });
    }

    const body: unknown = await request.json().catch(() => undefined);
    const name = typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
      ? body.name.trim()
      : "";
    const email = devOwnerEmail(name);
    if (!email) {
      return Response.json({ error: { code: "invalid_name" } }, { status: 400, headers: noStore });
    }

    const { response, headers } = await getAuth().api.devSignIn({ body: { email, name }, returnHeaders: true });
    getTelemetry().identify({ userId: response.userId });

    // Nunca se registra la cookie ni su valor: solo viaja al cliente.
    const out = Response.json({ ok: true, email }, { headers: noStore });
    for (const cookie of headers.getSetCookie()) out.headers.append("Set-Cookie", cookie);
    return out;
  });
}
