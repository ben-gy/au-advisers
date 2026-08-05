// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Everything that turns ASIC's Financial Advisers Register into the site's data
// lives here, with NO node-only imports and NO network access, so the tests can
// import the exact code the pipeline runs. `collect.mjs` does the downloading
// and the file writing; this module does the thinking.
//
// The file is a 54 MB **tab-delimited** export with a `.csv` extension and a
// UTF-8 BOM. Its companion Banned & Disqualified export, confusingly, really is
// comma-delimited — we do not read that one (see README: joining a banning to a
// named person on NAME ALONE is a defamation risk, and ASIC already publishes
// its own disciplinary linkage inside this file).

// ── low-level readers ───────────────────────────────────────────────────

/** Split a delimited line. The register quotes nothing, but a stray quote in a
 *  free-text column must not be allowed to swallow the rest of the row, so this
 *  is a plain split rather than a quote-aware parser — deliberately. */
export function splitRow(line, delim = '\t') {
  return line.split(delim);
}

/** Parse the whole file into objects. Strips the BOM; drops a trailing blank. */
export function parseRegister(text, delim = '\t') {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { header: [], rows: [] };
  const header = splitRow(lines[0], delim).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitRow(lines[i], delim);
    const o = {};
    for (let c = 0; c < header.length; c++) o[header[c]] = (cells[c] ?? '').trim();
    rows.push(o);
  }
  return { header, rows };
}

/** dd/mm/yyyy → a UTC day number (days since 1970-01-01), or null. */
export function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject 31/02/2020 and friends rather than silently rolling into March.
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1) return null;
  return Math.floor(ms / 86400000);
}

export function dayToISO(day) {
  if (day == null) return null;
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

export function dayToYear(day) {
  if (day == null) return null;
  return new Date(day * 86400000).getUTCFullYear();
}

// ── the ownership chain ─────────────────────────────────────────────────
//
// LICENCE_CONTROLLED_BY is a `~`-separated chain from the immediate controller
// outward to the ultimate parent, e.g.
//
//   AKUMIN PTY LTD ~ ENTIRETI LIMITED ~ AMP ADVICE HOLDINGS PTY LTD [Date Ceased: 13/12/2024] ~ …
//
// THE TRAP THAT DEFINES THIS SITE: the chain describes ownership **as it stands
// in the month the file was published**, and it is stamped onto every one of
// the adviser's historical rows, including appointments that ended a decade
// before the parent in question ever acquired the licensee. The `[Date Ceased]`
// marker is the only evidence in the entire file that a link is no longer live.
// Counting an owner's advisers without intersecting dates inflates the answer.

const CEASED_RE = /^(.*?)\s*\[Date Ceased:\s*(\d{1,2}\/\d{1,2}\/\d{4})\]\s*$/;

/** Parse a chain into [{name, ceased(dayNumber|null), depth}], nearest first. */
export function parseChain(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('~')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part, depth) => {
      const m = CEASED_RE.exec(part);
      if (m) return { name: m[1].trim(), ceased: parseDate(m[2]), depth };
      return { name: part, ceased: null, depth };
    });
}

/** The five vertically-integrated owners whose retreat is the site's headline.
 *  Matched on a normalised prefix of the ultimate parent's registered name. */
export const OWNER_GROUPS = [
  { id: 'cba', label: 'CBA', match: 'COMMONWEALTH BANK' },
  { id: 'nab', label: 'NAB', match: 'NATIONAL AUSTRALIA BANK' },
  { id: 'wbc', label: 'Westpac', match: 'WESTPAC BANKING' },
  { id: 'anz', label: 'ANZ', match: 'AUSTRALIA AND NEW ZEALAND BANKING' },
  { id: 'amp', label: 'AMP', match: 'AMP LIMITED' },
];

export function ownerOfName(name) {
  const up = (name || '').toUpperCase();
  for (const g of OWNER_GROUPS) if (up.startsWith(g.match)) return g.id;
  return null;
}

/**
 * Which of the five groups controlled this licensee, for an appointment that
 * started on `startDay`?
 *
 * `dated: false` reproduces the naive read (any mention of the group anywhere in
 * today's chain counts) so the site can SHOW the error rather than just claim it.
 */
