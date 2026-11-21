CREATE OR REPLACE FUNCTION ops.refresh_vault_view() RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, ops
AS $$
BEGIN
  IF to_regclass('sideband.vault_member_rules') IS NULL THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_vault_summary AS
    SELECT c.owner_id AS user_id, count(*) AS categories,
      (SELECT count(*) FROM sideband.vault_entries e WHERE e.owner_id = c.owner_id) AS entries,
      (SELECT count(*) FROM sideband.vault_permissions p WHERE p.owner_id = c.owner_id) AS permissions,
      (SELECT count(*) FROM sideband.vault_member_rules r WHERE r.owner_id = c.owner_id) AS member_rules,
      (CASE WHEN to_regclass('sideband.vault_documents') IS NULL THEN 0
            ELSE (SELECT count(*) FROM sideband.vault_documents d WHERE d.owner_id = c.owner_id) END) AS documents
    FROM sideband.vault_categories c GROUP BY c.owner_id;
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_vault_view() FROM PUBLIC;
