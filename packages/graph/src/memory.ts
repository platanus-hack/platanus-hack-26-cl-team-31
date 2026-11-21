import { hubPenalty } from "./cost.js";
import { kindOf, type Arc, type GraphMutation, type NodeId } from "./model.js";
import {
  interestedInSearch,
  nearestSearch,
  pathSearch,
  type InterestedOptions,
  type NearestOptions,
  type PathOptions,
} from "./search/api.js";
import { EMPTY } from "./search/common.js";
import type { SearchResult } from "./search/dijkstra.js";
import { LandmarkTable, type FullGraphView, type LandmarkMode } from "./search/landmarks.js";
import { runSync } from "./view.js";

interface NodeRec {
  arcs: Arc[];
  penalty: number;
  label?: string;
}

/**
 * Índice de adyacencia en memoria, incremental: cada mutación cuesta
 * O(grado) y nunca reconstruye el grafo completo.
 */
export class MemoryGraphIndex implements FullGraphView {
  private readonly nodes = new Map<NodeId, NodeRec>();
  private edges = 0;
  /** Aumenta con cualquier mutación. */
  version = 0;
  /** Aumenta solo con mutaciones que pueden acortar distancias base (arista nueva / base menor). */
  growVersion = 0;
  private landmarkTable: LandmarkTable | undefined;

  constructor(mutations?: Iterable<GraphMutation>) {
    if (mutations) this.apply(mutations);
  }

  // ---- AdjacencyView ------------------------------------------------------

  arcs(id: NodeId): readonly Arc[] {
    return this.nodes.get(id)?.arcs ?? EMPTY;
  }

  penalty(id: NodeId): number {
    return this.nodes.get(id)?.penalty ?? 0;
  }

  nodeIds(): Iterable<NodeId> {
    return this.nodes.keys();
  }

  has(id: NodeId): boolean {
    return this.nodes.has(id);
  }

  degree(id: NodeId): number {
    return this.nodes.get(id)?.arcs.length ?? 0;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Relaciones no dirigidas (cada una son 2 arcos). */
  get edgeCount(): number {
    return this.edges;
  }

  // ---- Mutaciones -----------------------------------------------------------

  apply(mutations: Iterable<GraphMutation>): this {
    for (const m of mutations) {
      switch (m.op) {
        case "upsertNode": {
          const rec = this.ensure(m.id);
          if (m.label !== undefined) rec.label = m.label;
          break;
        }
        case "removeNode":
          this.removeNode(m.id);
          break;
        case "upsertEdge":
          this.upsertEdge(m.a, m.b, m.kind, m.scope ?? "", m.base, m.attrs);
          break;
        case "removeEdge":
          this.removeEdge(m.a, m.b, m.kind, m.scope ?? "");
          break;
      }
    }
    return this;
  }

  private ensure(id: NodeId): NodeRec {
    let rec = this.nodes.get(id);
    if (!rec) {
      rec = { arcs: [], penalty: 0 };
      this.nodes.set(id, rec);
      this.version++;
    }
    return rec;
  }

  private refresh(id: NodeId, rec: NodeRec): void {
    rec.penalty = hubPenalty(kindOf(id), rec.arcs.length);
  }

  private upsertEdge(a: NodeId, b: NodeId, kind: Arc["kind"], scope: string, base: number, attrs?: Arc["attrs"]): void {
    if (a === b) throw new Error(`Arista reflexiva no permitida: ${a}`);
    if (!(base >= 0)) throw new Error(`Costo base inválido: ${base}`);
    const ra = this.ensure(a);
    const rb = this.ensure(b);
    const ab: Arc = attrs ? { from: a, to: b, kind, scope, base, attrs } : { from: a, to: b, kind, scope, base };
    const ba: Arc = { ...ab, from: b, to: a };
    const i = findArc(ra.arcs, b, kind, scope);
    this.version++;
    if (i >= 0) {
      const old = ra.arcs[i] as Arc;
      if (base < old.base) this.growVersion++;
      ra.arcs[i] = ab;
      rb.arcs[findArc(rb.arcs, a, kind, scope)] = ba;
      return;
    }
    this.growVersion++;
    ra.arcs.push(ab);
    rb.arcs.push(ba);
    this.edges++;
    this.refresh(a, ra);
    this.refresh(b, rb);
  }

  private removeEdge(a: NodeId, b: NodeId, kind: Arc["kind"], scope: string): void {
    const ra = this.nodes.get(a);
    const rb = this.nodes.get(b);
    if (!ra || !rb) return;
    const i = findArc(ra.arcs, b, kind, scope);
    if (i < 0) return;
    swapRemove(ra.arcs, i);
    swapRemove(rb.arcs, findArc(rb.arcs, a, kind, scope));
    this.edges--;
    this.version++;
    this.refresh(a, ra);
    this.refresh(b, rb);
  }

  private removeNode(id: NodeId): void {
    const rec = this.nodes.get(id);
    if (!rec) return;
    for (const arc of [...rec.arcs]) this.removeEdge(id, arc.to, arc.kind, arc.scope);
    this.nodes.delete(id);
    this.version++;
  }

  // ---- Búsquedas -------------------------------------------------------------

  nearest(source: NodeId, opts: NearestOptions): SearchResult {
    return runSync(nearestSearch(this, source, opts));
  }

  /** Las k personas más cercanas interesadas en `topic`. */
  interestedIn(source: NodeId, topic: NodeId, opts: InterestedOptions = {}): SearchResult {
    return runSync(interestedInSearch(this, source, topic, opts));
  }

  path(source: NodeId, target: NodeId, opts: PathOptions = {}): SearchResult {
    const lm = opts.landmarks ?? this.landmarkTable;
    return runSync(pathSearch(this, source, target, { ...opts, landmarks: lm, landmarksStale: opts.landmarksStale || (lm && this.isStale(lm)) }));
  }

  /** Construye (y recuerda) la tabla de landmarks para ALT. */
  buildLandmarks(count = 8, mode: LandmarkMode = "effective"): LandmarkTable {
    this.landmarkTable = LandmarkTable.build(this, count, mode, mode === "base" ? this.growVersion : this.version);
    return this.landmarkTable;
  }

  isStale(table: LandmarkTable): boolean {
    return table.version !== (table.mode === "base" ? this.growVersion : this.version);
  }

  /** Representación canónica (para comparar índices en tests). */
  snapshot(): string[] {
    const out: string[] = [];
    for (const [id, rec] of this.nodes) {
      out.push(`N ${id} ${rec.penalty.toFixed(6)}`);
      for (const a of rec.arcs) out.push(`A ${a.from} ${a.to} ${a.kind} ${a.scope} ${a.base} ${JSON.stringify(a.attrs ?? null)}`);
    }
    return out.sort();
  }
}

function findArc(arcs: readonly Arc[], to: NodeId, kind: Arc["kind"], scope: string): number {
  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i] as Arc;
    if (a.to === to && a.kind === kind && a.scope === scope) return i;
  }
  return -1;
}

function swapRemove<T>(xs: T[], i: number): void {
  const last = xs.pop() as T;
  if (i < xs.length) xs[i] = last;
}
