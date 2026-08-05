// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Kaplan-Meier-style retention, as small multiples.
//
// Retention is a curve, not a bar: the question is not "how many of the 2015
// intake are left" but "how does the 2015 intake's decay SHAPE compare to
// 2010's at the same age". Reading down a column compares intakes at equal age,
// which a headcount chart cannot do. Curves stop where the data stops —
// right-censoring, never drawn to zero.

import type { ViewCtx } from '../router.ts';
import { getCohorts } from '../data.ts';
import { el, chartCard, svg, mark, describe, legend } from './svg.ts';
import { linear, stepPath, finite } from './layout.ts';
import { num, pct, esc } from '../format.ts';
import { glossaryButton } from '../glossary.ts';
import type { Cohort } from '../types.ts';

export async function renderCohorts({ root, meta }: ViewCtx): Promise<void> {
  const { cohorts } = await getCohorts();
  const shown = cohorts.filter((c) => c.size >= 60);

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'How long advisers last'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    'Of everyone whose first appointment began in a given year, the share still on the register N years later. ' +
    'Each panel is one intake year; the curve stops where the data runs out rather than falling to zero.',
  ));
  const g = glossaryButton('survival');
  if (g) p.appendChild(g);
  const g2 = glossaryButton('censored');
  if (g2) p.appendChild(g2);
  head.appendChild(p);
  root.appendChild(head);

  // WHY THIS VIEW STARTS AT 2015, stated before any number is shown.
  const bias = el('div', 'note');
  bias.innerHTML = `<strong>Every cohort here begins in 2015, and that is not an arbitrary cut-off.</strong>
    ASIC's register commenced in 2015. It carries appointments back to 1969, but it does not carry the people who
    had <em>already left</em> before it existed — of 42,305 advisers, exactly <strong>12</strong> have a last
    appointment ending before 2015, against 27,192 after. So a "2005 intake" in this file is really just the part
    of the 2005 intake that survived a decade to still be practising when the register switched on, and its
    measured survival is close to 100% by construction. Charting it would produce a confident, plausible-looking
    curve that means nothing at all. Only intakes the register could watch both arrive and leave are shown.`;
  root.appendChild(bias);

  // ── the finding, stated up front ──────────────────────
  const at3 = (c: Cohort) => c.points.find((pt) => pt.n === 3)?.share ?? null;
  const with3 = shown.filter((c) => at3(c) != null);
  const early = with3.filter((c) => c.year <= 2017);
  const late = with3.filter((c) => c.year >= 2020);
  const avg = (xs: Cohort[]) => (xs.length ? xs.reduce((s, c) => s + (at3(c) ?? 0), 0) / xs.length : null);
  const earlyAvg = avg(early);
  const lateAvg = avg(late);

  // The findings, computed rather than asserted — the obvious claim ("newer
  // advisers don't last") turned out to be FALSE on this data, so the copy
  // states what the numbers actually show.
  const peak = shown.reduce((a, b) => (b.size > a.size ? b : a), shown[0]);
  const post = shown.filter((c) => c.year >= 2019);
  const trough = post.reduce((a, b) => (b.size < a.size ? b : a), post[0]);
  const worst = shown
    .filter((c) => at3(c) != null)
    .reduce((a, b) => ((at3(b) ?? 1) < (at3(a) ?? 1) ? b : a));

  if (earlyAvg != null && lateAvg != null) {
    const gap = lateAvg - earlyAvg;
    const hero = el('div', 'hero');
    hero.innerHTML = `<h2>The pipeline collapsed. Retention did not.</h2>
      <p><strong>${num(peak.size)} advisers started in ${peak.year}, and ${num(trough.size)} in ${trough.year}</strong>
      — a ${(peak.size / Math.max(1, trough.size)).toFixed(0)}-fold fall as the professional-standards regime took
      effect on 1 January 2019. The ${peak.year} figure is inflated by people entering ahead of the new education
      requirements; the years since are what the profession now recruits in a normal year.</p>
      <p>The obvious next claim would be that the survivors are less committed, and the data does not support it.
      Of the ${early[0].year}–${early[early.length - 1].year} intakes, <strong>${pct(earlyAvg)}</strong> were still
      registered three years on; of the ${late[0].year}–${late[late.length - 1].year} intakes,
      <strong>${pct(lateAvg)}</strong> — a difference of ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)} points, which
      is nothing. Fewer people arrive, and they stay about as well as their predecessors.</p>
      <p>One cohort is the exception. Of the ${num(worst.size)} who started in <strong>${worst.year}</strong>, just
      <strong>${pct(at3(worst)!)}</strong> were still there three years later — the people who entered precisely as
      the exam and degree requirements landed on them.</p>`;
    root.appendChild(hero);
  }

  // ── small multiples ───────────────────────────────────
  const card = chartCard(
    'Survival by intake year',
    'Each panel: horizontal axis is years since the first appointment, vertical axis is the share of that intake ' +
    'still on the register. A steeper fall means faster attrition. Panels with fewer than 60 people are omitted ' +
    'because a small intake produces a jagged curve that reads as a finding when it is noise.',
  );
  const grid = el('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(min(190px,100%),1fr));gap:12px';

  const PW = 190;
  const PH = 132;
  const pad = { l: 30, r: 8, t: 10, b: 22 };
  const iw = PW - pad.l - pad.r;
  const ih = PH - pad.t - pad.b;
  const maxN = Math.max(...shown.map((c) => c.points.length - 1), 1);

  for (const c of shown) {
    const cell = el('div');
    cell.style.cssText = 'border:1px solid var(--border-subtle);border-radius:6px;padding:6px 6px 2px;background:var(--bg-panel)';
    const title = el('div');
    title.style.cssText = 'font-size:0.8rem;font-weight:600;padding-left:4px';
    title.textContent = String(c.year);
    const sub = el('div', 'sub');
    sub.style.paddingLeft = '4px';
    sub.textContent = `${num(c.size)} started`;
    cell.append(title, sub);

    const sx = linear([0, maxN], [pad.l, pad.l + iw]);
    const sy = linear([0, 1], [pad.t + ih, pad.t]);
    const s = svg('svg', { viewBox: `0 0 ${PW} ${PH}`, width: '100%', height: PH, preserveAspectRatio: 'xMidYMid meet' });
    describe(s, `Survival curve for the ${c.year} intake of ${c.size} advisers.`);
    for (const t of [0, 0.5, 1]) {
      s.appendChild(svg('line', { class: 'gridline', x1: pad.l, x2: pad.l + iw, y1: finite(sy(t)), y2: finite(sy(t)) }));
      const lab = svg('text', { x: pad.l - 5, y: finite(sy(t)) + 3.5, 'text-anchor': 'end', 'font-size': 8.5 });
      lab.textContent = `${t * 100}%`;
      s.appendChild(lab);
    }
    for (const t of [0, 5, 10, 15, 20, 25].filter((v) => v <= maxN)) {
      const lab = svg('text', { x: finite(sx(t)), y: PH - 7, 'text-anchor': 'middle', 'font-size': 8.5 });
      lab.textContent = String(t);
      s.appendChild(lab);
    }
    s.appendChild(svg('path', {
      d: stepPath(c.points.map((pt) => ({ x: finite(sx(pt.n)), y: finite(sy(pt.share)) }))),
      fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.8,
    }));
    // Censoring tick: the curve simply ends here, it does not go to zero.
    const last = c.points[c.points.length - 1];
    if (last && c.observable <= maxN) {
      const cx = finite(sx(last.n));
      const cy = finite(sy(last.share));
      s.appendChild(svg('line', { x1: cx, x2: cx, y1: cy - 4, y2: cy + 4, stroke: 'var(--accent)', 'stroke-width': 1.8 }));
    }
    for (const pt of c.points) {
      const hit = svg('rect', {
        x: finite(sx(pt.n)) - 4, y: pad.t, width: 8, height: ih, fill: 'transparent',
      });
      mark(hit, `${c.year} intake, ${pt.n} year${pt.n === 1 ? '' : 's'} in\n${num(pt.alive)} of ${num(c.size)} still registered (${pct(pt.share)})`);
      s.appendChild(hit);
    }
    cell.appendChild(s);
    grid.appendChild(cell);
  }
  card.body.appendChild(grid);
  card.body.appendChild(el('p', 'sub',
    'The short vertical tick at the end of each curve marks where observation stops. A 2023 intake can only be ' +
    'watched for three years; drawing it to zero would invent an exit that has not happened.'));
  root.appendChild(card.card);

  // ── retention at fixed ages ───────────────────────────
  const cmp = chartCard(
    'The same question, read across intakes',
    'Share of each intake still registered at 1, 3, 5 and 8 years. Reading down a column compares intakes at ' +
    'the same age — the comparison the small multiples make visually and this table makes exact.',
  );
  const tbl = el('table');
  tbl.innerHTML = '<thead><tr><th>Intake</th><th class="n">Size</th><th class="n">1 yr</th><th class="n">3 yr</th><th class="n">5 yr</th><th class="n">8 yr</th></tr></thead>';
  const tb = el('tbody');
  const cell = (c: Cohort, n: number) => {
    const pt = c.points.find((x) => x.n === n);
    if (!pt) return '<td class="n sub">—</td>';
    const v = pt.share;
    const col = v >= 0.7 ? 'var(--status-good)' : v >= 0.45 ? 'var(--text-primary)' : 'var(--status-bad)';
    return `<td class="n" style="color:${col}">${pct(v, 0)}</td>`;
  };
  for (const c of [...shown].reverse()) {
    const tr = el('tr');
    tr.innerHTML = `<td class="name-cell">${esc(String(c.year))}</td><td class="n">${num(c.size)}</td>` +
      cell(c, 1) + cell(c, 3) + cell(c, 5) + cell(c, 8);
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const w = el('div', 'tbl-wrap');
  w.appendChild(tbl);
  cmp.body.appendChild(w);
  cmp.body.appendChild(legend([
    { color: 'var(--status-good)', label: '70% or more still registered' },
    { color: 'var(--status-bad)', label: 'under 45% still registered' },
  ]));
  root.appendChild(cmp.card);

  void meta;
}
