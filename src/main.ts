// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import './styles.css';
import { initTooltip, hideTooltip } from './components/tooltip.ts';
import { initGlossary } from './glossary.ts';
import { openOverlay, closeButton } from './overlay.ts';
import { getMeta, DataError } from './data.ts';
import { el } from './views/svg.ts';
import { parseHash, type ViewCtx } from './router.ts';
import { num, date, esc } from './format.ts';
import type { Meta } from './types.ts';

import { renderOverview } from './views/overview.ts';
import { renderRetreat } from './views/retreat.ts';
import { renderMovements } from './views/movements.ts';
import { renderOwnership } from './views/ownership.ts';
import { renderCohorts } from './views/cohorts.ts';
import { renderDiaspora } from './views/diaspora.ts';
import { renderConduct } from './views/conduct.ts';
import { renderAuthorisations } from './views/authorisations.ts';
import { renderWhere } from './views/where.ts';
import { renderExplorer } from './views/explorer.ts';
import { openAdviserByNumber } from './dossier.ts';


const VIEWS: { id: string; label: string; render: (ctx: ViewCtx) => Promise<void> }[] = [
  { id: 'overview', label: 'Overview', render: renderOverview },
  { id: 'retreat', label: 'Bank retreat', render: renderRetreat },
  { id: 'movements', label: 'Movements', render: renderMovements },
  { id: 'ownership', label: 'Ownership', render: renderOwnership },
  { id: 'cohorts', label: 'Cohorts', render: renderCohorts },
  { id: 'diaspora', label: 'Diaspora', render: renderDiaspora },
  { id: 'conduct', label: 'Conduct', render: renderConduct },
  { id: 'authorisations', label: 'Authorisations', render: renderAuthorisations },
  { id: 'where', label: 'Where', render: renderWhere },
  { id: 'explorer', label: 'Find an adviser', render: renderExplorer },
];

const BRAND_SVG = `<svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 20h18"/><path d="M5 20V9"/><path d="M12 20V4"/><path d="M19 20v-7"/>
  <circle cx="5" cy="7" r="1.6"/><circle cx="12" cy="2.6" r="1.6" opacity="0"/>
</svg>`;

const VIEW_IDS = VIEWS.map((v) => v.id);
const hash = () => parseHash(VIEW_IDS);

let meta: Meta | null = null;
let currentView = '';

