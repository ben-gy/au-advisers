// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import { openOverlay, closeButton } from './overlay.ts';
import { getLicensees, getMovements } from './data.ts';
import { el } from './views/svg.ts';
import { num, date, titleCase, esc } from './format.ts';
import { ownerColor, EXIT_COLOR } from './colors.ts';
import { goto } from './router.ts';

export async function openLicensee(licNumber: string): Promise<void> {
  const [licensees, movements] = await Promise.all([getLicensees(), getMovements()]);
  const idx = licensees.findIndex((l) => l.num === licNumber);
  if (idx < 0) return;
  const l = licensees[idx];

  const outbound = movements.all
    .filter((e) => e.f === idx)
    .sort((a, b) => b.c - a.c);
  const inbound = movements.all
    .filter((e) => e.t === idx)
    .sort((a, b) => b.c - a.c)
    .slice(0, 10);
  const left = outbound.find((e) => e.t === -2)?.c ?? 0;

  openOverlay({
    panelClass: 'drawer',
    label: `${titleCase(l.name)} details`,
    lockScroll: true,
    build: (panel, close) => {
      const head = el('div', 'drawer-head');
      const t = el('div');
      t.style.flex = '1';
      t.style.minWidth = '0';
      t.appendChild(el('h3', undefined, esc(titleCase(l.name))));
      t.appendChild(el('div', 'sub', `AFS licence ${esc(l.num)} · ${l.alive ? 'active on the register' : 'no current advisers'}`));
      head.append(t, closeButton(close, 'Close licensee details'));

      const body = el('div', 'drawer-body');

      const stats = el('div', 'tiles');
      stats.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(140px,100%),1fr))';
      const mk = (v: string, k: string) => {
        const d = el('div', 'tile');
        d.appendChild(el('div', 'v', esc(v)));
        d.appendChild(el('div', 'k', esc(k)));
        return d;
      };
      stats.append(
        mk(num(l.current), 'Advisers now'),
        mk(num(l.total), 'Advisers ever'),
        mk(date(l.first), 'First appointment'),
        mk(l.alive ? '—' : date(l.last), l.alive ? 'Still active' : 'Last appointment'),
      );
      body.appendChild(stats);

      // ownership chain
      const chainSec = el('div', 'dossier-section');
      chainSec.appendChild(el('h4', undefined, 'Ownership chain'));
      if (!l.chain.length) {
        chainSec.appendChild(el('p', 'sub', 'ASIC records no controlling entity for this licensee.'));
      } else {
        const ol = el('div');
        l.chain.forEach((link, i) => {
          const row = el('div');
          row.style.cssText = `display:flex;gap:8px;align-items:baseline;padding:4px 0 4px ${i * 14}px;font-size:0.86rem`;
          const dot = el('span');
          dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${ownerColor(null)}`;
          const nm = el('span');
          nm.innerHTML = `${i > 0 ? '<span style="color:var(--text-muted)">↳ </span>' : ''}${esc(titleCase(link.n))}`;
          row.append(dot, nm);
          if (link.c) {
            const b = el('span', 'badge badge-ceased', `control ended ${date(link.c)}`);
            row.appendChild(b);
            nm.style.color = 'var(--text-muted)';
          }
          ol.appendChild(row);
        });
        chainSec.appendChild(ol);
        chainSec.appendChild(el('p', 'sub',
          'Read outward: the first line controls the licensee directly, each following line controls the one above it. ' +
          'The chain is as ASIC records it today; a greyed line ended on the date shown.'));
      }
      body.appendChild(chainSec);

      // where the people went
      const outSec = el('div', 'dossier-section');
      outSec.appendChild(el('h4', undefined, 'Where its advisers went next'));
      const named = outbound.filter((e) => e.t >= 0).slice(0, 12);
      if (!named.length && !left) {
        outSec.appendChild(el('p', 'sub', 'No onward moves recorded — every adviser here is either still current or this is their only appointment.'));
      } else {
        const ul = el('div');
        for (const e of named) {
          const dest = licensees[e.t];
          const row = el('button', 'btn') as HTMLButtonElement;
          row.style.cssText = 'display:flex;width:100%;justify-content:space-between;gap:10px;text-align:left;margin-bottom:4px';
          row.innerHTML = `<span>${esc(titleCase(dest.name))}</span><strong>${num(e.c)}</strong>`;
          row.addEventListener('click', () => { void openLicensee(dest.num); });
          ul.appendChild(row);
        }
        if (left) {
          const row = el('div');
          row.style.cssText = `display:flex;justify-content:space-between;gap:10px;padding:8px 13px;border:1px dashed var(--border-default);border-radius:4px;color:var(--text-secondary);background:${EXIT_COLOR}18`;
          row.innerHTML = `<span>Left the register entirely</span><strong>${num(left)}</strong>`;
          ul.appendChild(row);
        }
        outSec.appendChild(ul);
      }
      body.appendChild(outSec);

      if (inbound.length) {
        const inSec = el('div', 'dossier-section');
        inSec.appendChild(el('h4', undefined, 'Where its advisers came from'));
        const ul = el('div');
        for (const e of inbound) {
          const src = licensees[e.f];
          const row = el('button', 'btn') as HTMLButtonElement;
          row.style.cssText = 'display:flex;width:100%;justify-content:space-between;gap:10px;text-align:left;margin-bottom:4px';
          row.innerHTML = `<span>${esc(titleCase(src.name))}</span><strong>${num(e.c)}</strong>`;
          row.addEventListener('click', () => { void openLicensee(src.num); });
          ul.appendChild(row);
        }
        inSec.appendChild(ul);
        body.appendChild(inSec);
      }

      const act = el('div');
      const b = el('button', 'btn btn-primary', 'See this firm in the Diaspora view') as HTMLButtonElement;
      b.addEventListener('click', () => { close(); goto('diaspora', { lic: l.num }); });
      act.appendChild(b);
      body.appendChild(act);

      panel.append(head, body);
    },
  });
}
