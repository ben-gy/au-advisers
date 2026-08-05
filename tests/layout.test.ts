// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// POSITIONAL tests for every hand-rolled layout.
//
// Area-only tests pass on visually broken layouts: an icicle that stacks every
// cell at the same origin conserves total area perfectly and renders as
// garbage. So these assert in-bounds, no-overlap, flush, and no-NaN.

import { describe, expect, it } from 'vitest';
import {
  stack, linear, log, areaPath, linePath, stepPath, hBars, vBars, histogram,
  icicle, sankeyBands, ribbonPath, careerLanes, seriate, finite, type IcicleNode,
} from '../src/views/layout.ts';
import { squarify } from '../src/utils/squarify.ts';

const overlapArea = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
};

describe('finite', () => {
  it('replaces every non-finite value, because one NaN silently deletes a shape', () => {
    expect(finite(NaN)).toBe(0);
    expect(finite(Infinity)).toBe(0);
    expect(finite(-Infinity, 5)).toBe(5);
    expect(finite(3.5)).toBe(3.5);
  });
});

describe('scales', () => {
  it('maps domain ends to range ends', () => {
    const s = linear([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(10)).toBe(100);
    expect(s(5)).toBe(50);
  });
  it('does not divide by zero on a degenerate domain', () => {
    const s = linear([5, 5], [0, 100]);
    expect(Number.isFinite(s(5))).toBe(true);
  });
  it('never returns NaN for a non-finite input', () => {
    const s = linear([0, 10], [0, 100]);
    expect(Number.isFinite(s(NaN))).toBe(true);
  });
  it('log scale tolerates zero by flooring at min', () => {
    const s = log([1, 1000], [0, 300]);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(s(1)).toBeCloseTo(0, 5);
    expect(s(1000)).toBeCloseTo(300, 5);
    expect(s(10)).toBeGreaterThan(s(1));
  });
});

describe('stack', () => {
  const series = [[1, 2, 3], [4, 5, 6], [0, 1, 0]];

  it('stacks contiguously — each band starts exactly where the last ended', () => {
    const out = stack(series, 'zero');
    for (let c = 0; c < 3; c++) {
      expect(out[0][c].y0).toBe(0);
      expect(out[1][c].y0).toBe(out[0][c].y1);
      expect(out[2][c].y0).toBe(out[1][c].y1);
    }
  });

  it('conserves the column total', () => {
    const out = stack(series, 'zero');
    for (let c = 0; c < 3; c++) {
      const total = series.reduce((s, row) => s + row[c], 0);
      expect(out[2][c].y1).toBeCloseTo(total, 9);
    }
  });

  it('wiggle centres each column on zero', () => {
    const out = stack(series, 'wiggle');
    for (let c = 0; c < 3; c++) {
      const total = series.reduce((s, row) => s + row[c], 0);
      expect(out[0][c].y0).toBeCloseTo(-total / 2, 9);
      expect(out[2][c].y1).toBeCloseTo(total / 2, 9);
    }
  });

  it('produces no NaN when a series contains holes', () => {
    const out = stack([[1, NaN, 3], [2, 2, NaN]], 'wiggle');
    for (const band of out) for (const p of band) {
      expect(Number.isFinite(p.y0)).toBe(true);
      expect(Number.isFinite(p.y1)).toBe(true);
    }
  });

  it('handles an empty input without throwing', () => {
    expect(stack([], 'zero')).toEqual([]);
  });
});

describe('paths', () => {
  const sx = linear([0, 2], [0, 100]);
  const sy = linear([0, 10], [100, 0]);

  it('area path is closed and contains no NaN', () => {
    const d = areaPath([0, 1, 2], [{ y0: 0, y1: 3 }, { y0: 0, y1: 5 }, { y0: 0, y1: 4 }], sx, sy);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('empty columns give an empty path rather than a broken one', () => {
    expect(areaPath([], [], sx, sy)).toBe('');
    expect(linePath([])).toBe('');
    expect(stepPath([])).toBe('');
  });
  it('step path only ever moves horizontally then vertically', () => {
    const d = stepPath([{ x: 0, y: 10 }, { x: 5, y: 8 }, { x: 10, y: 2 }]);
    expect(d).toMatch(/^M0\.00,10\.00H5\.00V8\.00H10\.00V2\.00$/);
  });
  it('paths sanitise non-finite inputs', () => {
    expect(linePath([{ x: NaN, y: 3 }, { x: 5, y: Infinity }])).not.toMatch(/NaN|Infinity/);
  });
});

describe('hBars / vBars', () => {
  const values = [5, 3, 8, 0, 1];

  it('horizontal bars stay in bounds and never overlap', () => {
    const bars = hBars(values, 200, 100);
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(200 + 1e-9);
      expect(b.y + b.h).toBeLessThanOrEqual(100 + 1e-9);
      expect(Number.isFinite(b.w) && Number.isFinite(b.h)).toBe(true);
    }
    for (let i = 0; i < bars.length; i++) {
      for (let j = i + 1; j < bars.length; j++) {
        expect(overlapArea(bars[i], bars[j])).toBeLessThan(0.5);
      }
    }
  });

  it('bar length is proportional to value', () => {
    const bars = hBars([10, 5], 100, 50);
    expect(bars[0].w).toBeCloseTo(100, 6);
    expect(bars[1].w).toBeCloseTo(50, 6);
  });

  it('vertical bars sit on the baseline and stay inside the canvas', () => {
    const bars = vBars(values, 200, 100);
    for (const b of bars) {
      expect(b.y).toBeGreaterThanOrEqual(-1e-9);
      expect(b.y + b.h).toBeCloseTo(100, 6);
      expect(b.x + b.w).toBeLessThanOrEqual(200 + 1e-9);
    }
  });

  it('vertical bars are ordered left to right without overlap', () => {
    const bars = vBars(values, 200, 100);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].w - 1e-9);
    }
  });

  it('a zero value produces a zero-length bar, not a negative one', () => {
    const bars = vBars([0, 5], 100, 50);
    expect(bars[0].h).toBe(0);
  });

  it('degenerate inputs return empty rather than NaN', () => {
    expect(hBars([], 100, 100)).toEqual([]);
    expect(vBars([1, 2], 0, 100)).toEqual([]);
    expect(vBars([0, 0], 100, 50).every((b) => b.h === 0)).toBe(true);
  });
});

