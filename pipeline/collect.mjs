// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Downloads ASIC's Financial Advisers Register, runs every gate in parse.mjs,
// and writes public/data/*.json. All of the thinking is in parse.mjs so the
// tests exercise the same code this runs.
//
// The download URL is never hardcoded: ASIC republishes monthly under a new
// filename (financial_advisers_YYYYMM.csv) but CKAN keeps a stable RESOURCE id,
// so we resolve through package_show and validate BY CONTENT (expected columns
// plus a plausible row count), never by filename.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDefaultResultOrder } from 'node:dns';
import {
  parseRegister, buildAppointments, buildCareers, buildMovements, ownerSeries,
  alumniByOwner, cohortSurvival, entryExit, parseChain, ownerOfName, OWNER_GROUPS,
  parseQualifications, parseList, authFlags, dayToISO, dayToYear, parseDate, EXIT_NODE,
  gateRowConservation, gateStatusCoherence, gateDatingRule, gateMovementConservation,
  gateGeographyScope, gateCensusAnchor, gateBoundaryCoverage, gateSurvivorship, gateSeriesEra,
  distinctActions, REGISTER_START_YEAR, reportGate, gateFailures,
} from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'public', 'data');
const CACHE = join(HERE, 'raw');

// GitHub runners resolve AAAA first and some AU government hosts hold an IPv6
// route they never answer on, so requests die as a bare "fetch failed" only on
// CI. Pin the resolver order; it costs nothing locally.
setDefaultResultOrder('ipv4first');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const PACKAGE_ID = 'f2b7c2c1-f4ef-4ae9-aba5-45c19e4d3038';
const FALLBACK_CSV = 'https://data.gov.au/data/dataset/f2b7c2c1-f4ef-4ae9-aba5-45c19e4d3038/resource/91d80440-5787-46fc-99de-0c1d93e6cc9f/download/financial_advisers_202607.csv';
const REQUIRED_COLUMNS = [
  'ADV_NAME', 'ADV_NUMBER', 'ADV_ROLE_STATUS', 'LICENCE_NAME', 'LICENCE_NUMBER',
  'LICENCE_CONTROLLED_BY', 'ADV_START_DT', 'ADV_END_DT', 'ADV_FIRST_PROVIDED_ADVICE',
  'ADV_ADD_STATE', 'ADV_ADD_PCODE', 'ADV_DA_TYPE', 'QUALIFICATIONS_AND_TRAINING',
];

const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { retries = 4, label = url } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 180000);
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en-AU,en;q=0.9' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      log(`  ! ${label} attempt ${attempt}/${retries}: ${err.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function resolveCsvUrl() {
  try {
    const txt = await fetchText(
      `https://data.gov.au/data/api/3/action/package_show?id=${PACKAGE_ID}`,
      { label: 'CKAN package_show', retries: 3 },
    );
    const pkg = JSON.parse(txt).result;
    const csv = pkg.resources.find(
      (r) => (r.format || '').toUpperCase() === 'CSV' && /financial_advisers/i.test(r.url),
    );
    if (csv) {
      log(`  resolved via CKAN: ${csv.name} (${csv.size ?? '?'} bytes)`);
      return csv.url;
    }
  } catch (err) {
    log(`  ! CKAN resolve failed (${err.message}); using pinned fallback URL`);
  }
  return FALLBACK_CSV;
}

/**
 * ABS ASGS 2021 postcode boundaries, straight from the authoritative ArcGIS
 * service and generalised SERVER-SIDE via maxAllowableOffset (the service's own
 * Douglas-Peucker), so no geometry is ever hand-authored and no extra
 * simplification toolchain has to survive CI. The service caps a page at 2,000
 * features, so this pages until it stops reporting a transfer limit.
 */
