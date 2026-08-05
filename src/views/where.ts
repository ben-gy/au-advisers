// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The one choropleth on this site, on real ABS ASGS 2021 postal-area polygons.
//
// Rate, not raw count: a raw-count map of advisers just redraws the population
// map. And "no advisers at all" is a CATEGORY, not a low value — it is drawn in
// its own neutral tone so an empty postcode can never read as merely a quiet
// one. That absence is the actual finding for most of Australia.

import type { ViewCtx } from '../router.ts';
import { getGeography, getBoundaries, getLicensees } from '../data.ts';
import { el, chartCard, legend } from './svg.ts';
import { num, rate, titleCase, esc } from '../format.ts';
import { densityColor, NONE_COLOR, quantileBreaks, bandOf } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import { openOverlay, closeButton } from '../overlay.ts';
import { openLicensee } from '../licenseeDrawer.ts';
import type { GeoRow, Licensee } from '../types.ts';

export async function renderWhere({ root, meta }: ViewCtx): Promise<void> {
  const [geo, licensees] = await Promise.all([getGeography(), getLicensees()]);

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Where the advisers are'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    `${num(geo.coverage.mappedAdvisers)} currently registered advisers, mapped to the postcode of their business ` +
    'address on real ABS postal-area boundaries.',
  ));
  const g = glossaryButton('per10k');
  if (g) p.appendChild(g);
  head.appendChild(p);
  root.appendChild(head);

  const byPc = new Map(geo.advised.map((r) => [r.pc, r]));
  const withRate = geo.advised.filter((r) => r.per10k != null);
  const breaks = quantileBreaks(withRate.map((r) => r.per10k!), 7);

  // ── the finding ───────────────────────────────────────
  const emptyPop = geo.empty.reduce((s, e) => s + e.pop, 0);
  const hero = el('div', 'hero');
  hero.innerHTML = `<h2>Most of the country has nobody</h2>
    <p><strong>${num(geo.empty.length)} residential postcodes, home to about ${num(emptyPop)} people, have no
    registered financial adviser at all.</strong> Advisers cluster hard into capital-city business districts:
    the top ${num(Math.min(10, geo.advised.length))} postcodes alone hold
    ${num(geo.advised.slice(0, 10).reduce((s, r) => s + r.n, 0))} of them. On this map those empty postcodes are a
    category of their own, not a pale shade — "no advice available here" is a different statement from "not much".</p>`;
  root.appendChild(hero);

  const controls = el('div', 'controls');
  const seg = el('div', 'seg');
  const bRate = el('button', undefined, 'Per 10,000 residents') as HTMLButtonElement;
  const bCount = el('button', undefined, 'Adviser count') as HTMLButtonElement;
  bRate.type = 'button'; bCount.type = 'button';
  seg.append(bRate, bCount);
  controls.appendChild(seg);
  root.appendChild(controls);

  const card = chartCard(
    'Advisers by postcode',
    'Click any postcode for the firms operating there. Grey postcodes have residents but no registered adviser.',
  );
  const frame = el('div', 'map-frame');
  card.body.appendChild(frame);
  const legendHost = el('div');
  card.body.appendChild(legendHost);
  root.appendChild(card.card);

  let mode: 'rate' | 'count' = 'rate';
  const countBreaks = quantileBreaks(geo.advised.map((r) => r.n), 7);

  const paintLegend = () => {
    const b = mode === 'rate' ? breaks : countBreaks;
    legendHost.replaceChildren(legend([
      { color: NONE_COLOR, label: 'No registered adviser' },
      ...b.map((_v, i) => ({
        color: densityColor((i + 1) / (b.length + 1)),
        label: i === 0
          ? `under ${mode === 'rate' ? rate(b[0]) : num(Math.round(b[0]))}`
          : `${mode === 'rate' ? rate(b[i - 1]) : num(Math.round(b[i - 1]))}+`,
      })),
    ]));
  };

  const L = await import('leaflet');
  const boundaries = await getBoundaries();

  const map = L.map(frame, { preferCanvas: true, scrollWheelZoom: true, attributionControl: true })
    .setView([-27.5, 134], 4);
  // A fixed centre+zoom cuts the continent off at some aspect ratios (it did at
  // 1440x900). Frame the mainland explicitly instead, and let Leaflet pick the
  // zoom that actually fits the container it ended up with.
  const AU_BOUNDS = L.latLngBounds([-43.8, 112.5], [-10.2, 154.2]);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Boundaries: ABS ASGS 2021 (CC BY 4.0) · Advisers: ASIC (CC BY 3.0 AU)',
    subdomains: 'abcd', maxZoom: 16,
  }).addTo(map);

  const style = (pc: string) => {
    const row = byPc.get(pc);
    if (!row) return { fillColor: NONE_COLOR, fillOpacity: 0.65, color: '#ffffff', weight: 0.3 };
    const v = mode === 'rate' ? row.per10k : row.n;
    if (v == null) return { fillColor: NONE_COLOR, fillOpacity: 0.65, color: '#ffffff', weight: 0.3 };
    const b = mode === 'rate' ? breaks : countBreaks;
    const t = (bandOf(v, b) + 1) / (b.length + 1);
    return { fillColor: densityColor(t), fillOpacity: 0.82, color: '#ffffff', weight: 0.3 };
  };

  let layer: L.GeoJSON | null = null;
  const paint = () => {
    if (layer) { layer.remove(); layer = null; }
    layer = L.geoJSON(boundaries as never, {
      style: (f) => style(String((f as GeoJSON.Feature).properties?.poa_code_2021 ?? '')),
      onEachFeature: (f, lyr) => {
        const pc = String(f.properties?.poa_code_2021 ?? '');
        const row = byPc.get(pc);
        const popRow = geo.empty.find((e) => e.pc === pc);
        const label = row
          ? `<strong>Postcode ${esc(pc)}</strong><br>${num(row.n)} adviser${row.n === 1 ? '' : 's'}<br>` +
            (row.per10k != null ? `${rate(row.per10k)} per 10,000 residents<br>` : '') +
            (row.pop ? `population ${num(row.pop)}` : 'no census population')
          : `<strong>Postcode ${esc(pc)}</strong><br>No registered adviser` +
            (popRow ? `<br>population ${num(popRow.pop)}` : '');
        // Every polygon gets a hover tooltip, including the empty ones.
        lyr.bindTooltip(label, { sticky: true });
        if (row) lyr.on('click', () => openPostcode(row, licensees, meta));
      },
    }).addTo(map);
  };
  paint();
  paintLegend();

  const setMode = (m: 'rate' | 'count') => {
    mode = m;
    bRate.setAttribute('aria-pressed', String(m === 'rate'));
    bCount.setAttribute('aria-pressed', String(m === 'count'));
    paint();
    paintLegend();
  };
  bRate.addEventListener('click', () => setMode('rate'));
  bCount.addEventListener('click', () => setMode('count'));
  setMode('rate');

  // Leaflet measures its container once, at construction — before CSS has
  // necessarily settled the frame's final width. A single requestAnimationFrame
  // is not enough: it fired while the container was still full-bleed, so the
  // map kept a zoom fitted to a box 480px wider than the one it ended up in.
  // Observe the frame instead and refit whenever its size actually changes,
  // which also handles the browser being resized after load.
  let lastW = 0;
  let lastH = 0;
  const refit = () => {
    const r = frame.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (Math.abs(r.width - lastW) < 2 && Math.abs(r.height - lastH) < 2) return;
    lastW = r.width;
    lastH = r.height;
    map.invalidateSize({ animate: false });
    map.fitBounds(AU_BOUNDS, { padding: [6, 6], animate: false });
  };
  const ro = new ResizeObserver(refit);
  ro.observe(frame);
  refit();
  // The observer must not outlive the view, or it keeps a dead map alive.
  const stop = () => { ro.disconnect(); map.remove(); window.removeEventListener('hashchange', stop); };
  window.addEventListener('hashchange', stop);

  // ── honesty panel ─────────────────────────────────────
  const cov = geo.coverage;
  const honesty = el('div', 'note');
  honesty.innerHTML = `<strong>What this map cannot show.</strong>
    ${num(cov.mappedAdvisers)} of ${num(meta.currentAppointments)} current appointments are placed here.
    ${num(cov.unmappableAdvisers)} are not: ${num(cov.poBox.reduce((s, x) => s + x.n, 0))} give a PO-box or
    large-volume-receiver postcode (${cov.poBox.slice(0, 6).map((x) => esc(x.pc)).join(', ')}${cov.poBox.length > 6 ? '…' : ''}),
    which ABS does not publish as an area because nobody lives in it, and
    ${num(cov.malformed.reduce((s, x) => s + x.n, 0))} rows in ASIC's own file have a state abbreviation
    (${cov.malformed.map((x) => esc(x.pc)).join(', ')}) where the postcode should be.
    ${num(cov.noPostcode)} have no address at all. None of them are dropped from any other view.
    <br><br>This is <strong>current advisers only</strong>: business addresses exist for 99.8% of current
    appointments but only about a third of ceased ones, so a historical map would chart where ASIC happens to
    hold an address rather than where advisers were. Populations are 2021 Census, the finest geography ABS
    publishes population for; adviser counts are current at ${esc(meta.asAt)}.`;
  root.appendChild(honesty);

  // ── leaderboards ──────────────────────────────────────
  const board = chartCard(
    'Best and least served',
    `Postcodes with at least 2,000 residents, ranked by advisers per 10,000 people. Click a row for the firms there.`,
  );
  const big = geo.advised.filter((r) => (r.pop ?? 0) >= 2000 && r.per10k != null);
  const grid = el('div', 'grid grid-2');
  grid.append(
    boardTable('Most advisers per resident', [...big].sort((a, b) => b.per10k! - a.per10k!).slice(0, 15), licensees, meta),
    boardTable('Fewest advisers per resident', [...big].sort((a, b) => a.per10k! - b.per10k!).slice(0, 15), licensees, meta),
  );
  board.body.appendChild(grid);
  root.appendChild(board.card);

  // ── by state ──────────────────────────────────────────
  const st = chartCard('By state', 'Current advisers by the state of their business address.');
  const stTbl = el('table');
  stTbl.innerHTML = '<thead><tr><th>State</th><th class="n">Advisers</th><th class="n">Share</th></tr></thead>';
  const stBody = el('tbody');
  const stTotal = Object.values(meta.byState).reduce((s, v) => s + v, 0);
  for (const [k, v] of Object.entries(meta.byState).sort((a, b) => b[1] - a[1])) {
    const tr = el('tr');
    tr.innerHTML = `<td class="name-cell">${esc(k)}</td><td class="n">${num(v)}</td><td class="n">${((v / stTotal) * 100).toFixed(1)}%</td>`;
    stBody.appendChild(tr);
  }
  stTbl.appendChild(stBody);
  const stw = el('div', 'tbl-wrap');
  stw.appendChild(stTbl);
  st.body.appendChild(stw);
  root.appendChild(st.card);
}