describe('histogram', () => {
  const values = [1, 2, 2, 3, 5, 8, 13, 21];

  it('bins are contiguous and flush', () => {
    const bins = histogram(values, 5);
    expect(bins).toHaveLength(5);
    for (let i = 1; i < bins.length; i++) expect(bins[i].lo).toBeCloseTo(bins[i - 1].hi, 9);
    expect(bins[0].lo).toBe(1);
    expect(bins[bins.length - 1].hi).toBeCloseTo(21, 9);
  });

  it('counts sum to the input length — nothing is lost or double-counted', () => {
    const bins = histogram(values, 5);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(values.length);
    const allItems = bins.flatMap((b) => b.items);
    expect(new Set(allItems).size).toBe(values.length);
  });

  it('places the maximum value in the LAST bin rather than off the end', () => {
    const bins = histogram(values, 4);
    expect(bins[bins.length - 1].items).toContain(values.indexOf(21));
  });

  it('ignores non-finite values without shifting the bins', () => {
    const bins = histogram([1, NaN, 3], 2);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(2);
  });

  it('handles all-equal values without dividing by zero', () => {
    const bins = histogram([4, 4, 4], 3);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(3);
    for (const b of bins) expect(Number.isFinite(b.lo) && Number.isFinite(b.hi)).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(histogram([], 5)).toEqual([]);
  });
});