async function loadBoundaries() {
  const cached = join(CACHE, 'poa.geojson');
  if (existsSync(cached) && !process.env.FORCE_DOWNLOAD) {
    log(`  using cached ${cached}`);
    return JSON.parse(readFileSync(cached, 'utf8'));
  }
  const base = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query';
  const features = [];
  for (let offset = 0; offset < 6000; offset += 2000) {
    const url = `${base}?where=1%3D1&outFields=poa_code_2021&returnGeometry=true` +
      `&maxAllowableOffset=0.008&geometryPrecision=4&outSR=4326&f=geojson` +
      `&resultOffset=${offset}&resultRecordCount=2000`;
    const txt = await fetchText(url, { label: `POA boundaries @${offset}` });
    const page = JSON.parse(txt);
    const got = page.features ?? [];
    log(`    page @${offset}: ${got.length} polygons`);
    features.push(...got);
    if (got.length < 2000) break;
  }
  const fc = { type: 'FeatureCollection', features };
  writeFileSync(cached, JSON.stringify(fc));
  return fc;
}

/**
 * 2021 Census G01 by postcode — the finest geography ABS publishes population
 * for. PCHAR 'P_1' with SEXP '3' is total persons; filtering either dimension
 * wrongly changes the national sum by millions, which is what gateCensusAnchor
 * is for.
 */
async function loadPopulation() {
  const cached = join(CACHE, 'poa-population.json');
  if (existsSync(cached) && !process.env.FORCE_DOWNLOAD) {
    log(`  using cached ${cached}`);
    return JSON.parse(readFileSync(cached, 'utf8'));
  }
  const url = 'https://data.api.abs.gov.au/rest/data/ABS,C21_G01_POA,1.0.0/all?startPeriod=2021&format=csvfile';
  const txt = await fetchText(url, { label: 'ABS Census G01 by POA' });
  const lines = txt.split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const iPchar = header.indexOf('PCHAR');
  const iSex = header.indexOf('SEXP');
  const iRegion = header.indexOf('REGION');
  const iType = header.indexOf('REGION_TYPE');
  const iVal = header.indexOf('OBS_VALUE');
  if (Math.min(iPchar, iSex, iRegion, iVal) < 0) throw new Error('census CSV is missing expected columns');
  const pop = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(',');
    if (c[iPchar] !== 'P_1' || c[iSex] !== '3') continue;
    if (iType >= 0 && c[iType] !== 'POA') continue;
    const n = Number(c[iVal]);
    if (Number.isFinite(n)) pop[c[iRegion]] = n;
  }
  writeFileSync(cached, JSON.stringify(pop));
  return pop;
}

async function loadRegister() {
  mkdirSync(CACHE, { recursive: true });
  const cached = join(CACHE, 'far.csv');
  if (existsSync(cached) && !process.env.FORCE_DOWNLOAD) {
    log(`  using cached ${cached}`);
    return readFileSync(cached, 'utf8');
  }
  const url = await resolveCsvUrl();
  log(`  downloading ${url}`);
  const text = await fetchText(url, { label: 'adviser register' });
  writeFileSync(cached, text);
  return text;
}

// ── main ────────────────────────────────────────────────────────────────

log('Financial Advisers Register — collect');
const text = await loadRegister();
const { header, rows } = parseRegister(text);
log(`  parsed ${rows.length} rows x ${header.length} columns`);

// Validate BY CONTENT. A filename can change; a missing column means the
// release changed shape and every number downstream would be quietly wrong.
const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
if (missing.length) throw new Error(`register is missing expected columns: ${missing.join(', ')}`);
if (rows.length < 50000) throw new Error(`register has only ${rows.length} rows — refusing to ship a truncated file`);

const { appointments, rejected } = buildAppointments(rows, header.length);
const careers = buildCareers(appointments);
const movements = buildMovements(careers);
log(`  ${appointments.length} appointments, ${careers.size} advisers, ${movements.edges.length} edges`);

// The as-at date is the newest appointment start in the file — a data-derived
// stamp, so re-running the pipeline without new data produces no diff.
const asAtDay = Math.max(...appointments.map((a) => a.start));
const asAtYear = dayToYear(asAtDay);
const asAt = dayToISO(asAtDay);

