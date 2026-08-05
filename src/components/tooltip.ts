// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Copied from gh-site-factory/patterns/ — the canonical factory implementation.
// Re-rolling one of these by hand is a defect; each exists because a bespoke
// variant shipped broken at least once.

// Global hover tooltip driven by [data-tip] attributes anywhere in the document.
// Ported from the au-flights implementation (canonical factory pattern).
let tip: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'hover-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function position(el: HTMLDivElement, x: number, y: number): void {
  const pad = 12;
  const rect = el.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 14;
  if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 14;
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

export function hideTooltip(): void {
  if (tip) tip.classList.remove('visible');
}

function show(text: string, x: number, y: number): void {
  const el = ensure();
  el.textContent = text;
  el.classList.add('visible');
  position(el, x, y);
}

export function initTooltip(): void {
  let activeText = '';
  // `.closest` only exists on Elements — a mouseover whose target is a text
  // node or the document itself would throw and kill the listener for good.
  const near = (e: Event) => (e.target as Element)?.closest?.('[data-tip]') ?? null;

  document.addEventListener('mouseover', (e) => {
    const target = near(e);
    if (!target) return;
    const text = target.getAttribute('data-tip') ?? '';
    if (!text) return;
    activeText = text;
    show(text, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (!tip || !tip.classList.contains('visible')) return;
    const target = near(e);
    if (!target || target.getAttribute('data-tip') !== activeText) { hideTooltip(); return; }
    position(tip, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mouseout', (e) => {
    if (near(e)) hideTooltip();
  });

  // Keyboard parity: every clickable mark on this site is focusable, so Tab
  // must reveal the same numbers the mouse does.
  document.addEventListener('focusin', (e) => {
    const target = near(e);
    if (!target) return;
    const text = target.getAttribute('data-tip') ?? '';
    if (!text) return;
    const r = target.getBoundingClientRect();
    activeText = text;
    show(text, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hideTooltip);

  // A tooltip must never survive scrolling away from its mark.
  window.addEventListener('scroll', hideTooltip, { passive: true, capture: true });
}