describe('icicle', () => {
  const tree = (): IcicleNode => ({
    key: '', label: 'root', value: 100, depth: 0, children: [
      { key: 'a', label: 'A', value: 60, depth: 1, children: [
        { key: 'a1', label: 'A1', value: 40, depth: 2, children: [] },
        { key: 'a2', label: 'A2', value: 20, depth: 2, children: [] },
      ] },
      { key: 'b', label: 'B', value: 40, depth: 1, children: [
        { key: 'b1', label: 'B1', value: 40, depth: 2, children: [] },
      ] },
    ],
  });

  it('every cell is inside the canvas', () => {
    const cells = icicle(tree(), 300, 200, 2);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(-1e-9);
      expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(300 + 1e-6);
      expect(c.y + c.h).toBeLessThanOrEqual(200 + 1e-6);
    }
  });

  it('no two cells overlap', () => {
    const cells = icicle(tree(), 300, 200, 2);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(overlapArea(cells[i], cells[j])).toBeLessThan(0.5);
      }
    }
  });

  it('siblings partition their parent exactly — flush, no gaps', () => {
    const cells = icicle(tree(), 300, 200, 2);
    const depth1 = cells.filter((c) => c.node.depth === 1).sort((a, b) => a.y - b.y);
    expect(depth1[0].y).toBeCloseTo(0, 6);
    expect(depth1[0].y + depth1[0].h).toBeCloseTo(depth1[1].y, 6);
    expect(depth1[1].y + depth1[1].h).toBeCloseTo(200, 6);
  });

  it('a child never escapes its parent vertically', () => {
    const cells = icicle(tree(), 300, 200, 2);
    const a = cells.find((c) => c.node.label === 'A')!;
    for (const label of ['A1', 'A2']) {
      const child = cells.find((c) => c.node.label === label)!;
      expect(child.y).toBeGreaterThanOrEqual(a.y - 1e-6);
      expect(child.y + child.h).toBeLessThanOrEqual(a.y + a.h + 1e-6);
    }
  });

  it('height is proportional to value', () => {
    const cells = icicle(tree(), 300, 200, 2);
    const a = cells.find((c) => c.node.label === 'A')!;
    const b = cells.find((c) => c.node.label === 'B')!;
    expect(a.h / b.h).toBeCloseTo(60 / 40, 5);
  });

  it('depth maps to distinct columns — the property a treemap cannot express', () => {
    const cells = icicle(tree(), 300, 200, 2);
    const d1x = new Set(cells.filter((c) => c.node.depth === 1).map((c) => Math.round(c.x)));
    const d2x = new Set(cells.filter((c) => c.node.depth === 2).map((c) => Math.round(c.x)));
    expect(d1x.size).toBe(1);
    expect(d2x.size).toBe(1);
    expect([...d1x][0]).not.toBe([...d2x][0]);
  });

  it('produces no NaN and survives zero-valued children', () => {
    const t = tree();
    t.children[0].children[0].value = 0;
    for (const c of icicle(t, 300, 200, 2)) {
      expect(Number.isFinite(c.x + c.y + c.w + c.h)).toBe(true);
    }
    expect(icicle({ key: '', label: 'r', value: 0, depth: 0, children: [] }, 300, 200, 2)).toEqual([]);
  });
});

