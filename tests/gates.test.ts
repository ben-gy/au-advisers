// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// EVERY gate is proven to FAIL on the exact fault it claims to catch. A gate
// that has only ever been observed passing is not a gate — it is decoration
// that prints green while bad data ships. (See the au-bushfires post-mortem:
// a dedupe rule validated on one convenient season shipped 28.8 Mha of
// phantom fire.)

import { describe, expect, it } from 'vitest';
import {
  parseRegister, buildAppointments, buildCareers, buildMovements,
  gateRowConservation, gateStatusCoherence, gateDatingRule, gateMovementConservation,
  gateGeographyScope, gateCensusAnchor, gateBoundaryCoverage, gateSurvivorship, gateSeriesEra,
  cohortSurvival, distinctActions, gateFailures,
  CENSUS_2021_PERSONS,
} from '../pipeline/parse.mjs';
import type { Appointment } from '../pipeline/parse.mjs';

const HEADER = [
  'ADV_NAME', 'ADV_NUMBER', 'ADV_ROLE_STATUS', 'ADV_SUB_TYPE', 'LICENCE_NAME', 'LICENCE_NUMBER',
  'LICENCE_CONTROLLED_BY', 'ADV_START_DT', 'ADV_END_DT', 'ADV_FIRST_PROVIDED_ADVICE',
  'ADV_ADD_STATE', 'ADV_ADD_PCODE', 'ADV_CPD_FAILURE_YEAR', 'ADV_DA_TYPE',
].join('\t');

function row(o: Record<string, string>): string {
  return [
    o.ADV_NAME ?? 'Jane  DOE', o.ADV_NUMBER ?? '001', o.ADV_ROLE_STATUS ?? 'Current',
    o.ADV_SUB_TYPE ?? 'Financial Adviser', o.LICENCE_NAME ?? 'ACME', o.LICENCE_NUMBER ?? 'L1',
    o.LICENCE_CONTROLLED_BY ?? '', o.ADV_START_DT ?? '01/01/2010', o.ADV_END_DT ?? '',
    o.ADV_FIRST_PROVIDED_ADVICE ?? '2005', o.ADV_ADD_STATE ?? 'NSW', o.ADV_ADD_PCODE ?? '2000',
    o.ADV_CPD_FAILURE_YEAR ?? '', o.ADV_DA_TYPE ?? '',
  ].join('\t');
}

/** The catastrophic regression: the date intersection deleted entirely. */
const stripCeaseDates = (appointments: Appointment[]): Appointment[] =>
  appointments.map((a) => ({ ...a, chain: a.chain.map((c) => ({ ...c, ceased: null })) }));

const parse = (lines: string[]) => {
  const { rows } = parseRegister([HEADER, ...lines].join('\n'));
  return { rows, ...buildAppointments(rows) };
};

/**
 * A synthetic register with the SAME structural property as the real one: the
 * dating rule must bite on cba/anz/amp and be a no-op on nab/wbc.
 */
function realisticRegister(): string[] {
  const lines: string[] = [];
  let id = 0;
  const add = (owner: string, ceased: string | null, start: string) => {
    id++;
    lines.push(row({
      ADV_NUMBER: `A${id}`, LICENCE_NUMBER: `L${owner}`, ADV_START_DT: start,
      LICENCE_CONTROLLED_BY: `SUB PTY LTD ~ ${owner}${ceased ? ` [Date Ceased: ${ceased}]` : ''}`,
    }));
  };
  // CBA, ANZ, AMP each get one genuine and one post-cease (phantom) adviser.
  add('COMMONWEALTH BANK OF AUSTRALIA', '01/10/2019', '01/01/2010');
  add('COMMONWEALTH BANK OF AUSTRALIA', '01/10/2019', '01/01/2024');
  add('AUSTRALIA AND NEW ZEALAND BANKING GROUP LIMITED', '05/10/2018', '01/01/2010');
  add('AUSTRALIA AND NEW ZEALAND BANKING GROUP LIMITED', '05/10/2018', '01/01/2024');
  add('AMP LIMITED', '13/12/2024', '01/01/2010');
  add('AMP LIMITED', '13/12/2024', '01/01/2025');
  // NAB and Westpac: every appointment predates the cease date, so the rule is
  // a NO-OP for them — exactly as in the real file.
  add('NATIONAL AUSTRALIA BANK LIMITED', '21/08/2023', '01/01/2010');
  add('NATIONAL AUSTRALIA BANK LIMITED', '21/08/2023', '01/01/2015');
  add('WESTPAC BANKING CORPORATION', '23/11/2023', '01/01/2010');
  add('WESTPAC BANKING CORPORATION', '23/11/2023', '01/01/2012');
  return lines;
}

