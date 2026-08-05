// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// One person, one page. This is the landing page for "check my financial
// adviser", so it is written for somebody with no background at all — and it
// reports what the register says, in the register's own terms, without ranking
// or scoring anybody.

import { openOverlay, closeButton } from './overlay.ts';
import { getAdvisers, getLicensees, getMeta, getAdviserDetail } from './data.ts';
import { el, svg, mark, describe, legend } from './views/svg.ts';
import { careerLanes, linear, finite } from './views/layout.ts';
import { num, date, duration, titleCase, personName, esc, yearFraction } from './format.ts';
import { ownerColor, CONDUCT_COLOR } from './colors.ts';
import { glossaryButton } from './glossary.ts';
import { openLicensee } from './licenseeDrawer.ts';
import type { Appointment, AdviserExtra, Licensee, Meta } from './types.ts';

export async function openAdviserByNumber(advNumber: string): Promise<void> {
  const adv = await getAdvisers();
  const i = adv.n.indexOf(advNumber);
  if (i < 0) return;
  await openAdviser(i);
}

export async function openAdviser(i: number): Promise<void> {
  const [adv, licensees, meta] = await Promise.all([getAdvisers(), getLicensees(), getMeta()]);
  const { apps, extra } = await getAdviserDetail(i);

  openOverlay({
    panelClass: 'drawer',
    label: `${personName(adv.name[i])} — adviser record`,
    lockScroll: true,
    build: (panel, close) => {
      const head = el('div', 'drawer-head');
      const t = el('div');
      t.style.cssText = 'flex:1;min-width:0';
      t.appendChild(el('h3', undefined, esc(personName(adv.name[i]))));
      const sub = el('div', 'sub');
      sub.innerHTML = `Adviser number <span style="font-family:var(--font-mono)">${esc(adv.n[i])}</span> · ` +
        (adv.cur[i]
          ? '<span class="badge badge-current">Currently registered</span>'
          : '<span class="badge badge-ceased">No current appointment</span>');
      t.appendChild(sub);
      head.append(t, closeButton(close, 'Close adviser record'));

      const body = el('div', 'drawer-body');
      body.appendChild(summary(adv, i, licensees, apps, meta));
      body.appendChild(ribbon(apps, licensees, meta));
      body.appendChild(history(apps, licensees, meta));
      if (extra) body.appendChild(credentials(extra, meta));
      body.appendChild(provenance(meta));
      panel.append(head, body);
    },
  });
}

function section(title: string, glossKey?: string): HTMLElement {
  const s = el('div', 'dossier-section');
  const h = el('h4');
  h.appendChild(document.createTextNode(title));
  if (glossKey) {
    const g = glossaryButton(glossKey);
    if (g) h.appendChild(g);
  }
  s.appendChild(h);
  return s;
}

function summary(
  adv: Awaited<ReturnType<typeof getAdvisers>>, i: number,
  licensees: Licensee[], apps: Appointment[], meta: Meta,
): HTMLElement {
  const s = section('At a glance');
  const cur = apps.filter((a) => !a.e);
  const dl = el('dl', 'kv');
  const add = (k: string, v: string) => {
    dl.appendChild(el('dt', undefined, esc(k)));
    dl.appendChild(el('dd', undefined, v));
  };
  add('First gave advice', adv.fy[i] ? String(adv.fy[i]) : '—');
  add('On the register since', date(apps[0]?.s ?? null));
  if (cur.length) {
    add('Currently authorised by', cur.map((a) => `<strong>${esc(titleCase(licensees[a.l]?.name ?? '—'))}</strong>`).join('<br>'));
  } else {
    const last = apps[apps.length - 1];
    add('Last appointment ended', date(last?.e ?? null));
  }
  add('Appointments recorded', `${num(apps.length)} at ${num(new Set(apps.map((a) => a.l)).size)} licensee(s)`);
  if (adv.pc[i]) add('Business location', `${esc(adv.pc[i])} ${esc(meta.states[adv.st[i]] ?? '')}`.trim());

  const owners = apps.flatMap((a) => a.o);
  const uniq = [...new Set(owners)];
  if (uniq.length) {
    add('Worked under', uniq.map((o) => {
      const label = meta.owners.find((x) => x.id === o)?.label ?? o;
      return `<span class="badge" style="border-color:${ownerColor(o)};color:${ownerColor(o)}">${esc(label)}</span>`;
    }).join(' '));
  }
  s.appendChild(dl);

  const das = apps.filter((a) => a.d);
  const cpd = adv.cpd[i];
  if (das.length || cpd) {
    const box = el('div', 'note');
    box.style.borderLeftColor = CONDUCT_COLOR;
    const bits: string[] = [];
    if (das.length) {
      bits.push(`<strong>ASIC has recorded ${das.length === 1 ? 'a disciplinary action' : `${das.length} disciplinary actions`} against this adviser.</strong> ` +
        das.map((a) => `${esc(meta.daTypes[a.d!.t] ?? 'Action')}${a.d!.s ? `, from ${date(a.d!.s)}` : ''}${a.d!.e ? ` to ${date(a.d!.e)}` : ''}` +
          (a.d!.x ? `<br><span class="sub">${esc(a.d!.x)}</span>` : '')).join('<br>'));
    }
    if (cpd) {
      bits.push(`A continuing professional development shortfall was reported for <strong>${esc(cpd.split(',').join(', '))}</strong>. ` +
        'That is a training compliance issue, not a finding of misconduct.');
    }
    box.innerHTML = bits.join('<br><br>');
    s.appendChild(box);
  }
  return s;
}

