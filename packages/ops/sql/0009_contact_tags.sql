-- Etiquetas de contactos del broker (sideband.contact_tags y sideband.tag_presets). El admin ve cuántos
-- contactos tiene cada titular por etiqueta y cuántas categorías comparte cada etiqueta, sin direcciones.
-- Requiere haber corrido antes las migraciones del broker (pnpm sideband:broker:migrate).
DO $$
BEGIN
  IF to_regclass('sideband.contact_tags') IS NOT NULL AND to_regclass('sideband.tag_presets') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW ops.v_contact_tags AS
      SELECT t.user_id, t.tag, count(*) AS contacts,
             (SELECT jsonb_array_length(p.categories) FROM sideband.tag_presets p
               WHERE p.user_id = t.user_id AND p.tag = t.tag) AS preset_categories
      FROM sideband.contact_tags t
      GROUP BY t.user_id, t.tag
    $v$;
    PERFORM ops.apply_view_grants();
  END IF;
END $$;
