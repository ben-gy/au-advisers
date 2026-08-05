// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-AU');
}

export function pct(n: number | null | undefined, dp = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(dp)}%`;
}

export function rate(n: number | null | undefined, dp = 1): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return n.toFixed(dp);
}

/** ISO date → "12 Mar 2019". Dates in this register are the whole story, so a
 *  missing one prints as "—" rather than as today. */
export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function year(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Number(iso.slice(0, 4));
  return Number.isFinite(n) ? n : null;
}

/** Fractional year, so a career ribbon can position a bar mid-year. */
export function yearFraction(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (end - start);
}

export function duration(fromISO: string, toISO: string | null): string {
  const a = new Date(`${fromISO}T00:00:00Z`).getTime();
  const b = toISO ? new Date(`${toISO}T00:00:00Z`).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '—';
  const months = Math.round((b - a) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 1) return 'under a month';
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years} yr ${rem} mo` : `${years} yr`;
}

/** Title Case a SHOUTED registered name without mangling the acronyms that
 *  carry meaning in this dataset (PTY, LTD, AFSL, SMSF, AMP, NAB, ANZ, CBA…). */
const KEEP_UPPER = new Set([
  'PTY', 'LTD', 'LIMITED', 'AFSL', 'ACN', 'ABN', 'SMSF', 'AMP', 'NAB', 'ANZ', 'CBA',
  'BT', 'MLC', 'IOOF', 'FSP', 'AFS', 'IFA', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT',
  'AU', 'AUST', 'II', 'III', 'IV', 'UK', 'USA', 'HSBC', 'ING', 'RSM', 'PKF', 'BDO', 'KPMG', 'EY', 'PWC',
]);

export function titleCase(s: string): string {
  if (!s) return '';
  // Leave mixed-case names alone — they are already human-written.
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b[\w']+\b/g, (w) => {
      const up = w.toUpperCase();
      if (KEEP_UPPER.has(up)) return up;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .replace(/\bPty\b/g, 'Pty')
    .trim();
}

/** ASIC prints people as "Given  SURNAME"; collapse the double space. */
export function personName(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

export function slug(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Escape for insertion into innerHTML. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Tooltip text differs by delivery path and getting it wrong ships visible
 * junk: `setAttribute` takes RAW newlines, while a string interpolated into
 * innerHTML needs them as `&#10;` or the browser renders the literal characters.
 */
export function tipAttr(text: string): string {
  return esc(text).replace(/\n/g, '&#10;');
}

export function setTip(el: Element, text: string): void {
  el.setAttribute('data-tip', text);
}
