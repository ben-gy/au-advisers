// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import { describe, expect, it } from 'vitest';
import {
  parseRegister, parseDate, dayToISO, dayToYear, parseChain, ownerOfName,
  ownersForAppointment, buildAppointments, buildCareers, buildMovements,
  parseQualifications, parseList, authFlags, ownerSeries, alumniByOwner,
  cohortSurvival, entryExit, isPostcodeShaped, classifyPostcodes, EXIT_NODE,
} from '../pipeline/parse.mjs';

const HEADER = [
  'ADV_NAME', 'ADV_NUMBER', 'ADV_ROLE_STATUS', 'ADV_SUB_TYPE', 'LICENCE_NAME', 'LICENCE_NUMBER',
  'LICENCE_CONTROLLED_BY', 'ADV_START_DT', 'ADV_END_DT', 'ADV_FIRST_PROVIDED_ADVICE',
  'ADV_ADD_STATE', 'ADV_ADD_PCODE', 'ADV_CPD_FAILURE_YEAR', 'ADV_DA_TYPE',
].join('\t');

function row(o: Record<string, string>): string {
  return [
    o.ADV_NAME ?? 'Jane  DOE', o.ADV_NUMBER ?? '001', o.ADV_ROLE_STATUS ?? 'Current',
    o.ADV_SUB_TYPE ?? 'Financial Adviser', o.LICENCE_NAME ?? 'ACME ADVICE PTY LTD',
    o.LICENCE_NUMBER ?? 'L1', o.LICENCE_CONTROLLED_BY ?? '', o.ADV_START_DT ?? '01/01/2010',
    o.ADV_END_DT ?? '', o.ADV_FIRST_PROVIDED_ADVICE ?? '2005', o.ADV_ADD_STATE ?? 'NSW',
    o.ADV_ADD_PCODE ?? '2000', o.ADV_CPD_FAILURE_YEAR ?? '', o.ADV_DA_TYPE ?? '',
  ].join('\t');
}

