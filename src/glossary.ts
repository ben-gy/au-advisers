// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Assume the reader knows nothing about financial-advice regulation. Every
// piece of jargon on the site carries an ℹ button wired to one of these.

export interface Term { term: string; definition: string }

export const GLOSSARY: Record<string, Term> = {
  far: {
    term: 'Financial Advisers Register',
    definition:
      'The public register ASIC is required by law to keep of every person authorised to give personal financial advice to retail clients in Australia. It records who they are, who authorises them, their qualifications, and any disciplinary action. This site is built entirely from it.',
  },
  licensee: {
    term: 'Licensee (AFS licensee)',
    definition:
      'The company that holds the Australian Financial Services licence and authorises the adviser to give advice. Advisers are rarely licensed in their own right — they are "authorised representatives" of a licensee, which is legally responsible for their advice.',
  },
  authrep: {
    term: 'Authorised representative',
    definition:
      'A person or company authorised by a licensee to provide financial services on the licensee\'s behalf. The relationship is an appointment with a start date and, usually eventually, an end date — which is what makes this register a career history.',
  },
  chain: {
    term: 'Ownership chain',
    definition:
      'The register records who controls each licensee, listed outward from the immediate controller to the ultimate parent. A chain such as "Akumin ~ Entireti ~ AMP Advice Holdings ~ AMP Limited" means the licensee sits four levels below AMP.',
  },
  dateceased: {
    term: '[Date Ceased]',
    definition:
      'A marker inside the ownership chain showing that a controlling link ended on that date. It is the only evidence in the file that ownership has changed — the chain itself is always written as it stands today, and is stamped onto every historical row, including appointments that ended long before that owner ever appeared.',
  },
  dated: {
    term: 'Dated vs naive counting',
    definition:
      'Because the ownership chain is a snapshot of today applied to the whole history, counting an owner\'s advisers naively includes people who left before that owner arrived. Dated counting only counts an appointment toward an owner if it began while that owner still controlled the licensee. On this data the difference is 530 advisers.',
  },
  vertical: {
    term: 'Vertical integration',
    definition:
      'When the same corporate group both manufactures financial products (funds, insurance, platforms) and owns the advice businesses recommending them. The conflict this creates was central to the 2018 Hayne Royal Commission, after which all four major banks and AMP sold or closed their advice arms.',
  },
  hayne: {
    term: 'Hayne Royal Commission',
    definition:
      'The Royal Commission into Misconduct in the Banking, Superannuation and Financial Services Industry (2017–2019), chaired by Kenneth Hayne. Its findings on fees for no service and conflicted advice preceded both the banks\' exit from advice and much tougher education and professional standards.',
  },
  standards: {
    term: 'Professional standards reforms',
    definition:
      'From 2019 advisers faced new education requirements, a compulsory exam, a code of ethics and continuing professional development. Adviser numbers roughly halved over the following years, and this register lets you watch it happen cohort by cohort.',
  },
  cpd: {
    term: 'CPD failure',
    definition:
      'Continuing Professional Development is mandatory annual training. Where a licensee reports that an adviser did not meet the requirement in a given year, ASIC records the year on the register. It is a compliance shortfall, not a finding of misconduct.',
  },
  da: {
    term: 'Disciplinary action',
    definition:
      'Formal action ASIC records against an adviser on this register — a banning or disqualification, an enforceable undertaking, or a determination by the Financial Services and Credit Panel. These are ASIC\'s own entries against the adviser\'s own record; this site does not match names against any other list.',
  },
  fscp: {
    term: 'FSCP action',
    definition:
      'A determination by the Financial Services and Credit Panel, a body ASIC convenes to deal with adviser misconduct that falls short of a ban — outcomes range from a written direction to a suspension of registration.',
  },
  eu: {
    term: 'Enforceable undertaking',
    definition:
      'A legally binding promise given to ASIC — typically to change conduct, compensate clients or accept supervision — accepted as an alternative to court action.',
  },
  authorisation: {
    term: 'Authorisation',
    definition:
      'The specific classes of financial product an adviser may advise on: superannuation, securities, life risk insurance, managed investments, derivatives and so on. An adviser can only advise on what their licensee has authorised them for.',
  },
  tfas: {
    term: 'Tax (financial) advice',
    definition:
      'Advice about the tax consequences of a financial product recommendation. Advisers must be separately qualified to provide it, and the register records whether they can.',
  },
  provisional: {
    term: 'Provisional financial adviser',
    definition:
      'Someone completing the supervised "professional year" required before they can advise retail clients independently. The number of provisional advisers is the clearest available measure of the industry\'s new-entrant pipeline.',
  },
  timeshare: {
    term: 'Time-share adviser',
    definition:
      'An adviser restricted to advising on time-share schemes (holiday ownership products). They are on the same register but are not general financial advisers, which is why this site labels them separately.',
  },
  survival: {
    term: 'Cohort survival',
    definition:
      'Of everyone who first gave advice in a given year, the share still on the register some number of years later. Reading down a column compares intakes at the same age, which a simple headcount chart cannot do.',
  },
  censored: {
    term: 'Right-censoring',
    definition:
      'A 2023 intake can only be observed for three years, so its curve simply stops rather than falling to zero. Drawing it to zero would invent an exit that has not happened.',
  },
  per10k: {
    term: 'Advisers per 10,000 residents',
    definition:
      'Adviser count divided by the postcode\'s 2021 Census population, times 10,000. Raw counts mostly redraw the population map; this shows where advice is genuinely thin on the ground relative to the people living there.',
  },
  poa: {
    term: 'Postal area (POA)',
    definition:
      'The ABS approximation of a postcode as a geographic area. Some postcodes — PO-box and large-volume-receiver ranges such as 2001 or 4001 — are not areas at all and have no boundary, which is why a small number of advisers cannot be placed on the map.',
  },
  exitnode: {
    term: 'Left the register',
    definition:
      'An adviser whose last appointment ended and who holds no current appointment anywhere. In the movement graph they flow into an explicit exit node rather than disappearing, so the picture cannot imply that everyone who left a firm landed at another one.',
  },
};