// ── gates ───────────────────────────────────────────────────────────────
const gates = [
  gateRowConservation(rows.length, appointments.length, rejected),
  gateStatusCoherence(appointments),
  gateDatingRule(appointments),
  gateMovementConservation(careers, movements, appointments),
  gateGeographyScope(appointments),
];
log('\nGATES');
for (const g of gates) log(reportGate(g));
const failed = gateFailures(gates);
if (failed.length) {
  throw new Error(`${failed.length} gate(s) failed — refusing to write data: ${failed.map((g) => g.name).join(', ')}`);
}
log('');

// ── licensees ───────────────────────────────────────────────────────────
const licensees = new Map();
for (const a of appointments) {
  let l = licensees.get(a.licNumber);
  if (!l) {
    l = {
      num: a.licNumber, name: a.licName, chainRaw: a.chainRaw,
      total: new Set(), current: new Set(), firstSeen: a.start, lastSeen: a.start,
    };
    licensees.set(a.licNumber, l);
  }
  // Keep the chain from a current row where one exists — ceased rows can carry
  // an older rendering of the same chain.
  if (a.current && a.chainRaw) { l.chainRaw = a.chainRaw; l.name = a.licName; }
  l.total.add(a.advNumber);
  if (a.current) l.current.add(a.advNumber);
  if (a.start < l.firstSeen) l.firstSeen = a.start;
  const seen = a.end ?? a.start;
  if (seen > l.lastSeen) l.lastSeen = seen;
}

const licList = [...licensees.values()]
  .map((l) => {
    const chain = parseChain(l.chainRaw);
    const ultimate = chain.length ? chain[chain.length - 1] : null;
    return {
      num: l.num,
      name: l.name,
      chain: chain.map((c) => ({ n: c.name, c: c.ceased == null ? null : dayToISO(c.ceased) })),
      owner: chain.map((c) => ownerOfName(c.name)).find(Boolean) ?? null,
      ownerLive: chain.some((c) => ownerOfName(c.name) && c.ceased == null),
      ultimate: ultimate ? ultimate.name : null,
      total: l.total.size,
      current: l.current.size,
      first: dayToISO(l.firstSeen),
      last: dayToISO(l.lastSeen),
      alive: l.current.size > 0,
    };
  })
  .sort((a, b) => b.total - a.total);
const licIndex = new Map(licList.map((l, i) => [l.num, i]));

// ── advisers (compact columnar index for the 42k-row search) ────────────
const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', ''];
const DA_TYPES = [
  'AFS banned/disqualification', 'Enforceable undertaking', 'FSCP action',
  'Disqualified person', 'Credit banned/disqualification', 'SMSF auditor disqualification',
];

const advList = [];
for (const [advNumber, career] of careers) {
  const cur = career.filter((a) => a.current);
  const latest = cur.length ? cur[cur.length - 1] : career[career.length - 1];
  const das = career.filter((a) => a.daType);
  const cpd = [...new Set(career.map((a) => a.cpdFailure).filter(Boolean))].sort();
  const firstAdvice = career.find((a) => a.firstAdvice != null)?.firstAdvice ?? null;
  const owners = new Set();
  for (const a of career) {
    for (const link of a.chain) {
      const g = ownerOfName(link.name);
      if (!g) continue;
      if (link.ceased == null || a.start <= link.ceased) owners.add(g);
    }
  }
  advList.push({
    n: advNumber,
    name: latest.advName,
    cur: cur.length > 0 ? 1 : 0,
    lic: licIndex.get(latest.licNumber) ?? -1,
    st: Math.max(0, STATES.indexOf(latest.state)),
    pc: latest.postcode || '',
    fy: firstAdvice,
    apps: career.length,
    start: dayToISO(career[0].start),
    end: cur.length ? null : dayToISO(Math.max(...career.map((a) => a.end ?? a.start))),
    da: das.length ? [...new Set(das.map((a) => DA_TYPES.indexOf(a.daType)).filter((i) => i >= 0))] : [],
    // The year the adviser's LAST action ended, or null if one is still running.
    // Without this the UI can only say "ASIC action" in the present tense, which
    // is wrong for the 142 of 277 whose actions have all expired.
    daEnd: das.length
      ? (das.some((a) => a.daEnd == null) ? null : dayToYear(Math.max(...das.map((a) => a.daEnd))))
      : undefined,
    cpd,
    own: [...owners],
    sub: latest.subType,
  });
}
advList.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const advIndex = new Map(advList.map((a, i) => [a.n, i]));

