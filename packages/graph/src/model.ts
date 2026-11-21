/**
 * Modelo del grafo de relaciones.
 *
 * Los ids de nodo llevan su tipo como prefijo (`person:ana`, `group:futbol`,
 * `topic:ajedrez`, `vault:ana/notas`). Así el tipo se conoce sin otra consulta,
 * tanto en memoria como en Postgres.
 */

export const NODE_KINDS = ["person", "group", "topic", "vault"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_KINDS = [
  "member_of", // person — group
  "interested_in", // person — topic (scope = audiencia: '' público, si no id de grupo)
  "owns", // person — vault
  "about", // vault — topic
  "related_to", // vault — vault, topic — topic (similitud; futuro: embeddings)
  "knows", // person — person (futuro)
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export type NodeId = `${NodeKind}:${string}`;

/**
 * Arista dirigida tal como se almacena en la lista de adyacencia. Cada relación
 * no dirigida se guarda dos veces (a→b y b→a) con el mismo `base`, por lo que el
 * grafo efectivo es simétrico.
 */
export interface Arc {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly kind: EdgeKind;
  /** Audiencia de la relación. '' = pública; si no, id del grupo que la ve. */
  readonly scope: string;
  /** Costo base de la relación (sin penalización por hubs). */
  readonly base: number;
  /** Datos extra que el hook de visibilidad puede leer (p. ej. canAsk/canShare). */
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export type GraphMutation =
  | { readonly op: "upsertNode"; readonly id: NodeId; readonly label?: string }
  | { readonly op: "removeNode"; readonly id: NodeId }
  | {
      readonly op: "upsertEdge";
      readonly a: NodeId;
      readonly b: NodeId;
      readonly kind: EdgeKind;
      readonly scope?: string;
      readonly base: number;
      readonly attrs?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly op: "removeEdge";
      readonly a: NodeId;
      readonly b: NodeId;
      readonly kind: EdgeKind;
      readonly scope?: string;
    };

export function nodeId(kind: NodeKind, key: string): NodeId {
  return `${kind}:${key}`;
}

export function kindOf(id: NodeId): NodeKind {
  return id.slice(0, id.indexOf(":")) as NodeKind;
}

export function keyOf(id: NodeId): string {
  return id.slice(id.indexOf(":") + 1);
}

export function isNodeId(value: string): value is NodeId {
  const i = value.indexOf(":");
  return i > 0 && (NODE_KINDS as readonly string[]).includes(value.slice(0, i));
}

/** Normalización de temas compartida entre TS y SQL: `lower(btrim(x))`. */
export function topicId(interest: string): NodeId {
  return nodeId("topic", interest.trim().toLowerCase());
}

export function flip(arc: Arc): Arc {
  return { ...arc, from: arc.to, to: arc.from };
}