function boardTable(title: string, rows: GeoRow[], licensees: Licensee[], meta: ViewCtx['meta']): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('h3', undefined, esc(title))).setAttribute('style', 'font-size:0.88rem;margin-bottom:6px');
  const tbl = el('table');
  tbl.innerHTML = '<thead><tr><th>Postcode</th><th class="n">Advisers</th><th class="n">Per 10k</th></tr></thead>';
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr', 'clickable-row');
    tr.tabIndex = 0;
    tr.innerHTML = `<td class="name-cell">${esc(r.pc)} <span class="sub">${esc(r.state)}</span></td>` +
      `<td class="n">${num(r.n)}</td><td class="n">${rate(r.per10k)}</td>`;
    const open = () => openPostcode(r, licensees, meta);
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
  wrap.appendChild(w);
  return wrap;
}

function openPostcode(row: GeoRow, licensees: Licensee[], meta: ViewCtx['meta']): void {
  openOverlay({
    panelClass: 'drawer',
    label: `Postcode ${row.pc}`,
    lockScroll: true,
    build: (panel, close) => {
      const head = el('div', 'drawer-head');
      const t = el('div');
      t.style.cssText = 'flex:1;min-width:0';
      t.appendChild(el('h3', undefined, `Postcode ${esc(row.pc)}`));
      t.appendChild(el('div', 'sub', `${esc(row.state)} · ${num(row.n)} registered adviser${row.n === 1 ? '' : 's'}`));
      head.append(t, closeButton(close, 'Close postcode details'));

      const body = el('div', 'drawer-body');
      const tiles = el('div', 'tiles');
      tiles.style.gridTemplateColumns = 'repeat(auto-fit,minmax(min(140px,100%),1fr))';
      const mk = (v: string, k: string) => {
        const d = el('div', 'tile');
        d.appendChild(el('div', 'v', esc(v)));
        d.appendChild(el('div', 'k', esc(k)));
        return d;
      };
      tiles.append(
        mk(num(row.n), 'Advisers'),
        mk(row.pop ? num(row.pop) : '—', 'Residents (2021)'),
        mk(rate(row.per10k), 'Per 10,000'),
      );
      body.appendChild(tiles);

      const sec = el('div', 'dossier-section');
      sec.appendChild(el('h4', undefined, 'Licensees operating here'));
      const ul = el('div');
      for (const item of row.lics) {
        const l = licensees[item.l];
        if (!l) continue;
        const b = el('button', 'btn') as HTMLButtonElement;
        b.style.cssText = 'display:flex;width:100%;justify-content:space-between;gap:10px;text-align:left;margin-bottom:4px';
        b.innerHTML = `<span>${esc(titleCase(l.name))}</span><strong>${num(item.c)}</strong>`;
        b.addEventListener('click', () => void openLicensee(l.num));
        ul.appendChild(b);
      }
      sec.appendChild(ul);
      if (row.lics.length >= 12) {
        sec.appendChild(el('p', 'sub', 'Showing the twelve licensees with the most advisers in this postcode.'));
      }
      body.appendChild(sec);
      body.appendChild(el('p', 'sub',
        `Counts are advisers whose business address is in this postcode, current at ${esc(meta.asAt)}. ` +
        'An adviser may serve clients well beyond it.'));
      panel.append(head, body);
    },
  });
}
