// Latencias y conteos por herramienta; tabla compacta para la terminal.

export class Metrics {
  constructor() {
    /** @type {Map<string, {ms: number[], codes: Record<string, number>, unexpected: number}>} */
    this.byTool = new Map();
  }

  /** @param {string} name @param {{status: number, ms: number}} res @param {boolean} unexpected */
  record(name, res, unexpected) {
    let t = this.byTool.get(name);
    if (!t) this.byTool.set(name, t = { ms: [], codes: {}, unexpected: 0 });
    t.ms.push(res.ms);
    t.codes[res.status] = (t.codes[res.status] ?? 0) + 1;
    if (unexpected) t.unexpected++;
  }

  /** @param {number} wallMs */
  summary(wallMs) {
    /** @type {Record<string, any>} */ const tools = {};
    const all = [];
    let unexpected = 0;
    for (const [name, t] of [...this.byTool].sort(([a], [b]) => a.localeCompare(b))) {
      tools[name] = { count: t.ms.length, codes: t.codes, unexpected: t.unexpected, ...latency(t.ms) };
      all.push(...t.ms);
      unexpected += t.unexpected;
    }
    return {
      tools,
      total: { count: all.length, unexpected, ...latency(all), throughputRps: round(all.length / (wallMs / 1000)) },
    };
  }
}

const round = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/** @param {number[]} values */
export function latency(values) {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const s = Float64Array.from(values).sort();
  const q = (/** @type {number} */ p) => round(/** @type {number} */ (s[Math.min(s.length - 1, Math.floor(p * s.length))]));
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: round(/** @type {number} */ (s[s.length - 1])), mean: round(values.reduce((a, b) => a + b, 0) / values.length) };
}

/** @param {ReturnType<Metrics["summary"]>} summary */
export function table(summary) {
  const rows = [["tool", "count", "unexp", "p50ms", "p95ms", "p99ms", "maxms"]];
  for (const [name, t] of Object.entries(summary.tools)) {
    rows.push([name, t.count, t.unexpected, t.p50, t.p95, t.p99, t.max].map(String));
  }
  const tot = summary.total;
  rows.push(["TOTAL", tot.count, tot.unexpected, tot.p50, tot.p95, tot.p99, tot.max].map(String));
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map(r => String(r[i]).length))) ?? [];
  return rows.map(r => r.map((c, i) => (i ? String(c).padStart(widths[i] ?? 0) : String(c).padEnd(widths[i] ?? 0))).join("  ")).join("\n");
}