describe('gateRowConservation', () => {
  it('passes when accepted + rejected equals the source row count', () => {
    const { rows, appointments, rejected } = parse([row({}), row({ ADV_NUMBER: '2' })]);
    const g = gateRowConservation(rows.length, appointments.length, rejected);
    expect(g.ok).toBe(true);
  });

  it('FAILS when rows are silently dropped — the fault it exists to catch', () => {
    const { rows, appointments, rejected } = parse([row({}), row({ ADV_NUMBER: '2' })]);
    // Simulate a filter that quietly deleted one row without bucketing it.
    const g = gateRowConservation(rows.length, appointments.length - 1, rejected);
    expect(g.ok).toBe(false);
    expect(g.fails).toBe(1);
  });

  it('counts genuinely rejected rows so a legitimate rejection still passes', () => {
    const { rows, appointments, rejected } = parse([row({}), row({ ADV_NUMBER: '' })]);
    expect(rejected.no_adviser_number).toBe(1);
    expect(gateRowConservation(rows.length, appointments.length, rejected).ok).toBe(true);
  });
});

describe('gateStatusCoherence', () => {
  it('passes when Current always means no end date', () => {
    const { appointments } = parse([
      row({ ADV_ROLE_STATUS: 'Current', ADV_END_DT: '' }),
      row({ ADV_NUMBER: '2', ADV_ROLE_STATUS: 'Ceased', ADV_END_DT: '01/01/2020' }),
    ]);
    expect(gateStatusCoherence(appointments).ok).toBe(true);
  });

  it('FAILS on a Current row that also carries an end date', () => {
    const { appointments } = parse([row({ ADV_ROLE_STATUS: 'Current', ADV_END_DT: '01/01/2020' })]);
    const g = gateStatusCoherence(appointments);
    expect(g.ok).toBe(false);
    expect(g.fails).toBe(1);
  });

  it('FAILS on a Ceased row with no end date', () => {
    const { appointments } = parse([row({ ADV_ROLE_STATUS: 'Ceased', ADV_END_DT: '' })]);
    expect(gateStatusCoherence(appointments).ok).toBe(false);
  });
});

describe('gateDatingRule — the load-bearing gate', () => {
  it('passes on a register with the real structural property', () => {
    const { appointments } = parse(realisticRegister());
    const g = gateDatingRule(appointments);
    expect(g.ok).toBe(true);
    expect(g.phantom).toBe(3);
    expect(g.perGroup.cba).toEqual({ naive: 2, dated: 1 });
    expect(g.perGroup.nab).toEqual({ naive: 2, dated: 2 });
  });

  it('FAILS when the date intersection is removed entirely', () => {
    // The catastrophic regression: everything counted naively. CBA/ANZ/AMP no
    // longer differ from their naive counts, so the gate must reject it.
    const { appointments } = parse(realisticRegister());
    const broken = stripCeaseDates(appointments);
    const g = gateDatingRule(broken);
    expect(g.ok).toBe(false);
    expect(g.problems.some((p: string) => p.startsWith('cba'))).toBe(true);
  });

  it('CRITICAL: a check written only against NAB or Westpac passes on that broken build', () => {
    // This is the au-bushfires lesson made executable. Measuring the guard on a
    // group where the fault cannot appear proves nothing at all.
    const { appointments } = parse(realisticRegister());
    const broken = stripCeaseDates(appointments);
    const g = gateDatingRule(broken);
    // NAB and Westpac are IDENTICAL between the correct and broken builds…
    expect(g.perGroup.nab).toEqual({ naive: 2, dated: 2 });
    expect(g.perGroup.wbc).toEqual({ naive: 2, dated: 2 });
    // …so only the cba/anz/amp assertions catch it.
    expect(g.problems.every((p: string) => !p.startsWith('nab') && !p.startsWith('wbc'))).toBe(true);
    expect(g.ok).toBe(false);
  });

  it('FAILS when the rule is applied so aggressively that NAB and Westpac also change', () => {
    // The opposite regression: an off-by-one that excludes appointments starting
    // exactly ON the cease date would move groups that must not move.
    const { appointments } = parse(realisticRegister());
    const overZealous = appointments.map((a) => ({
      ...a,
      chain: a.chain.map((c) => (/NATIONAL AUSTRALIA|WESTPAC/.test(c.name) ? { ...c, ceased: 0 } : c)),
    }));
    const g = gateDatingRule(overZealous);
    expect(g.ok).toBe(false);
    expect(g.problems.some((p: string) => p.startsWith('nab') || p.startsWith('wbc'))).toBe(true);
  });

  it('FAILS when no phantoms are found at all', () => {
    const { appointments } = parse([
      row({ ADV_NUMBER: '1', ADV_START_DT: '01/01/2010', LICENCE_CONTROLLED_BY: 'X ~ AMP LIMITED' }),
    ]);
    expect(gateDatingRule(appointments).ok).toBe(false);
  });
});