export function ownersForAppointment(chain, startDay, dated = true) {
  const out = new Set();
  for (const link of chain) {
    const g = ownerOfName(link.name);
    if (!g) continue;
    if (!dated) { out.add(g); continue; }
    // A link with no cease date is live today, so it covers any past start.
    if (link.ceased == null) { out.add(g); continue; }
    // Otherwise the appointment must have begun while the link still stood.
    if (startDay != null && startDay <= link.ceased) out.add(g);
  }
  return [...out];
}

// ── appointments ────────────────────────────────────────────────────────

export const REJECTION_BUCKETS = ['no_adviser_number', 'no_licensee', 'unparsable_start_date'];

/**
 * Normalise raw register rows into appointment records.
 * Returns { appointments, rejected: {bucket: count}, rejectedRows }.
 * Row conservation is a gate: accepted + every rejection bucket must equal the
 * source row count.
 */
export function buildAppointments(rows) {
  const appointments = [];
  const rejected = Object.fromEntries(REJECTION_BUCKETS.map((b) => [b, 0]));
  const rejectedRows = [];

  for (const r of rows) {
    const advNumber = (r.ADV_NUMBER || '').trim();
    if (!advNumber) { rejected.no_adviser_number++; rejectedRows.push(r); continue; }
    const licNumber = (r.LICENCE_NUMBER || '').trim();
    if (!licNumber) { rejected.no_licensee++; rejectedRows.push(r); continue; }
    const start = parseDate(r.ADV_START_DT);
    if (start == null) { rejected.unparsable_start_date++; rejectedRows.push(r); continue; }

    const end = parseDate(r.ADV_END_DT);
    const chain = parseChain(r.LICENCE_CONTROLLED_BY);
    appointments.push({
      advNumber,
      advName: (r.ADV_NAME || '').trim(),
      subType: (r.ADV_SUB_TYPE || '').trim(),
      current: (r.ADV_ROLE_STATUS || '').trim() === 'Current',
      licNumber,
      licName: (r.LICENCE_NAME || '').trim(),
      chain,
      chainRaw: (r.LICENCE_CONTROLLED_BY || '').trim(),
      start,
      end,
      firstAdvice: /^\d{4}$/.test((r.ADV_FIRST_PROVIDED_ADVICE || '').trim())
        ? Number(r.ADV_FIRST_PROVIDED_ADVICE.trim())
        : null,
      state: (r.ADV_ADD_STATE || '').trim(),
      postcode: (r.ADV_ADD_PCODE || '').trim(),
      locality: (r.ADV_ADD_LOCAL || '').trim(),
      cpdFailure: (r.ADV_CPD_FAILURE_YEAR || '').trim(),
      daType: (r.ADV_DA_TYPE || '').trim(),
      daDesc: (r.ADV_DA_DESCRIPTION || '').trim(),
      daStart: parseDate(r.ADV_DA_START_DT),
      daEnd: parseDate(r.ADV_DA_END_DT),
      restrictions: (r.FURTHER_RESTRICTIONS || '').trim(),
      qualifications: (r.QUALIFICATIONS_AND_TRAINING || '').trim(),
      memberships: (r.MEMBERSHIPS || '').trim(),
      raw: r,
    });
  }
  return { appointments, rejected, rejectedRows };
}

// ── qualifications ──────────────────────────────────────────────────────
//
// "1995 - Bachelor of Business (Accounting/Finance) -  - Charles Sturt University"
//
// Four ` - ` separated fields, any of which may be EMPTY — and the empty third
// field above is the trap. Splitting on `-` alone destroys hyphenated course
// names, but splitting on the regex /\s+-\s+/ is worse: `\s+` is greedy, so on
// `) -  - Charles` it consumes ` -  ` in one match and the SECOND dash is left
// glued to the institution. The result is an empty institution and a `kind` of
// "- Charles Sturt University". Splitting on the literal ` - ` yields the empty
// field correctly, because the separator cannot overlap itself.

export function parseQualifications(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('~')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(' - ').map((p) => p.trim());
      const year = /^\d{4}$/.test((parts[0] || '').trim()) ? Number(parts[0].trim()) : null;
      return {
        year,
        course: (parts[1] || '').trim(),
        kind: (parts[2] || '').trim(),
        institution: (parts.slice(3).join(' - ') || '').trim(),
      };
    })
    .filter((q) => q.course || q.institution);
}

export function parseList(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split('~').map((s) => s.trim()).filter(Boolean);
}