let pop: HTMLElement | null = null;

function dismiss(): void {
  pop?.remove();
  pop = null;
}

/** An ℹ button bound to a glossary key. */
export function glossaryButton(key: string): HTMLButtonElement | null {
  const entry = GLOSSARY[key];
  if (!entry) return null;
  const b = document.createElement('button');
  b.className = 'gloss';
  b.type = 'button';
  b.textContent = 'i';
  b.setAttribute('aria-label', `What is ${entry.term}?`);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    show(key, b);
  });
  return b;
}

export function show(key: string, anchor: HTMLElement): void {
  const entry = GLOSSARY[key];
  if (!entry) return;
  dismiss();
  const node = document.createElement('div');
  node.className = 'gloss-pop';
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', entry.term);
  const close = document.createElement('button');
  close.className = 'gloss-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close definition');
  close.textContent = '✕';
  close.addEventListener('click', () => { dismiss(); anchor.focus(); });
  const h = document.createElement('h4');
  h.textContent = entry.term;
  const p = document.createElement('p');
  p.textContent = entry.definition;
  node.append(close, h, p);
  document.body.appendChild(node);

  const r = anchor.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  let left = r.left;
  let top = r.bottom + 8;
  if (left + box.width > window.innerWidth - 12) left = window.innerWidth - box.width - 12;
  if (top + box.height > window.innerHeight - 12) top = Math.max(12, r.top - box.height - 8);
  node.style.left = `${Math.max(12, left)}px`;
  node.style.top = `${top}px`;
  pop = node;
  close.focus();
}

/** Click-away and Escape, once, at boot. pointerdown covers touch. */
export function initGlossary(): void {
  document.addEventListener('pointerdown', (e) => {
    if (!pop) return;
    const t = e.target as Node;
    if (pop.contains(t)) return;
    if ((t as Element)?.closest?.('.gloss')) return;
    dismiss();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop) { e.stopPropagation(); dismiss(); }
  });
  window.addEventListener('hashchange', dismiss);
}

/** Inline "label ℹ" pair for use inside built-up DOM. */
export function withGlossary(text: string, key: string): DocumentFragment {
  const f = document.createDocumentFragment();
  f.appendChild(document.createTextNode(text));
  const b = glossaryButton(key);
  if (b) f.appendChild(b);
  return f;
}
