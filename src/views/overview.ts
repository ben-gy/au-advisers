// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { ViewCtx } from '../router.ts';
import { getSeries, getCohorts, getLicensees } from '../data.ts';
import { el, chartCard, svg, mark, legend, describe, niceTicks } from './svg.ts';
import { linear, linePath, vBars, finite } from './layout.ts';
import { num, pct, date, titleCase, esc } from '../format.ts';
import { ownerColor, INDEPENDENT_COLOR, CONDUCT_COLOR } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import { goto } from '../router.ts';
import { openLicensee } from '../licenseeDrawer.ts';

function tile(value: string, key: string, note?: string, glossKey?: string): HTMLElement {
  const t = el('div', 'tile');
  t.appendChild(el('div', 'v', esc(value)));
  const k = el('div', 'k');
  k.appendChild(document.createTextNode(key));
  if (glossKey) {
    const g = glossaryButton(glossKey);
    if (g) k.appendChild(g);
  }
  t.appendChild(k);
  if (note) t.appendChild(el('div', 'n', esc(note)));
  return t;
}

export async function renderOverview({ root, meta }: ViewCtx): Promise<void> {
  const [series, cohortData, licensees] = await Promise.all([getSeries(), getCohorts(), getLicensees()]);
  const h = meta.headline;

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Who advises Australia'));
  head.appendChild(el('p', undefined,
    `Every person who has ever been on ASIC's Financial Advisers Register — ${num(meta.advisers)} people, ` +
    `${num(meta.appointments)} appointments, ${num(meta.licensees)} licensees. Current at ${date(meta.asAt)}.`));
  root.appendChild(head);

  // ── the headline ──────────────────────────────────────
  const hero = el('div', 'hero');
  hero.innerHTML = `
    <h2>The banks left. Their advisers didn't.</h2>
    <p>Between 2018 and 2026 all four major banks and AMP sold or shut their financial advice arms.
    <strong>${num(h.underLiveChain)}</strong> of Australia's ${num(meta.currentAdvisers)} current advisers now sit under
    a live ownership chain belonging to any of the five — down from thousands.</p>
    <p>But the people did not leave with the owners. <strong>${num(h.alumniStillPractising)} advisers still
    practising today — ${pct(h.alumniShareOfCurrent)} of the entire profession — spent part of their career inside a
    bank or AMP advice business that no longer exists.</strong> The vertically integrated model was dismantled;
    the advisers it trained are still advising.</p>`;
  root.appendChild(hero);

  const tiles = el('div', 'tiles');
  tiles.append(
    tile(num(meta.currentAdvisers), 'Advising today', `of ${num(meta.advisers)} ever registered`),
    tile(pct(h.alumniShareOfCurrent, 1), 'Are bank/AMP alumni', `${num(h.alumniStillPractising)} people`, 'vertical'),
    tile(num(h.underLiveChain), 'Still bank/AMP owned', 'live ownership chain', 'chain'),
    tile(num(meta.transitions), 'Recorded job moves', `${num(meta.exits)} left the register`, 'exitnode'),
    tile(num(meta.conduct.advisers), 'With ASIC action', `${num(meta.conduct.actions)} actions recorded`, 'da'),
    tile(num(h.phantom), 'Phantom advisers', 'removed by dating the chain', 'dated'),
  );
  root.appendChild(tiles);

  // ── headcount over time ───────────────────────────────
  const dated = series.dated;
  const W = 900;
  const H = 300;
  const pad = { l: 54, r: 16, t: 14, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxTotal = Math.max(...dated.map((d) => d.total));
  const sx = linear([dated[0].year, dated[dated.length - 1].year], [pad.l, pad.l + iw]);
  const sy = linear([0, maxTotal * 1.05], [pad.t + ih, pad.t]);

  const c1 = chartCard(
    'The profession, 1999 to now',
    'Advisers on the register at 30 June each year. The peak and the collapse either side of the 2019 professional-standards reforms is the single biggest change in the register\'s history.',
  );
  const s1 = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(s1, `Line chart of total advisers on the register from ${dated[0].year} to ${dated[dated.length - 1].year}, peaking and then falling by about half.`);
  for (const t of niceTicks(maxTotal * 1.05, 5)) {
    s1.appendChild(svg('line', { class: 'gridline', x1: pad.l, x2: pad.l + iw, y1: finite(sy(t)), y2: finite(sy(t)) }));
    const lab = svg('text', { x: pad.l - 8, y: finite(sy(t)) + 4, 'text-anchor': 'end', 'font-size': 11 });
    lab.textContent = num(t);
    s1.appendChild(lab);
  }
  for (const d of dated) {
    if (d.year % 5 !== 0 && d.year !== dated[dated.length - 1].year) continue;
    const lab = svg('text', { x: finite(sx(d.year)), y: H - 10, 'text-anchor': 'middle', 'font-size': 11 });
    lab.textContent = String(d.year);
    s1.appendChild(lab);
  }
  s1.appendChild(svg('path', {
    d: linePath(dated.map((d) => ({ x: finite(sx(d.year)), y: finite(sy(d.total)) }))),
    fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2,
  }));
  const peak = dated.reduce((a, b) => (b.total > a.total ? b : a));
  s1.appendChild(svg('circle', { cx: finite(sx(peak.year)), cy: finite(sy(peak.total)), r: 4, fill: 'var(--accent)' }));
  const peakLab = svg('text', { x: finite(sx(peak.year)), y: finite(sy(peak.total)) - 12, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: 'var(--text-primary)' });
  peakLab.textContent = `peak ${num(peak.total)} (${peak.year})`;
  s1.appendChild(peakLab);
  for (const d of dated) {
    const dot = svg('rect', {
      x: finite(sx(d.year)) - 6, y: pad.t, width: 12, height: ih, fill: 'transparent',
    });
    mark(dot, `${d.year}\n${num(d.total)} advisers on the register\n${num(d.independent)} not bank or AMP owned`);
    s1.appendChild(dot);
  }
  c1.body.appendChild(s1);
  root.appendChild(c1.card);

  // ── entries vs exits ──────────────────────────────────
  const flow = cohortData.flow.filter((f) => f.year >= 2000 && f.year <= meta.asAtYear);
  const c2 = chartCard(
    'Who arrived, who left',
    'New advisers joining the register against advisers leaving it, by year. The register has run net-negative every year since 2019 — the story is as much about who stopped arriving as about who left.',
  );
  const FW = 900;
  const FH = 260;
  const fpad = { l: 54, r: 16, t: 14, b: 30 };
  const fiw = FW - fpad.l - fpad.r;
  const fih = FH - fpad.t - fpad.b;
  const fmax = Math.max(...flow.map((f) => Math.max(f.entries, f.exits)));
  const half = fih / 2;
  const s2 = svg('svg', { viewBox: `0 0 ${FW} ${FH}`, width: '100%', height: FH, preserveAspectRatio: 'xMidYMid meet' });
  describe(s2, 'Butterfly chart of advisers entering the register above the axis and leaving below, by year.');
  const colW = fiw / flow.length;
  const mid = fpad.t + half;
  flow.forEach((f, i) => {
    const x = fpad.l + i * colW;
    const bw = Math.max(1, colW - 2);
    const eh = fmax > 0 ? (f.entries / fmax) * half : 0;
    const xh = fmax > 0 ? (f.exits / fmax) * half : 0;
    const rIn = svg('rect', { x: finite(x), y: finite(mid - eh), width: bw, height: finite(eh), fill: '#3f6b8a', rx: 1 });
    mark(rIn, `${f.year}\n${num(f.entries)} advisers started\n${num(f.exits)} advisers left\nnet ${f.entries - f.exits >= 0 ? '+' : ''}${num(f.entries - f.exits)}`);
    const rOut = svg('rect', { x: finite(x), y: mid, width: bw, height: finite(xh), fill: '#a8613f', rx: 1 });
    mark(rOut, `${f.year}\n${num(f.exits)} advisers left\n${num(f.entries)} advisers started\nnet ${f.entries - f.exits >= 0 ? '+' : ''}${num(f.entries - f.exits)}`);
    s2.append(rIn, rOut);
    if (f.year % 5 === 0) {
      const lab = svg('text', { x: finite(x + bw / 2), y: FH - 8, 'text-anchor': 'middle', 'font-size': 11 });
      lab.textContent = String(f.year);
      s2.appendChild(lab);
    }
  });
  s2.appendChild(svg('line', { x1: fpad.l, x2: fpad.l + fiw, y1: mid, y2: mid, stroke: 'var(--border-strong)' }));
  const upLab = svg('text', { x: fpad.l - 8, y: fpad.t + 12, 'text-anchor': 'end', 'font-size': 11 });
  upLab.textContent = 'joined';
  const dnLab = svg('text', { x: fpad.l - 8, y: fpad.t + fih - 2, 'text-anchor': 'end', 'font-size': 11 });
  dnLab.textContent = 'left';
  s2.append(upLab, dnLab);
  c2.body.appendChild(s2);
  c2.body.appendChild(legend([
    { color: '#3f6b8a', label: 'Started advising' },
    { color: '#a8613f', label: 'Left the register' },
  ]));
  root.appendChild(c2.card);

  // ── biggest licensees now ─────────────────────────────
  const top = licensees.filter((l) => l.current > 0).sort((a, b) => b.current - a.current).slice(0, 18);
  const c3 = chartCard(
    'The biggest licensees today',
    'Advisers currently authorised, by licensee. Click any bar for that firm\'s full ownership chain and adviser history.',
  );
  const BW = 900;
  const rowH = 26;
  const BH = top.length * rowH + 12;
  const labelW = 250;
  const s3 = svg('svg', { viewBox: `0 0 ${BW} ${BH}`, width: '100%', height: BH, preserveAspectRatio: 'xMidYMid meet' });
  describe(s3, 'Ranked bar chart of the largest licensees by current adviser count.');
  const bmax = top[0]?.current ?? 1;
  const bars = vBars([], 0, 0); // (keep the import honest; horizontal bars below)
  void bars;
  top.forEach((l, i) => {
    const y = i * rowH + 4;
    const w = Math.max(1, (l.current / bmax) * (BW - labelW - 70));
    const r = svg('rect', { x: labelW, y, width: finite(w), height: rowH - 8, rx: 2, fill: ownerColor(l.ownerLive ? l.owner : null) });
    mark(r, `${titleCase(l.name)}\n${num(l.current)} advisers now\n${num(l.total)} ever\nUltimate owner: ${l.ultimate ? titleCase(l.ultimate) : 'none recorded'}`, {
      label: `${titleCase(l.name)}, ${num(l.current)} current advisers`,
      onClick: () => void openLicensee(l.num),
    });
    const lab = svg('text', { x: labelW - 8, y: y + rowH / 2 - 1, 'text-anchor': 'end', 'font-size': 11.5, fill: 'var(--text-primary)' });
    lab.textContent = titleCase(l.name).slice(0, 38);
    const val = svg('text', { x: labelW + w + 7, y: y + rowH / 2 - 1, 'font-size': 11.5, fill: 'var(--text-secondary)' });
    val.textContent = num(l.current);
    s3.append(r, lab, val);
  });
  c3.body.appendChild(s3);
  c3.body.appendChild(legend([
    { color: ownerColor(null), label: 'Independent / other owner' },
    ...meta.owners.filter((o) => top.some((l) => l.ownerLive && l.owner === o.id))
      .map((o) => ({ color: ownerColor(o.id), label: `${o.label}-owned` })),
  ]));
  root.appendChild(c3.card);

  // ── what to read next ─────────────────────────────────
  const next = el('div', 'card');
  const nb = el('div', 'card-body');
  nb.innerHTML = `<h2 style="font-size:1rem;margin-bottom:6px">Where to go next</h2>`;
  const links: [string, string, string][] = [
    ['explorer', 'Look up an adviser', 'Search all ' + num(meta.advisers) + ' people by name or adviser number and read their whole career.'],
    ['retreat', 'Watch the banks leave', 'The dated streamgraph, with a toggle that shows the phantom advisers appear and disappear.'],
    ['movements', 'Follow the people', num(meta.transitions) + ' recorded moves between licensees, with an explicit exit node.'],
    ['where', 'Find advisers near you', 'Advisers per 10,000 residents by postcode, on real ABS boundaries.'],
  ];
  const list = el('div', 'grid grid-2');
  for (const [view, title, blurb] of links) {
    const a = el('button', 'btn') as HTMLButtonElement;
    a.style.textAlign = 'left';
    a.style.height = 'auto';
    a.style.padding = '12px 14px';
    a.innerHTML = `<strong>${esc(title)}</strong><br><span class="sub">${esc(blurb)}</span>`;
    a.addEventListener('click', () => goto(view));
    list.appendChild(a);
  }
  nb.appendChild(list);
  next.appendChild(nb);
  root.appendChild(next);

  // Colour reminder so CONDUCT_COLOR/INDEPENDENT_COLOR stay meaningful here too.
  void CONDUCT_COLOR;
  void INDEPENDENT_COLOR;
}