describe('gateMovementConservation', () => {
  const sample = () => parse([
    row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'A', ADV_START_DT: '01/01/2010', ADV_END_DT: '01/01/2015', ADV_ROLE_STATUS: 'Ceased' }),
    row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'B', ADV_START_DT: '01/01/2015', ADV_END_DT: '01/01/2020', ADV_ROLE_STATUS: 'Ceased' }),
    row({ ADV_NUMBER: '2', LICENCE_NUMBER: 'A', ADV_START_DT: '01/01/2012' }),
  ]);

  it('passes when transitions, exits and edge weights all agree', () => {
    const { appointments } = sample();
    const careers = buildCareers(appointments);
    const m = buildMovements(careers);
    const g = gateMovementConservation(careers, m);
    expect(g.ok).toBe(true);
    expect(m.transitions).toBe(1);
    expect(m.exits).toBe(1);
  });

  it('FAILS when an edge is dropped so the weights no longer reconcile', () => {
    const { appointments } = sample();
    const careers = buildCareers(appointments);
    const m = buildMovements(careers);
    const broken = { ...m, edges: m.edges.slice(1) };
    expect(gateMovementConservation(careers, broken).ok).toBe(false);
  });

  it('FAILS when exits are not emitted for departed advisers', () => {
    const { appointments } = sample();
    const careers = buildCareers(appointments);
    const m = buildMovements(careers);
    const broken = {
      ...m,
      exits: 0,
      edges: m.edges.filter((e: { to: string }) => e.to !== '__EXIT__'),
    };
    const g = gateMovementConservation(careers, broken);
    expect(g.ok).toBe(false);
    expect(g.problems.some((p: string) => p.includes('exits'))).toBe(true);
  });
});

describe('gateGeographyScope', () => {
  it('passes when current rows are well-addressed and ceased rows are not', () => {
    const lines = [];
    for (let i = 0; i < 100; i++) lines.push(row({ ADV_NUMBER: `C${i}`, ADV_ADD_PCODE: '2000' }));
    for (let i = 0; i < 100; i++) {
      lines.push(row({
        ADV_NUMBER: `X${i}`, ADV_ROLE_STATUS: 'Ceased', ADV_END_DT: '01/01/2020',
        ADV_ADD_PCODE: i < 35 ? '2000' : '',
      }));
    }
    const { appointments } = parse(lines);
    expect(gateGeographyScope(appointments).ok).toBe(true);
  });

  it('FAILS when current rows lose their addresses — the map would go blank', () => {
    const lines = [];
    for (let i = 0; i < 100; i++) lines.push(row({ ADV_NUMBER: `C${i}`, ADV_ADD_PCODE: i < 50 ? '2000' : '' }));
    lines.push(row({ ADV_NUMBER: 'X', ADV_ROLE_STATUS: 'Ceased', ADV_END_DT: '01/01/2020', ADV_ADD_PCODE: '' }));
    const { appointments } = parse(lines);
    expect(gateGeographyScope(appointments).ok).toBe(false);
  });

  it('FAILS when historical geography becomes usable, because the UI caveat would be stale', () => {
    const lines = [];
    for (let i = 0; i < 100; i++) lines.push(row({ ADV_NUMBER: `C${i}`, ADV_ADD_PCODE: '2000' }));
    for (let i = 0; i < 100; i++) {
      lines.push(row({ ADV_NUMBER: `X${i}`, ADV_ROLE_STATUS: 'Ceased', ADV_END_DT: '01/01/2020', ADV_ADD_PCODE: '2000' }));
    }
    const { appointments } = parse(lines);
    const g = gateGeographyScope(appointments);
    expect(g.ok).toBe(false);
    expect(g.problems[0]).toContain('stale');
  });
});

