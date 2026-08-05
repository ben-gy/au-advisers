// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure layout geometry for every hand-rolled chart. No DOM here on purpose:
// these are the functions the positional tests assert against (in-bounds,
// no-overlap, flush, no-NaN, area-conserved). Area-only tests pass on visually
// broken layouts, so the tests check POSITIONS.

export interface Rect { x: number; y: number; w: number; h: number; i: number }
export interface Pt { x: number; y: number }

/** Guard every coordinate that reaches an SVG attribute. A single NaN silently
 *  removes a shape; a stream of them silently removes the chart. */
export function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

// ── stacked area / streamgraph ──────────────────────────────────────────

/**
 * Stack series into baselines. `mode: 'zero'` is a normal stacked area;
 * `'wiggle'` centres each column on the total, which is what makes a
 * streamgraph read as composition rather than as a sum.
 *
 * Returns [seriesIndex][columnIndex] = { y0, y1 } in VALUE space.
 */
export function stack(series: number[][], mode: 'zero' | 'wiggle' = 'zero'): { y0: number; y1: number }[][] {
  const nSeries = series.length;
  const nCols = nSeries ? series[0].length : 0;
  const out: { y0: number; y1: number }[][] = series.map(() => new Array(nCols));
  for (let c = 0; c < nCols; c++) {
    let total = 0;
    for (let s = 0; s < nSeries; s++) total += finite(series[s][c]);
    let base = mode === 'wiggle' ? -total / 2 : 0;
    for (let s = 0; s < nSeries; s++) {
      const v = finite(series[s][c]);
      out[s][c] = { y0: base, y1: base + v };
      base += v;
    }
  }
  return out;
}

export interface Scale { (v: number): number; domain: [number, number]; range: [number, number] }

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = ((v: number) => {
    if (!Number.isFinite(v)) return r0;
    if (span === 0) return (r0 + r1) / 2;
    return r0 + ((v - d0) / span) * (r1 - r0);
  }) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** log10 scale that tolerates zero by flooring the domain at `min`. */
export function log(domain: [number, number], range: [number, number], min = 1): Scale {
  const d0 = Math.max(min, domain[0]);
  const d1 = Math.max(d0 * 1.0001, domain[1]);
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const f = ((v: number) => {
    const x = Math.log10(Math.max(min, Number.isFinite(v) ? v : min));
    return range[0] + ((x - l0) / (l1 - l0)) * (range[1] - range[0]);
  }) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** Build an SVG path for one stacked band. */
export function areaPath(
  cols: number[], band: { y0: number; y1: number }[], sx: Scale, sy: Scale,
): string {
  if (!cols.length) return '';
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    const x = finite(sx(cols[i]));
    top.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${finite(sy(band[i].y1)).toFixed(2)}`);
    bottom.push(`L${x.toFixed(2)},${finite(sy(band[i].y0)).toFixed(2)}`);
  }
  bottom.reverse();
  return `${top.join('')}${bottom.join('')}Z`;
}

export function linePath(pts: Pt[]): string {
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${finite(p.x).toFixed(2)},${finite(p.y).toFixed(2)}`)
    .join('');
}

/** A step (staircase) path — correct for survival curves, where the value holds
 *  until the next observation rather than sliding linearly toward it. */
