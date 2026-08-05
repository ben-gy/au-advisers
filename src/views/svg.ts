// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Small SVG helpers shared by every hand-rolled chart. Pure geometry lives in
// `layout.ts` so the positional tests can exercise it without a DOM.

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** A root <svg>, typed so it can be handed to attachSvgZoom. */
export function svgRoot(attrs: Record<string, string | number> = {}): SVGSVGElement {
  return svg('svg', attrs) as SVGSVGElement;
}

export function el(tag: string, cls?: string, html?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/** A chart frame: title, subtitle, and a scrollable body so a wide chart
 *  scrolls inside itself instead of giving the whole page a sideways scroll. */
export function chartCard(title: string, subtitle: string): { card: HTMLElement; body: HTMLElement } {
  const card = el('section', 'card');
  const head = el('header', 'card-head');
  head.appendChild(el('h2', undefined, title));
  if (subtitle) head.appendChild(el('p', 'card-sub', subtitle));
  card.appendChild(head);
  const body = el('div', 'card-body scroll-x');
  card.appendChild(body);
  return { card, body };
}

/** Nice round axis ticks covering [0, max]. */
export function niceTicks(max: number, count = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Accessible name for a chart that is a figure, not an image of one. */
export function describe(node: SVGElement, label: string): void {
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', label);
}

/**
 * A focusable, hoverable data mark. Every mark on this site goes through here,
 * so no mark can ship without a tooltip AND a keyboard path to the same values.
 *
 * `data-tip` is set with setAttribute, which takes RAW newlines — passing the
 * `&#10;`-escaped form used for innerHTML would render literal "&#10;" text.
 */
export function mark(node: SVGElement | HTMLElement, tip: string, opts: {
  label?: string; onClick?: () => void; role?: string;
} = {}): void {
  node.setAttribute('data-tip', tip);
  if (opts.onClick) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', opts.role ?? 'button');
    node.setAttribute('aria-label', opts.label ?? tip.split('\n')[0]);
    node.classList.add('clickable');
    node.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick!(); });
    node.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); opts.onClick!(); }
    });
  } else if (opts.label) {
    node.setAttribute('aria-label', opts.label);
  }
}

/** Legend row of swatch + label chips. */
export function legend(items: { color: string; label: string; note?: string }[]): HTMLElement {
  const wrap = el('div', 'legend');
  for (const it of items) {
    const chip = el('span', 'legend-chip');
    const sw = el('span', 'legend-swatch');
    sw.style.background = it.color;
    chip.appendChild(sw);
    chip.appendChild(el('span', 'legend-label', it.label));
    if (it.note) chip.appendChild(el('span', 'legend-note', it.note));
    wrap.appendChild(chip);
  }
  return wrap;
}

export function emptyState(message: string): HTMLElement {
  return el('div', 'empty-state', message);
}
