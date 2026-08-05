// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Colour means one thing across the whole site and is defined only here.
//
//  * The five owner colours are reserved for the five vertically-integrated
//    owners and are used in the streamgraph, the career ribbon, the ownership
//    icicle, the network and every legend. An owner is always the same colour.
//  * Amber is reserved for ASIC conduct events and appears nowhere else, so
//    amber always means "the regulator did something".
//  * Independent/other is a deliberately quiet slate-green: it is the majority
//    of the data and must not shout.

import type { OwnerId } from './types.ts';

// Five well-separated hues at similar mid-lightness. CBA and ANZ are both blue
// — that is deliberate and safe because they are separated by a large lightness
// step, the standard way to keep a two-member colour family legible; every
// other pair differs in hue outright.
export const OWNER_COLOR: Record<OwnerId, string> = {
  cba: '#1d5c8f', // deep blue
  nab: '#0f6b5c', // teal
  wbc: '#8c2f2a', // brick
  anz: '#5b93cc', // light blue
  amp: '#6b4d9e', // violet
};

export const INDEPENDENT_COLOR = '#7d8f7a';
export const EXIT_COLOR = '#96a0a8';
/** Reserved for ASIC conduct events, and used for nothing else anywhere. */
export const CONDUCT_COLOR = '#c07818';

export function ownerColor(id: string | null | undefined): string {
  if (!id) return INDEPENDENT_COLOR;
  return OWNER_COLOR[id as OwnerId] ?? INDEPENDENT_COLOR;
}

/** Sequential ramp for density/rate choropleths — light to deep slate-navy.
 *  Single hue, monotonic in lightness, so it is readable in greyscale and by
 *  the most common colour-vision deficiencies. */
const DENSITY_RAMP = ['#e8eef3', '#c6d7e4', '#9dbcd2', '#6f9cbb', '#4a7ba0', '#2d5c82', '#1a3f5f'];

export function densityColor(t: number | null): string {
  if (t == null || !Number.isFinite(t)) return '#eceff1';
  const i = Math.max(0, Math.min(DENSITY_RAMP.length - 1, Math.floor(t * DENSITY_RAMP.length)));
  return DENSITY_RAMP[i];
}

export const DENSITY_STOPS = DENSITY_RAMP;

/** No advisers at all — a category, not a low value. Rendered as a distinct
 *  hatch-grey so "nobody here" never reads as "very few here". */
export const NONE_COLOR = '#f4f1ec';

/**
 * Quantile breakpoints.
 *
 * Adviser counts per postcode are savagely skewed (2000 has 1,795; the median
 * postcode has 4), so a LINEAR ramp paints the whole country one colour and a
 * pure quantile scale invents visual differences between values that are
 * effectively identical. This returns quantile edges but collapses duplicate
 * edges, so tied values cannot be split across bands.
 */
export function quantileBreaks(values: number[], bands: number): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const out: number[] = [];
  for (let i = 1; i < bands; i++) {
    const q = sorted[Math.floor((i / bands) * sorted.length)];
    if (!out.length || q > out[out.length - 1]) out.push(q);
  }
  return out;
}

export function bandOf(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}
