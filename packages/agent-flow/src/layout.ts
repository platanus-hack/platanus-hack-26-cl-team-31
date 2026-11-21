// Layout determinista. El broker queda al centro y cada titular es una tarjeta con sus agentes
// (y su titular humano cuando lo consultan). En pantallas anchas las tarjetas rodean al broker en
// una elipse; en pantallas angostas van en dos columnas, sobre y bajo el broker.
// Función pura sin aleatoriedad: la misma entrada produce exactamente las mismas posiciones.

export interface LayoutOwner {
  key: string;
}

export interface LayoutActor {
  id: string;
  ownerKey: string;
  role: "agent" | "owner";
}

export interface LayoutInput {
  width: number;
  height: number;
  owners: readonly LayoutOwner[];
  actors: readonly LayoutActor[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fila de un actor dentro de su tarjeta y el punto donde nace su arista hacia el broker. */
export interface Slot extends Rect {
  anchor: Point;
  /** Dirección de salida de la arista (unitaria). */
  normal: Point;
}

export interface LayoutResult {
  compact: boolean;
  /** cards: una tarjeta por titular con sus agentes. dots: red densa, un avatar por titular. */
  density: "cards" | "dots";
  /** Avatares del modo dots (centro). */
  nodes: Map<string, Point>;
  nodeRadius: number;
  /** Centro del sello del broker y su lado. */
  hub: Point & { size: number };
  /** Zona reservada para el broker, su nombre y su último paso. Ninguna tarjeta la cruza. */
  hubZone: Rect;
  cards: Map<string, Rect>;
  slots: Map<string, Slot>;
}

export interface LayoutMetrics {
  compact: boolean;
  pad: number;
  cardW: number;
  header: number;
  row: number;
  gap: number;
  inset: number;
  hub: number;
  hubZoneW: number;
  hubZoneH: number;
}

export function layoutMetrics(width: number): LayoutMetrics {
  const compact = width < 640;
  if (compact) {
    const pad = 12;
    return { compact, pad, cardW: Math.floor((width - pad * 3) / 2), header: 44, row: 32, gap: 4, inset: 8, hub: 52, hubZoneW: 220, hubZoneH: 140 };
  }
  const large = width >= 1200;
  return {
    compact,
    pad: 16,
    cardW: large ? 236 : 212,
    header: 48,
    row: large ? 36 : 34,
    gap: 4,
    inset: 8,
    hub: large ? 76 : 68,
    hubZoneW: 240,
    hubZoneH: large ? 164 : 156,
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function cardHeight(metrics: LayoutMetrics, rows: number): number {
  const n = Math.max(rows, 1);
  return metrics.inset * 2 + metrics.header + n * metrics.row + (n - 1) * metrics.gap;
}

function rowsByOwner(owners: readonly LayoutOwner[], actors: readonly LayoutActor[]) {
  return owners.map((owner) => {
    const own = actors.filter((actor) => actor.ownerKey === owner.key);
    // Agentes primero; el titular humano al final de su tarjeta.
    return { owner, rows: [...own.filter((a) => a.role === "agent"), ...own.filter((a) => a.role === "owner")] };
  });
}

/** En escritorio la franja superior queda libre para el modo y el contador de la red. */
export const TOP_INSET = 44;

/** Más titulares que esto pasan al modo dots. */
export const denseThreshold = (compact: boolean) => (compact ? 6 : 8);
const DOT_LABEL = 22;
const dotRadius = (compact: boolean) => (compact ? 16 : 20);
const DOT_COLUMNS = 4;

function dotRowHeight(compact: boolean) {
  return dotRadius(compact) * 2 + DOT_LABEL + 12;
}

/** Alto mínimo del escenario para que nada se superponga. */
export function stageHeightFor(width: number, owners: readonly LayoutOwner[], actors: readonly LayoutActor[]): number {
  const metrics = layoutMetrics(width);
  const groups = rowsByOwner(owners, actors);
  const tallest = Math.max(cardHeight(metrics, 2), ...groups.map((g) => cardHeight(metrics, g.rows.length)));
  if (groups.length > denseThreshold(metrics.compact)) {
    if (!metrics.compact) return Math.round(Math.min(680, Math.max(500, width * 0.58))) + TOP_INSET;
    return metrics.pad * 2 + Math.ceil(groups.length / DOT_COLUMNS) * dotRowHeight(true) + 40 + metrics.hubZoneH;
  }
  if (metrics.compact) return Math.max(320, compactPlan(metrics, groups).height);
  const base = Math.round(Math.min(620, Math.max(460, width * 0.56)));
  // Con muchas tarjetas, la de arriba, la de abajo y el broker deben caber en vertical.
  return TOP_INSET + (groups.length >= 5 ? Math.max(base, tallest * 2 + metrics.hubZoneH + metrics.pad * 2 + 48) : Math.max(base, tallest + metrics.hubZoneH + metrics.pad * 4));
}

/** Alto de cada fila (la tarjeta más alta de la fila) y alto total del escenario angosto. */
function compactPlan(metrics: LayoutMetrics, groups: ReturnType<typeof rowsByOwner>) {
  const { above, below } = compactRows(groups.length);
  const heightOf = (indices: number[]) => Math.max(...indices.map((i) => cardHeight(metrics, groups[i]!.rows.length)));
  const aboveHeights = above.map(heightOf);
  const belowHeights = below.map(heightOf);
  const block = (heights: number[]) => heights.reduce((sum, h) => sum + h + metrics.pad, 0);
  // 20 px de aire extra a cada lado de la zona del broker.
  return { above, below, aboveHeights, belowHeights, height: metrics.pad + block(aboveHeights) + 40 + metrics.hubZoneH + block(belowHeights) };
}

/** Reparto en filas de dos columnas: la mitad de las filas sobre el broker y el resto bajo él. */
function compactRows(count: number): { above: number[][]; below: number[][] } {
  if (count <= 2) return { above: count >= 1 ? [[0]] : [], below: count === 2 ? [[1]] : [] };
  const rows: number[][] = [];
  for (let i = 0; i < count; i += 2) rows.push(i + 1 < count ? [i, i + 1] : [i]);
  const split = Math.ceil(rows.length / 2);
  return { above: rows.slice(0, split), below: rows.slice(split) };
}

export function layoutFlow({ width, height, owners, actors }: LayoutInput): LayoutResult {
  const metrics = layoutMetrics(width);
  const { compact, pad, cardW, header, row, gap, inset } = metrics;
  const groups = rowsByOwner(owners, actors);
  const tallest = Math.max(cardHeight(metrics, 1), ...groups.map((g) => cardHeight(metrics, g.rows.length)));
  const plan = compactPlan(metrics, groups);
  const sum = (heights: number[]) => heights.reduce((total, h) => total + h + pad, 0);
  // Si sobra alto (embed a pantalla completa), el conjunto queda centrado en vez de pegado a los bordes.
  const slack = compact ? Math.max(0, height - plan.height) / 2 : 0;
  const aboveBottom = slack + pad + sum(plan.aboveHeights) - pad;
  const belowTop = height - slack - sum(plan.belowHeights);
  // La zona del broker (sello, nombre y último paso) queda centrada en el espacio libre.
  const dense = groups.length > denseThreshold(compact);
  const dotRows = Math.ceil(groups.length / DOT_COLUMNS);
  const zoneTop = compact && dense
    ? (height - (dotRows * dotRowHeight(true) + 40 + metrics.hubZoneH)) / 2 + Math.ceil(dotRows / 2) * dotRowHeight(true) + 20
    : compact ? (aboveBottom + belowTop - metrics.hubZoneH) / 2 : TOP_INSET + (height - TOP_INSET - metrics.hubZoneH) / 2;
  const hubZone = { x: round(width / 2 - metrics.hubZoneW / 2), y: round(zoneTop), w: metrics.hubZoneW, h: metrics.hubZoneH };
  const hub = { x: round(width / 2), y: round(zoneTop + 8 + metrics.hub / 2), size: metrics.hub };
  const cards = new Map<string, Rect>();
  const slots = new Map<string, Slot>();
  const nodes = new Map<string, Point>();
  const nodeRadius = dotRadius(compact);
  if (groups.length === 0) return { compact, density: "cards", nodes, nodeRadius, hub, hubZone, cards, slots };
  if (dense) return dotsLayout();

  const place = (key: string, rect: Rect) => cards.set(key, { x: round(rect.x), y: round(rect.y), w: rect.w, h: rect.h });

  if (compact) {
    const { above, below, aboveHeights, belowHeights } = plan;
    const placeRow = (indices: number[], y: number) => {
      indices.forEach((groupIndex, column) => {
        const group = groups[groupIndex]!;
        const h = cardHeight(metrics, group.rows.length);
        const w = indices.length === 1 ? Math.min(width - pad * 2, 280) : cardW;
        const x = indices.length === 1 ? (width - w) / 2 : column === 0 ? pad : width - pad - w;
        place(group.owner.key, { x, y, w, h });
      });
    };
    let y = slack + pad;
    above.forEach((indices, i) => {
      placeRow(indices, y);
      y += aboveHeights[i]! + pad;
    });
    y = belowTop;
    below.forEach((indices, i) => {
      placeRow(indices, y);
      y += belowHeights[i]! + pad;
    });
  } else {
    const count = groups.length;
    if (count >= 5) {
      // De 5 a 8: dos filas (arriba y abajo del broker) con casillas fijas; quien se une ocupa la
      // siguiente y nadie se mueve hasta pasar de 3 a 4 columnas.
      const columns = count <= 6 ? 3 : 4;
      const w = Math.max(160, Math.min(cardW, Math.floor((width - (columns + 1) * pad) / columns)));
      const gapX = (width - columns * w) / (columns + 1);
      groups.forEach((group, index) => {
        const top = index < columns;
        const column = top ? index : index - columns;
        const h = cardHeight(metrics, group.rows.length);
        const x = gapX + column * (w + gapX);
        // La fila de arriba se apoya sobre la zona del broker; la de abajo cuelga de ella.
        const y = top ? Math.max(TOP_INSET, hubZone.y - 24 - h) : Math.min(height - pad - h, hubZone.y + hubZone.h + 24);
        place(group.owner.key, { x, y, w, h });
      });
    } else {
    // Posiciones por casillas: quien se une ocupa la siguiente y nadie se mueve hasta que cambia la capacidad.
    const capacity = [1, 2, 3, 4].find((c) => c >= count) ?? count;
    // En escenarios muy anchos (16:9 a pantalla completa) las tarjetas no se van a los bordes.
    const rx = Math.max(0, Math.min(width / 2 - cardW / 2 - pad, cardW * 2.4));
    const ry = Math.max(0, (height - TOP_INSET) / 2 - tallest / 2 - pad);
    const center = hubZone.y + hubZone.h / 2;
    groups.forEach((group, index) => {
      // El primero a la izquierda. Con 4 se gira medio paso para usar las esquinas.
      const offset = capacity === 4 ? Math.PI / 4 : 0;
      const angle = Math.PI + (2 * Math.PI * index) / capacity + offset;
      const h = cardHeight(metrics, group.rows.length);
      const cx = hub.x + rx * Math.cos(angle);
      const cy = center + ry * Math.sin(angle);
      const x = Math.min(width - pad - cardW, Math.max(pad, cx - cardW / 2));
      let y = Math.min(height - pad - h, Math.max(TOP_INSET, cy - h / 2));
      // Una tarjeta sobre o bajo el broker no pisa su zona.
      if (x < hubZone.x + hubZone.w && hubZone.x < x + cardW) {
        y = cy < hub.y ? Math.min(y, hubZone.y - pad - h) : Math.max(y, hubZone.y + hubZone.h + pad);
      }
      place(group.owner.key, { x, y, w: cardW, h });
    });
    }
  }

  for (const group of groups) {
    const card = cards.get(group.owner.key)!;
    const centerX = card.x + card.w / 2;
    // Centro de la tarjeta respecto del broker: define desde qué borde sale cada arista.
    // En filas (angosto o de 5 a 8 titulares) salen por arriba o por abajo: de lado cruzarían la tarjeta vecina.
    const vertical = card.y + card.h / 2 < hub.y ? "bottom" : "top";
    const side = compact || groups.length >= 5 ? vertical : centerX < hub.x - card.w / 3 ? "right" : centerX > hub.x + card.w / 3 ? "left" : vertical;
    group.rows.forEach((actor, i) => {
      const y = card.y + inset + header + i * (row + gap);
      const rect = { x: round(card.x + inset), y: round(y), w: card.w - inset * 2, h: row };
      const midY = round(y + row / 2);
      const spread = card.x + (card.w * (i + 1)) / (group.rows.length + 1);
      const anchor =
        side === "right" ? { x: round(card.x + card.w), y: midY }
        : side === "left" ? { x: round(card.x), y: midY }
        : side === "bottom" ? { x: round(spread), y: round(card.y + card.h) }
        : { x: round(spread), y: round(card.y) };
      const normal = side === "right" ? { x: 1, y: 0 } : side === "left" ? { x: -1, y: 0 } : side === "bottom" ? { x: 0, y: 1 } : { x: 0, y: -1 };
      slots.set(actor.id, { ...rect, anchor, normal });
    });
  }
  return { compact, density: "cards", nodes, nodeRadius, hub, hubZone, cards, slots };

  // Red densa: avatares en anillos (escritorio) o en una grilla de cuatro columnas (angosto).
  function dotsLayout(): LayoutResult {
    const r = nodeRadius;
    const count = groups.length;
    const placeNode = (key: string, x: number, y: number) => nodes.set(key, { x: round(x), y: round(y) });
    if (compact) {
      const rows = Math.ceil(count / DOT_COLUMNS);
      const above = Math.ceil(rows / 2);
      const rowH = dotRowHeight(true);
      const cellW = (width - pad * 2) / DOT_COLUMNS;
      groups.forEach((group, index) => {
        const rowIndex = Math.floor(index / DOT_COLUMNS);
        const column = index % DOT_COLUMNS;
        const y = rowIndex < above
          ? hubZone.y - 20 - (above - rowIndex) * rowH + r + 6
          : hubZone.y + hubZone.h + 20 + (rowIndex - above) * rowH + r + 6;
        placeNode(group.owner.key, pad + cellW * (column + 0.5), y);
      });
    } else {
      const center = hubZone.y + hubZone.h / 2;
      const outer = { rx: width / 2 - pad - 56, ry: (height - TOP_INSET) / 2 - pad - r - DOT_LABEL };
      const inner = { rx: Math.max(hubZone.w / 2 + 90, outer.rx * 0.6), ry: Math.max(hubZone.h / 2 + r + 40, outer.ry * 0.58) };
      const perimeter = (e: { rx: number; ry: number }) => 2 * Math.PI * Math.sqrt((e.rx * e.rx + e.ry * e.ry) / 2);
      const spacing = 112;
      const outerCap = Math.max(8, Math.floor(perimeter(outer) / spacing));
      // Capacidad por escalones de 8: los avatares solo se reacomodan al cruzar un escalón.
      const step = (n: number) => Math.ceil(n / 8) * 8;
      const outerSlots = Math.min(outerCap, step(count));
      const innerCount = Math.max(0, count - outerSlots);
      const innerSlots = innerCount > 0 ? step(innerCount) : 0;
      const outerPoints = ellipsePoints(outer.rx, outer.ry, outerSlots, 0);
      const innerPoints = innerSlots > 0 ? ellipsePoints(inner.rx, inner.ry, innerSlots, 0.5) : [];
      groups.forEach((group, index) => {
        const p = index < outerSlots ? outerPoints[index]! : innerPoints[index - outerSlots]!;
        placeNode(group.owner.key, hub.x + p.x, center + p.y);
      });
    }
    for (const group of groups) {
      const node = nodes.get(group.owner.key)!;
      const dx = hub.x - node.x;
      const dy = hub.y - node.y;
      const length = Math.hypot(dx, dy) || 1;
      const normal = { x: round(dx / length), y: round(dy / length) };
      const anchor = { x: round(node.x + normal.x * (r + 4)), y: round(node.y + normal.y * (r + 4)) };
      for (const actor of group.rows) slots.set(actor.id, { x: node.x - r, y: node.y - r, w: r * 2, h: r * 2, anchor, normal });
    }
    return { compact, density: "dots", nodes, nodeRadius: r, hub, hubZone, cards, slots };
  }
}

/**
 * n puntos de una elipse separados por igual longitud de arco (no por ángulo, que amontona los
 * costados). Empiezan a la izquierda; offset desplaza media casilla para intercalar anillos.
 */
function ellipsePoints(rx: number, ry: number, n: number, offset: number): Point[] {
  const samples = 720;
  const lengths = [0];
  let previous = { x: -rx, y: 0 };
  for (let i = 1; i <= samples; i++) {
    const angle = Math.PI + (2 * Math.PI * i) / samples;
    const point = { x: rx * Math.cos(angle), y: ry * Math.sin(angle) };
    lengths.push(lengths[i - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y));
    previous = point;
  }
  const total = lengths[samples]!;
  const points: Point[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * (k + offset)) / n;
    while (j < samples && lengths[j + 1]! < target) j++;
    const angle = Math.PI + (2 * Math.PI * j) / samples;
    points.push({ x: rx * Math.cos(angle), y: ry * Math.sin(angle) });
  }
  return points;
}

export interface EdgeCurve {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/**
 * Arista desde la tarjeta hasta el broker, como curva cúbica. Las tarjetas laterales entran por los
 * costados del sello, las de arriba por su borde superior y las de abajo por el borde inferior de la
 * zona del broker: ninguna cruza su nombre ni su último paso.
 */
export function edgeCurve(slot: Slot, layout: Pick<LayoutResult, "hub" | "hubZone">): EdgeCurve {
  const { hub, hubZone } = layout;
  const start = slot.anchor;
  const half = hub.size / 2 + 6;
  const spreadY = clamp((start.y - hub.y) * 0.12, hub.size / 3);
  const spreadX = clamp((start.x - hub.x) * 0.12, hub.size / 3);
  let end: Point;
  let entry: Point;
  const horizontal = Math.abs(slot.normal.x) >= Math.abs(slot.normal.y);
  if (horizontal && slot.normal.x > 0) [end, entry] = [{ x: hub.x - half, y: hub.y + spreadY }, { x: -1, y: 0 }];
  else if (horizontal) [end, entry] = [{ x: hub.x + half, y: hub.y + spreadY }, { x: 1, y: 0 }];
  else if (slot.normal.y > 0) [end, entry] = [{ x: hub.x + spreadX, y: hub.y - half }, { x: 0, y: -1 }];
  else [end, entry] = [{ x: hub.x + spreadX, y: hubZone.y + hubZone.h }, { x: 0, y: 1 }];
  const reach = Math.max(24, Math.hypot(end.x - start.x, end.y - start.y) * 0.42);
  return {
    start,
    c1: { x: start.x + slot.normal.x * reach, y: start.y + slot.normal.y * reach },
    c2: { x: end.x + entry.x * reach, y: end.y + entry.y * reach },
    end,
  };
}

export function pointOnCurve(curve: EdgeCurve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve.start.x + b * curve.c1.x + c * curve.c2.x + d * curve.end.x,
    y: a * curve.start.y + b * curve.c1.y + c * curve.c2.y + d * curve.end.y,
  };
}
