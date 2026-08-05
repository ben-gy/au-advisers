// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// "Check my financial adviser" — the query this site exists to answer.
//
// All 42,305 people are searchable, including everyone who has left, because
// the common real-world case is a letter or a statement from years ago. Search
// is debounced and runs over a pre-lowercased index so typing stays smooth on
// a phone.

import type { ViewCtx } from '../router.ts';
import { getAdvisers, getLicensees } from '../data.ts';
import { el, chartCard, svg, mark, describe, emptyState } from './svg.ts';
import { histogram, vBars, finite } from './layout.ts';
import { num, pct, titleCase, personName, esc } from '../format.ts';
import { CONDUCT_COLOR, ownerColor } from '../colors.ts';
import { openAdviser } from '../dossier.ts';
import { glossaryButton } from '../glossary.ts';

const PAGE = 60;

export async function renderExplorer({ root, meta, params }: ViewCtx): Promise<void> {
  const [adv, licensees] = await Promise.all([getAdvisers(), getLicensees()]);
  const total = adv.n.length;

  // Pre-lowercased haystack, built once.
  const hay = adv.name.map((n) => n.toLowerCase());

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Find an adviser'));
  head.appendChild(el('p', undefined,
    `Search all ${num(total)} people who have ever been on the register — including the ` +
    `${num(total - meta.currentAdvisers)} who are no longer on it. Type a name or an adviser number.`));
  root.appendChild(head);

  // ── controls ──────────────────────────────────────────
  const controls = el('div', 'controls');
  const search = el('input') as HTMLInputElement;
  search.type = 'search';
  search.className = 'search-wide';
  search.placeholder = 'Name or adviser number…';
  search.setAttribute('aria-label', 'Search advisers by name or number');
  controls.appendChild(search);

  const status = el('select') as HTMLSelectElement;
  status.setAttribute('aria-label', 'Filter by registration status');
  status.innerHTML = '<option value="">Any status</option><option value="cur">Currently registered</option><option value="past">No longer registered</option>';
  controls.appendChild(status);

  const stateSel = el('select') as HTMLSelectElement;
  stateSel.setAttribute('aria-label', 'Filter by state');
  stateSel.innerHTML = '<option value="">Any state</option>' +
    meta.states.filter(Boolean).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  controls.appendChild(stateSel);

  const ownerSel = el('select') as HTMLSelectElement;
  ownerSel.setAttribute('aria-label', 'Filter by former owner group');
  ownerSel.innerHTML = '<option value="">Any background</option>' +
    meta.owners.map((o, i) => `<option value="${i}">Worked under ${esc(o.label)}</option>`).join('') +
    '<option value="da">Has an ASIC disciplinary record</option>';
  controls.appendChild(ownerSel);
  const gg = glossaryButton('da');
  if (gg) controls.appendChild(gg);
  root.appendChild(controls);

  const pills = el('div', 'controls');
  root.appendChild(pills);

  // ── the click-to-filter histogram ─────────────────────
  const histCard = chartCard(
    'How long careers last',
    'Every adviser by the number of years between their first and last recorded appointment. Click a bar to ' +
    'filter the table below to that group.',
  );
  root.appendChild(histCard.card);

  const summary = el('div', 'sub');
  summary.style.margin = '4px 0 8px';
  root.appendChild(summary);

  const tableHost = el('div');
  root.appendChild(tableHost);

  const moreHost = el('div');
  moreHost.style.cssText = 'display:flex;justify-content:center;padding:12px';
  root.appendChild(moreHost);

  // Career length in years, from the index (fy is first-advice year).
  const nowY = meta.asAtYear;
  const spanYears = adv.fy.map((fy) => (fy && fy > 1900 ? Math.max(0, nowY - fy) : NaN));

  let binFilter: number | null = null;
  let shown = PAGE;
  const bins = histogram(spanYears.filter((v) => Number.isFinite(v)), 14);

  const matches = (): number[] => {
    const q = search.value.trim().toLowerCase();
    const st = status.value;
    const state = stateSel.value;
    const own = ownerSel.value;
    const out: number[] = [];
    for (let i = 0; i < total; i++) {
      if (q && !hay[i].includes(q) && !adv.n[i].includes(q)) continue;
      if (st === 'cur' && !adv.cur[i]) continue;
      if (st === 'past' && adv.cur[i]) continue;
      if (state && meta.states[adv.st[i]] !== state) continue;
      if (own === 'da') { if (!adv.da[i]) continue; }
      else if (own !== '') { if (!(adv.own[i] & (1 << Number(own)))) continue; }
      if (binFilter != null) {
        const v = spanYears[i];
        const b = bins[binFilter];
        if (!Number.isFinite(v)) continue;
        const isLast = binFilter === bins.length - 1;
        if (!(v >= b.lo && (isLast ? v <= b.hi : v < b.hi))) continue;
      }
      out.push(i);
    }
    return out;
  };

  const drawHist = (result: number[]) => {
    const W = 880;
    const H = 190;
    const pad = { l: 46, r: 14, t: 12, b: 34 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const counts = bins.map((b) => b.n);
    const bars = vBars(counts, iw, ih, 3);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
    describe(s, 'Histogram of adviser career length in years; click a bar to filter the table.');
    bars.forEach((b, i) => {
      const active = binFilter === i;
      const r = svg('rect', {
        x: finite(pad.l + b.x), y: finite(pad.t + b.y), width: finite(b.w), height: finite(b.h),
        rx: 2, fill: active ? 'var(--accent)' : '#8fa8bd', 'fill-opacity': binFilter == null || active ? 0.95 : 0.35,
      });
      const lo = Math.round(bins[i].lo);
      const hi = Math.round(bins[i].hi);
      mark(r, `${lo}–${hi} years on the register\n${num(counts[i])} advisers (${pct(counts[i] / Math.max(1, total))})\n\nClick to filter the table`, {
        label: `${lo} to ${hi} years, ${num(counts[i])} advisers`,
        onClick: () => { binFilter = binFilter === i ? null : i; shown = PAGE; draw(); },
      });
      s.appendChild(r);
      if (i % 3 === 0) {
        const lab = svg('text', { x: finite(pad.l + b.x + b.w / 2), y: H - 12, 'text-anchor': 'middle', 'font-size': 10.5 });
        lab.textContent = String(lo);
        s.appendChild(lab);
      }
    });
    const xt = svg('text', { x: pad.l + iw / 2, y: H - 1, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--text-muted)' });
    xt.textContent = 'years since first giving advice';
    s.appendChild(xt);
    histCard.body.replaceChildren(s);
    void result;
  };

  const drawPills = () => {
    pills.replaceChildren();
    if (binFilter != null) {
      const b = bins[binFilter];
      const pill = el('span', 'pill');
      pill.appendChild(document.createTextNode(`${Math.round(b.lo)}–${Math.round(b.hi)} years`));
      const x = el('button', undefined, '✕') as HTMLButtonElement;
      x.setAttribute('aria-label', 'Clear the career-length filter');
      x.addEventListener('click', () => { binFilter = null; shown = PAGE; draw(); });
      pill.appendChild(x);
      pills.appendChild(pill);
    }
  };

  const drawTable = (result: number[]) => {
    if (!result.length) {
      tableHost.replaceChildren(emptyState('No adviser matches those filters. Try a shorter search — the register stores names as ASIC received them.'));
      moreHost.replaceChildren();
      return;
    }
    const tbl = el('table');
    tbl.innerHTML = '<thead><tr><th>Name</th><th>Status</th><th>Licensee</th><th>Location</th><th class="n">Since</th><th class="n">Roles</th></tr></thead>';
    const tb = el('tbody');
    for (const i of result.slice(0, shown)) {
      const tr = el('tr', 'clickable-row');
      tr.tabIndex = 0;
      const lic = licensees[adv.lic[i]];
      const ownBits = meta.owners.map((o, oi) => (adv.own[i] & (1 << oi)) ? o : null).filter(Boolean);
      const daBadge = adv.da[i]
        ? `<span class="badge badge-conduct" style="margin-left:6px">ASIC action</span>` : '';
      tr.innerHTML =
        `<td class="name-cell">${esc(personName(adv.name[i]))}${daBadge}` +
        `<div class="sub" style="font-family:var(--font-mono)">${esc(adv.n[i])}</div></td>` +
        `<td>${adv.cur[i] ? '<span class="badge badge-current">current</span>' : '<span class="badge badge-ceased">ceased</span>'}</td>` +
        `<td>${esc(titleCase(lic?.name ?? '—')).slice(0, 44)}` +
        (ownBits.length ? `<div class="sub">${ownBits.map((o) => `<span style="color:${ownerColor(o!.id)}">${esc(o!.label)}</span>`).join(' · ')}</div>` : '') +
        `</td>` +
        `<td>${esc(adv.pc[i] || '')} ${esc(meta.states[adv.st[i]] ?? '')}</td>` +
        `<td class="n">${adv.fy[i] || '—'}</td>` +
        `<td class="n">${num(adv.apps[i])}</td>`;
      const open = () => void openAdviser(i);
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
    tableHost.replaceChildren(w);

    moreHost.replaceChildren();
    if (result.length > shown) {
      const b = el('button', 'btn', `Show more (${num(result.length - shown)} remaining)`) as HTMLButtonElement;
      b.addEventListener('click', () => { shown += PAGE * 4; draw(); });
      moreHost.appendChild(b);
    }
  };

  const draw = () => {
    const result = matches();
    summary.textContent = `${num(result.length)} of ${num(total)} advisers match` +
      (result.length > shown ? ` · showing the first ${num(shown)}` : '');
    drawPills();
    drawHist(result);
    drawTable(result);
  };

  let t: ReturnType<typeof setTimeout> | null = null;
  const debounced = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { shown = PAGE; draw(); }, 300);
  };
  search.addEventListener('input', debounced);
  for (const s of [status, stateSel, ownerSel]) {
    s.addEventListener('change', () => { shown = PAGE; draw(); });
  }

  const q = params.get('q');
  if (q) search.value = q;
  draw();

  void CONDUCT_COLOR;
}