// ── authorisations ──────────────────────────────────────────────────────
//
// Two different encodings share one row: every FIN_*/CLASSES_* column is '1' or
// '0' (blank on ceased rows, which carry no authorisation data at all), while
// ABLE_TO_PROVIDE_TFAS alone is 'Y'/'N'. Treating them uniformly silently makes
// every 'Y' falsy.

export function authFlags(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'ABLE_TO_PROVIDE_TFAS') { if (v === 'Y' || v === 'N') out[k] = v === 'Y'; continue; }
    if (!/^(FIN|CLASSES)/.test(k)) continue;
    if (v === '1') out[k] = true;
    else if (v === '0') out[k] = false;
  }
  return out;
}

// ── careers and movements ───────────────────────────────────────────────

/** Group appointments by adviser, each career sorted by start date. */
export function buildCareers(appointments) {
  const byAdviser = new Map();
  for (const a of appointments) {
    let c = byAdviser.get(a.advNumber);
    if (!c) { c = []; byAdviser.set(a.advNumber, c); }
    c.push(a);
  }
  for (const c of byAdviser.values()) {
    c.sort((x, y) => (x.start - y.start) || (x.licName < y.licName ? -1 : 1));
  }
  return byAdviser;
}

export const EXIT_NODE = '__EXIT__';

/**
 * Consecutive appointments become directed licensee→licensee transitions.
 * An adviser whose last appointment has ended and who holds no current
 * appointment anywhere gets one final edge into an explicit EXIT node, so the
 * graph can never imply that everyone landed somewhere.
 */
export function buildMovements(careers) {
  const edges = new Map();
  let transitions = 0;
  let exits = 0;
  const bump = (from, to, day) => {
    const key = `${from} ${to}`;
    const e = edges.get(key);
    if (e) { e.count++; if (day != null && (e.last == null || day > e.last)) e.last = day; }
    else edges.set(key, { from, to, count: 1, last: day });
  };

  for (const career of careers.values()) {
    // Distinct licensees in career order — repeated stints at one licensee are
    // not a "move", and consecutive rows for the same licensee are common.
    const seq = [];
    for (const a of career) {
      if (!seq.length || seq[seq.length - 1].licNumber !== a.licNumber) seq.push(a);
    }
    for (let i = 1; i < seq.length; i++) {
      bump(seq[i - 1].licNumber, seq[i].licNumber, seq[i].start);
      transitions++;
    }
    const stillIn = career.some((a) => a.current);
    if (!stillIn && seq.length) {
      const last = seq[seq.length - 1];
      bump(last.licNumber, EXIT_NODE, last.end);
      exits++;
    }
  }
  return { edges: [...edges.values()], transitions, exits };
}

// ── the bank-retreat series ─────────────────────────────────────────────

/**
 * Headcount by owner group for each 30 June, replaying every appointment's date
 * range. `dated` toggles the correctness guard so the site can render both.
 */
export function ownerSeries(appointments, years, dated = true) {
  const out = [];
  for (const year of years) {
    const asAt = parseDate(`30/06/${year}`);
    const counts = Object.fromEntries(OWNER_GROUPS.map((g) => [g.id, new Set()]));
    const independent = new Set();
    for (const a of appointments) {
      if (a.start == null || a.start > asAt) continue;
      if (a.end != null && a.end < asAt) continue;
      const owners = ownersForAppointment(a.chain, a.start, dated);
      if (owners.length) for (const o of owners) counts[o].add(a.advNumber);
      else independent.add(a.advNumber);
    }
    const row = { year, independent: independent.size, total: 0 };
    const claimed = new Set();
    for (const g of OWNER_GROUPS) {
      row[g.id] = counts[g.id].size;
      for (const n of counts[g.id]) claimed.add(n);
    }
    // A person under two groups at once (dual appointments) is counted in each
    // band but only once in the total, which is why total is derived, not summed.
    row.total = claimed.size + independent.size;
    out.push(row);
  }
  return out;
}

/** Every adviser who ever sat under one of the five, on the dated rule. */
export function alumniByOwner(appointments, dated = true) {
  const sets = Object.fromEntries(OWNER_GROUPS.map((g) => [g.id, new Set()]));
  for (const a of appointments) {
    for (const o of ownersForAppointment(a.chain, a.start, dated)) sets[o].add(a.advNumber);
  }
  const any = new Set();
  for (const s of Object.values(sets)) for (const n of s) any.add(n);
  return { sets, any };
}

