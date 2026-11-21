-- Proyección materializada del grafo de relaciones (@team-31/graph).
-- Es derivada: se puede reconstruir desde las tablas core (PgGraphIndex.rebuildFromCore)
-- y se mantiene incrementalmente con PgGraphIndex.apply(mutations).
-- Cada relación no dirigida se guarda en ambos sentidos para que la expansión
-- de un nodo sea un único range scan por `src`.

CREATE TABLE IF NOT EXISTS graph_nodes (
  id text PRIMARY KEY,                       -- '<kind>:<key>'
  kind text NOT NULL CHECK (kind IN ('person', 'group', 'topic', 'vault')),
  degree integer NOT NULL DEFAULT 0 CHECK (degree >= 0),  -- nº de arcos salientes (penalización de hub)
  label text
);

CREATE TABLE IF NOT EXISTS graph_edges (
  src text NOT NULL,
  dst text NOT NULL,
  kind text NOT NULL,
  scope text NOT NULL DEFAULT '',            -- audiencia: '' público, si no id de grupo
  base double precision NOT NULL CHECK (base >= 0),
  attrs jsonb,
  -- El PK con `src` al inicio es el índice de expansión: WHERE src = ANY($1).
  PRIMARY KEY (src, dst, kind, scope)
);
