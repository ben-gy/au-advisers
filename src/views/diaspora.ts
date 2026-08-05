// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// "My old firm no longer exists — where did its people go?"
//
// A Sankey answers that for ONE firm without asking the reader to interpret a
// network graph. The terminal "left the register" band is not decoration: for
// most dissolved licensees it is the largest single destination, and omitting
// it would turn an industry contraction into a story about firms poaching.

import type { ViewCtx } from '../router.ts';
import { getMovements, getLicensees } from '../data.ts';
import { el, chartCard, svg, mark, describe, legend, emptyState } from './svg.ts';
import { sankeyBands, ribbonPath, finite } from './layout.ts';
import { num, pct, date, titleCase, esc } from '../format.ts';
import { ownerColor, EXIT_COLOR, INDEPENDENT_COLOR } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import { openLicensee } from '../licenseeDrawer.ts';
import { goto } from '../router.ts';
import type { Licensee } from '../types.ts';

export async function renderDiaspora({ root, meta, params }: ViewCtx): Promise<void> {
  const [movements, licensees] = await Promise.all([getMovements(), getLicensees()]);

  // Firms worth offering: those enough people actually left.
  const outflow = new Map<number, number>();
  for (const e of movements.all) outflow.set(e.f, (outflow.get(e.f) ?? 0) + e.c);
  const candidates = [...outflow.entries()]
    .filter(([, c]) => c >= 20)
    .sort((a, b) => b[1] - a[1])
    .map(([i]) => i);

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Where did my adviser\'s firm go?'));
  head.appendChild(el('p', undefined,
    'Pick a licensee and follow its advisers to wherever they went next — including out of the industry ' +
    'altogether. Flows are people, counted from the order of their appointments.'));
  root.appendChild(head);

  const controls = el('div', 'controls');
  const sel = el('select') as HTMLSelectElement;
  sel.className = 'search-wide';
  sel.setAttribute('aria-label', 'Choose a licensee');
  sel.innerHTML = candidates.map((i) => {
    const l = licensees[i];
    return `<option value="${esc(l.num)}">${esc(titleCase(l.name))} — ${num(outflow.get(i) ?? 0)} departures${l.alive ? '' : ' (closed)'}</option>`;
  }).join('');
  controls.appendChild(sel);
  const gg = glossaryButton('exitnode');
  if (gg) controls.appendChild(gg);
  root.appendChild(controls);

  const wrap = el('div');
  root.appendChild(wrap);

  const initial = params.get('lic');
  if (initial && candidates.some((i) => licensees[i].num === initial)) sel.value = initial;

  const draw = () => {
    const idx = licensees.findIndex((l) => l.num === sel.value);
    wrap.replaceChildren(build(idx, movements, licensees, meta));
  };
  sel.addEventListener('change', () => {
    draw();
    goto('diaspora', { lic: sel.value });
  });
  draw();
}

