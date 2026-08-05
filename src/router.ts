// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The view contract and hash navigation live here, apart from main.ts, so that
// importing a single view never drags in — and boot — the whole application.

import type { Meta } from './types.ts';

export interface ViewCtx {
  root: HTMLElement;
  meta: Meta;
  params: URLSearchParams;
}

/** Navigate by hash. All state that deserves a URL goes through here. */
export function goto(view: string, extra: Record<string, string> = {}): void {
  const p = new URLSearchParams();
  p.set('view', view);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  location.hash = p.toString();
}

export function parseHash(known: string[]): { view: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const view = params.get('view') ?? (raw && !raw.includes('=') ? raw : 'overview');
  return { view: known.includes(view) ? view : 'overview', params };
}