// ── cohort survival ─────────────────────────────────────────────────────

/**
 * THE REGISTER'S START DATE, and why every cohort begins at it.
 *
 * ASIC's Financial Advisers Register commenced in 2015. It carries appointments
 * dating back to 1969, but it does NOT carry the people who had already left
 * before it existed: across all 42,305 advisers, exactly 12 have a last
 * appointment ending before 2015, against 1,733 in 2015 alone.
 *
 * So a "1995 intake" in this file is not the 1995 intake — it is the subset of
 * the 1995 intake that survived twenty years to still be practising when the
 * register switched on. Their measured survival is therefore ~100% for two
 * decades BY CONSTRUCTION, and the shape is an artefact of the register's start
 * date rather than a finding about advisers. Charting it would publish a false
 * claim ("98.8% of the 1995-2012 intakes lasted five years") with a
 * plausible-looking curve behind it.
 *
 * Cohorts therefore start at 2015, and are keyed on the adviser's first
 * OBSERVED APPOINTMENT rather than their self-reported first-advice year —
 * 27.7% of advisers report first giving advice more than three years before
 * their earliest recorded appointment, so the two are not interchangeable.
 */
export const REGISTER_START_YEAR = 2015;

/**
 * Kaplan-Meier-style retention: of the advisers whose first recorded
 * appointment began in `year`, what share were still on the register N years
 * later? Right-censored at the file's own as-at date — a cohort cannot be
 * observed beyond the data, so the curve is truncated rather than drawn to zero.
 */
export function cohortSurvival(careers, asAtYear, maxYears = 25, minYear = REGISTER_START_YEAR) {
  const cohorts = new Map();
  for (const [advNumber, career] of careers) {
    const first = dayToYear(career[0].start);
    if (first == null || first < minYear || first > asAtYear) continue;
    let c = cohorts.get(first);
    if (!c) { c = []; cohorts.set(first, c); }
    // Last year this person was active anywhere. A current appointment means
    // "still here", represented by the as-at year.
    const stillIn = career.some((a) => a.current);
    const lastYear = stillIn
      ? asAtYear
      : Math.max(...career.map((a) => dayToYear(a.end) ?? dayToYear(a.start) ?? first));
    c.push({ advNumber, lastYear, stillIn });
  }
  const out = [];
  for (const [year, members] of [...cohorts].sort((a, b) => a[0] - b[0])) {
    const observable = asAtYear - year;
    const points = [];
    for (let n = 0; n <= Math.min(maxYears, observable); n++) {
      const alive = members.filter((m) => m.lastYear >= year + n).length;
      points.push({ n, share: members.length ? alive / members.length : 0, alive });
    }
    out.push({ year, size: members.length, observable, points });
  }
  return out;
}

/** Entries and exits per year — the register has run net-negative since 2019. */
export function entryExit(careers) {
  const entries = new Map();
  const exits = new Map();
  for (const career of careers.values()) {
    const firstStart = dayToYear(career[0].start);
    if (firstStart != null) entries.set(firstStart, (entries.get(firstStart) ?? 0) + 1);
    const stillIn = career.some((a) => a.current);
    if (!stillIn) {
      const ends = career.map((a) => a.end).filter((d) => d != null);
      const y = ends.length ? dayToYear(Math.max(...ends)) : null;
      if (y != null) exits.set(y, (exits.get(y) ?? 0) + 1);
    }
  }
  // Same survivorship constraint as the cohorts: exits are only observable from
  // the year the register began, so charting entries against exits before then
  // would draw a decade of apparent net growth that is purely an artefact.
  const years = [...new Set([...entries.keys(), ...exits.keys()])]
    .filter((y) => y >= REGISTER_START_YEAR).sort();
  return years.map((y) => ({ year: y, entries: entries.get(y) ?? 0, exits: exits.get(y) ?? 0 }));
}

// ── gates ───────────────────────────────────────────────────────────────
//
// Every gate below is written so that it FAILS on the specific fault it claims
// to catch, and each has a test that injects that exact fault. A gate measured
// somewhere the fault cannot appear is worse than no gate: it prints green and
// buys false confidence. (See the au-bushfires post-mortem.)

