DROP VIEW IF EXISTS ops.v_vault_contact_group_summary;
DROP VIEW IF EXISTS ops.v_pending_group_invitations;
DROP FUNCTION IF EXISTS ops.refresh_vault_contact_group_view();
DROP FUNCTION IF EXISTS ops.refresh_group_invitations_view();

CREATE FUNCTION ops.refresh_tags_view() RETURNS void LANGUAGE plpgsql
SET search_path = pg_catalog, ops AS $$
BEGIN
  IF to_regclass('sideband.tags') IS NULL THEN RETURN; END IF;
  DROP VIEW IF EXISTS ops.v_contact_tags;
  CREATE VIEW ops.v_contact_tags AS
    SELECT t.user_id, t.tag_id, count(ct.address) AS contacts,
      jsonb_array_length(t.categories) AS preset_categories
    FROM sideband.tags t
    LEFT JOIN sideband.contact_tags ct ON ct.user_id = t.user_id AND ct.tag_id = t.tag_id
    GROUP BY t.user_id, t.tag_id, t.categories;
  CREATE OR REPLACE VIEW ops.v_tag_summary AS
    SELECT t.user_id, count(*) AS tags,
      count(*) FILTER (WHERE t.tag_id NOT IN ('friend', 'family', 'work')) AS custom_tags,
      (SELECT count(*) FROM sideband.contact_tags ct WHERE ct.user_id = t.user_id) AS memberships,
      (SELECT count(*) FROM sideband.vault_permissions p WHERE p.owner_id = t.user_id) AS vault_permissions
    FROM sideband.tags t GROUP BY t.user_id;
  PERFORM ops.apply_view_grants();
END $$;
REVOKE ALL ON FUNCTION ops.refresh_tags_view() FROM PUBLIC;