// Per-adviser appointment detail, keyed by adviser index, for the dossier.
const appsByAdviser = advList.map(() => []);
for (const [advNumber, career] of careers) {
  const i = advIndex.get(advNumber);
  for (const a of career) {
    appsByAdviser[i].push({
      l: licIndex.get(a.licNumber) ?? -1,
      s: dayToISO(a.start),
      e: a.end == null ? null : dayToISO(a.end),
      o: [...new Set(a.chain.map((c) => (ownerOfName(c.name) && (c.ceased == null || a.start <= c.ceased)) ? ownerOfName(c.name) : null).filter(Boolean))],
      t: a.subType || null,
      d: a.daType ? { t: DA_TYPES.indexOf(a.daType), s: dayToISO(a.daStart), e: dayToISO(a.daEnd), x: a.daDesc.slice(0, 400) } : null,
      r: a.restrictions ? a.restrictions.slice(0, 500) : null,
    });
  }
}

// Qualifications/memberships/authorisations only from the most recent row.
const advExtra = advList.map(() => null);
for (const [advNumber, career] of careers) {
  const i = advIndex.get(advNumber);
  const cur = career.filter((a) => a.current);
  const src = cur.length ? cur[cur.length - 1] : career[career.length - 1];
  const flags = authFlags(src.raw);
  advExtra[i] = {
    q: parseQualifications(src.qualifications),
    m: parseList(src.memberships),
    a: Object.entries(flags).filter(([, v]) => v).map(([k]) => k),
  };
}

// ── series ──────────────────────────────────────────────────────────────
const YEARS = [];
for (let y = REGISTER_START_YEAR; y <= asAtYear; y++) YEARS.push(y);
log('  building owner series (dated)…');
const seriesDated = ownerSeries(appointments, YEARS, true);
log('  building owner series (naive)…');
const seriesNaive = ownerSeries(appointments, YEARS, false);

const alumniDated = alumniByOwner(appointments, true);
const alumniNaive = alumniByOwner(appointments, false);
const currentAdvisers = new Set(appointments.filter((a) => a.current).map((a) => a.advNumber));
const alumniStillPractising = [...alumniDated.any].filter((n) => currentAdvisers.has(n)).length;
const underLiveChain = new Set(
  appointments
    .filter((a) => a.current && a.chain.some((c) => ownerOfName(c.name) && c.ceased == null))
    .map((a) => a.advNumber),
).size;

const cohorts = cohortSurvival(careers, asAtYear);
const flow = entryExit(careers);

// Runs here rather than with the first batch because it needs the cohorts.
const survivorGate = gateSurvivorship(careers, cohorts);
const seriesGate = gateSeriesEra(seriesDated);
for (const g of [survivorGate, seriesGate]) log(reportGate(g));
if (!survivorGate.ok || !seriesGate.ok) throw new Error('survivorship/series gate failed');
gates.push(survivorGate, seriesGate);

// ── movement graph, trimmed to what a browser can render honestly ───────
const edgesOut = movements.edges
  .filter((e) => e.count >= 3 && e.to !== EXIT_NODE)
  .sort((a, b) => b.count - a.count)
  .map((e) => ({ f: licIndex.get(e.from) ?? -1, t: licIndex.get(e.to) ?? -1, c: e.count }))
  .filter((e) => e.f >= 0 && e.t >= 0);
const exitEdges = movements.edges
  .filter((e) => e.to === EXIT_NODE)
  .map((e) => ({ f: licIndex.get(e.from) ?? -1, c: e.count }))
  .filter((e) => e.f >= 0);
// Full-weight edges (including 1s and exits) for the per-licensee diaspora view.
const allEdges = movements.edges
  .map((e) => ({
    f: licIndex.get(e.from) ?? -1,
    t: e.to === EXIT_NODE ? -2 : (licIndex.get(e.to) ?? -1),
    c: e.count,
  }))
  .filter((e) => e.f >= 0 && e.t !== -1);