export function gateRowConservation(sourceRowCount, acceptedCount, rejected) {
  const rejectedTotal = Object.values(rejected).reduce((a, b) => a + b, 0);
  const ok = acceptedCount + rejectedTotal === sourceRowCount;
  return {
    name: 'row-conservation',
    ok,
    detail: `source ${sourceRowCount} = accepted ${acceptedCount} + rejected ${rejectedTotal}`,
    checks: 1,
    fails: ok ? 0 : 1,
  };
}

export function gateStatusCoherence(appointments) {
  let fails = 0;
  for (const a of appointments) {
    const hasEnd = a.end != null;
    if (a.current === hasEnd) fails++;
  }
  return {
    name: 'status-coherence',
    ok: fails === 0,
    detail: `ADV_ROLE_STATUS=Current <=> blank ADV_END_DT across ${appointments.length} appointments`,
    checks: appointments.length,
    fails,
  };
}

/**
 * THE LOAD-BEARING GATE.
 *
 * Asserts that the dating rule is actually doing work, and — crucially — that
 * it is doing work IN THE PLACES THE FAULT LIVES. The naive and dated counts
 * are IDENTICAL for NAB and Westpac, so a test that only inspects those two
 * passes on an implementation with the date intersection deleted entirely.
 * The gate therefore requires a strictly positive gap on the three groups where
 * ceased links predate appointments (CBA, ANZ, AMP) and exact equality on the
 * two where they do not.
 */
export function gateDatingRule(appointments) {
  const naive = alumniByOwner(appointments, false);
  const dated = alumniByOwner(appointments, true);
  const perGroup = {};
  for (const g of OWNER_GROUPS) {
    perGroup[g.id] = { naive: naive.sets[g.id].size, dated: dated.sets[g.id].size };
  }
  const MUST_DIFFER = ['cba', 'anz', 'amp'];
  const MUST_MATCH = ['nab', 'wbc'];
  const problems = [];
  for (const id of MUST_DIFFER) {
    const { naive: n, dated: d } = perGroup[id];
    if (!(n > d)) problems.push(`${id}: expected naive > dated, got ${n} vs ${d}`);
  }
  for (const id of MUST_MATCH) {
    const { naive: n, dated: d } = perGroup[id];
    if (n !== d) problems.push(`${id}: expected naive == dated, got ${n} vs ${d}`);
  }
  const phantom = naive.any.size - dated.any.size;
  if (phantom <= 0) problems.push(`expected phantom advisers > 0, got ${phantom}`);
  return {
    name: 'dating-rule',
    ok: problems.length === 0,
    detail: `phantom advisers ${phantom}; ` +
      OWNER_GROUPS.map((g) => `${g.label} ${perGroup[g.id].naive}->${perGroup[g.id].dated}`).join(', '),
    checks: OWNER_GROUPS.length + 1,
    fails: problems.length,
    problems,
    perGroup,
    phantom,
  };
}

/**
 * Movement conservation. Every adviser's distinct-licensee sequence of length L
 * must contribute exactly L-1 transitions, plus one exit edge iff they hold no
 * current appointment. Checked against the totals the graph actually emitted.
 */
export function gateMovementConservation(careers, movements) {
  let expectedTransitions = 0;
  let expectedExits = 0;
  for (const career of careers.values()) {
    const seq = [];
    for (const a of career) {
      if (!seq.length || seq[seq.length - 1] !== a.licNumber) seq.push(a.licNumber);
    }
    expectedTransitions += Math.max(0, seq.length - 1);
    if (!career.some((a) => a.current)) expectedExits++;
  }
  const edgeSum = movements.edges.reduce((s, e) => s + e.count, 0);
  const problems = [];
  if (movements.transitions !== expectedTransitions) {
    problems.push(`transitions ${movements.transitions} != expected ${expectedTransitions}`);
  }
  if (movements.exits !== expectedExits) {
    problems.push(`exits ${movements.exits} != expected ${expectedExits}`);
  }
  if (edgeSum !== expectedTransitions + expectedExits) {
    problems.push(`edge weight sum ${edgeSum} != ${expectedTransitions + expectedExits}`);
  }
  return {
    name: 'movement-conservation',
    ok: problems.length === 0,
    detail: `${movements.transitions} transitions + ${movements.exits} exits = ${edgeSum} edge weight`,
    checks: 3,
    fails: problems.length,
    problems,
  };
}

