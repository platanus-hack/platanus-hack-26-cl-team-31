import { baseCost } from "./cost.js";
import { nodeId, type GraphMutation, type NodeId } from "./model.js";
import { projectCore, type CoreRows, type InterestRow, type MembershipRow } from "./projection.js";

/** PRNG determinista (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muestreador Zipf(s) sobre [0, n): el rango 0 es el más popular. */
export function zipf(n: number, s: number, rand: () => number): () => number {
  const cdf = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) cdf[i] = acc += 1 / Math.pow(i + 1, s);
  return () => {
    const x = rand() * acc;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] as number) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export interface SyntheticOptions {
  readonly people: number;
  readonly seed?: number;
  /** Incluir vaults (dueño, temas y relaciones entre vaults). Default: true. */
  readonly vaults?: boolean;
}

export interface SyntheticGraph {
  readonly core: CoreRows;
  readonly mutations: GraphMutation[];
  readonly people: NodeId[];
  readonly groups: NodeId[];
  readonly topics: NodeId[];
  readonly vaults: NodeId[];
}

/**
 * Red sintética con estructura realista:
 *  - comunidades (~200 personas) con grupos propios; 85% de las membresías
 *    caen en la comunidad, 15% en cualquier grupo (Zipf global → algunos
 *    grupos enormes).
 *  - temas con popularidad Zipf (s≈1.07): unos pocos temas masivos (hubs) y
 *    una cola larga de nicho; cada comunidad además favorece ~30 temas.
 *  - 25% de los intereses son visibles solo para uno de los grupos de la persona.
 *  - 30% de las personas tienen un vault sobre sus temas, relacionado con 1–2
 *    vaults de su comunidad.
 */
export function syntheticGraph(opts: SyntheticOptions): SyntheticGraph {
  const rand = rng(opts.seed ?? 42);
  const N = opts.people;
  const C = Math.max(4, Math.round(N / 200));
  const G = Math.max(8, Math.round(N / 20));
  const T = Math.max(40, Math.round(N / 15));
  const int = (n: number) => Math.floor(rand() * n);

  const groupsByCommunity: number[][] = Array.from({ length: C }, () => []);
  for (let g = 0; g < G; g++) groupsByCommunity[g % C]?.push(g);
  const favored: number[][] = Array.from({ length: C }, () => Array.from({ length: 30 }, () => int(T)));
  const globalGroup = zipf(G, 1.0, rand);
  const globalTopic = zipf(T, 1.07, rand);
  const localGroup = zipf(Math.ceil(G / C), 0.8, rand);

  const people = Array.from({ length: N }, (_, i) => `p${i}`);
  const community = people.map(() => int(C));
  const memberships: MembershipRow[] = [];
  const interests: InterestRow[] = [];
  const myGroups: string[][] = people.map(() => []);

  people.forEach((pid, i) => {
    const c = community[i] as number;
    const own = groupsByCommunity[c] as number[];
    const n = 1 + Math.min(3, Math.floor(-Math.log(1 - rand()) * 0.9));
    const seen = new Set<number>();
    for (let j = 0; j < n; j++) {
      const g = rand() < 0.85 ? (own[localGroup() % own.length] as number) : globalGroup();
      if (seen.has(g)) continue;
      seen.add(g);
      const group = `g${g}`;
      myGroups[i]?.push(group);
      memberships.push({ person_id: pid, group_id: group, can_ask: rand() < 0.8, can_share: rand() < 0.6 });
    }
    const m = 3 + int(6);
    const topics = new Set<number>();
    for (let j = 0; j < m; j++) topics.add(rand() < 0.5 ? (favored[c]?.[int(30)] as number) : globalTopic());
    for (const t of topics) {
      const groups = myGroups[i] as string[];
      const audience = rand() < 0.25 && groups.length ? (groups[int(groups.length)] as string) : "";
      interests.push({ person_id: pid, interest: `t${t}`, audience });
    }
  });

  const core: CoreRows = { people: people.map((id) => ({ id })), memberships, interests };
  const mutations = [...projectCore(core)];
  const vaults: NodeId[] = [];

  if (opts.vaults ?? true) {
    const byCommunity: NodeId[][] = Array.from({ length: C }, () => []);
    const topicsOf = new Map<string, string[]>();
    for (const r of interests) {
      const list = topicsOf.get(r.person_id) ?? [];
      if (r.audience === "") list.push(r.interest);
      topicsOf.set(r.person_id, list);
    }
    people.forEach((pid, i) => {
      if (rand() >= 0.3) return;
      const v = nodeId("vault", `${pid}/v`);
      vaults.push(v);
      byCommunity[community[i] as number]?.push(v);
      mutations.push({ op: "upsertEdge", a: nodeId("person", pid), b: v, kind: "owns", base: baseCost("owns") });
      const ts = topicsOf.get(pid) ?? [];
      for (let j = 0; j < Math.min(ts.length, 1 + int(3)); j++) {
        mutations.push({ op: "upsertEdge", a: v, b: nodeId("topic", ts[int(ts.length)] as string), kind: "about", base: baseCost("about") });
      }
    });
    for (const list of byCommunity) {
      list.forEach((v, i) => {
        if (i === 0) return;
        const links = 1 + int(2);
        for (let j = 0; j < links; j++) {
          const other = list[int(i)] as NodeId; // solo hacia atrás: evita reflexivas
          mutations.push({ op: "upsertEdge", a: v, b: other, kind: "related_to", base: baseCost("related_to", "", 0.3 + 0.65 * rand()) });
        }
      });
    }
  }

  const groupIds = [...new Set(memberships.map((m) => m.group_id))].map((g) => nodeId("group", g));
  const topicIds = [...new Set(interests.map((r) => r.interest))].map((t) => nodeId("topic", t));
  return { core, mutations, people: people.map((p) => nodeId("person", p)), groups: groupIds, topics: topicIds, vaults };
}
