// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The signature view. A streamgraph of adviser headcount by ultimate owner,
// rebuilt by replaying every appointment's date range against the ownership
// chain that was valid on that date.
//
// A stacked bar chart would hide the thing that matters: the independent band
// THICKENS as the five bank/AMP bands collapse. Composition of a changing total
// is exactly what a streamgraph is for.
//
// The dated/naive toggle is not a curiosity — it renders the site's correctness
// guard as a feature, and shows that the correction is not uniform.

import type { ViewCtx } from '../router.ts';
import { getSeries } from '../data.ts';
import { el, chartCard, svg, mark, legend, describe } from './svg.ts';
import { stack, linear, areaPath, finite } from './layout.ts';
import { num, pct, esc } from '../format.ts';
import { ownerColor, INDEPENDENT_COLOR } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import type { SeriesRow, OwnerId } from '../types.ts';

/** Dates ASIC's own file records as the moment a controlling link ended. Every
 *  one of these is read out of a [Date Ceased] marker, not from a news story. */
const EVENTS: { year: number; label: string }[] = [
  { year: 2018, label: 'ANZ advice sold (Oct 2018)' },
  { year: 2019, label: 'CBA / Count sold (Oct 2019)' },
  { year: 2023, label: 'NAB / MLC (Aug 2023) · Westpac (Nov 2023)' },
  { year: 2024, label: 'AMP advice → Entireti (Dec 2024)' },
];

export async function renderRetreat({ root, meta }: ViewCtx): Promise<void> {
  const series = await getSeries();
  let mode: 'dated' | 'naive' = 'dated';

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'The bank retreat, dated'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    'Advisers on the register at 30 June each year, banded by the corporate group that ultimately controlled ' +
    'their licensee at that time. Bands are counted per owner, so an adviser authorised by two licensees at ' +
    'once appears in both; the total counts them once.',
  ));
  const g = glossaryButton('vertical');
  if (g) p.appendChild(g);
  head.appendChild(p);
  root.appendChild(head);

  const controls = el('div', 'controls');
  const seg = el('div', 'seg');
  const bDated = el('button', undefined, 'Dated (correct)') as HTMLButtonElement;
  const bNaive = el('button', undefined, 'Naive (wrong)') as HTMLButtonElement;
  bDated.type = 'button'; bNaive.type = 'button';
  seg.append(bDated, bNaive);
  controls.appendChild(seg);
  const gg = glossaryButton('dated');
  if (gg) controls.appendChild(gg);
  root.appendChild(controls);

  const explain = el('div', 'note');
  root.appendChild(explain);

  const cardWrap = el('div');
  root.appendChild(cardWrap);

  const draw = () => {
    bDated.setAttribute('aria-pressed', String(mode === 'dated'));
    bNaive.setAttribute('aria-pressed', String(mode === 'naive'));
    explain.innerHTML = mode === 'dated'
      ? `<strong>Dated counting.</strong> An appointment only counts toward an owner if it began while that
         owner still controlled the licensee. This is the correct reading and gives
         <strong>${num(meta.headline.alumniDated)}</strong> bank and AMP alumni in total.`
      : `<strong>Naive counting — shown so you can see the error.</strong> The register writes today's ownership
         chain onto every historical row, so counting any mention of an owner sweeps in advisers who left before
         that owner ever arrived. It inflates the alumni total to <strong>${num(meta.headline.alumniNaive)}</strong>,
         adding <strong>${num(meta.headline.phantom)} people who were never there</strong>.`;

    const rows: SeriesRow[] = mode === 'dated' ? series.dated : series.naive;
    cardWrap.replaceChildren(buildStream(rows, meta, mode));
  };

  bDated.addEventListener('click', () => { mode = 'dated'; draw(); });
  bNaive.addEventListener('click', () => { mode = 'naive'; draw(); });
  draw();

  // ── the per-owner correction table ────────────────────
  const c = chartCard(
    'Where the correction bites',
    'The dating rule is not a uniform haircut. It removes hundreds of advisers from CBA, ANZ and AMP and ' +
    'exactly none from NAB or Westpac — because those two groups\' cease dates fall after their advisers\' ' +
    'appointments began. A check written only against NAB or Westpac would pass on an implementation with the ' +
    'date logic deleted entirely, which is why the test suite asserts the rule specifically where it bites.',
  );
  const tbl = el('table');
  tbl.innerHTML = `<thead><tr><th>Owner group</th><th class="n">Naive alumni</th><th class="n">Dated alumni</th><th class="n">Phantoms removed</th></tr></thead>`;
  const tb = el('tbody');
  for (const o of meta.owners) {
    const row = meta.headline.perOwner[o.id as OwnerId];
    const diff = row.naive - row.dated;
    const tr = el('tr');
    tr.innerHTML = `<td class="name-cell"><span class="legend-swatch" style="display:inline-block;background:${ownerColor(o.id)};margin-right:7px"></span>${esc(o.label)}</td>` +
      `<td class="n">${num(row.naive)}</td><td class="n">${num(row.dated)}</td>` +
      `<td class="n" style="color:${diff > 0 ? 'var(--status-bad)' : 'var(--text-muted)'}">${diff > 0 ? `−${num(diff)}` : '0'}</td>`;
    tb.appendChild(tr);
  }
  const tot = el('tr');
  tot.style.fontWeight = '600';
  tot.innerHTML = `<td>All five (de-duplicated)</td><td class="n">${num(meta.headline.alumniNaive)}</td>` +
    `<td class="n">${num(meta.headline.alumniDated)}</td><td class="n" style="color:var(--status-bad)">−${num(meta.headline.phantom)}</td>`;
  tb.appendChild(tot);
  tbl.appendChild(tb);
  const wrap = el('div', 'tbl-wrap');
  wrap.appendChild(tbl);
  c.body.appendChild(wrap);
  root.appendChild(c.card);
}

