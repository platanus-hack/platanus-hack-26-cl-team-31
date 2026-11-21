/** Min-heap binario con prioridades numéricas en arreglos paralelos. */
export class MinHeap<T> {
  private readonly keys: number[] = [];
  private readonly items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  peekKey(): number {
    return this.keys.length ? (this.keys[0] as number) : Infinity;
  }

  push(item: T, key: number): void {
    const keys = this.keys;
    const items = this.items;
    let i = items.length;
    keys.push(key);
    items.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p] as number;
      if (pk <= key) break;
      keys[i] = pk;
      items[i] = items[p] as T;
      i = p;
    }
    keys[i] = key;
    items[i] = item;
  }

  /** Devuelve el mínimo; la clave queda en `lastKey`. */
  pop(): T | undefined {
    const keys = this.keys;
    const items = this.items;
    const n = items.length;
    if (n === 0) return undefined;
    const top = items[0] as T;
    this.lastKey = keys[0] as number;
    const lastItem = items.pop() as T;
    const lastKey = keys.pop() as number;
    const m = n - 1;
    if (m > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= m) break;
        const r = l + 1;
        const c = r < m && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[c] as number) >= lastKey) break;
        keys[i] = keys[c] as number;
        items[i] = items[c] as T;
        i = c;
      }
      keys[i] = lastKey;
      items[i] = lastItem;
    }
    return top;
  }

  lastKey = Infinity;

  /** Recorre elementos en orden de arreglo (≈ por niveles: los más baratos primero). */
  *entries(): Generator<T> {
    for (const item of this.items) yield item;
  }
}
