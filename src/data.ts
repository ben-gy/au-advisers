// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Lazy, cached, per-view data loading.
//
// The register is big — the full 42,305-name search index is 2.4 MB and the
// postcode boundaries another 2.5 MB — so nothing is loaded until a view
// actually needs it. The Overview costs about 10 KB. Each file is fetched at
// most once; a failed fetch is not cached, so a retry can succeed.

import type {
  Meta, Licensee, AdviserIndex, Appointment, AdviserExtra, SeriesRow,
  Cohort, FlowRow, Geography, Movements, Conduct, Authorisations,
} from './types.ts';

const cache = new Map<string, Promise<unknown>>();

/**
 * KEEPING THE COPY AND THE NUMBERS IN STEP.
 *
 * The JS bundle is content-hashed, so a deploy busts it immediately. The data
 * files are not, and GitHub Pages serves them with `max-age=600` — so for up to
 * ten minutes after a data refresh a returning visitor can run the NEW bundle
 * against the OLD numbers. That was observed live: the page showed the corrected
 * copy beside the superseded figures, which is worse than showing either alone.
 *
 * `meta.json` is therefore always revalidated (an etag round-trip, a few
 * hundred bytes), and every other data file is then versioned by the as-at date
 * meta reports. A data refresh changes that date, which changes every URL, so
 * the browser cannot serve a stale file alongside fresh copy.
 */
let dataVersion = '';

export class DataError extends Error {
  constructor(readonly file: string, cause: unknown) {
    super(`Could not load ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DataError';
  }
}

function load<T>(file: string, opts: { revalidate?: boolean } = {}): Promise<T> {
  const hit = cache.get(file);
  if (hit) return hit as Promise<T>;
  const p = (async () => {
    try {
      const url = `data/${file}${dataVersion && !opts.revalidate ? `?v=${dataVersion}` : ''}`;
      const res = await fetch(url, opts.revalidate ? { cache: 'no-cache' } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      // Do not cache failure — the visitor may just have lost the network for a
      // moment and the retry button has to be able to work.
      cache.delete(file);
      throw new DataError(file, err);
    }
  })();
  cache.set(file, p);
  return p;
}

export const getMeta = (): Promise<Meta> =>
  load<Meta>('meta.json', { revalidate: true }).then((m) => {
    // Every subsequent data URL carries this, so copy and numbers cannot drift.
    dataVersion = m.asAt ?? '';
    return m;
  });
export const getLicensees = () => load<Licensee[]>('licensees.json');
export const getAdvisers = () => load<AdviserIndex>('advisers.json');
export const getSeries = () => load<{ years: number[]; dated: SeriesRow[]; naive: SeriesRow[] }>('series.json');
export const getCohorts = () => load<{ cohorts: Cohort[]; flow: FlowRow[] }>('cohorts.json');
export const getMovements = () => load<Movements>('movements.json');
export const getAuthorisations = () => load<Authorisations>('authorisations.json');
export const getGeography = () => load<Geography>('geography.json');
export const getConduct = () => load<Conduct>('conduct.json');
export const getBoundaries = () => load<GeoJSON.FeatureCollection>('poa.geojson');

/** Dossier detail lives in 512-adviser shards so opening one career does not
 *  cost 21 MB. Returns the shard containing adviser index `i`. */
export async function getDetailShard(i: number): Promise<{
  lo: number; apps: Appointment[][]; extra: AdviserExtra[];
}> {
  const meta = await getMeta();
  const shard = Math.floor(i / meta.shardSize);
  return load(`detail/${shard}.json`);
}

export async function getAdviserDetail(i: number): Promise<{ apps: Appointment[]; extra: AdviserExtra }> {
  const s = await getDetailShard(i);
  return { apps: s.apps[i - s.lo] ?? [], extra: s.extra[i - s.lo] ?? { q: [], m: [], a: [] } };
}