// ── authorisations ──────────────────────────────────────────────────────
const AUTH_LABELS = {
  FIN: 'All financial products',
  FIN_SUPER: 'Superannuation',
  FIN_SUPER_SMSUPER: 'Self-managed super',
  FIN_SUPER_SUPERHOLD: 'Super — holdings',
  FIN_SECUR: 'Securities',
  FIN_SECURALL: 'Securities (all)',
  FIN_SECURALL_SECURDEBENT: 'Debentures',
  FIN_LIFEPROD_LIFEINV: 'Life — investment',
  FIN_LIFEPROD_LIFERISK: 'Life — risk',
  FIN_LIFEPROD_LIFERISK_LIFECONS: 'Life risk — consumer credit',
  FIN_MINV: 'Managed investments',
  FIN_MINV_MIEXCLUDEIDPS: 'Managed investments (excl. IDPS)',
  FIN_MINV_MIINCLUDEIDPS: 'Managed investments (incl. IDPS)',
  FIN_MINV_MIIDPSONLY: 'IDPS only',
  FIN_MINV_MIOWN: 'Own managed investments',
  FIN_MINV_MIHORSE: 'Horse-racing schemes',
  FIN_MINV_MITIME: 'Time-share schemes',
  FIN_MINV_IMIS: 'Investor-directed schemes',
  FIN_DERIV: 'Derivatives',
  FIN_DERIV_DERWOOL: 'Derivatives — wool',
  FIN_DERIV_DERELEC: 'Derivatives — electricity',
  FIN_DERIV_DERGRAIN: 'Derivatives — grain',
  FIN_DERIV_LAWSECURITIES: 'Derivatives — securities',
  FIN_DERIV_LAWFUTURE: 'Derivatives — futures',
  FIN_FOREXCH: 'Foreign exchange',
  FIN_GOVDEB: 'Government debentures',
  FIN_DEPPAY_DPNONBAS: 'Deposit products (non-basic)',
  FIN_DEPPAY_DPNONCSH: 'Non-cash payment',
  FIN_RSA: 'Retirement savings accounts',
  FIN_STDMARGLEND: 'Standard margin lending',
  FIN_NONSTDMARGLEND: 'Non-standard margin lending',
  FIN_CARBUNIT: 'Carbon units',
  FIN_AUSCARBCRDUNIT: 'Australian carbon credit units',
  FIN_ELIGINTREMSUNIT: 'Eligible international emissions units',
  FIN_MISFIN_MISMDA: 'Managed discretionary accounts',
  FIN_MISFIN_MISFINRP: 'Miscellaneous — retirement products',
  FIN_MISFIN_MISFINIP: 'Miscellaneous — investment products',
  FIN_FHSANONADIDUMMY: 'First home saver accounts',
  CLASSES_SECUR: 'Class — securities',
  CLASSES_SMIS: 'Class — managed investments',
  CLASSES_LIFEPROD_LIFERISK: 'Class — life risk',
  CLASSES_SUPER: 'Class — superannuation',
  ABLE_TO_PROVIDE_TFAS: 'Tax (financial) advice',
};

// Authorisation flags are BLANK on every ceased row, so this is inherently a
// current-adviser picture — a fact the view states rather than hides.
const currentApps = appointments.filter((a) => a.current);
const authKeys = Object.keys(AUTH_LABELS);
const authByState = {};
for (const st of STATES.filter(Boolean)) authByState[st] = Object.fromEntries(authKeys.map((k) => [k, 0]));
const authTotals = Object.fromEntries(authKeys.map((k) => [k, 0]));
const authStateTotals = Object.fromEntries(STATES.filter(Boolean).map((s) => [s, 0]));
for (const a of currentApps) {
  const flags = authFlags(a.raw);
  const st = STATES.includes(a.state) && a.state ? a.state : null;
  if (st) authStateTotals[st]++;
  for (const k of authKeys) {
    if (flags[k]) {
      authTotals[k]++;
      if (st) authByState[st][k]++;
    }
  }
}
// Prevalence over time: share of appointments active at 30 June holding a flag
// can only be computed for current rows, so instead we show, for each
// authorisation, how many CURRENT advisers hold it by their intake decade.
const authByCohort = {};
for (const a of currentApps) {
  const fy = a.firstAdvice;
  if (fy == null) continue;
  const dec = Math.floor(fy / 10) * 10;
  authByCohort[dec] ??= { n: 0, ...Object.fromEntries(authKeys.map((k) => [k, 0])) };
  authByCohort[dec].n++;
  const flags = authFlags(a.raw);
  for (const k of authKeys) if (flags[k]) authByCohort[dec][k]++;
}

