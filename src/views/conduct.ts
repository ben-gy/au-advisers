// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Every disciplinary record here is ASIC's OWN entry against that adviser's own
// record on this register. Nothing is matched by name against any other list —
// see the About panel for why that matters.
//
// The licensee chart is a SCATTER against the denominator, not a league table,
// and that is a correctness decision rather than a stylistic one: "share of
// alumni later disciplined" is dominated by denominator size, so a ranked table
// hands the top spots to small firms with two unlucky years. Putting the
// denominator on the x axis and shading the zone where the numbers cannot
// support a conclusion makes that visible instead of hiding it.

import type { ViewCtx } from '../router.ts';
import { getConduct, getLicensees } from '../data.ts';
import { el, chartCard, svg, mark, describe, legend, niceTicks } from './svg.ts';
import { linear, log, vBars, finite } from './layout.ts';
import { num, pct, titleCase, esc } from '../format.ts';
import { CONDUCT_COLOR } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import { openLicensee } from '../licenseeDrawer.ts';

/** Below this many alumni, a percentage is noise. Shaded, not hidden. */
const LOW_N = 200;

export async function renderConduct({ root, meta }: ViewCtx): Promise<void> {
  const [conduct, licensees] = await Promise.all([getConduct(), getLicensees()]);

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Conduct'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    `ASIC has recorded ${num(meta.conduct.actions)} disciplinary actions against ${num(meta.conduct.advisers)} of the ` +
    `${num(meta.advisers)} people who have ever been on the register — ${pct(meta.conduct.advisers / meta.advisers, 2)}. ` +
    'A further ' + num(meta.conduct.cpdAdvisers) + ' have a reported training shortfall, which is a compliance ' +
    'matter and not a finding of misconduct.',
  ));
  const g = glossaryButton('da');
  if (g) p.appendChild(g);
  head.appendChild(p);
  root.appendChild(head);

  const caveat = el('div', 'note');
  caveat.innerHTML = `<strong>What this is and is not.</strong> Every record below is ASIC's own entry against an
    adviser's own registration. This site does <strong>not</strong> match names against ASIC's separate Banned and
    Disqualified Persons list, because that list has no adviser number and a name collision would attach somebody
    else's banning to a real named person. Nothing here is a rating of any adviser or firm.`;
  root.appendChild(caveat);

  // ── action types ──────────────────────────────────────
  const types = Object.entries(meta.conduct.byType).sort((a, b) => b[1] - a[1]);
  const c1 = chartCard('What kind of action', 'Disciplinary records on the register, by type.');
  const TW = 860;
  const rowH = 30;
  const TH = types.length * rowH + 8;
  const s1 = svg('svg', { viewBox: `0 0 ${TW} ${TH}`, width: '100%', height: TH, preserveAspectRatio: 'xMidYMid meet' });
  describe(s1, 'Ranked bars of ASIC disciplinary action types recorded on the register.');
  const tmax = types[0]?.[1] ?? 1;
  const labelW = 268;
  types.forEach(([label, count], i) => {
    const y = i * rowH + 4;
    const w = Math.max(2, (count / tmax) * (TW - labelW - 70));
    const r = svg('rect', { x: labelW, y, width: finite(w), height: rowH - 10, rx: 2, fill: CONDUCT_COLOR, 'fill-opacity': 0.85 });
    mark(r, `${label}\n${num(count)} records`);
    const lab = svg('text', { x: labelW - 8, y: y + rowH / 2 - 2, 'text-anchor': 'end', 'font-size': 11.5, fill: 'var(--text-primary)' });
    lab.textContent = label;
    const val = svg('text', { x: labelW + w + 7, y: y + rowH / 2 - 2, 'font-size': 11.5, fill: 'var(--text-secondary)' });
    val.textContent = num(count);
    s1.append(r, lab, val);
  });
  c1.body.appendChild(s1);
  root.appendChild(c1.card);

  // ── over time ─────────────────────────────────────────
  const years = Object.keys(meta.conduct.byYear).map(Number).filter((y) => y >= 2000 && y <= meta.asAtYear).sort();
  if (years.length) {
    const c2 = chartCard(
      'When action was taken',
      'Disciplinary actions by the year they began. The surge after 2018 follows the Hayne Royal Commission and ' +
      'the creation of the Financial Services and Credit Panel — it reflects enforcement activity, not necessarily ' +
      'when the underlying conduct happened.',
    );
    const YW = 860;
    const YH = 220;
    const ypad = { l: 44, r: 14, t: 12, b: 28 };
    const yiw = YW - ypad.l - ypad.r;
    const yih = YH - ypad.t - ypad.b;
    const vals = years.map((y) => meta.conduct.byYear[String(y)] ?? 0);
    const bars = vBars(vals, yiw, yih, 3);
    const ymax = Math.max(...vals);
    const s2 = svg('svg', { viewBox: `0 0 ${YW} ${YH}`, width: '100%', height: YH, preserveAspectRatio: 'xMidYMid meet' });
    describe(s2, 'Bar chart of ASIC disciplinary actions per year.');
    for (const t of niceTicks(ymax, 4)) {
      const yy = ypad.t + yih - (ymax > 0 ? (t / ymax) * yih : 0);
      s2.appendChild(svg('line', { class: 'gridline', x1: ypad.l, x2: ypad.l + yiw, y1: finite(yy), y2: finite(yy) }));
      const lab = svg('text', { x: ypad.l - 6, y: finite(yy) + 4, 'text-anchor': 'end', 'font-size': 10.5 });
      lab.textContent = num(t);
      s2.appendChild(lab);
    }
    bars.forEach((b, i) => {
      const r = svg('rect', {
        x: finite(ypad.l + b.x), y: finite(ypad.t + b.y), width: finite(b.w), height: finite(b.h),
        fill: CONDUCT_COLOR, rx: 1.5,
      });
      mark(r, `${years[i]}\n${num(vals[i])} disciplinary actions began`);
      s2.appendChild(r);
      if (years[i] % 4 === 0) {
        const lab = svg('text', { x: finite(ypad.l + b.x + b.w / 2), y: YH - 8, 'text-anchor': 'middle', 'font-size': 10.5 });
        lab.textContent = String(years[i]);
        s2.appendChild(lab);
      }
    });
    c2.body.appendChild(s2);
    root.appendChild(c2.card);
  }

  // ── the denominator-visible scatter ───────────────────
  const risk = conduct.risk.filter((r) => r.n >= 20);
  const c3 = chartCard(
    'Disciplinary history by licensee, with the denominator visible',
    'Each dot is one licensee. Horizontal position is how many advisers have ever worked there (log scale); ' +
    'vertical position is the share of them who carry an ASIC disciplinary record from any point in their career. ' +
    'A dot in the shaded band is based on too few people to mean anything.',
  );
  const BW = 900;
  const BH = 420;
  const bpad = { l: 54, r: 16, t: 16, b: 42 };
  const biw = BW - bpad.l - bpad.r;
  const bih = BH - bpad.t - bpad.b;
  const maxShare = Math.max(0.02, ...risk.map((r) => r.share));
  const sx = log([20, Math.max(...risk.map((r) => r.n), 100)], [bpad.l, bpad.l + biw], 20);
  const sy = linear([0, maxShare * 1.08], [bpad.t + bih, bpad.t]);

  const s3 = svg('svg', { viewBox: `0 0 ${BW} ${BH}`, width: '100%', height: BH, preserveAspectRatio: 'xMidYMid meet' });
  describe(s3, `Scatter of ${risk.length} licensees: alumni count against the share of alumni with a recorded ASIC disciplinary action.`);

  // The low-n curtain, drawn first so dots sit above it.
  const curtainX = finite(sx(LOW_N));
  s3.appendChild(svg('rect', {
    x: bpad.l, y: bpad.t, width: Math.max(0, curtainX - bpad.l), height: bih,
    fill: '#8896a4', 'fill-opacity': 0.13,
  }));
  const curtainLab = svg('text', { x: bpad.l + 8, y: bpad.t + 16, 'font-size': 10.5, fill: 'var(--text-tertiary)' });
  curtainLab.textContent = `fewer than ${LOW_N} alumni — percentages here are noise`;
  s3.appendChild(curtainLab);

  for (const t of niceTicks(maxShare * 1.08, 4)) {
    s3.appendChild(svg('line', { class: 'gridline', x1: bpad.l, x2: bpad.l + biw, y1: finite(sy(t)), y2: finite(sy(t)) }));
    const lab = svg('text', { x: bpad.l - 6, y: finite(sy(t)) + 4, 'text-anchor': 'end', 'font-size': 10.5 });
    lab.textContent = pct(t, 1);
    s3.appendChild(lab);
  }
  for (const t of [20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    if (t > (sx.domain[1] as number)) break;
    const x = finite(sx(t));
    const lab = svg('text', { x, y: BH - 22, 'text-anchor': 'middle', 'font-size': 10.5 });
    lab.textContent = num(t);
    s3.appendChild(lab);
  }
  const xTitle = svg('text', { x: bpad.l + biw / 2, y: BH - 6, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-secondary)' });
  xTitle.textContent = 'advisers who have ever worked there (log scale)';
  s3.appendChild(xTitle);

  // Every dot sits at its TRUE (alumni, share) position. Dodging dots apart —
  // the beeswarm treatment — is right for a 1-D distribution and wrong here:
  // it would move a licensee off the value being reported about it. The dense
  // band along the zero line is not a rendering problem, it is the finding
  // (most firms have no disciplined alumni at all), so it is drawn as a band.
  const xs = risk.map((r) => finite(sx(r.n)));
  const ys = risk.map((r) => finite(sy(r.share)));
  risk.forEach((r, i) => {
    const l = licensees[r.l];
    if (!l) return;
    const dot = svg('circle', {
      cx: xs[i], cy: ys[i], r: r.n >= LOW_N ? 4 : 3,
      fill: r.d > 0 ? CONDUCT_COLOR : '#8ea0ae',
      'fill-opacity': r.n >= LOW_N ? 0.82 : 0.42,
      stroke: '#fff', 'stroke-width': 0.8,
    });
    mark(dot, `${titleCase(l.name)}\n${num(r.n)} advisers ever worked there\n${num(r.d)} of them carry an ASIC disciplinary record (${pct(r.share, 2)})` +
      (r.n < LOW_N ? '\n\nToo few people for this percentage to mean much.' : ''), {
      label: `${titleCase(l.name)}, ${num(r.d)} of ${num(r.n)} alumni with a record`,
      onClick: () => void openLicensee(l.num),
    });
    s3.appendChild(dot);
  });
  c3.body.appendChild(s3);
  c3.body.appendChild(legend([
    { color: CONDUCT_COLOR, label: 'Has alumni with an ASIC record' },
    { color: '#8ea0ae', label: 'No alumni with a record' },
  ]));
  c3.body.appendChild(el('p', 'sub',
    'An adviser\'s disciplinary record is attached to them, not to the firm they were at when the conduct occurred — ' +
    'the register does not say where it happened. A dot high on this chart means a firm employed people who were ' +
    'disciplined at some point in their careers. It is not a finding about the firm.'));
  root.appendChild(c3.card);

  // ── largest firms table ───────────────────────────────
  const big = risk.filter((r) => r.n >= LOW_N).sort((a, b) => b.share - a.share);
  const c4 = chartCard(
    `Licensees with ${LOW_N}+ alumni`,
    'The same numbers as a table, restricted to firms large enough for the share to be meaningful. Sorted by share.',
  );
  const tbl = el('table');
  tbl.innerHTML = '<thead><tr><th>Licensee</th><th class="n">Advisers ever</th><th class="n">With an ASIC record</th><th class="n">Share</th></tr></thead>';
  const tb = el('tbody');
  for (const r of big.slice(0, 60)) {
    const l = licensees[r.l];
    if (!l) continue;
    const tr = el('tr', 'clickable-row');
    tr.tabIndex = 0;
    tr.innerHTML = `<td class="name-cell">${esc(titleCase(l.name))}</td><td class="n">${num(r.n)}</td>` +
      `<td class="n">${num(r.d)}</td><td class="n">${pct(r.share, 2)}</td>`;
    const open = () => void openLicensee(l.num);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
    });
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
  const w = el('div', 'tbl-wrap');
  w.appendChild(tbl);
  c4.body.appendChild(w);
  root.appendChild(c4.card);
}
