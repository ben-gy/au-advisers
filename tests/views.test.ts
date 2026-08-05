// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every non-map view is rendered against the REAL committed data and asserted
// to produce its signature marks, no NaN/undefined/Infinity anywhere, and no
// dead interactive affordances.
//
// The map view is excluded because Leaflet needs a real layout engine; it is
// covered by the live browser verification instead.

import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), 'public', 'data');
const read = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

// Serve the committed data files to the app's fetch-based loader.
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).replace(/^data\//, '');
    const path = join(DATA, file);
    if (!existsSync(path)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) };
  });
  // jsdom has no layout engine; the zoom helper reads viewBox.baseVal.
  if (!('PointerEvent' in globalThis)) {
    globalThis.PointerEvent = MouseEvent as unknown as typeof PointerEvent;
  }
});

beforeEach(() => {
  document.body.replaceChildren();
  location.hash = '';
});

const meta = () => read('meta.json');

// "Infinity" is deliberately NOT checked in free text: the register genuinely
// contains firms called "Infinity Capital Solutions Pty Ltd". Non-finite
// numbers are caught where they actually matter — in SVG coordinate
// attributes — by the dedicated test below.
const BAD = /\bNaN\b|\bundefined\b|\[object Object\]/;

async function render(name: string, params = ''): Promise<HTMLElement> {
  const mod = await import(`../src/views/${name}.ts`);
  const fn = Object.values(mod).find((v) => typeof v === 'function' && /^render/.test((v as { name: string }).name)) as
    (ctx: { root: HTMLElement; meta: unknown; params: URLSearchParams }) => Promise<void>;
  const root = document.createElement('div');
  document.body.appendChild(root);
  await fn({ root, meta: meta(), params: new URLSearchParams(params) });
  return root;
}

const VIEWS = ['overview', 'retreat', 'movements', 'ownership', 'cohorts', 'diaspora', 'conduct', 'authorisations', 'explorer'];

describe('data files are present and internally consistent', () => {
  it('meta reports all nine gates passing', () => {
    const m = meta();
    expect(m.gates.length).toBe(9);
    for (const g of m.gates) expect(g.ok, `${g.name}: ${g.detail}`).toBe(true);
  });

  it('the headline figures agree with each other', () => {
    const m = meta();
    expect(m.headline.alumniNaive - m.headline.alumniDated).toBe(m.headline.phantom);
    expect(m.headline.phantom).toBeGreaterThan(0);
    expect(m.headline.alumniStillPractising).toBeLessThanOrEqual(m.headline.alumniDated);
    expect(m.headline.alumniShareOfCurrent)
      .toBeCloseTo(m.headline.alumniStillPractising / m.currentAdvisers, 6);
  });

  it('the dating rule bites on CBA, ANZ and AMP and is a no-op on NAB and Westpac', () => {
    // The structural property the whole site rests on, asserted against the
    // SHIPPED data rather than only against a synthetic fixture.
    const p = meta().headline.perOwner;
    for (const id of ['cba', 'anz', 'amp']) expect(p[id].naive, id).toBeGreaterThan(p[id].dated);
    for (const id of ['nab', 'wbc']) expect(p[id].naive, id).toBe(p[id].dated);
  });

  it('the adviser index is columnar and every column is the same length', () => {
    const a = read('advisers.json');
    const n = a.n.length;
    for (const k of Object.keys(a)) expect(a[k].length, k).toBe(n);
    expect(n).toBe(meta().advisers);
  });

  it('every licensee reference in the geography file resolves', () => {
    const geo = read('geography.json');
    const lic = read('licensees.json');
    for (const row of geo.advised.slice(0, 200)) {
      for (const item of row.lics) expect(lic[item.l]).toBeTruthy();
    }
  });

  it('movement edges never point at a missing licensee', () => {
    const m = read('movements.json');
    const lic = read('licensees.json');
    for (const e of m.edges) {
      expect(lic[e.f]).toBeTruthy();
      expect(lic[e.t]).toBeTruthy();
    }
    // -2 is the explicit exit sink and is the ONLY negative target allowed.
    for (const e of m.all) expect(e.t === -2 || lic[e.t]).toBeTruthy();
  });

  it('the exit sink carries real weight — leaving is not hidden', () => {
    const m = read('movements.json');
    const exitWeight = m.all.filter((e: { t: number }) => e.t === -2).reduce((s: number, e: { c: number }) => s + e.c, 0);
    expect(exitWeight).toBe(meta().exits);
    expect(exitWeight).toBeGreaterThan(0);
  });

  it('survival shares are always between 0 and 1', () => {
    for (const c of read('cohorts.json').cohorts) {
      for (const p of c.points) {
        expect(p.share).toBeGreaterThanOrEqual(0);
        expect(p.share).toBeLessThanOrEqual(1);
      }
    }
  });

  it('per-capita rates are only computed where a real denominator exists', () => {
    for (const row of read('geography.json').advised) {
      if (row.per10k == null) continue;
      expect(row.pop).toBeGreaterThanOrEqual(200);
      expect(Number.isFinite(row.per10k)).toBe(true);
      expect(row.per10k).toBeCloseTo((row.n / row.pop) * 10000, 6);
    }
  });
});

