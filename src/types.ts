// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

export type OwnerId = 'cba' | 'nab' | 'wbc' | 'anz' | 'amp';

export interface OwnerGroup { id: OwnerId; label: string; match: string }

export interface ChainLink { n: string; c: string | null }

export interface Licensee {
  num: string;
  name: string;
  chain: ChainLink[];
  owner: OwnerId | null;
  ownerLive: boolean;
  ultimate: string | null;
  total: number;
  current: number;
  first: string;
  last: string;
  alive: boolean;
}

/** Columnar adviser index — one array per field, aligned by row. */
export interface AdviserIndex {
  n: string[];
  name: string[];
  cur: number[];
  lic: number[];
  st: number[];
  pc: string[];
  fy: number[];
  apps: number[];
  /** bitmask over meta.daTypes */
  da: number[];
  /** bitmask over meta.owners order */
  own: number[];
  cpd: string[];
}

export interface Appointment {
  l: number;
  s: string;
  e: string | null;
  o: OwnerId[];
  t: string | null;
  d: { t: number; s: string | null; e: string | null; x: string } | null;
  r: string | null;
}

export interface AdviserExtra {
  q: { year: number | null; course: string; kind: string; institution: string }[];
  m: string[];
  a: string[];
}

export interface SeriesRow {
  year: number;
  independent: number;
  total: number;
  cba: number; nab: number; wbc: number; anz: number; amp: number;
  [k: string]: number;
}

export interface Cohort {
  year: number;
  size: number;
  observable: number;
  points: { n: number; share: number; alive: number }[];
}

export interface FlowRow { year: number; entries: number; exits: number }

export interface Meta {
  asAt: string;
  asAtYear: number;
  source: string;
  rows: number;
  appointments: number;
  advisers: number;
  licensees: number;
  currentAdvisers: number;
  currentAppointments: number;
  rejected: Record<string, number>;
  gates: { name: string; ok: boolean; detail: string; checks: number; fails: number }[];
  headline: {
    alumniDated: number;
    alumniNaive: number;
    phantom: number;
    alumniStillPractising: number;
    alumniShareOfCurrent: number;
    underLiveChain: number;
    perOwner: Record<OwnerId, { label: string; naive: number; dated: number }>;
  };
  transitions: number;
  exits: number;
  edges: number;
  conduct: {
    /** DISTINCT actions, de-duplicated across an adviser's appointment rows. */
    actions: number;
    /** Raw appointment rows carrying a disciplinary field — always larger. */
    actionRows: number;
    advisers: number;
    byType: Record<string, number>;
    byYear: Record<string, number>;
    cpdAdvisers: number;
  };
  byState: Record<string, number>;
  postcodes: number;
  states: string[];
  daTypes: string[];
  owners: OwnerGroup[];
  authLabels: Record<string, string>;
  shardSize: number;
  shardCount: number;
}

export interface GeoRow {
  pc: string;
  state: string;
  n: number;
  pop: number | null;
  per10k: number | null;
  lics: { l: number; c: number }[];
}

export interface Geography {
  advised: GeoRow[];
  empty: { pc: string; pop: number }[];
  censusTotal: number;
  coverage: {
    mappedPostcodes: number;
    /** Distinct people, not a sum over postcodes. */
    mappedAdvisers: number;
    mappedAppointments: number;
    unmappablePostcodes: number;
    unmappableAdvisers: number;
    poBox: { pc: string; n: number }[];
    malformed: { pc: string; n: number }[];
    noPostcode: number;
  };
}

export interface Movements {
  edges: { f: number; t: number; c: number }[];
  exits: { f: number; c: number }[];
  /** -2 in `t` is the explicit "left the register" sink. */
  all: { f: number; t: number; c: number }[];
}

export interface Conduct {
  risk: { l: number; n: number; d: number; share: number }[];
  byType: Record<string, number>;
  byYear: Record<string, number>;
}

export interface Authorisations {
  keys: string[];
  totals: Record<string, number>;
  byState: Record<string, Record<string, number>>;
  stateTotals: Record<string, number>;
  byCohort: Record<string, Record<string, number> & { n: number }>;
  base: number;
}
