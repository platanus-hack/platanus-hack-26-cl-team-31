-- Índice por nombre e id para las colas filtradas por nombre del admin: el flujo en vivo
-- (/api/admin/flow/live, name = ANY(...) AND id > cursor ORDER BY id) y el historial de
-- /api/admin/events con `name` (ORDER BY id DESC). events_kind_name_idx no sirve sin `kind`
-- y ordena por `at`, que no es el orden de inserción.
-- ops.events se poda por retención (0004), así que crearlo dentro de la transacción de la
-- migración bloquea las escrituras por poco tiempo.
CREATE INDEX IF NOT EXISTS events_name_id_idx ON ops.events (name, id);