/**
 * The career ribbon: one lane per concurrent appointment, on a shared time axis,
 * each bar tinted by who owned that licensee AT THE TIME. Concurrent
 * appointments get their own lane rather than being merged, so nothing is hidden.
 */
function ribbon(apps: Appointment[], licensees: Licensee[], meta: Meta): HTMLElement {
  const s = section('Career');
  if (!apps.length) { s.appendChild(el('p', 'sub', 'No appointments recorded.')); return s; }

  const spans = apps.map((a) => ({
    from: yearFraction(a.s) ?? meta.asAtYear,
    to: yearFraction(a.e) ?? meta.asAtYear + 0.25,
  }));
  const lanes = careerLanes(spans);
  const laneCount = Math.max(...lanes.map((l) => l.lane)) + 1;

  const minY = Math.floor(Math.min(...spans.map((s2) => s2.from)));
  const maxY = Math.ceil(Math.max(...spans.map((s2) => s2.to)));
  const W = 520;
  const laneH = 26;
  const pad = { l: 6, r: 6, t: 6, b: 22 };
  const H = laneCount * laneH + pad.t + pad.b;
  const sx = linear([minY, Math.max(maxY, minY + 1)], [pad.l, W - pad.r]);

  const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(node, `Timeline of ${apps.length} appointments from ${minY} to ${maxY}.`);

  for (let y = Math.ceil(minY); y <= maxY; y++) {
    if ((maxY - minY) > 12 && y % 5 !== 0) continue;
    const x = finite(sx(y));
    node.appendChild(svg('line', { class: 'gridline', x1: x, x2: x, y1: pad.t, y2: pad.t + laneCount * laneH }));
    const lab = svg('text', { x, y: H - 7, 'text-anchor': 'middle', 'font-size': 10 });
    lab.textContent = String(y);
    node.appendChild(lab);
  }

  apps.forEach((a, i) => {
    const lane = lanes[i].lane;
    const x0 = finite(sx(spans[i].from));
    const x1 = finite(sx(spans[i].to));
    const lic = licensees[a.l];
    const owner = a.o[0] ?? null;
    const r = svg('rect', {
      x: Math.min(x0, x1), y: pad.t + lane * laneH + 3, width: Math.max(3, Math.abs(x1 - x0)),
      height: laneH - 8, rx: 3, fill: ownerColor(owner), opacity: a.e ? 0.85 : 1,
    });
    const ownerTxt = a.o.length
      ? a.o.map((o) => meta.owners.find((x) => x.id === o)?.label ?? o).join(', ')
      : 'independent / other';
    mark(r, `${titleCase(lic?.name ?? 'Unknown licensee')}\n${date(a.s)} → ${a.e ? date(a.e) : 'current'}\n${duration(a.s, a.e)}\nOwned by: ${ownerTxt}`, {
      label: `${titleCase(lic?.name ?? 'Unknown')}, ${date(a.s)} to ${a.e ? date(a.e) : 'current'}`,
      onClick: () => { if (lic) void openLicensee(lic.num); },
    });
    node.appendChild(r);
    if (Math.abs(x1 - x0) > 66) {
      const lab = svg('text', {
        x: Math.min(x0, x1) + 6, y: pad.t + lane * laneH + laneH / 2 + 1,
        'font-size': 10, fill: '#fff', 'pointer-events': 'none',
      });
      lab.textContent = titleCase(lic?.name ?? '').slice(0, Math.floor(Math.abs(x1 - x0) / 6));
      node.appendChild(lab);
    }
    if (a.d?.s) {
      const dx = finite(sx(yearFraction(a.d.s) ?? spans[i].from));
      const g = svg('circle', { cx: dx, cy: pad.t + lane * laneH + laneH / 2 - 1, r: 5, fill: CONDUCT_COLOR, stroke: '#fff', 'stroke-width': 1.5 });
      mark(g, `${meta.daTypes[a.d.t] ?? 'ASIC action'}\nfrom ${date(a.d.s)}${a.d.e ? ` to ${date(a.d.e)}` : ''}`);
      node.appendChild(g);
    }
  });

  s.appendChild(node);
  const used = [...new Set(apps.flatMap((a) => a.o))];
  s.appendChild(legend([
    ...used.map((o) => ({ color: ownerColor(o), label: meta.owners.find((x) => x.id === o)?.label ?? String(o) })),
    { color: ownerColor(null), label: 'Independent / other' },
    ...(apps.some((a) => a.d) ? [{ color: CONDUCT_COLOR, label: 'ASIC action' }] : []),
  ]));
  s.appendChild(el('p', 'sub',
    'Each bar is one appointment, coloured by who owned that licensee at that time — not by who owns it now. ' +
    'Overlapping bars are concurrent authorisations, which are normal. Click a bar for the firm.'));
  return s;
}