/**
 * Geography honesty.
 *
 * The map is built from CURRENT appointments only. That is not a convenience —
 * it is forced by the data, and this gate is what proves it rather than
 * assuming it. Address coverage is near-total on current rows (99.8%) and only
 * about a third on ceased rows, so a historical map would chart where ASIC
 * happens to hold an address, not where advisers were. The gate fails if that
 * asymmetry ever disappears, because at that point the UI's caveat would have
 * become a false statement about the data.
 */
export function gateGeographyScope(appointments) {
  const current = appointments.filter((a) => a.current);
  const ceased = appointments.filter((a) => !a.current);
  const currentWithPc = current.filter((a) => a.postcode).length;
  const ceasedWithPc = ceased.filter((a) => a.postcode).length;
  const curShare = currentWithPc / Math.max(1, current.length);
  const ceaShare = ceasedWithPc / Math.max(1, ceased.length);
  const problems = [];
  if (!(curShare > 0.95)) {
    problems.push(`current rows with a postcode ${(curShare * 100).toFixed(1)}% <= 95%`);
  }
  if (!(ceaShare < 0.6)) {
    problems.push(
      `ceased rows now carry a postcode ${(ceaShare * 100).toFixed(1)}% of the time — ` +
      `historical geography may have become usable, and the map's "current only" caveat is stale`,
    );
  }
  return {
    name: 'geography-scope',
    ok: problems.length === 0,
    detail: `postcode coverage: current ${(curShare * 100).toFixed(1)}% (${currentWithPc}/${current.length}), ` +
      `ceased ${(ceaShare * 100).toFixed(1)}% (${ceasedWithPc}/${ceased.length})`,
    checks: 2,
    fails: problems.length,
    problems,
  };
}

/**
 * ANCHOR GATE for the per-capita denominator.
 *
 * The postcode populations come from the 2021 Census G01 table, which publishes
 * a national total we can check against an independently published figure. If a
 * column shifts, a code changes meaning, or the sex dimension stops being
 * filtered, the sum moves by millions and this catches it. The tolerance is
 * wide enough to absorb ABS's cell perturbation (observed: 32 people out of
 * 25.4 million) and far too tight to absorb a real parsing fault.
 */
export const CENSUS_2021_PERSONS = 25422788;

export function gateCensusAnchor(totalPersons, postcodeCount) {
  const ratio = totalPersons / CENSUS_2021_PERSONS;
  const problems = [];
  if (!(ratio > 0.999 && ratio < 1.001)) {
    problems.push(`national census sum ${totalPersons} is ${(ratio * 100).toFixed(2)}% of the published 25,422,788`);
  }
  if (!(postcodeCount > 2000)) {
    problems.push(`only ${postcodeCount} postcodes carry a population — expected >2000`);
  }
  return {
    name: 'census-anchor',
    ok: problems.length === 0,
    detail: `${totalPersons.toLocaleString('en-AU')} persons across ${postcodeCount} postcodes ` +
      `(${(ratio * 100).toFixed(3)}% of the published national count)`,
    checks: 2,
    fails: problems.length,
    problems,
  };
}

/** A postcode the ABS would recognise: exactly four digits. */
export function isPostcodeShaped(pc) {
  return /^\d{4}$/.test((pc || '').trim());
}

/**
 * Classify every adviser postcode against the boundary and census files.
 *
 *  mapped        — has an ABS polygon; can be drawn.
 *  nonResidential— four digits, but no polygon AND no census population. These
 *                  are real: PO-box and large-volume-receiver ranges (2001,
 *                  4001, 6909, 7001…) that ABS does not publish as areas
 *                  because nobody lives in them. An adviser's *business*
 *                  address is legitimately one of these.
 *  malformed     — not four digits at all. ASIC's register genuinely contains a
 *                  handful of rows where the postcode column holds a state
 *                  abbreviation, including one 'MSW' typo for NSW.
 */
export function classifyPostcodes(postcodes, boundaryCodes, population) {
  const mapped = [];
  const nonResidential = [];
  const malformed = [];
  for (const pc of postcodes) {
    if (!isPostcodeShaped(pc)) { malformed.push(pc); continue; }
    if (boundaryCodes.has(pc)) { mapped.push(pc); continue; }
    nonResidential.push(pc);
  }
  return { mapped, nonResidential, malformed, population };
}