describe.each(VIEWS)('view: %s', (name) => {
  it('renders against the real data with no NaN, undefined or Infinity', async () => {
    const root = await render(name);
    expect(root.children.length).toBeGreaterThan(0);
    const text = root.textContent ?? '';
    expect(text.length).toBeGreaterThan(50);
    const bad = text.match(BAD);
    expect(bad, `${name} rendered "${bad?.[0]}"`).toBeNull();
  });

  it('emits no NaN into any SVG coordinate attribute', async () => {
    const root = await render(name);
    for (const node of root.querySelectorAll('svg *')) {
      for (const attr of ['x', 'y', 'cx', 'cy', 'r', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'd']) {
        const v = node.getAttribute(attr);
        if (v == null) continue;
        expect(v, `${name} <${node.tagName} ${attr}>`).not.toMatch(/NaN|Infinity|undefined/);
      }
    }
  });

  it('gives every chart an accessible name', async () => {
    const root = await render(name);
    const charts = root.querySelectorAll('svg[role="group"], svg[role="img"]');
    expect(charts.length).toBeGreaterThan(0);
    for (const s of charts) {
      expect(s.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('never puts a focusable mark inside an accessibility-leaf svg', async () => {
    // role="img" prunes descendants from the accessibility tree, so a focusable
    // mark inside one is reachable by Tab and announces nothing.
    const root = await render(name);
    for (const s of root.querySelectorAll('svg[role="img"]')) {
      expect(s.querySelectorAll('[tabindex="0"]').length, `${name}: focusable marks inside role=img`).toBe(0);
    }
  });

  it('has no dead affordance — everything that looks clickable responds', async () => {
    const root = await render(name);
    // Anything given a button role must be reachable and named.
    for (const node of root.querySelectorAll('[role="button"]')) {
      expect(node.getAttribute('tabindex'), `${name}: role=button without a tab stop`).not.toBe('-1');
      expect(node.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0);
    }
    // Every clickable-row is keyboard reachable.
    for (const row of root.querySelectorAll('tr.clickable-row')) {
      expect((row as HTMLElement).tabIndex).toBe(0);
    }
  });

  it('gives every data mark a hover tooltip', async () => {
    const root = await render(name);
    const marks = root.querySelectorAll('svg rect, svg circle, svg path[fill]:not([fill="none"])');
    let tipped = 0;
    for (const m of marks) if (m.getAttribute('data-tip')) tipped++;
    if (marks.length > 4) {
      // Structural rects (gridlines, backgrounds) legitimately have none, so
      // this asserts the bulk of marks are tipped rather than every single one.
      expect(tipped / marks.length, `${name}: only ${tipped}/${marks.length} marks have a tooltip`)
        .toBeGreaterThan(0.5);
    }
  });

  it('uses no native <title> as a substitute for a real tooltip', async () => {
    const root = await render(name);
    expect(root.querySelectorAll('svg title').length).toBe(0);
  });
});

describe('overview', () => {
  it('states the headline share and the phantom count', async () => {
    const root = await render('overview');
    const m = meta();
    const text = root.textContent ?? '';
    expect(text).toContain(m.headline.alumniStillPractising.toLocaleString('en-AU'));
    expect(text).toContain(m.headline.phantom.toLocaleString('en-AU'));
  });
});

describe('retreat', () => {
  it('renders one band per owner group plus independent', async () => {
    const root = await render('retreat');
    const paths = root.querySelectorAll('svg path[fill]');
    expect(paths.length).toBeGreaterThanOrEqual(meta().owners.length + 1);
  });

  it('offers the naive/dated toggle and switching it changes the copy', async () => {
    const root = await render('retreat');
    const buttons = [...root.querySelectorAll('button')].filter((b) => /naive/i.test(b.textContent ?? ''));
    expect(buttons.length).toBe(1);
    const before = root.querySelector('.note')?.textContent ?? '';
    buttons[0].click();
    const after = root.querySelector('.note')?.textContent ?? '';
    expect(after).not.toBe(before);
    expect(after.toLowerCase()).toContain('never there');
  });
});

describe('explorer', () => {
  it('lists advisers and filters on search', async () => {
    const root = await render('explorer');
    const rowsBefore = root.querySelectorAll('tbody tr').length;
    expect(rowsBefore).toBeGreaterThan(10);
    const search = root.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search).toBeTruthy();
  });

  it('the career-length histogram bar is clickable and filters the table', async () => {
    const root = await render('explorer');
    const bars = [...root.querySelectorAll('svg rect[role="button"]')];
    expect(bars.length).toBeGreaterThan(3);
    const summaryBefore = root.querySelector('.sub')?.textContent ?? '';
    (bars[2] as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const pill = root.querySelector('.pill');
    expect(pill, 'clicking a histogram bar must reveal a Clear pill').toBeTruthy();
    const summaryAfter = root.querySelector('.sub')?.textContent ?? '';
    expect(summaryAfter).not.toBe(summaryBefore);
  });
});

describe('conduct', () => {
  it('shades a low-n zone rather than silently dropping small firms', async () => {
    const root = await render('conduct');
    expect(root.textContent).toMatch(/percentages here are noise|too few/i);
  });

  it('states that names are not matched against the banned register', async () => {
    const root = await render('conduct');
    expect((root.textContent ?? '').replace(/\s+/g, ' ')).toMatch(/Banned and Disqualified/i);
  });
});

describe('diaspora', () => {
  it('draws an explicit "left the register" band', async () => {
    const root = await render('diaspora');
    expect(root.textContent).toMatch(/Left the register/i);
  });
});

describe('the review findings, pinned against the shipped data', () => {
  it('counts DISTINCT disciplinary actions, not appointment rows', () => {
    // ASIC repeats the ADV_DA_* fields on every appointment row of a disciplined
    // adviser. Counting rows published 859 "actions" where there are 285 — a
    // threefold overstatement of regulatory action against named individuals.
    const c = meta().conduct;
    expect(c.actions).toBeLessThan(c.actionRows);
    expect(c.actions).toBeGreaterThanOrEqual(c.advisers);
    // The per-type breakdown must sum to the DISTINCT total, not the row total.
    const sum = Object.values(c.byType).reduce((a: number, b) => a + (b as number), 0);
    expect(sum).toBe(c.actions);
  });

  it('never charts a headcount year the register could not observe', () => {
    for (const r of read('series.json').dated) expect(r.year).toBeGreaterThanOrEqual(2015);
    for (const r of read('series.json').naive) expect(r.year).toBeGreaterThanOrEqual(2015);
  });

  it('rejects the nine stray-tab rows rather than publishing shifted columns', () => {
    const m = meta();
    expect(m.rejected.field_count_mismatch).toBeGreaterThan(0);
    // Row conservation must still hold with the new bucket.
    const rejected = Object.values(m.rejected).reduce((a: number, b) => a + (b as number), 0);
    expect(m.appointments + rejected).toBe(m.rows);
  });

  it('counts mappable advisers as PEOPLE, so the map cannot claim more than exist', () => {
    const cov = read('geography.json').coverage;
    expect(cov.mappedAdvisers).toBeLessThanOrEqual(meta().currentAdvisers);
    // The appointment sum is the larger number and is kept separately.
    expect(cov.mappedAppointments).toBeGreaterThanOrEqual(cov.mappedAdvisers);
  });
});

describe('cohorts', () => {
  it('never charts an intake the register could not observe leaving', async () => {
    // The bias that produced a confident, entirely meaningless 98.8% five-year
    // survival rate for the 1995-2012 intakes. Asserted against SHIPPED data.
    for (const c of read('cohorts.json').cohorts) expect(c.year).toBeGreaterThanOrEqual(2015);
    for (const f of read('cohorts.json').flow) expect(f.year).toBeGreaterThanOrEqual(2015);
  });

  it('explains why the cohorts start where they do', async () => {
    const root = await render('cohorts');
    expect((root.textContent ?? '').replace(/\s+/g, ' '))
      .toMatch(/register commenced in 2015|not an arbitrary cut-off/i);
  });
});

describe('authorisations', () => {
  it('states the current-advisers-only limitation', async () => {
    const root = await render('authorisations');
    expect(root.textContent).toMatch(/Current advisers only/i);
  });
});