// ── geography ───────────────────────────────────────────────────────────
const byPostcode = new Map();
for (const a of currentApps) {
  if (!a.postcode) continue;
  let p = byPostcode.get(a.postcode);
  if (!p) { p = { pc: a.postcode, state: a.state, advisers: new Set(), lics: new Map() }; byPostcode.set(a.postcode, p); }
  p.advisers.add(a.advNumber);
  p.lics.set(a.licNumber, (p.lics.get(a.licNumber) ?? 0) + 1);
}
log('  fetching ABS postcode population + boundaries…');
const population = await loadPopulation();
const boundaries = await loadBoundaries();
const censusTotal = Object.values(population).reduce((a, b) => a + b, 0);

const geo = [...byPostcode.values()].map((p) => {
  const pop = population[p.pc] ?? null;
  return {
    pc: p.pc,
    state: p.state,
    n: p.advisers.size,
    pop,
    // per 10,000 residents. Null where the postcode has no census population
    // (PO-box-only and similar non-residential postcodes) — shown as "n/a"
    // rather than as a spectacular rate over a denominator of nothing.
    per10k: pop && pop >= 200 ? (p.advisers.size / pop) * 10000 : null,
    lics: [...p.lics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([num, c]) => ({ l: licIndex.get(num) ?? -1, c })),
  };
}).sort((a, b) => b.n - a.n);

// Every residential postcode, including the ones with NO adviser at all — that
// absence is the finding, so the map must be able to draw it.
const advisedPostcodes = new Set(geo.map((g) => g.pc));
const emptyPostcodes = Object.keys(population)
  .filter((pc) => !advisedPostcodes.has(pc) && population[pc] >= 200)
  .map((pc) => ({ pc, pop: population[pc] }));

// Second gate round — these need the population and boundary downloads, so they
// could not run with the first batch. Same rule: a failure stops the write.
const geoGates = [
  gateCensusAnchor(censusTotal, Object.keys(population).length),
  gateBoundaryCoverage(boundaries.features, geo.map((g) => g.pc), population),
];
log('\nGATES (geography)');
for (const g of geoGates) log(reportGate(g));
const geoFailed = gateFailures(geoGates);
if (geoFailed.length) {
  throw new Error(`${geoFailed.length} geography gate(s) failed: ${geoFailed.map((g) => g.name).join(', ')}`);
}
gates.push(...geoGates);
log('');

const byState = {};
for (const a of currentApps) {
  if (!a.state) continue;
  byState[a.state] ??= new Set();
  byState[a.state].add(a.advNumber);
}

// ── conduct ─────────────────────────────────────────────────────────────
// DISTINCT actions — ASIC repeats the ADV_DA_* fields on every appointment row
// of a disciplined adviser, so counting rows triples the published figure.
const daRows = appointments.filter((a) => a.daType);
const actions = distinctActions(appointments);
log(`  conduct: ${daRows.length} appointment rows carry a disciplinary field, ` +
  `= ${actions.length} distinct actions against ${new Set(actions.map((a) => a.advNumber)).size} advisers`);