describe('gateCensusAnchor', () => {
  it('passes on the real observed total, which is 32 people off the published figure', () => {
    expect(gateCensusAnchor(25422756, 2643).ok).toBe(true);
  });

  it('FAILS when the sex dimension is not filtered and the total roughly doubles', () => {
    expect(gateCensusAnchor(CENSUS_2021_PERSONS * 2, 2643).ok).toBe(false);
  });

  it('FAILS when a wrong characteristic code is used and the total collapses', () => {
    expect(gateCensusAnchor(1_200_000, 2643).ok).toBe(false);
  });

  it('FAILS when only a handful of postcodes parse', () => {
    expect(gateCensusAnchor(CENSUS_2021_PERSONS, 12).ok).toBe(false);
  });
});

describe('gateBoundaryCoverage', () => {
  const poly = (code: string, n: number) => ({
    type: 'Feature' as const,
    properties: { poa_code_2021: code },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [Array.from({ length: n }, (_, i) => [150 + i * 0.001, -33 + i * 0.001])],
    },
  });
  const realistic = () => {
    const f = [poly('2000', 12000), poly('3000', 12000)];
    return f;
  };

  it('passes when unmatched postcodes are genuinely non-residential', () => {
    const g = gateBoundaryCoverage(realistic(), ['2000', '3000', '2001'], { 2000: 27936, 3000: 40000 });
    expect(g.ok).toBe(true);
    expect(g.classification.nonResidential).toEqual(['2001']);
  });

  it('FAILS when a POPULATED postcode has no boundary — a genuinely incomplete file', () => {
    const g = gateBoundaryCoverage(realistic(), ['2000', '3000', '4000'], { 2000: 27936, 3000: 40000, 4000: 15000 });
    expect(g.ok).toBe(false);
    expect(g.problems[0]).toContain('4000');
  });

  it('FAILS on hand-drawn geometry — a whole-country layer cannot have 8 vertices', () => {
    const g = gateBoundaryCoverage([poly('2000', 4), poly('3000', 4)], ['2000'], { 2000: 27936 });
    expect(g.ok).toBe(false);
    expect(g.problems.some((p: string) => p.includes('not real ABS geometry'))).toBe(true);
  });

  it('FAILS on an empty boundary file', () => {
    expect(gateBoundaryCoverage([], [], {}).ok).toBe(false);
  });

  it('tolerates malformed postcodes without treating them as missing boundaries', () => {
    const g = gateBoundaryCoverage(realistic(), ['2000', 'NSW', 'MSW'], { 2000: 27936 });
    expect(g.ok).toBe(true);
    expect(g.classification.malformed).toEqual(['NSW', 'MSW']);
  });
});

