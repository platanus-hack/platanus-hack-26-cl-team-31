-- Suma al resumen de la bóveda cuántas visitas recibió el titular, cuántos lectores distintos
-- y cuándo fue la última. La dirección del lector vive solo en sideband.vault_visits y nunca
-- sale por esta vista: el admin ve uso, no identidades.
CREATE OR REPLACE FUNCTION ops.refresh_vault_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF to_regclass('sideband.vault_member_rules') IS NULL THEN RETURN; END IF;
  -- Si el broker aún no migró la columna, la vista anterior sigue vigente hasta la próxima migración.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('sideband.vault_categories') AND attname = 'visibility') THEN RETURN; END IF;
  -- Las guardas de existencia viven aquí, nunca dentro de la vista: to_regclass dentro del SELECT
  -- lo evalúa quien consulta, y sideband_admin_ro no tiene USAGE sobre el esquema sideband. La
  -- columna documents lo hacía así desde 0021 y fallaba con "permission denied for schema sideband"
  -- en cuanto el titular tenía alguna categoría.
  IF to_regclass('sideband.vault_documents') IS NULL THEN RETURN; END IF;
  IF to_regclass('sideband.vault_visits') IS NULL THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_vault_summary AS
    SELECT c.owner_id AS user_id, count(*) AS categories,
      (SELECT count(*) FROM sideband.vault_entries e WHERE e.owner_id = c.owner_id) AS entries,
      (SELECT count(*) FROM sideband.vault_permissions p WHERE p.owner_id = c.owner_id) AS permissions,
      (SELECT count(*) FROM sideband.vault_member_rules r WHERE r.owner_id = c.owner_id) AS member_rules,
      (SELECT count(*) FROM sideband.vault_documents d WHERE d.owner_id = c.owner_id) AS documents,
      count(*) FILTER (WHERE c.description <> '') AS described,
      count(*) FILTER (WHERE c.visibility = 'public') AS public,
      (SELECT count(*) FROM sideband.vault_visits v WHERE v.owner_id = c.owner_id) AS visits,
      (SELECT count(DISTINCT v.reader_address) FROM sideband.vault_visits v WHERE v.owner_id = c.owner_id) AS visitors,
      (SELECT max(v.visited_at) FROM sideband.vault_visits v WHERE v.owner_id = c.owner_id) AS last_visit_at
    FROM sideband.vault_categories c GROUP BY c.owner_id;
  PERFORM ops.apply_view_grants();
END $$;
