-- Poda de telemetría: borra los eventos más viejos que la retención y devuelve cuántos borró.
-- El servidor admin la llama una vez por hora (docs/admin.md#21-opsevents):
--   SELECT ops.prune_events(make_interval(days => TELEMETRY_RETENTION_DAYS));
-- Borra por lotes para no tomar candados largos sobre ops.events. Exige al menos una hora de
-- retención para que un intervalo mal escrito no vacíe la tabla.
-- No se otorga a ningún rol del admin (nexo_admin_ro es de solo lectura): la ejecuta el dueño
-- del esquema o un usuario al que ADM-08 le otorgue EXECUTE explícitamente.
CREATE OR REPLACE FUNCTION ops.prune_events(retention interval) RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $fn$
DECLARE
  cutoff timestamptz;
  batch bigint;
  total bigint := 0;
BEGIN
  IF retention IS NULL OR retention < interval '1 hour' THEN
    RAISE EXCEPTION 'ops.prune_events: la retención debe ser de al menos 1 hora (recibí %)', retention
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  cutoff := now() - retention;
  LOOP
    DELETE FROM ops.events
    WHERE id IN (SELECT id FROM ops.events WHERE at < cutoff ORDER BY at LIMIT 10000);
    GET DIAGNOSTICS batch = ROW_COUNT;
    total := total + batch;
    EXIT WHEN batch < 10000;
  END LOOP;
  RETURN total;
END
$fn$;

REVOKE ALL ON FUNCTION ops.prune_events(interval) FROM PUBLIC;
