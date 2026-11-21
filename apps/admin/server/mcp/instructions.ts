export const instructions =
  "MCP de administración de Sideband, de solo lectura, para depurar producción. " +
  "Todos los datos ya vienen redactados: nunca hay payloads (args, result, propósito), tokens, nonces ni secretos, y el texto libre de terceros (preguntas, respuestas, notas) nunca aparece; no intentes reconstruirlo. " +
  "Empieza siempre por admin_overview para ver qué está roto ahora (servicios caídos, solicitudes atascadas, errores principales). " +
  "Luego baja a la solicitud: admin_search_requests (por estado, herramienta, dirección o stuck=true) y admin_get_request para su línea de tiempo, avisos y decisión de política. " +
  "Después sigue la traza con admin_get_trace usando los trace_ids de la solicitud. " +
  "Para errores usa admin_errors y admin_get_error; para personas y agentes, admin_search_users, admin_get_user, admin_agents y admin_wake_queue; admin_events filtra el historial crudo de telemetría. " +
  "El recurso admin://schema lista las vistas ops.v_* con sus columnas y el catálogo de eventos; admin_sql (requiere el scope admin:sql) ejecuta un SELECT sobre esas vistas. " +
  "Este MCP no ejecuta acciones: reintentar, expirar o revocar se hace desde el panel por un operador."