/**
 * The map must not invent coverage, and must not silently drop anyone either.
 *
 * The first version of this gate simply required "at most 5 unmatched adviser
 * postcodes" and failed on the real file. That failure was correct and the fix
 * is NOT to raise the threshold — it is to state precisely which absences are
 * legitimate. An unmatched postcode is only acceptable if the census also has
 * no population for it, i.e. ABS agrees it is not a place where people live.
 * A POPULATED residential postcode with no polygon would be a genuine bug and
 * still fails here, at any count.
 */
export function gateBoundaryCoverage(features, adviserPostcodes, population) {
  const codes = new Set(features.map((f) => f.properties?.poa_code_2021).filter(Boolean));
  const cls = classifyPostcodes(adviserPostcodes, codes, population);
  let vertices = 0;
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') for (const r of g.coordinates) vertices += r.length;
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) for (const r of p) vertices += r.length;
  }
  const problems = [];
  // The only unforgivable case: unmatched AND populated.
  const populatedButUnmapped = cls.nonResidential.filter((pc) => (population[pc] ?? 0) > 0);
  if (populatedButUnmapped.length) {
    problems.push(
      `${populatedButUnmapped.length} postcode(s) have a census population but no boundary ` +
      `(${populatedButUnmapped.slice(0, 5).join(', ')}) — the boundary file is incomplete`,
    );
  }
  if (vertices < 20000) {
    problems.push(`boundary file has only ${vertices} vertices — that is not real ABS geometry`);
  }
  if (!codes.size) problems.push('no boundary polygons at all');
  return {
    name: 'boundary-coverage',
    ok: problems.length === 0,
    detail: `${features.length} polygons, ${vertices.toLocaleString('en-AU')} vertices; adviser postcodes: ` +
      `${cls.mapped.length} mapped, ${cls.nonResidential.length} non-residential (PO box), ${cls.malformed.length} malformed`,
    checks: 3,
    fails: problems.length,
    problems,
    classification: cls,
  };
}

/**
 * SURVIVORSHIP GATE.
 *
 * Asserts the property that forces every cohort to start at 2015: the register
 * contains essentially nobody who left before it began. If that ever stopped
 * being true — ASIC back-filling historical exits — the 2015 floor would be
 * needless and the note explaining it would be wrong, so the gate fails in
 * BOTH directions.
 *
 * It also asserts that no cohort the site actually charts begins before the
 * register did. That is the check that would have caught the first version,
 * which charted intakes back to 1995 and reported a 98.8% five-year survival
 * rate that was pure artefact.
 */
export function gateSurvivorship(careers, cohorts) {
  const problems = [];
  let exitedBefore = 0;
  let exitedAfter = 0;
  for (const career of careers.values()) {
    if (career.some((a) => a.current)) continue;
    const ends = career.map((a) => a.end).filter((d) => d != null);
    if (!ends.length) continue;
    const y = dayToYear(Math.max(...ends));
    if (y == null) continue;
    if (y < REGISTER_START_YEAR) exitedBefore++;
    else exitedAfter++;
  }
  // Pre-register exits must be a rounding error against post-register ones.
  const ratio = exitedBefore / Math.max(1, exitedAfter);
  if (ratio > 0.01) {
    problems.push(
      `${exitedBefore} advisers left before ${REGISTER_START_YEAR} vs ${exitedAfter} after ` +
      `(${(ratio * 100).toFixed(2)}%) — exits now look observable pre-register, so the cohort floor ` +
      `and the note explaining it are stale`,
    );
  }
  const early = cohorts.filter((c) => c.year < REGISTER_START_YEAR);
  if (early.length) {
    problems.push(
      `${early.length} cohort(s) start before ${REGISTER_START_YEAR} (earliest ${early[0].year}) — ` +
      `their survival is ~100% by construction because the register cannot see who had already left`,
    );
  }
  return {
    name: 'survivorship',
    ok: problems.length === 0,
    detail: `${exitedBefore} pre-${REGISTER_START_YEAR} exits vs ${exitedAfter} after; ` +
      `${cohorts.length} cohorts, earliest ${cohorts.length ? cohorts[0].year : 'n/a'}`,
    checks: 2,
    fails: problems.length,
    problems,
  };
}

export function reportGate(g) {
  return `${g.ok ? 'PASS' : 'FAIL'}  ${g.name.padEnd(24)} ${g.detail}` +
    (g.problems && g.problems.length ? `\n        ${g.problems.join('\n        ')}` : '');
}

export function gateFailures(gates) {
  return gates.filter((g) => !g.ok);
}