function buildStream(rows: SeriesRow[], meta: ViewCtx['meta'], mode: string): HTMLElement {
  const c = chartCard(
    mode === 'dated' ? 'Adviser headcount by ultimate owner' : 'Adviser headcount by ultimate owner — naive count',
    'Each band is one corporate group; the pale band is everyone else. Hover any year for the exact split.',
  );
  const W = 940;
  const H = 400;
  // t leaves room for TWO staggered rows of event labels above the plot.
  const pad = { l: 56, r: 14, t: 36, b: 42 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const keys: (OwnerId | 'independent')[] = [...meta.owners.map((o) => o.id as OwnerId), 'independent'];
  const matrix = keys.map((k) => rows.map((r) => Number(r[k]) || 0));
  const stacked = stack(matrix, 'wiggle');
  const extent = stacked.reduce((m, band) => {
    for (const p of band) m = Math.max(m, Math.abs(p.y0), Math.abs(p.y1));
    return m;
  }, 1);

  const sx = linear([rows[0].year, rows[rows.length - 1].year], [pad.l, pad.l + iw]);
  const sy = linear([-extent, extent], [pad.t + ih, pad.t]);

  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(s, `Streamgraph of adviser headcount by owning corporate group from ${rows[0].year} to ${rows[rows.length - 1].year}. The five bank and AMP bands collapse to near nothing while the independent band grows.`);

  // Event rules first, so bands paint over their lower half and the labels sit clear.
  for (const ev of EVENTS) {
    if (ev.year < rows[0].year || ev.year > rows[rows.length - 1].year) continue;
    const x = finite(sx(ev.year));
    s.appendChild(svg('line', { x1: x, x2: x, y1: pad.t, y2: pad.t + ih, stroke: 'var(--border-strong)', 'stroke-dasharray': '3 3' }));
  }

  keys.forEach((k, i) => {
    const color = k === 'independent' ? INDEPENDENT_COLOR : ownerColor(k);
    const label = k === 'independent' ? 'Independent / other' : meta.owners.find((o) => o.id === k)!.label;
    const path = svg('path', {
      d: areaPath(rows.map((r) => r.year), stacked[i], sx, sy),
      fill: color, stroke: 'rgba(255,255,255,0.55)', 'stroke-width': 0.5,
    });
    const peak = rows.reduce((a, b) => ((Number(b[k]) || 0) > (Number(a[k]) || 0) ? b : a));
    mark(path, `${label}\npeak ${num(Number(peak[k]) || 0)} advisers in ${peak.year}\nnow ${num(Number(rows[rows.length - 1][k]) || 0)}`);
    s.appendChild(path);
  });

  // Hover columns give exact per-year splits for every band at once.
  const colW = iw / rows.length;
  rows.forEach((r, i) => {
    const tip = [`${r.year} — ${num(r.total)} advisers`]
      .concat(meta.owners.map((o) => `${o.label}: ${num(Number(r[o.id]) || 0)}`))
      .concat([`Independent / other: ${num(r.independent)}`])
      .join('\n');
    const hit = svg('rect', { x: finite(pad.l + i * colW), y: pad.t, width: Math.max(1, colW), height: ih, fill: 'transparent' });
    mark(hit, tip);
    s.appendChild(hit);
  });

  for (const r of rows) {
    if (r.year % 4 !== 0 && r.year !== rows[rows.length - 1].year) continue;
    const lab = svg('text', { x: finite(sx(r.year)), y: H - 24, 'text-anchor': 'middle', 'font-size': 11 });
    lab.textContent = String(r.year);
    s.appendChild(lab);
  }
  // Event labels sit only a few years apart and WILL collide if they are all
  // drawn on one line — 2018/2019 and 2023/2024 overprinted each other into
  // unreadable mush. Lay them out left to right, dropping to a second line
  // whenever the previous label's measured extent would overlap this one.
  const visible = EVENTS.filter((ev) => ev.year >= rows[0].year && ev.year <= rows[rows.length - 1].year);
  const CHAR_W = 5.2;
  const rowEnds = [-Infinity, -Infinity];
  for (const ev of visible) {
    const text = ev.label.split(' (')[0];
    const halfW = (text.length * CHAR_W) / 2;
    const x = finite(sx(ev.year));
    // First line that this label clears; otherwise the one with more room.
    let line = rowEnds.findIndex((end) => x - halfW > end + 6);
    if (line === -1) line = rowEnds[0] <= rowEnds[1] ? 0 : 1;
    rowEnds[line] = x + halfW;
    const y = pad.t - 6 - (1 - line) * 11;
    const lab = svg('text', {
      x, y, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--text-tertiary)',
    });
    lab.textContent = text;
    s.appendChild(lab);
    // A short leader so a label on the upper line is still tied to its rule.
    if (line === 0) {
      s.appendChild(svg('line', {
        x1: x, x2: x, y1: y + 3, y2: pad.t, stroke: 'var(--border-default)', 'stroke-width': 0.7,
      }));
    }
  }
  const scaleNote = svg('text', { x: pad.l, y: H - 6, 'font-size': 10.5, fill: 'var(--text-muted)' });
  scaleNote.textContent = `band thickness = advisers; full height ≈ ${num(Math.round(extent * 2))} advisers`;
  s.appendChild(scaleNote);

  c.body.appendChild(s);
  c.body.appendChild(legend([
    ...meta.owners.map((o) => ({ color: ownerColor(o.id), label: o.label })),
    { color: INDEPENDENT_COLOR, label: 'Independent / other' },
  ]));

  const last = rows[rows.length - 1];
  const first = rows.find((r) => r.year === 2015) ?? rows[0];
  const fiveTotal = (r: SeriesRow) => meta.owners.reduce((s2, o) => s2 + (Number(r[o.id]) || 0), 0);
  const note = el('div', 'note');
  note.innerHTML = `In ${first.year} the five groups between them accounted for <strong>${num(fiveTotal(first))}</strong>
    adviser appointments — ${pct(fiveTotal(first) / Math.max(1, first.total))} of the register. By ${last.year} that is
    <strong>${num(fiveTotal(last))}</strong>, or ${pct(fiveTotal(last) / Math.max(1, last.total))}.`;
  c.body.appendChild(note);
  return c.card;
}