describe('sankeyBands', () => {
  const targets = [
    { label: 'A', value: 50, ref: 0 },
    { label: 'B', value: 30, ref: 1 },
    { label: 'C', value: 20, ref: 2 },
  ];

  it('source bands are flush and fill the full height', () => {
    const bands = sankeyBands(targets, 300, 0);
    expect(bands[0].sy0).toBeCloseTo(0, 6);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].sy0).toBeCloseTo(bands[i - 1].sy1, 6);
    }
    expect(bands[bands.length - 1].sy1).toBeCloseTo(300, 6);
  });

  it('target bands never overlap and stay in bounds', () => {
    const bands = sankeyBands(targets, 300, 4);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].y0).toBeGreaterThanOrEqual(bands[i - 1].y1 - 1e-9);
    }
    for (const b of bands) {
      expect(b.y0).toBeGreaterThanOrEqual(-1e-9);
      expect(b.y1).toBeLessThanOrEqual(300 + 1e-6);
    }
  });

  it('band thickness is proportional to value', () => {
    const bands = sankeyBands(targets, 300, 0);
    expect((bands[0].sy1 - bands[0].sy0) / (bands[2].sy1 - bands[2].sy0)).toBeCloseTo(50 / 20, 5);
  });

  it('returns empty rather than NaN when everything is zero', () => {
    expect(sankeyBands([{ label: 'A', value: 0, ref: 0 }], 300)).toEqual([]);
    expect(sankeyBands([], 300)).toEqual([]);
  });

  it('ribbon paths are closed and finite', () => {
    const bands = sankeyBands(targets, 300, 3);
    for (const b of bands) {
      const d = ribbonPath(10, 200, b);
      expect(d.endsWith('Z')).toBe(true);
      expect(d).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('careerLanes', () => {
  it('puts sequential appointments in one lane', () => {
    const lanes = careerLanes([{ from: 2000, to: 2005 }, { from: 2005, to: 2010 }, { from: 2010, to: 2015 }]);
    expect(lanes.map((l) => l.lane)).toEqual([0, 0, 0]);
  });

  it('gives OVERLAPPING appointments their own lane so neither is hidden', () => {
    const lanes = careerLanes([{ from: 2000, to: 2010 }, { from: 2005, to: 2012 }]);
    expect(lanes[0].lane).toBe(0);
    expect(lanes[1].lane).toBe(1);
  });

  it('reuses a freed lane once its appointment has ended', () => {
    const lanes = careerLanes([
      { from: 2000, to: 2010 },
      { from: 2005, to: 2008 },
      { from: 2011, to: 2015 },
    ]);
    expect(lanes[2].lane).toBe(0);
  });

  it('handles three concurrent appointments', () => {
    const lanes = careerLanes([
      { from: 2000, to: 2010 }, { from: 2001, to: 2011 }, { from: 2002, to: 2012 },
    ]);
    expect(new Set(lanes.map((l) => l.lane)).size).toBe(3);
  });

  it('returns empty for no appointments', () => {
    expect(careerLanes([])).toEqual([]);
  });
});

describe('seriate', () => {
  it('returns a permutation containing every row exactly once', () => {
    const m = [[1, 0, 1], [0, 1, 0], [1, 0, 1], [0, 1, 1]];
    const order = seriate(m);
    expect(order).toHaveLength(4);
    expect(new Set(order).size).toBe(4);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });

  it('places identical rows adjacent to each other — the whole point', () => {
    const m = [[1, 1, 0], [0, 0, 1], [1, 1, 0]];
    const order = seriate(m);
    const p0 = order.indexOf(0);
    const p2 = order.indexOf(2);
    expect(Math.abs(p0 - p2)).toBe(1);
  });

  it('is deterministic', () => {
    const m = [[1, 0, 1], [0, 1, 0], [1, 1, 1], [0, 0, 1]];
    expect(seriate(m)).toEqual(seriate(m));
  });

  it('handles trivial and all-zero matrices without throwing', () => {
    expect(seriate([[1, 1]])).toEqual([0]);
    expect(seriate([]).length).toBe(0);
    const z = seriate([[0, 0], [0, 0], [0, 0]]);
    expect(new Set(z).size).toBe(3);
  });
});

describe('squarify (copied pattern)', () => {
  it('conserves area, stays in bounds and does not overlap', () => {
    const values = [40, 25, 15, 10, 6, 4];
    const rects = squarify(values, 400, 300);
    const total = values.reduce((a, b) => a + b, 0);
    let area = 0;
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(300 + 1e-6);
      area += r.w * r.h;
    }
    expect(area).toBeCloseTo(400 * 300, 2);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlapArea(rects[i], rects[j])).toBeLessThan(0.5);
      }
    }
    expect(rects[0].w * rects[0].h / (rects[1].w * rects[1].h)).toBeCloseTo(values[0] / values[1], 2);
    expect(total).toBeGreaterThan(0);
  });
});
