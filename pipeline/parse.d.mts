// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Types for the dependency-free pipeline parser, so the test suite type-checks
// against the exact code the pipeline runs. The implementation stays plain
// .mjs so it executes on CI with no build step and no dependencies at all.

export interface ChainLink { name: string; ceased: number | null; depth: number }

export interface RawRow { [column: string]: string }

export interface Appointment {
  advNumber: string;
  advName: string;
  subType: string;
  current: boolean;
  licNumber: string;
  licName: string;
  chain: ChainLink[];
  chainRaw: string;
  start: number;
  end: number | null;
  firstAdvice: number | null;
  state: string;
  postcode: string;
  locality: string;
  cpdFailure: string;
  daType: string;
  daDesc: string;
  daStart: number | null;
  daEnd: number | null;
  restrictions: string;
  qualifications: string;
  memberships: string;
  raw: RawRow;
}

export interface Gate {
  name: string;
  ok: boolean;
  detail: string;
  checks: number;
  fails: number;
  problems?: string[];
  [extra: string]: unknown;
}

export function splitRow(line: string, delim?: string): string[];
export function parseRegister(text: string, delim?: string): { header: string[]; rows: RawRow[] };
export function parseDate(s: string): number | null;
export function dayToISO(day: number | null): string | null;
export function dayToYear(day: number | null): number | null;
export function parseChain(raw: string): ChainLink[];
export function ownerOfName(name: string): string | null;
export function ownersForAppointment(chain: ChainLink[], startDay: number | null, dated?: boolean): string[];
export function hasFieldCountMismatch(row: RawRow, expectedFields: number): boolean;
export function distinctActions(appointments: Appointment[]): {
  advNumber: string; type: string; start: number | null; end: number | null; desc: string;
}[];
export function buildAppointments(rows: RawRow[], expectedFields?: number | null): {
  appointments: Appointment[];
  rejected: Record<string, number>;
  rejectedRows: RawRow[];
};
export function parseQualifications(raw: string): {
  year: number | null; course: string; kind: string; institution: string;
}[];
export function parseList(raw: string): string[];
export function authFlags(row: RawRow): Record<string, boolean>;
export function buildCareers(appointments: Appointment[]): Map<string, Appointment[]>;
export function buildMovements(careers: Map<string, Appointment[]>): {
  edges: { from: string; to: string; count: number; last: number | null }[];
  transitions: number;
  exits: number;
};
export function ownerSeries(
  appointments: Appointment[], years: number[], dated?: boolean,
): Record<string, number>[];
export function alumniByOwner(appointments: Appointment[], dated?: boolean): {
  sets: Record<string, Set<string>>;
  any: Set<string>;
};
export interface CohortRow {
  year: number;
  size: number;
  observable: number;
  points: { n: number; share: number; alive: number }[];
}
export function cohortSurvival(
  careers: Map<string, Appointment[]>, asAtYear: number, maxYears?: number, minYear?: number,
): CohortRow[];
export function entryExit(careers: Map<string, Appointment[]>): { year: number; entries: number; exits: number }[];
export function isPostcodeShaped(pc: string): boolean;
export function classifyPostcodes(
  postcodes: string[], boundaryCodes: Set<string>, population: Record<string, number>,
): { mapped: string[]; nonResidential: string[]; malformed: string[]; population: Record<string, number> };

export function gateRowConservation(
  sourceRowCount: number, acceptedCount: number, rejected: Record<string, number>,
): Gate;
export function gateStatusCoherence(appointments: Appointment[]): Gate;
export function gateDatingRule(appointments: Appointment[]): Gate & {
  perGroup: Record<string, { naive: number; dated: number }>;
  phantom: number;
  problems: string[];
};
export function gateMovementConservation(
  careers: Map<string, Appointment[]>,
  movements: { edges: { from: string; to: string; count: number }[]; transitions: number; exits: number },
  appointments?: Appointment[] | null,
): Gate & { problems: string[] };
export function gateSeriesEra(
  series: { year: number; total?: number }[],
): Gate & { problems: string[] };
export function gateGeographyScope(appointments: Appointment[]): Gate & { problems: string[] };
export function gateCensusAnchor(totalPersons: number, postcodeCount: number): Gate & { problems: string[] };
export function gateSurvivorship(
  careers: Map<string, Appointment[]>, cohorts: { year: number }[],
): Gate & { problems: string[] };
export function gateBoundaryCoverage(
  features: { properties?: Record<string, unknown>; geometry?: unknown }[],
  adviserPostcodes: string[],
  population: Record<string, number>,
): Gate & {
  problems: string[];
  classification: { mapped: string[]; nonResidential: string[]; malformed: string[] };
};
export function reportGate(g: Gate): string;
export function gateFailures(gates: { ok: boolean }[]): Gate[];

export const OWNER_GROUPS: { id: string; label: string; match: string }[];
export const REJECTION_BUCKETS: string[];
export const EXIT_NODE: string;
export const CENSUS_2021_PERSONS: number;
export const REGISTER_START_YEAR: number;
