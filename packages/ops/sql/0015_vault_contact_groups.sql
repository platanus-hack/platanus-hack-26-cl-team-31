CREATE FUNCTION ops.refresh_vault_contact_group_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF to_regclass('sideband.vault_contact_group_permissions') IS NULL THEN RETURN; END IF;
  CREATE OR REPLACE VIEW ops.v_vault_contact_group_summary AS
    SELECT g.owner_id AS user_id, count(*) AS groups,
      (SELECT count(*) FROM sideband.vault_contact_group_members m WHERE m.owner_id = g.owner_id) AS memberships,
      (SELECT count(*) FROM sideband.vault_contact_group_permissions p WHERE p.owner_id = g.owner_id) AS permissions
    FROM sideband.vault_contact_groups g GROUP BY g.owner_id;
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_vault_contact_group_view() FROM PUBLIC;