function history(apps: Appointment[], licensees: Licensee[], meta: Meta): HTMLElement {
  const s = section('Every appointment', 'authrep');
  const tbl = el('table');
  tbl.innerHTML = '<thead><tr><th>Licensee</th><th>From</th><th>To</th><th>For</th></tr></thead>';
  const tb = el('tbody');
  [...apps].reverse().forEach((a) => {
    const lic = licensees[a.l];
    const tr = el('tr', 'clickable-row');
    tr.innerHTML = `<td class="name-cell">${esc(titleCase(lic?.name ?? '—'))}` +
      (a.t && a.t !== 'Financial Adviser' ? `<div class="sub">${esc(a.t)}</div>` : '') +
      (a.r ? `<div class="sub">Restriction: ${esc(a.r)}</div>` : '') +
      `</td><td>${date(a.s)}</td><td>${a.e ? date(a.e) : '<span class="badge badge-current">current</span>'}</td>` +
      `<td class="n">${esc(duration(a.s, a.e))}</td>`;
    tr.tabIndex = 0;
    const open = () => { if (lic) void openLicensee(lic.num); };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); open(); }
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  const w = el('div', 'tbl-wrap');
  w.appendChild(tbl);
  s.appendChild(w);
  void meta;
  return s;
}

function credentials(extra: AdviserExtra, meta: Meta): HTMLElement {
  const s = section('Qualifications, memberships and authorisations');
  if (extra.q.length) {
    const ul = el('ul', 'qual-list');
    for (const q of extra.q) {
      const li = el('li');
      li.innerHTML = `${q.year ? `<span class="yr">${q.year}</span>` : ''}<strong>${esc(q.course)}</strong>` +
        (q.institution ? ` <span class="sub">· ${esc(q.institution)}</span>` : '');
      ul.appendChild(li);
    }
    s.appendChild(ul);
  } else {
    s.appendChild(el('p', 'sub', 'No qualifications recorded on the register for this adviser.'));
  }
  if (extra.m.length) {
    const c = el('div', 'chips');
    c.style.marginTop = '8px';
    for (const m of extra.m) c.appendChild(el('span', 'badge', esc(m)));
    s.appendChild(c);
  }
  if (extra.a.length) {
    const h = el('h4');
    h.style.marginTop = '12px';
    h.appendChild(document.createTextNode('Can advise on'));
    const g = glossaryButton('authorisation');
    if (g) h.appendChild(g);
    s.appendChild(h);
    const c = el('div', 'chips');
    for (const a of extra.a) {
      c.appendChild(el('span', 'badge', esc(meta.authLabels[a] ?? a)));
    }
    s.appendChild(c);
  }
  return s;
}

function provenance(meta: Meta): HTMLElement {
  const s = el('div', 'note');
  s.innerHTML = `Everything on this page is reproduced from ASIC's Financial Advisers Register as published on
    <strong>${date(meta.asAt)}</strong>. Nothing here is a rating, a score, or a recommendation, and no
    information is combined from any other list. If a detail is wrong, ASIC's own record is the authority.`;
  return s;
}
