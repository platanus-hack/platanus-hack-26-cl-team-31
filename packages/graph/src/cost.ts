import type { EdgeKind, NodeKind } from "./model.js";

/**
 * Función de costo ("distancia": menor = más cercano).
 *
 *   peso(u→v) = base(arista) + (pen(u) + pen(v)) / 2
 *   pen(n)    = HUB[kind(n)] · log2(1 + grado(n))
 *
 * - `base` depende del tipo de relación y su audiencia: compartir algo dentro de
 *   un grupo privado es una señal más fuerte que un interés público.
 * - `pen` penaliza nodos muy conectados (temas masivos, grupos enormes) para que
 *   los caminos no pasen todos por el mismo hub: compartir un tema de nicho
 *   acerca más que compartir "música".
 * - La penalización se reparte mitad y mitad entre los extremos para que el peso
 *   sea simétrico (grafo no dirigido): eso permite Dijkstra bidireccional y
 *   landmarks sin distinguir dirección. El efecto sobre un camino s→t es
 *   sumar `pen(n)` completo por cada nodo intermedio, más `pen(s)/2 + pen(t)/2`.
 * - El grado se lee al recorrer (no se guarda en la arista), así agregar un
 *   miembro a un grupo no obliga a reescribir las aristas de los demás.
 */
export const BASE_COST = {
  member_of: 1,
  interestedInPublic: 2,
  interestedInScoped: 1.5,
  owns: 0.5,
  about: 1.5,
  related_to: 1,
  knows: 1,
} as const;

export const HUB_PENALTY: Readonly<Record<NodeKind, number>> = {
  person: 0,
  group: 0.5,
  topic: 0.75,
  vault: 0.1,
};

export function baseCost(kind: EdgeKind, scope = "", similarity?: number): number {
  switch (kind) {
    case "member_of":
      return BASE_COST.member_of;
    case "interested_in":
      return scope === "" ? BASE_COST.interestedInPublic : BASE_COST.interestedInScoped;
    case "owns":
      return BASE_COST.owns;
    case "about":
      return BASE_COST.about;
    case "related_to":
      // similitud ∈ [0,1] → 1 (muy similar) … 3 (poco similar)
      return similarity === undefined ? BASE_COST.related_to : BASE_COST.related_to + 2 * (1 - clamp01(similarity));
    case "knows":
      return BASE_COST.knows;
  }
}

export function hubPenalty(kind: NodeKind, degree: number): number {
  return HUB_PENALTY[kind] * Math.log2(1 + degree);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
