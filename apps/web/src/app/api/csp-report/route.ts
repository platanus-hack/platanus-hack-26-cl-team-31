// Las infracciones se ven en DevTools. Los informes pueden incluir URLs privadas:
// no leer ni guardar su cuerpo durante la evaluación de la política.
export function POST(request: Request) {
  return observeRoute(request, "/api/csp-report", async () => new Response(null, { status: 204 }));
}
import { observeRoute } from "../../../lib/telemetry";