describe('parseRegister', () => {
  it('reads tab-delimited rows into objects', () => {
    const { header, rows } = parseRegister(`${HEADER}\n${row({})}`);
    expect(header).toContain('LICENCE_CONTROLLED_BY');
    expect(rows).toHaveLength(1);
    expect(rows[0].ADV_NUMBER).toBe('001');
  });

  it('strips a UTF-8 BOM — the real file has one, and it corrupts the first column name', () => {
    const { header } = parseRegister(`﻿${HEADER}\n${row({})}`);
    expect(header[0]).toBe('ADV_NAME');
  });

  it('ignores a trailing blank line rather than emitting an empty adviser', () => {
    const { rows } = parseRegister(`${HEADER}\n${row({})}\n\n`);
    expect(rows).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseRegister(`${HEADER}\r\n${row({})}\r\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0].ADV_ADD_PCODE).toBe('2000');
  });

  it('returns empty rather than throwing on an empty file', () => {
    expect(parseRegister('')).toEqual({ header: [], rows: [] });
  });

  it('pads short rows instead of shifting columns', () => {
    const { rows } = parseRegister(`${HEADER}\nOnly\tTwo`);
    expect(rows[0].ADV_NAME).toBe('Only');
    expect(rows[0].ADV_NUMBER).toBe('Two');
    expect(rows[0].ADV_ADD_PCODE).toBe('');
  });
});

describe('parseDate', () => {
  it('reads dd/mm/yyyy as day-first, not month-first', () => {
    // 03/04/2020 is 3 April, not 4 March. Getting this backwards would silently
    // reorder careers and move appointments across ownership cease dates.
    expect(dayToISO(parseDate('03/04/2020'))).toBe('2020-04-03');
  });
  it('accepts single-digit days and months', () => {
    expect(dayToISO(parseDate('1/2/1999'))).toBe('1999-02-01');
  });
  it('rejects blank and malformed values', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('2020-04-03')).toBeNull();
  });
  it('rejects impossible dates rather than rolling them into the next month', () => {
    expect(parseDate('31/02/2020')).toBeNull();
    expect(parseDate('32/01/2020')).toBeNull();
    expect(parseDate('01/13/2020')).toBeNull();
  });
  it('round-trips to a year', () => {
    expect(dayToYear(parseDate('30/06/2019'))).toBe(2019);
  });
});

describe('parseChain', () => {
  it('splits a tilde chain nearest-first with depth', () => {
    const c = parseChain('AKUMIN PTY LTD ~ ENTIRETI LIMITED ~ AMP LIMITED');
    expect(c.map((x) => x.name)).toEqual(['AKUMIN PTY LTD', 'ENTIRETI LIMITED', 'AMP LIMITED']);
    expect(c.map((x) => x.depth)).toEqual([0, 1, 2]);
    expect(c.every((x) => x.ceased === null)).toBe(true);
  });

  it('extracts the [Date Ceased] marker and strips it from the name', () => {
    const c = parseChain('COMMONWEALTH BANK OF AUSTRALIA [Date Ceased: 30/06/2026]');
    expect(c[0].name).toBe('COMMONWEALTH BANK OF AUSTRALIA');
    expect(dayToISO(c[0].ceased)).toBe('2026-06-30');
  });

  it('handles a mixed chain where only some links have ceased', () => {
    const c = parseChain('AKUMIN PTY LTD ~ ENTIRETI LIMITED ~ AMP ADVICE HOLDINGS PTY LTD [Date Ceased: 13/12/2024] ~ AMP LIMITED [Date Ceased: 13/12/2024]');
    expect(c).toHaveLength(4);
    expect(c[0].ceased).toBeNull();
    expect(c[1].ceased).toBeNull();
    expect(dayToISO(c[2].ceased)).toBe('2024-12-13');
    expect(dayToISO(c[3].ceased)).toBe('2024-12-13');
  });

  it('handles individuals as controllers, which the register genuinely contains', () => {
    const c = parseChain('Ned  SCHEPIS ~ David Paul  THURBON [Date Ceased: 13/12/2022]');
    expect(c[0].name).toBe('Ned  SCHEPIS');
    expect(dayToISO(c[1].ceased)).toBe('2022-12-13');
  });

  it('returns empty for a blank chain — 23,243 real rows have none', () => {
    expect(parseChain('')).toEqual([]);
    expect(parseChain('   ')).toEqual([]);
  });
});

describe('ownerOfName', () => {
  it('matches the five groups on their registered-name prefix', () => {
    expect(ownerOfName('COMMONWEALTH BANK OF AUSTRALIA')).toBe('cba');
    expect(ownerOfName('NATIONAL AUSTRALIA BANK LIMITED')).toBe('nab');
    expect(ownerOfName('WESTPAC BANKING CORPORATION')).toBe('wbc');
    expect(ownerOfName('AUSTRALIA AND NEW ZEALAND BANKING GROUP LIMITED')).toBe('anz');
    expect(ownerOfName('AMP LIMITED')).toBe('amp');
  });
  it('does not match unrelated firms that merely contain a bank word', () => {
    expect(ownerOfName('SMITH COMMONWEALTH ADVISERS')).toBeNull();
    expect(ownerOfName('AMP CAPITAL FUNDS MANAGEMENT')).toBeNull();
    expect(ownerOfName('')).toBeNull();
  });
});

describe('ownersForAppointment — THE DATING RULE', () => {
  const chain = parseChain('SOME LICENSEE ~ COMMONWEALTH BANK OF AUSTRALIA [Date Ceased: 01/10/2019]');

  it('counts an appointment that began BEFORE the owner ceased control', () => {
    expect(ownersForAppointment(chain, parseDate('01/01/2015'))).toEqual(['cba']);
  });

  it('counts an appointment that began exactly ON the cease date', () => {
    expect(ownersForAppointment(chain, parseDate('01/10/2019'))).toEqual(['cba']);
  });

  it('EXCLUDES an appointment that began after control ended — this is the whole point', () => {
    expect(ownersForAppointment(chain, parseDate('02/10/2019'))).toEqual([]);
    expect(ownersForAppointment(chain, parseDate('01/01/2024'))).toEqual([]);
  });

  it('counts a live link regardless of when the appointment started', () => {
    const live = parseChain('SOME LICENSEE ~ AMP LIMITED');
    expect(ownersForAppointment(live, parseDate('01/01/2026'))).toEqual(['amp']);
  });

  it('naive mode reproduces the WRONG answer, so the site can show the error', () => {
    expect(ownersForAppointment(chain, parseDate('01/01/2024'), false)).toEqual(['cba']);
  });

  it('handles a null start date without crediting the owner', () => {
    expect(ownersForAppointment(chain, null)).toEqual([]);
  });
});

describe('buildAppointments', () => {
  it('accepts a well-formed row and normalises it', () => {
    const { rows } = parseRegister(`${HEADER}\n${row({})}`);
    const { appointments, rejected } = buildAppointments(rows);
    expect(appointments).toHaveLength(1);
    expect(appointments[0].current).toBe(true);
    expect(appointments[0].firstAdvice).toBe(2005);
    expect(Object.values(rejected).reduce((a: number, b) => a + (b as number), 0)).toBe(0);
  });

  it('rejects rows into NAMED buckets so row conservation can be asserted', () => {
    const { rows } = parseRegister([
      HEADER,
      row({ ADV_NUMBER: '' }),
      row({ ADV_NUMBER: '2', LICENCE_NUMBER: '' }),
      row({ ADV_NUMBER: '3', ADV_START_DT: 'garbage' }),
      row({ ADV_NUMBER: '4' }),
    ].join('\n'));
    const { appointments, rejected } = buildAppointments(rows);
    expect(appointments).toHaveLength(1);
    expect(rejected.no_adviser_number).toBe(1);
    expect(rejected.no_licensee).toBe(1);
    expect(rejected.unparsable_start_date).toBe(1);
  });

  it('treats a non-numeric first-advice year as unknown rather than NaN', () => {
    const { rows } = parseRegister(`${HEADER}\n${row({ ADV_FIRST_PROVIDED_ADVICE: 'n/a' })}`);
    const { appointments } = buildAppointments(rows);
    expect(appointments[0].firstAdvice).toBeNull();
  });
});

describe('buildCareers and buildMovements', () => {
  const mk = (n: string, lic: string, start: string, end = '', status = end ? 'Ceased' : 'Current') =>
    row({ ADV_NUMBER: n, LICENCE_NUMBER: lic, LICENCE_NAME: lic, ADV_START_DT: start, ADV_END_DT: end, ADV_ROLE_STATUS: status });

  it('orders each career by start date regardless of file order', () => {
    const { rows } = parseRegister([HEADER,
      mk('1', 'C', '01/01/2020', '01/01/2022'),
      mk('1', 'A', '01/01/2010', '01/01/2015'),
      mk('1', 'B', '01/01/2015', '01/01/2020'),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const careers = buildCareers(appointments);
    expect(careers.get('1')!.map((a) => a.licNumber)).toEqual(['A', 'B', 'C']);
  });

  it('emits one transition per licensee change, and an exit edge for a departed adviser', () => {
    const { rows } = parseRegister([HEADER,
      mk('1', 'A', '01/01/2010', '01/01/2015'),
      mk('1', 'B', '01/01/2015', '01/01/2020'),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const m = buildMovements(buildCareers(appointments));
    expect(m.transitions).toBe(1);
    expect(m.exits).toBe(1);
    const exit = m.edges.find((e) => e.to === EXIT_NODE);
    expect(exit).toBeTruthy();
    expect(exit!.from).toBe('B');
  });

  it('does NOT emit an exit edge for an adviser who is still current', () => {
    const { rows } = parseRegister([HEADER,
      mk('1', 'A', '01/01/2010', '01/01/2015'),
      mk('1', 'B', '01/01/2015'),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const m = buildMovements(buildCareers(appointments));
    expect(m.transitions).toBe(1);
    expect(m.exits).toBe(0);
  });

  it('does not count consecutive rows at the SAME licensee as a move', () => {
    const { rows } = parseRegister([HEADER,
      mk('1', 'A', '01/01/2010', '01/01/2012'),
      mk('1', 'A', '01/01/2012', '01/01/2015'),
      mk('1', 'B', '01/01/2015'),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const m = buildMovements(buildCareers(appointments));
    expect(m.transitions).toBe(1);
  });

  it('accumulates weight when many advisers make the same move', () => {
    const lines = [HEADER];
    for (let i = 0; i < 7; i++) {
      lines.push(mk(String(i), 'A', '01/01/2010', '01/01/2015'));
      lines.push(mk(String(i), 'B', '01/01/2015'));
    }
    const { rows } = parseRegister(lines.join('\n'));
    const m = buildMovements(buildCareers(buildAppointments(rows).appointments));
    const edge = m.edges.find((e) => e.from === 'A' && e.to === 'B');
    expect(edge!.count).toBe(7);
  });
});

describe('parseQualifications', () => {
  it('splits the four fields without mangling hyphenated course names', () => {
    const q = parseQualifications('1995 - Bachelor of Business (Accounting/Finance) -  - Charles Sturt University');
    expect(q).toHaveLength(1);
    expect(q[0].year).toBe(1995);
    expect(q[0].course).toBe('Bachelor of Business (Accounting/Finance)');
    expect(q[0].institution).toBe('Charles Sturt University');
  });

  it('reads multiple tilde-separated qualifications', () => {
    const q = parseQualifications('1999 - CA - Professional Designations - ICAA ~ 2010 - CFP -  - FPA');
    expect(q).toHaveLength(2);
    expect(q[1].course).toBe('CFP');
  });

  it('returns empty for blank input', () => {
    expect(parseQualifications('')).toEqual([]);
    expect(parseList('')).toEqual([]);
  });
});

describe('authFlags — two encodings in one row', () => {
  it('reads FIN_* as 1/0 and TFAS as Y/N, which is the trap', () => {
    const flags = authFlags({
      FIN_SUPER: '1', FIN_SECUR: '0', CLASSES_SUPER: '1',
      ABLE_TO_PROVIDE_TFAS: 'Y', ADV_NAME: 'ignored',
    });
    expect(flags.FIN_SUPER).toBe(true);
    expect(flags.FIN_SECUR).toBe(false);
    expect(flags.CLASSES_SUPER).toBe(true);
    // Treating Y/N as 1/0 would silently make every authorised adviser false.
    expect(flags.ABLE_TO_PROVIDE_TFAS).toBe(true);
    expect(flags.ADV_NAME).toBeUndefined();
  });

  it('omits blank flags rather than reading them as false', () => {
    const flags = authFlags({ FIN_SUPER: '', ABLE_TO_PROVIDE_TFAS: '' });
    expect('FIN_SUPER' in flags).toBe(false);
    expect('ABLE_TO_PROVIDE_TFAS' in flags).toBe(false);
  });
});

describe('ownerSeries', () => {
  it('counts an adviser only in the years their appointment was open', () => {
    const { rows } = parseRegister([HEADER,
      row({ ADV_NUMBER: '1', ADV_START_DT: '01/01/2010', ADV_END_DT: '01/01/2015', ADV_ROLE_STATUS: 'Ceased', LICENCE_CONTROLLED_BY: 'X ~ AMP LIMITED' }),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const s = ownerSeries(appointments, [2009, 2012, 2020]);
    expect(s[0].amp).toBe(0); // before it started
    expect(s[1].amp).toBe(1); // open at 30/06/2012
    expect(s[2].amp).toBe(0); // after it ended
  });

  it('derives the total by de-duplicating people across bands', () => {
    // One adviser, two concurrent appointments under two different owners.
    const { rows } = parseRegister([HEADER,
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'A', ADV_START_DT: '01/01/2010', LICENCE_CONTROLLED_BY: 'X ~ AMP LIMITED' }),
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'B', ADV_START_DT: '01/01/2010', LICENCE_CONTROLLED_BY: 'Y ~ WESTPAC BANKING CORPORATION' }),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const s = ownerSeries(appointments, [2012]);
    expect(s[0].amp).toBe(1);
    expect(s[0].wbc).toBe(1);
    expect(s[0].total).toBe(1); // one PERSON, counted once
  });
});

describe('alumniByOwner', () => {
  it('dated and naive disagree exactly where a ceased link predates an appointment', () => {
    const { rows } = parseRegister([HEADER,
      // started AFTER CBA ceased control — a phantom under naive counting
      row({ ADV_NUMBER: '1', ADV_START_DT: '01/01/2024', LICENCE_CONTROLLED_BY: 'X ~ COMMONWEALTH BANK OF AUSTRALIA [Date Ceased: 01/10/2019]' }),
      // started before — genuine
      row({ ADV_NUMBER: '2', ADV_START_DT: '01/01/2010', LICENCE_CONTROLLED_BY: 'X ~ COMMONWEALTH BANK OF AUSTRALIA [Date Ceased: 01/10/2019]' }),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    expect(alumniByOwner(appointments, true).any.size).toBe(1);
    expect(alumniByOwner(appointments, false).any.size).toBe(2);
  });
});

describe('cohortSurvival and entryExit', () => {
  const mk = (n: string, first: string, start: string, end = '') =>
    row({ ADV_NUMBER: n, ADV_FIRST_PROVIDED_ADVICE: first, ADV_START_DT: start, ADV_END_DT: end, ADV_ROLE_STATUS: end ? 'Ceased' : 'Current' });

  it('reports a cohort shrinking over time and stops at the observation limit', () => {
    const { rows } = parseRegister([HEADER,
      mk('1', '2015', '01/01/2015', '01/01/2017'),
      mk('2', '2015', '01/01/2015', '01/01/2020'),
      mk('3', '2015', '01/01/2015'),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    const cohorts = cohortSurvival(buildCareers(appointments), 2025);
    const c = cohorts.find((x: { year: number }) => x.year === 2015)!;
    expect(c.size).toBe(3);
    expect(c.points[0].share).toBe(1);
    // Right-censoring: a 2015 cohort observed to 2025 cannot report year 11.
    expect(c.points[c.points.length - 1].n).toBe(10);
    expect(c.points.find((p: { n: number }) => p.n === 3)!.alive).toBe(2);
  });

  it('never reports survival above 1 or below 0', () => {
    const { rows } = parseRegister([HEADER, mk('1', '2015', '01/01/2015')].join('\n'));
    const cohorts = cohortSurvival(buildCareers(buildAppointments(rows).appointments), 2025);
    for (const c of cohorts) for (const p of c.points) {
      expect(p.share).toBeGreaterThanOrEqual(0);
      expect(p.share).toBeLessThanOrEqual(1);
    }
  });

  it('counts an entry in the first appointment year and an exit in the last', () => {
    const { rows } = parseRegister([HEADER, mk('1', '2015', '01/01/2015', '01/01/2019')].join('\n'));
    const flow = entryExit(buildCareers(buildAppointments(rows).appointments));
    expect(flow.find((f: { year: number }) => f.year === 2015)!.entries).toBe(1);
    expect(flow.find((f: { year: number }) => f.year === 2019)!.exits).toBe(1);
  });
});

describe('postcode classification', () => {
  it('recognises four-digit postcodes only', () => {
    expect(isPostcodeShaped('2000')).toBe(true);
    expect(isPostcodeShaped('0800')).toBe(true);
    expect(isPostcodeShaped('NSW')).toBe(false);
    expect(isPostcodeShaped('MSW')).toBe(false);
    expect(isPostcodeShaped('')).toBe(false);
  });

  it('separates mapped, PO-box and malformed postcodes — all three exist in the real file', () => {
    const boundary = new Set(['2000', '3000']);
    const cls = classifyPostcodes(['2000', '3000', '2001', 'NSW', 'MSW'], boundary, { 2000: 27936 });
    expect(cls.mapped).toEqual(['2000', '3000']);
    expect(cls.nonResidential).toEqual(['2001']);
    expect(cls.malformed).toEqual(['NSW', 'MSW']);
  });
});