async function render(): Promise<void> {
  const { view, params } = hash();
  const root = document.getElementById('view-root');
  if (!root || !meta) return;

  document.querySelectorAll<HTMLAnchorElement>('.tabs a').forEach((a) => {
    const active = a.dataset.view === view;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  // A tooltip must never survive a view change.
  hideTooltip();

  if (view !== currentView) {
    root.replaceChildren(el('div', 'loading', 'Loading…'));
    currentView = view;
  }

  const def = VIEWS.find((v) => v.id === view)!;
  try {
    const fresh = document.createElement('div');
    await def.render({ root: fresh, meta, params });
    // Only swap in once the view has built successfully, so a failure cannot
    // leave the page half-rendered.
    if (hash().view === view) root.replaceChildren(...fresh.childNodes);
  } catch (err) {
    root.replaceChildren(errorState(err, () => { currentView = ''; void render(); }));
  }

  // Deep link straight to a person: #view=explorer&adv=001234567
  const adv = params.get('adv');
  if (adv) void openAdviserByNumber(adv);
}

function errorState(err: unknown, retry: () => void): HTMLElement {
  const wrap = el('div', 'error-state');
  const msg = err instanceof DataError
    ? 'Could not load the register data. This is usually a temporary network problem.'
    : 'Something went wrong building this view.';
  wrap.appendChild(el('p', undefined, esc(msg)));
  const detail = el('p', 'sub', esc(err instanceof Error ? err.message : String(err)));
  wrap.appendChild(detail);
  const b = el('button', 'btn btn-primary', 'Try again') as HTMLButtonElement;
  b.addEventListener('click', retry);
  wrap.appendChild(b);
  return wrap;
}

function aboutModal(m: Meta): void {
  openOverlay({
    panelClass: 'modal',
    label: 'About this site',
    lockScroll: true,
    build: (panel, close) => {
      const head = el('div', 'modal-head');
      head.appendChild(el('h3', undefined, 'About this site'));
      head.appendChild(closeButton(close, 'Close about'));
      const body = el('div', 'modal-body');
      body.innerHTML = `
        <h4>What this is</h4>
        <p>Every person who has ever been on Australia's <strong>Financial Advisers Register</strong> —
        ${num(m.advisers)} people across ${num(m.appointments)} appointments at ${num(m.licensees)} licensees,
        as published by ASIC and current at <strong>${date(m.asAt)}</strong>. ${num(m.currentAdvisers)} of
        them are advising right now.</p>
        <p>ASIC publishes the register, but not its history. Every row carries the ownership chain that
        controls the licensee <em>as it stands today</em>, with cease dates buried in free text — so the file
        silently contains a decade of industry restructuring that nobody can read without parsing it. This
        site reconstructs that history.</p>

        <h4>The one number you should be sceptical of, and why we are</h4>
        <p>Because the ownership chain is a snapshot of today stamped onto every historical row, counting
        an owner's advisers naively includes people who had already left before that owner arrived. Counting
        naively gives ${num(m.headline.alumniNaive)} bank and AMP alumni. Intersecting each appointment's
        dates against the cease dates gives <strong>${num(m.headline.alumniDated)}</strong>. The difference —
        <strong>${num(m.headline.phantom)} advisers</strong> — never existed under those owners.</p>
        <p>The <a href="#view=retreat">Bank retreat</a> view lets you switch between the two counts so you
        can see the phantoms appear and disappear. The correction is not uniform: it removes 337 advisers
        from CBA, 382 from ANZ and 179 from AMP, and <em>nothing at all</em> from NAB or Westpac. That
        matters, because a check written only against NAB or Westpac would pass on an implementation with
        the date logic deleted entirely — so the site's test suite asserts the rule specifically where it bites.</p>

        <h4>Where the data comes from</h4>
        <ul>
          <li><strong>ASIC Financial Advisers Register</strong>, via data.gov.au — the whole site.
          Licensed <a href="https://creativecommons.org/licenses/by/3.0/au/" target="_blank" rel="noopener">CC BY 3.0 AU</a>.</li>
          <li><strong>ABS ASGS 2021 postal area boundaries</strong> for the map, and
          <strong>2021 Census</strong> postcode populations as the per-capita denominator. CC BY 4.0.</li>
        </ul>

        <h4>What this site deliberately does NOT do</h4>
        <p>It does <strong>not</strong> match adviser names against ASIC's separate Banned and Disqualified
        Persons register. That list carries no adviser number, so the only possible join is a person's name —
        and a name collision would publish, next to a real named individual, a banning that belongs to somebody
        else. Every disciplinary record shown here is <strong>ASIC's own entry against that adviser's own
        record</strong> on this register: ${num(m.conduct.actions)} actions against ${num(m.conduct.advisers)} people.</p>
        <p>It also does not rank, score or rate advisers, and nothing here is advice about whether to use one.</p>

        <h4>Known limits</h4>
        <ul>
          <li>Business addresses exist for almost every current appointment but only about a third of ceased
          ones, so the map is <strong>current advisers only</strong>. Historical geography is not shown because
          it would chart where ASIC happens to hold an address, not where advisers were.</li>
          <li>Product authorisations are blank on every ceased row, so that view is also current-only.</li>
          <li>Postcode populations are 2021 Census (the finest geography ABS publishes population for) while
          adviser counts are current — the two vintages differ.</li>
          <li>A person can hold appointments at two licensees at once. Bands in the retreat view count them
          in each, but the total counts them once, so bands do not sum to the total.</li>
          <li>ASIC's own data has a few malformed rows — five current advisers have a state abbreviation
          where a postcode should be. They are counted, and named, in the Where view rather than dropped.</li>
        </ul>

        <h4>How it is checked</h4>
        <p>Seven reconciliation gates run on every build and the pipeline refuses to write data if any fails:</p>
        <ul>${m.gates.map((g) => `<li><strong>${esc(g.name)}</strong> — ${esc(g.detail)}</li>`).join('')}</ul>

        <h4>Corrections</h4>
        <p>If something here is wrong about you or your firm, the register itself is the authority — ASIC's
        own record is what this site reproduces. Use the Feedback link in the footer and it will be looked at.</p>
      `;
      panel.append(head, body);
    },
  });
}

function shell(m: Meta): void {
  const app = document.getElementById('app')!;
  app.replaceChildren();

  const skip = el('a', 'skip', 'Skip to content') as HTMLAnchorElement;
  skip.href = '#view-root';

  const header = el('header', 'site-header');
  const inner = el('div', 'header-inner');
  const brand = el('a', 'brand') as HTMLAnchorElement;
  brand.href = '#view=overview';
  brand.innerHTML = `${BRAND_SVG}<span class="brand-txt"><strong>Financial Advisers</strong><small>ASIC register · ${date(m.asAt)}</small></span>`;

  const tabs = el('nav', 'tabs');
  tabs.setAttribute('aria-label', 'Views');
  for (const v of VIEWS) {
    const a = el('a') as HTMLAnchorElement;
    a.href = `#view=${v.id}`;
    a.textContent = v.label;
    a.dataset.view = v.id;
    tabs.appendChild(a);
  }

  const about = el('button', 'about-btn', '?') as HTMLButtonElement;
  about.type = 'button';
  about.setAttribute('aria-label', 'About this site and its data');
  about.addEventListener('click', () => aboutModal(m));

  inner.append(brand, tabs, about);
  header.appendChild(inner);

  const main = el('main', 'main-content');
  main.id = 'view-root';
  main.setAttribute('role', 'main');

  const footer = el('footer', 'site-footer');
  const fi = el('div', 'footer-inner');
  fi.innerHTML = `<span>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> ·
    <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></span>
    <span>Source: ASIC Financial Advisers Register (CC BY 3.0 AU) · ABS boundaries &amp; Census (CC BY 4.0) ·
    current at ${date(m.asAt)}</span>`;
  footer.appendChild(fi);

  app.append(skip, header, main, footer);
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  app.replaceChildren(el('div', 'loading', 'Loading the register…'));
  try {
    meta = await getMeta();
  } catch (err) {
    app.replaceChildren(errorState(err, () => void boot()));
    return;
  }
  shell(meta);
  initTooltip();
  initGlossary();
  window.addEventListener('hashchange', () => void render());
  await render();
}

void boot();