function build(
  idx: number,
  movements: Awaited<ReturnType<typeof getMovements>>,
  licensees: Licensee[],
  meta: ViewCtx['meta'],
): HTMLElement {
  if (idx < 0) return emptyState('Choose a licensee above.');
  const src = licensees[idx];
  const edges = movements.all.filter((e) => e.f === idx).sort((a, b) => b.c - a.c);
  if (!edges.length) return emptyState('No onward moves are recorded for this licensee.');

  const total = edges.reduce((s, e) => s + e.c, 0);
  const exited = edges.find((e) => e.t === -2)?.c ?? 0;
  const named = edges.filter((e) => e.t >= 0);

  // Keep the top destinations legible; aggregate the rest honestly.
  const TOP = 14;
  const shown = named.slice(0, TOP);
  const restCount = named.slice(TOP).reduce((s, e) => s + e.c, 0);
  const restFirms = named.length - shown.length;

  const targets = shown.map((e) => ({
    label: titleCase(licensees[e.t].name), value: e.c, ref: e.t,
  }));
  if (restCount > 0) targets.push({ label: `${restFirms} other firms`, value: restCount, ref: -3 });
  if (exited > 0) targets.push({ label: 'Left the register', value: exited, ref: -2 });

  const card = chartCard(
    `${titleCase(src.name)} — where its advisers went`,
    `${num(total)} recorded departures. Ribbon thickness is people. Click any destination to open that firm.`,
  );

  const W = 900;
  const rowH = 30;
  const H = Math.max(220, targets.length * rowH + 40);
  const pad = { t: 16, b: 16 };
  const ih = H - pad.t - pad.b;
  const srcX = 190;
  const dstX = 470;

  const bands = sankeyBands(targets, ih, 3);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(s, `Flow diagram: ${num(total)} advisers leaving ${titleCase(src.name)} for ${targets.length} destinations.`);

  // Source column
  const srcRect = svg('rect', {
    x: srcX - 16, y: pad.t, width: 16, height: ih, rx: 2,
    fill: ownerColor(src.ownerLive ? src.owner : null),
  });
  mark(srcRect, `${titleCase(src.name)}\n${num(total)} advisers left over time\n${num(src.current)} still here`);
  s.appendChild(srcRect);
  const srcLab = svg('text', { x: srcX - 24, y: pad.t + ih / 2, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 600, fill: 'var(--text-primary)' });
  srcLab.textContent = titleCase(src.name).slice(0, 24);
  s.appendChild(srcLab);
  const srcSub = svg('text', { x: srcX - 24, y: pad.t + ih / 2 + 14, 'text-anchor': 'end', 'font-size': 10.5, fill: 'var(--text-muted)' });
  srcSub.textContent = src.alive ? `${num(src.current)} advisers today` : `closed ${date(src.last)}`;
  s.appendChild(srcSub);

  for (const b of bands) {
    const isExit = b.ref === -2;
    const isRest = b.ref === -3;
    const dest = b.ref >= 0 ? licensees[b.ref] : null;
    const color = isExit ? EXIT_COLOR : isRest ? '#b9c6d1' : ownerColor(dest?.ownerLive ? dest.owner : null);
    const path = svg('path', {
      d: ribbonPath(srcX, dstX, { ...b, y0: b.y0 + pad.t, y1: b.y1 + pad.t, sy0: b.sy0 + pad.t, sy1: b.sy1 + pad.t }),
      fill: color, 'fill-opacity': isExit ? 0.4 : 0.55,
    });
    const tip = `${b.label}\n${num(b.value)} advisers (${pct(b.value / total)} of departures)` +
      (isExit ? '\nThese advisers ended their last appointment and never returned to the register.' : '');
    if (dest) {
      mark(path, tip, { label: `${b.label}, ${num(b.value)} advisers`, onClick: () => void openLicensee(dest.num) });
    } else {
      mark(path, tip);
    }
    s.appendChild(path);

    const bar = svg('rect', {
      x: dstX, y: finite(b.y0 + pad.t), width: 11, height: Math.max(1, finite(b.y1 - b.y0)), rx: 2,
      fill: color, 'fill-opacity': isExit ? 0.75 : 1,
    });
    if (dest) mark(bar, tip, { label: `${b.label}, ${num(b.value)} advisers`, onClick: () => void openLicensee(dest.num) });
    else mark(bar, tip);
    s.appendChild(bar);

    const lab = svg('text', {
      x: dstX + 18, y: finite(b.y0 + pad.t + (b.y1 - b.y0) / 2) + 4, 'font-size': 11.5,
      fill: isExit ? 'var(--text-secondary)' : 'var(--text-primary)',
      'font-style': isExit || isRest ? 'italic' : 'normal',
    });
    lab.textContent = `${b.label.slice(0, 44)} — ${num(b.value)}`;
    s.appendChild(lab);
  }

  card.body.appendChild(s);
  card.body.appendChild(legend([
    ...meta.owners.map((o) => ({ color: ownerColor(o.id), label: `${o.label}-owned destination` }))
      .filter((_, i) => named.slice(0, TOP).some((e) => licensees[e.t].ownerLive && licensees[e.t].owner === meta.owners[i].id)),
    { color: INDEPENDENT_COLOR, label: 'Independent destination' },
    { color: EXIT_COLOR, label: 'Left the register' },
  ]));

  const note = el('div', 'note');
  if (exited > 0) {
    note.innerHTML = `<strong>${num(exited)} of the ${num(total)} advisers who left ${esc(titleCase(src.name))}
      (${pct(exited / total)}) left the register altogether</strong> rather than joining another firm.` +
      (exited >= (shown[0]?.c ?? 0)
        ? ' That is more than went to any single other licensee — which is why this view draws leaving as a destination in its own right.'
        : '');
  } else {
    note.textContent = 'Every recorded departure from this licensee went on to another firm.';
  }
  card.body.appendChild(note);
  return card.card;
}
