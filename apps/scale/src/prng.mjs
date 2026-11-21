// PRNG determinista (mulberry32) sembrado desde un string: misma semilla → misma secuencia.

/** @param {string} text */
export function hash32(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Avalancha final para que semillas parecidas no generen secuencias parecidas.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** @param {string | number} seed */
export function rng(seed) {
  let a = hash32(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** @param {number} lo @param {number} hi */
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    /** @param {[number, number]} range */
    range: ([lo, hi]) => int(lo, hi),
    /** @param {number} p */
    chance: p => next() < p,
    /** @template T @param {readonly T[]} items @returns {T} */
    pick: items => /** @type {T} */ (items[Math.floor(next() * items.length)]),
    /** k elementos distintos, en orden aleatorio. @template T @param {readonly T[]} items @param {number} k @returns {T[]} */
    sample(items, k) {
      const copy = items.slice();
      const n = Math.min(k, copy.length);
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(next() * (copy.length - i));
        [copy[i], copy[j]] = [/** @type {T} */ (copy[j]), /** @type {T} */ (copy[i])];
      }
      return copy.slice(0, n);
    },
  };
}

/** Número estable en [0,1) para una tupla (ej. decisión de aceptar un encuentro). @param {...string|number} parts */
export const unit = (...parts) => rng(parts.join("|")).next();
