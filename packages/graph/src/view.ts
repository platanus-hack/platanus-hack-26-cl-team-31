import type { Arc, NodeId } from "./model.js";

/**
 * Lo único que los algoritmos ven del índice. El índice en memoria tiene todo
 * cargado; el adaptador Postgres llena un caché por demanda y `arcs()` devuelve
 * `undefined` mientras un nodo no se ha pedido.
 */
export interface AdjacencyView {
  /** Aristas salientes de `id`, o `undefined` si aún no están cargadas. */
  arcs(id: NodeId): readonly Arc[] | undefined;
  /** Penalización de hub del nodo (ver cost.ts). Solo se consulta para nodos ya vistos. */
  penalty(id: NodeId): number;
}

/** Peso efectivo y simétrico de una arista. */
export function arcWeight(view: AdjacencyView, arc: Arc): number {
  return arc.base + (view.penalty(arc.from) + view.penalty(arc.to)) / 2;
}

// ---------------------------------------------------------------------------
// Seam de permisos
// ---------------------------------------------------------------------------

export interface TraversalContext {
  /** Quién busca. Lo define el llamador (p. ej. `person:ana`). */
  readonly viewer: NodeId | undefined;
}

/**
 * Hook de visibilidad. Se llama para cada arista antes de recorrerla, con la
 * arista orientada en el sentido del recorrido (alejándose del origen; en la
 * búsqueda hacia atrás de Dijkstra bidireccional se pasa ya invertida para que
 * el sentido sea siempre origen → destino).
 *
 * Devuelve `false` para que la arista no exista para esta búsqueda: no se
 * recorre, no aparece en caminos, y los predicados de búsqueda (`match`) no la
 * ven. Debe ser síncrono y barato (se llama en el loop interno). La lógica real
 * de permisos NO vive en este paquete: la aporta quien llama.
 */
export type EdgeFilter = (arc: Arc, ctx: TraversalContext) => boolean;

export const allowAll: EdgeFilter = () => true;

// ---------------------------------------------------------------------------
// Protocolo de carga perezosa
// ---------------------------------------------------------------------------

/** Lo que un algoritmo pide al driver cuando le faltan adyacencias. */
export interface FetchRequest {
  readonly ids: readonly NodeId[];
}

/**
 * Los algoritmos son generadores: cuando les falta la adyacencia de un nodo
 * hacen `yield {ids}` con ese nodo y otros de la frontera (batch). El driver
 * síncrono (memoria) nunca recibe un yield; el asíncrono (Postgres) resuelve
 * cada yield con una sola consulta.
 */
export type SearchGenerator<R> = Generator<FetchRequest, R, void>;

export function runSync<R>(gen: SearchGenerator<R>): R {
  const step = gen.next();
  if (!step.done) throw new Error("La vista no tiene la adyacencia completa; usa runAsync");
  return step.value;
}

export async function runAsync<R>(
  gen: SearchGenerator<R>,
  load: (ids: readonly NodeId[]) => Promise<void>,
): Promise<R> {
  let step = gen.next();
  while (!step.done) {
    await load(step.value.ids);
    step = gen.next();
  }
  return step.value;
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

export interface Path {
  readonly source: NodeId;
  readonly target: NodeId;
  readonly cost: number;
  /** source, …, target */
  readonly nodes: readonly NodeId[];
  /** Aristas en sentido del recorrido; `arcs[i]` va de `nodes[i]` a `nodes[i+1]`. */
  readonly arcs: readonly Arc[];
  /** Aristas visibles que justifican el match (p. ej. `persona —le interesa→ tema`). */
  readonly evidence?: readonly Arc[];
}

export type StopReason = "target" | "k" | "exhausted" | "maxCost" | "maxExpanded" | "unreachable";

export interface SearchStats {
  /** Nodos asentados y expandidos. */
  expanded: number;
  /** Aristas examinadas (incluye las bloqueadas por el filtro). */
  edgesScanned: number;
  /** Inserciones al heap. */
  pushes: number;
  /** Veces que el algoritmo pidió adyacencias (= consultas en Postgres). */
  fetches: number;
  /** Nodos cuya adyacencia se pidió en total. */
  fetchedNodes: number;
  stopReason: StopReason;
  /** Si ALT tuvo que caer a otro algoritmo (landmarks desactualizados). */
  fallback?: string;
}

export interface SearchBudget {
  /** No explorar más allá de este costo acumulado. */
  readonly maxCost?: number;
  /** Máximo de nodos expandidos. */
  readonly maxExpanded?: number;
}

export interface SearchOptions extends SearchBudget {
  readonly viewer?: NodeId;
  readonly filter?: EdgeFilter;
  /** Cuántos nodos de la frontera pedir junto al que falta (solo vistas perezosas). */
  readonly batchSize?: number;
}

export function newStats(): SearchStats {
  return { expanded: 0, edgesScanned: 0, pushes: 0, fetches: 0, fetchedNodes: 0, stopReason: "exhausted" };
}