describe('gateSurvivorship — the bias that shipped a meaningless 98.8%', () => {
  /** Careers that all ENDED after the register began, as the real file's do. */
  const modernExits = () => {
    const lines = [];
    for (let i = 0; i < 50; i++) {
      lines.push(row({
        ADV_NUMBER: `A${i}`, ADV_START_DT: '01/01/2016', ADV_END_DT: '01/01/2019',
        ADV_ROLE_STATUS: 'Ceased',
      }));
    }
    return buildCareers(parse(lines).appointments);
  };

  it('passes when exits are only observable from 2015 and no cohort predates it', () => {
    const careers = modernExits();
    const cohorts = cohortSurvival(careers, 2026);
    const g = gateSurvivorship(careers, cohorts);
    expect(g.ok).toBe(true);
    expect(cohorts.every((c: { year: number }) => c.year >= 2015)).toBe(true);
  });

  it('FAILS when a cohort starts before the register did — the exact original defect', () => {
    const careers = modernExits();
    // Reproduce the first implementation: cohorts keyed on the self-reported
    // first-advice year, reaching back to 1990.
    const preRegister = cohortSurvival(careers, 2026, 25, 1990)
      .concat([{ year: 1995, size: 411, observable: 25, points: [{ n: 0, share: 1, alive: 411 }] }]);
    const g = gateSurvivorship(careers, preRegister);
    expect(g.ok).toBe(false);
    expect(g.problems.some((p: string) => p.includes('1995'))).toBe(true);
    expect(g.problems.some((p: string) => p.includes('by construction'))).toBe(true);
  });

  it('FAILS in the OTHER direction if pre-register exits ever become observable', () => {
    // If ASIC back-filled historical exits, the 2015 floor would be needless and
    // the note explaining it would be a false statement about the data.
    const lines = [];
    for (let i = 0; i < 50; i++) {
      lines.push(row({
        ADV_NUMBER: `B${i}`, ADV_START_DT: '01/01/2000', ADV_END_DT: '01/01/2005',
        ADV_ROLE_STATUS: 'Ceased',
      }));
    }
    const careers = buildCareers(parse(lines).appointments);
    const g = gateSurvivorship(careers, []);
    expect(g.ok).toBe(false);
    expect(g.problems[0]).toContain('stale');
  });
});

describe('gateSeriesEra', () => {
  it('passes on a series that starts at the register commencement', () => {
    expect(gateSeriesEra([{ year: 2015, total: 100 }, { year: 2016, total: 120 }]).ok).toBe(true);
  });

  it('FAILS on the pre-register ramp that read as the profession quadrupling', () => {
    const g = gateSeriesEra([{ year: 1999, total: 382 }, { year: 2014, total: 21340 }]);
    expect(g.ok).toBe(false);
    expect(g.problems[0]).toContain('1999');
  });
});

describe('distinctActions', () => {
  it('de-duplicates an action repeated across an adviser\'s appointment rows', () => {
    const { rows } = parseRegister([HEADER,
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'A', ADV_DA_TYPE: 'AFS banned/disqualification' }),
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'B', ADV_DA_TYPE: 'AFS banned/disqualification' }),
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'C', ADV_DA_TYPE: 'AFS banned/disqualification' }),
    ].join('\n'));
    const { appointments } = buildAppointments(rows);
    // Three rows, one action — counting rows would treble it.
    expect(appointments.filter((a) => a.daType)).toHaveLength(3);
    expect(distinctActions(appointments)).toHaveLength(1);
  });

  it('keeps two genuinely different actions against the same adviser', () => {
    const { rows } = parseRegister([HEADER,
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'A', ADV_DA_TYPE: 'AFS banned/disqualification' }),
      row({ ADV_NUMBER: '1', LICENCE_NUMBER: 'B', ADV_DA_TYPE: 'Enforceable undertaking' }),
    ].join('\n'));
    expect(distinctActions(buildAppointments(rows).appointments)).toHaveLength(2);
  });

  it('returns nothing when no action is recorded', () => {
    const { rows } = parseRegister([HEADER, row({})].join('\n'));
    expect(distinctActions(buildAppointments(rows).appointments)).toHaveLength(0);
  });
});

describe('field-count mismatch — the stray tab', () => {
  it('rejects a row whose stray tab shifted every later column', () => {
    const good = row({ ADV_NUMBER: '1' });
    const shifted = `${good}\textra`;
    const { header, rows } = parseRegister([HEADER, good, shifted].join('\n'));
    const { appointments, rejected } = buildAppointments(rows, header.length);
    expect(appointments).toHaveLength(1);
    expect(rejected.field_count_mismatch).toBe(1);
  });

  it('accepts everything when no expected width is supplied, preserving old behaviour', () => {
    const { rows } = parseRegister([HEADER, `${row({ ADV_NUMBER: '1' })}\textra`].join('\n'));
    expect(buildAppointments(rows).appointments).toHaveLength(1);
  });
});

describe('gateFailures', () => {
  it('collects only the failing gates', () => {
    const gates = [{ name: 'a', ok: true }, { name: 'b', ok: false }, { name: 'c', ok: false }];
    expect(gateFailures(gates).map((g: { name: string }) => g.name)).toEqual(['b', 'c']);
  });
});
