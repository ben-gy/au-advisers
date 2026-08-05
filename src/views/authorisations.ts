// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Which kinds of advice you can actually still get.
//
// The matrix is SERIATED — rows and columns ordered by similarity so blocks of
// co-occurring authorisations emerge. Alphabetical order actively destroys that
// structure, which is the only thing this matrix exists to show.

import type { ViewCtx } from '../router.ts';
import { getAuthorisations } from '../data.ts';
import { el, chartCard, svg, mark, describe, legend, niceTicks } from './svg.ts';
import { seriate, finite } from './layout.ts';
import { num, pct, esc } from '../format.ts';
import { densityColor } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';

export async function renderAuthorisations({ root, meta }: ViewCtx): Promise<void> {
  const auth = await getAuthorisations();

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'What advice you can actually get'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    `The register records which classes of financial product each adviser may advise on. Across the ` +
    `${num(auth.base)} current appointments, some authorisations are near-universal and others have all but ` +
    `disappeared from the profession.`,
  ));
  const g = glossaryButton('authorisation');
  if (g) p.appendChild(g);
  head.appendChild(p);
  root.appendChild(head);

  const caveat = el('div', 'note');
  caveat.innerHTML = `<strong>Current advisers only.</strong> Authorisation flags are blank on every ceased row in
    ASIC's file — the register does not retain what a departed adviser was once authorised for. So this view can
    show what the profession looks like now, and how it differs by intake generation, but it cannot show an
    authorisation being withdrawn over time. Anything claiming otherwise would be invented.`;
  root.appendChild(caveat);

  // ── prevalence ────────────────────────────────────────
  const ranked = auth.keys
    .map((k) => ({ k, label: meta.authLabels[k] ?? k, n: auth.totals[k] ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);

  const c1 = chartCard(
    'How common each authorisation is',
    `Share of the ${num(auth.base)} current adviser appointments authorised for each product class.`,
  );
  const W = 880;
  const rowH = 21;
  const H = ranked.length * rowH + 10;
  const labelW = 290;
  const s1 = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(s1, 'Ranked bars showing the share of current advisers holding each product authorisation.');
  ranked.forEach((r, i) => {
    const y = i * rowH + 3;
    const share = r.n / Math.max(1, auth.base);
    const w = Math.max(1.5, share * (W - labelW - 76));
    const rect = svg('rect', { x: labelW, y, width: finite(w), height: rowH - 7, rx: 2, fill: densityColor(Math.min(0.99, share)) });
    mark(rect, `${r.label}\n${num(r.n)} of ${num(auth.base)} current advisers (${pct(share)})`);
    const lab = svg('text', { x: labelW - 8, y: y + rowH / 2 + 1, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-primary)' });
    lab.textContent = r.label;
    const val = svg('text', { x: labelW + w + 6, y: y + rowH / 2 + 1, 'font-size': 10.5, fill: 'var(--text-secondary)' });
    val.textContent = `${pct(share, 0)} · ${num(r.n)}`;
    s1.append(rect, lab, val);
  });
  c1.body.appendChild(s1);
  root.appendChild(c1.card);

  // ── the seriated matrix ───────────────────────────────
  const states = Object.keys(auth.stateTotals).filter((s) => auth.stateTotals[s] > 0);
  const cols = ranked.filter((r) => r.n >= auth.base * 0.005).slice(0, 30);
  const matrix = states.map((st) => cols.map((c) => {
    const denom = auth.stateTotals[st] || 1;
    return (auth.byState[st]?.[c.k] ?? 0) / denom;
  }));
  const rowOrder = seriate(matrix);
  const colOrder = seriate(cols.map((_, ci) => states.map((_st, si) => matrix[si][ci])));

  const c2 = chartCard(
    'Authorisations by state, ordered by similarity',
    'Cell shade is the share of that state\'s current advisers holding that authorisation. Rows and columns are ' +
    'ordered so similar profiles sit together — blocks emerging here mean groups of authorisations that travel ' +
    'together, which alphabetical ordering would scatter.',
  );
  const CW = Math.max(560, 150 + colOrder.length * 26);
  const CH = 60 + rowOrder.length * 30;
  const cellW = 26;
  const cellH = 30;
  const mLeft = 62;
  const mTop = 120;
  const s2 = svg('svg', { viewBox: `0 0 ${CW} ${CH + mTop}`, width: CW, height: CH + mTop });
  describe(s2, `Heatmap of ${states.length} states against ${cols.length} product authorisations, shaded by share of current advisers.`);
  colOrder.forEach((ci, x) => {
    const c = cols[ci];
    const lab = svg('text', {
      x: mLeft + x * cellW + cellW / 2, y: mTop - 8, 'font-size': 10.5, fill: 'var(--text-secondary)',
      transform: `rotate(-58 ${mLeft + x * cellW + cellW / 2} ${mTop - 8})`, 'text-anchor': 'start',
    });
    lab.textContent = c.label.slice(0, 30);
    s2.appendChild(lab);
  });
  rowOrder.forEach((ri, y) => {
    const st = states[ri];
    const lab = svg('text', { x: mLeft - 8, y: mTop + y * cellH + cellH / 2 + 4, 'text-anchor': 'end', 'font-size': 11.5, fill: 'var(--text-primary)' });
    lab.textContent = `${st} (${num(auth.stateTotals[st])})`;
    s2.appendChild(lab);
    colOrder.forEach((ci, x) => {
      const v = matrix[ri][ci];
      const rect = svg('rect', {
        x: mLeft + x * cellW, y: mTop + y * cellH, width: cellW - 1.5, height: cellH - 1.5, rx: 2,
        fill: densityColor(v),
      });
      mark(rect, `${st} — ${cols[ci].label}\n${num(auth.byState[st]?.[cols[ci].k] ?? 0)} of ${num(auth.stateTotals[st])} advisers (${pct(v)})`);
      s2.appendChild(rect);
      if (cellW > 22) {
        const t = svg('text', {
          x: mLeft + x * cellW + (cellW - 1.5) / 2, y: mTop + y * cellH + cellH / 2 + 3.5,
          'text-anchor': 'middle', 'font-size': 9, 'pointer-events': 'none',
          fill: v > 0.55 ? '#fff' : 'var(--text-secondary)',
        });
        t.textContent = `${Math.round(v * 100)}`;
        s2.appendChild(t);
      }
    });
  });
  c2.body.appendChild(s2);
  c2.body.appendChild(legend(
    [0.05, 0.25, 0.5, 0.75, 0.95].map((t) => ({ color: densityColor(t), label: `${Math.round(t * 100)}%` })),
  ));
  root.appendChild(c2.card);

  // ── by intake generation ──────────────────────────────
  const decades = Object.keys(auth.byCohort).map(Number).sort();
  if (decades.length > 1) {
    const interesting = ranked.filter((r) => {
      const vals = decades.map((d) => (auth.byCohort[String(d)][r.k] ?? 0) / Math.max(1, auth.byCohort[String(d)].n));
      return Math.max(...vals) - Math.min(...vals) > 0.12;
    }).slice(0, 8);

    if (interesting.length) {
      const c3 = chartCard(
        'The generational split',
        'Share of currently-practising advisers holding each authorisation, grouped by the decade they first gave ' +
        'advice. Where the lines diverge, older and newer advisers are authorised for genuinely different work — ' +
        'this compares generations of advisers who are all still practising, not change over time.',
      );
      const GW = 880;
      const GH = 300;
      const gpad = { l: 48, r: 190, t: 14, b: 32 };
      const giw = GW - gpad.l - gpad.r;
      const gih = GH - gpad.t - gpad.b;
      const s3 = svg('svg', { viewBox: `0 0 ${GW} ${GH}`, width: '100%', height: GH, preserveAspectRatio: 'xMidYMid meet' });
      describe(s3, 'Line chart comparing authorisation prevalence across intake decades of currently-practising advisers.');
      for (const t of niceTicks(1, 4)) {
        const y = gpad.t + gih - t * gih;
        s3.appendChild(svg('line', { class: 'gridline', x1: gpad.l, x2: gpad.l + giw, y1: finite(y), y2: finite(y) }));
        const lab = svg('text', { x: gpad.l - 6, y: finite(y) + 4, 'text-anchor': 'end', 'font-size': 10.5 });
        lab.textContent = pct(t, 0);
        s3.appendChild(lab);
      }
      decades.forEach((d, i) => {
        const x = gpad.l + (decades.length > 1 ? (i / (decades.length - 1)) * giw : giw / 2);
        const lab = svg('text', { x: finite(x), y: GH - 10, 'text-anchor': 'middle', 'font-size': 10.5 });
        lab.textContent = `${d}s`;
        s3.appendChild(lab);
        const sub = svg('text', { x: finite(x), y: GH - 22, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--text-muted)' });
        sub.textContent = `n=${num(auth.byCohort[String(d)].n)}`;
        s3.appendChild(sub);
      });
      interesting.forEach((r, si) => {
        const pts = decades.map((d, i) => {
          const c = auth.byCohort[String(d)];
          const share = (c[r.k] ?? 0) / Math.max(1, c.n);
          return {
            x: gpad.l + (decades.length > 1 ? (i / (decades.length - 1)) * giw : giw / 2),
            y: gpad.t + gih - share * gih,
            share, d, n: c[r.k] ?? 0, tot: c.n,
          };
        });
        const color = densityColor(0.25 + (si / Math.max(1, interesting.length - 1)) * 0.7);
        s3.appendChild(svg('path', {
          d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${finite(p.x).toFixed(1)},${finite(p.y).toFixed(1)}`).join(''),
          fill: 'none', stroke: color, 'stroke-width': 2,
        }));
        for (const p of pts) {
          const dot = svg('circle', { cx: finite(p.x), cy: finite(p.y), r: 3.5, fill: color });
          mark(dot, `${r.label}\n${p.d}s intake: ${num(p.n)} of ${num(p.tot)} (${pct(p.share)})`);
          s3.appendChild(dot);
        }
        const lastPt = pts[pts.length - 1];
        const lab = svg('text', { x: finite(lastPt.x) + 8, y: finite(lastPt.y) + 4, 'font-size': 10.5, fill: 'var(--text-primary)' });
        lab.textContent = r.label.slice(0, 28);
        s3.appendChild(lab);
      });
      c3.body.appendChild(s3);
      root.appendChild(c3.card);
    }
  }

  const foot = el('div', 'note');
  foot.innerHTML = `Two encodings share one row in ASIC's file: every <code>FIN_*</code> and <code>CLASSES_*</code>
    column is 1/0, while tax (financial) advice alone is Y/N. Treating them uniformly would silently read every
    "Y" as false — the pipeline handles them separately and the tests pin that behaviour.`;
  root.appendChild(foot);
  void esc;
}