const daByType = {};
for (const a of actions) daByType[a.type] = (daByType[a.type] ?? 0) + 1;
const disciplinedAdvisers = new Set(actions.map((a) => a.advNumber));
const cpdAdvisers = new Set(appointments.filter((a) => a.cpdFailure).map((a) => a.advNumber));
const daByYear = {};
for (const a of actions) {
  const y = dayToYear(a.start);
  if (y != null) daByYear[y] = (daByYear[y] ?? 0) + 1;
}
// Alumni-risk scatter: per licensee, share of its alumni who ever carry an
// ASIC disciplinary action. Small denominators are kept but flagged — the view
// shades a low-n zone rather than filtering silently.
const licRisk = [];
for (const l of licList) {
  if (l.total < 20) continue;
  const alumni = new Set();
  for (const a of appointments) if (a.licNumber === l.num) alumni.add(a.advNumber);
  const hit = [...alumni].filter((n) => disciplinedAdvisers.has(n)).length;
  licRisk.push({ l: licIndex.get(l.num), n: alumni.size, d: hit, share: hit / alumni.size });
}
licRisk.sort((a, b) => b.share - a.share);

// ── write ───────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const write = (name, obj) => {
  const p = join(OUT, name);
  writeFileSync(p, JSON.stringify(obj));
  const kb = (Buffer.byteLength(JSON.stringify(obj)) / 1024).toFixed(0);
  log(`  wrote ${name} (${kb} KB)`);
};

const meta = {
  asAt,
  asAtYear,
  source: 'ASIC Financial Advisers Register (data.gov.au), CC BY 3.0 AU',
  rows: rows.length,
  appointments: appointments.length,
  advisers: careers.size,
  licensees: licList.length,
  currentAdvisers: currentAdvisers.size,
  currentAppointments: currentApps.length,
  rejected,
  gates: gates.map((g) => ({ name: g.name, ok: g.ok, detail: g.detail, checks: g.checks, fails: g.fails })),
  headline: {
    alumniDated: alumniDated.any.size,
    alumniNaive: alumniNaive.any.size,
    phantom: alumniNaive.any.size - alumniDated.any.size,
    alumniStillPractising,
    alumniShareOfCurrent: alumniStillPractising / currentAdvisers.size,
    underLiveChain,
    perOwner: Object.fromEntries(OWNER_GROUPS.map((g) => [g.id, {
      label: g.label,
      naive: alumniNaive.sets[g.id].size,
      dated: alumniDated.sets[g.id].size,
    }])),
  },
  transitions: movements.transitions,
  exits: movements.exits,
  edges: movements.edges.length,
  conduct: {
    actions: actions.length,
    actionRows: daRows.length,
    advisers: disciplinedAdvisers.size,
    byType: daByType,
    byYear: daByYear,
    cpdAdvisers: cpdAdvisers.size,
  },
  byState: Object.fromEntries(Object.entries(byState).map(([k, v]) => [k, v.size])),
  postcodes: geo.length,
  states: STATES,
  daTypes: DA_TYPES,
  owners: OWNER_GROUPS,
  authLabels: AUTH_LABELS,
};

write('licensees.json', licList);

// The adviser index must cover all 42,305 people, because "search for the name
// on the letter I was sent" is the site's primary job. Shipped COLUMNAR (one
// array per field) rather than as 42k objects: identical information, roughly a
// third of the bytes, and it parses faster.
const OWNER_IDS = OWNER_GROUPS.map((g) => g.id);
write('advisers.json', {
  n: advList.map((a) => a.n),
  name: advList.map((a) => a.name),
  cur: advList.map((a) => a.cur),
  lic: advList.map((a) => a.lic),
  st: advList.map((a) => a.st),
  pc: advList.map((a) => a.pc),
  fy: advList.map((a) => a.fy ?? 0),
  apps: advList.map((a) => a.apps),
  // bitmask over DA_TYPES, and a second over the five owner groups
  da: advList.map((a) => a.da.reduce((m, i) => m | (1 << i), 0)),
  own: advList.map((a) => a.own.reduce((m, id) => m | (1 << OWNER_IDS.indexOf(id)), 0)),
  cpd: advList.map((a) => (a.cpd.length ? a.cpd.join(',') : '')),
  // 0 = no action, -1 = an action is still running, otherwise the end year.
  daEnd: advList.map((a) => (a.da.length ? (a.daEnd == null ? -1 : a.daEnd) : 0)),
});