export function stepPath(pts: Pt[]): string {
  if (!pts.length) return '';
  let d = `M${finite(pts[0].x).toFixed(2)},${finite(pts[0].y).toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    d += `H${finite(pts[i].x).toFixed(2)}V${finite(pts[i].y).toFixed(2)}`;
  }
  return d;
}

// ── bars ────────────────────────────────────────────────────────────────

/** Horizontal bars, top-down, flush within [0, height]. */
export function hBars(values: number[], width: number, height: number, gap = 2, max?: number): Rect[] {
  const n = values.length;
  if (!n || width <= 0 || height <= 0) return [];
  const m = max ?? Math.max(...values.filter(Number.isFinite), 0);
  const rowH = height / n;
  const barH = Math.max(1, rowH - gap);
  return values.map((v, i) => ({
    i,
    x: 0,
    y: finite(i * rowH),
    w: m > 0 ? Math.max(0, finite((Math.max(0, v) / m) * width)) : 0,
    h: barH,
  }));
}

/** Vertical bars across [0, width], flush and non-overlapping. */
export function vBars(values: number[], width: number, height: number, gap = 1, max?: number): Rect[] {
  const n = values.length;
  if (!n || width <= 0 || height <= 0) return [];
  const m = max ?? Math.max(...values.filter(Number.isFinite), 0);
  const colW = width / n;
  const barW = Math.max(1, colW - gap);
  return values.map((v, i) => {
    const h = m > 0 ? Math.max(0, finite((Math.max(0, v) / m) * height)) : 0;
    return { i, x: finite(i * colW), y: finite(height - h), w: barW, h };
  });
}

// ── histogram ───────────────────────────────────────────────────────────

export interface Bin { lo: number; hi: number; n: number; items: number[] }

/** Contiguous, flush bins. The top edge is inclusive on the LAST bin only, so
 *  the maximum value lands somewhere instead of falling off the end. */
export function histogram(values: number[], binCount: number): Bin[] {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length || binCount < 1) return [];
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const span = hi - lo || 1;
  const step = span / binCount;
  const bins: Bin[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({ lo: lo + i * step, hi: lo + (i + 1) * step, n: 0, items: [] });
  }
  values.forEach((v, idx) => {
    if (!Number.isFinite(v)) return;
    let b = Math.floor((v - lo) / step);
    if (b >= binCount) b = binCount - 1;
    if (b < 0) b = 0;
    bins[b].n++;
    bins[b].items.push(idx);
  });
  return bins;
}

// ── icicle (horizontal partition) ───────────────────────────────────────

export interface IcicleNode {
  key: string; label: string; value: number; depth: number; children: IcicleNode[];
  ceased?: string | null; owner?: string | null; ref?: number;
}
export interface IcicleCell extends Rect { node: IcicleNode }

/**
 * Depth on the X axis, value on Y. Siblings partition their parent's Y span
 * exactly, so the layout is flush by construction and a child can never escape
 * its parent — the property a treemap of the same data cannot express.
 */
export function icicle(root: IcicleNode, width: number, height: number, maxDepth: number): IcicleCell[] {
  const out: IcicleCell[] = [];
  const colW = maxDepth > 0 ? width / maxDepth : width;
  let i = 0;
  const walk = (node: IcicleNode, y: number, h: number, depth: number) => {
    if (depth > 0) {
      out.push({ i: i++, x: finite((depth - 1) * colW), y: finite(y), w: finite(colW), h: finite(h), node });
    }
    const total = node.children.reduce((s, c) => s + Math.max(0, c.value), 0);
    if (!total || depth >= maxDepth) return;
    let cy = y;
    for (const c of node.children) {
      const ch = (Math.max(0, c.value) / total) * h;
      walk(c, cy, ch, depth + 1);
      cy += ch;
    }
  };
  walk(root, 0, height, 0);
  return out;
}

// ── sankey (one source fanning to many targets) ─────────────────────────

export interface SankeyBand {
  i: number; label: string; value: number;
  y0: number; y1: number; sy0: number; sy1: number; ref: number;
}

/**
 * A one-to-many Sankey. The source column's band for each target is stacked in
 * the same order as the target column, so ribbons never cross unnecessarily.
 * Bands are flush: they partition the full height in proportion to value.
 */
export function sankeyBands(
  targets: { label: string; value: number; ref: number }[], height: number, gap = 2,
): SankeyBand[] {
  const total = targets.reduce((s, t) => s + Math.max(0, t.value), 0);
  if (!total) return [];
  const usable = Math.max(1, height - gap * Math.max(0, targets.length - 1));
  let ty = 0;
  let sy = 0;
  return targets.map((t, i) => {
    const h = (Math.max(0, t.value) / total) * usable;
    const sh = (Math.max(0, t.value) / total) * height;
    const band: SankeyBand = {
      i, label: t.label, value: t.value, ref: t.ref,
      y0: finite(ty), y1: finite(ty + h),
      sy0: finite(sy), sy1: finite(sy + sh),
    };
    ty += h + gap;
    sy += sh;
    return band;
  });
}

/** Cubic ribbon between two vertical spans. */
export function ribbonPath(x0: number, x1: number, b: SankeyBand): string {
  const mx = (x0 + x1) / 2;
  const f = (n: number) => finite(n).toFixed(2);
  return `M${f(x0)},${f(b.sy0)}` +
    `C${f(mx)},${f(b.sy0)} ${f(mx)},${f(b.y0)} ${f(x1)},${f(b.y0)}` +
    `L${f(x1)},${f(b.y1)}` +
    `C${f(mx)},${f(b.y1)} ${f(mx)},${f(b.sy1)} ${f(x0)},${f(b.sy1)}Z`;
}

// ── career ribbon ───────────────────────────────────────────────────────

/**
 * One lane per appointment on a shared time axis. Overlapping appointments —
 * which are common and meaningful, an adviser authorised by two licensees at
 * once — get their own lane rather than being merged, so nothing is hidden.
 */
export function careerLanes(spans: { from: number; to: number }[]): { i: number; lane: number }[] {
  const laneEnds: number[] = [];
  const out: { i: number; lane: number }[] = [];
  spans.forEach((s, i) => {
    // Reuse the first lane whose last appointment finished before this one
    // started; otherwise open a new lane. Concurrent appointments therefore
    // stack instead of overwriting each other.
    let lane = laneEnds.findIndex((end) => end <= s.from);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.to); }
    else laneEnds[lane] = Math.max(laneEnds[lane], s.to);
    out.push({ i, lane });
  });
  return out;
}

// ── seriation ───────────────────────────────────────────────────────────

/**
 * Order rows/columns of a binary matrix so similar ones sit together and blocks
 * emerge. Greedy nearest-neighbour on cosine similarity, seeded from the
 * densest row — cheap, deterministic, and enough to beat alphabetical order,
 * which actively destroys the structure this matrix exists to show.
 */
export function seriate(matrix: number[][]): number[] {
  const n = matrix.length;
  if (n <= 2) return matrix.map((_, i) => i);
  const norms = matrix.map((r) => Math.sqrt(r.reduce((s, v) => s + v * v, 0)) || 1);
  const sim = (a: number, b: number) => {
    let dot = 0;
    for (let k = 0; k < matrix[a].length; k++) dot += matrix[a][k] * matrix[b][k];
    return dot / (norms[a] * norms[b]);
  };
  const used = new Set<number>();
  let cur = matrix
    .map((r, i) => ({ i, s: r.reduce((s, v) => s + v, 0) }))
    .sort((x, y) => y.s - x.s)[0].i;
  const order = [cur];
  used.add(cur);
  while (order.length < n) {
    let best = -1;
    let bestSim = -Infinity;
    for (let j = 0; j < n; j++) {
      if (used.has(j)) continue;
      const s = sim(cur, j);
      if (s > bestSim) { bestSim = s; best = j; }
    }
    if (best < 0) break;
    order.push(best);
    used.add(best);
    cur = best;
  }
  for (let j = 0; j < n; j++) if (!used.has(j)) order.push(j);
  return order;
}