// Dossier detail is only ever needed for ONE person at a time, so it is sharded
// and fetched on demand instead of making every visitor download 21 MB to read
// a single career. 512 advisers per shard keeps each file around 250 KB.
const SHARD = 512;
const shardCount = Math.ceil(advList.length / SHARD);
mkdirSync(join(OUT, 'detail'), { recursive: true });
let detailBytes = 0;
for (let s = 0; s < shardCount; s++) {
  const lo = s * SHARD;
  const hi = Math.min(advList.length, lo + SHARD);
  const payload = {
    lo,
    apps: appsByAdviser.slice(lo, hi),
    extra: advExtra.slice(lo, hi),
  };
  const body = JSON.stringify(payload);
  detailBytes += Buffer.byteLength(body);
  writeFileSync(join(OUT, 'detail', `${s}.json`), body);
}
log(`  wrote detail/*.json (${shardCount} shards, ${(detailBytes / 1024 / 1024).toFixed(1)} MB total, ~${(detailBytes / shardCount / 1024).toFixed(0)} KB each)`);
meta.shardSize = SHARD;
meta.shardCount = shardCount;

write('series.json', { years: YEARS, dated: seriesDated, naive: seriesNaive });
write('cohorts.json', { cohorts, flow });
write('movements.json', { edges: edgesOut, exits: exitEdges, all: allEdges });
write('authorisations.json', { keys: authKeys, totals: authTotals, byState: authByState, stateTotals: authStateTotals, byCohort: authByCohort, base: currentApps.length });
// Nothing is dropped quietly: the map can only draw postcodes that have an ABS
// polygon, so the ones it cannot draw are counted and named for the UI to state.
const boundaryCodes = new Set(boundaries.features.map((f) => f.properties?.poa_code_2021).filter(Boolean));
const unmappable = geo.filter((g) => !boundaryCodes.has(g.pc));
// Counted as DISTINCT PEOPLE. Summing each postcode's adviser count double-counts
// anyone holding current appointments at two firms in different postcodes, which
// would let "advisers on this map" exceed the number of advisers that exist.
const mappedSet = new Set();
const unmappableSet = new Set();
for (const a of currentApps) {
  if (!a.postcode) continue;
  (boundaryCodes.has(a.postcode) ? mappedSet : unmappableSet).add(a.advNumber);
}
const geoCoverage = {
  mappedPostcodes: geo.length - unmappable.length,
  mappedAdvisers: mappedSet.size,
  mappedAppointments: geo.filter((g) => boundaryCodes.has(g.pc)).reduce((s, g) => s + g.n, 0),
  unmappablePostcodes: unmappable.length,
  unmappableAdvisers: unmappableSet.size,
  poBox: unmappable.filter((g) => /^\d{4}$/.test(g.pc)).map((g) => ({ pc: g.pc, n: g.n })),
  malformed: unmappable.filter((g) => !/^\d{4}$/.test(g.pc)).map((g) => ({ pc: g.pc, n: g.n })),
  noPostcode: new Set(currentApps.filter((a) => !a.postcode).map((a) => a.advNumber)).size,
};
log(`  geography: ${geoCoverage.mappedAdvisers} advisers mappable, ` +
  `${geoCoverage.unmappableAdvisers} at PO-box/malformed postcodes, ${geoCoverage.noPostcode} with no address`);

write('geography.json', { advised: geo, empty: emptyPostcodes, censusTotal, coverage: geoCoverage });
writeFileSync(join(OUT, 'poa.geojson'), JSON.stringify(boundaries));
log(`  wrote poa.geojson (${(Buffer.byteLength(JSON.stringify(boundaries)) / 1024 / 1024).toFixed(1)} MB, ${boundaries.features.length} polygons)`);
write('conduct.json', { risk: licRisk, byType: daByType, byYear: daByYear });
// meta last: it carries the shard configuration decided above.
write('meta.json', meta);

log(`\nDone. as-at ${asAt}. ${careers.size} advisers, ${currentAdvisers.size} current.`);
log(`Headline: ${alumniStillPractising} of ${currentAdvisers.size} current advisers (${(alumniStillPractising / currentAdvisers.size * 100).toFixed(1)}%) are bank/AMP alumni; ${underLiveChain} still under a live chain; ${alumniNaive.any.size - alumniDated.any.size} phantom advisers removed by the dating rule.`);
