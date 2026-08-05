// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// An icicle (horizontal partition) over the parsed ownership chains.
//
// Depth is on the X axis on purpose: the reader's question is "how many
// companies are stacked behind my adviser's firm, and are any of them dead?"
// A treemap of exactly the same data cannot express depth at all.

import type { ViewCtx } from '../router.ts';
import { getLicensees } from '../data.ts';
import { el, chartCard, svg, svgRoot, mark, legend, describe } from './svg.ts';
import { icicle, finite, type IcicleNode } from './layout.ts';
import { attachSvgZoom } from '../utils/svgZoom.ts';
import { num, date, titleCase } from '../format.ts';
import { ownerColor, INDEPENDENT_COLOR } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import { openLicensee } from '../licenseeDrawer.ts';
import type { Licensee } from '../types.ts';

export async function renderOwnership({ root, meta }: ViewCtx): Promise<void> {
  const licensees = await getLicensees();

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Who owns whom'));
  const p = el('p');
  p.appendChild(document.createTextNode(
    'Every licensee, nested under the companies that control it. Read left to right: the leftmost column is ' +
    'the ultimate parent, each column to its right is one level closer to the adviser.',
  ));
  const g = glossaryButton('chain');
  if (g) p.appendChild(g);
  head.appendChild(p);
  root.appendChild(head);

  const controls = el('div', 'controls');
  const seg = el('div', 'seg');
  const bCur = el('button', undefined, 'Advisers now') as HTMLButtonElement;
  const bAll = el('button', undefined, 'Advisers ever') as HTMLButtonElement;
  bCur.type = 'button'; bAll.type = 'button';
  seg.append(bCur, bAll);
  controls.appendChild(seg);
  const only = el('label');
  only.style.cssText = 'display:inline-flex;align-items:center;gap:6px;font-size:0.82rem';
  const cb = el('input') as HTMLInputElement;
  cb.type = 'checkbox';
  cb.checked = true;
  only.append(cb, document.createTextNode('Only chains with a live licensee'));
  controls.appendChild(only);
  root.appendChild(controls);

  const wrap = el('div');
  root.appendChild(wrap);

  let metric: 'current' | 'total' = 'current';
  const draw = () => {
    bCur.setAttribute('aria-pressed', String(metric === 'current'));
    bAll.setAttribute('aria-pressed', String(metric === 'total'));
    wrap.replaceChildren(build(licensees, meta, metric, cb.checked));
  };
  bCur.addEventListener('click', () => { metric = 'current'; draw(); });
  bAll.addEventListener('click', () => { metric = 'total'; draw(); });
  cb.addEventListener('change', draw);
  draw();
}

function build(
  licensees: Licensee[], meta: ViewCtx['meta'], metric: 'current' | 'total', liveOnly: boolean,
): HTMLElement {
  const pool = licensees.filter((l) => {
    const v = metric === 'current' ? l.current : l.total;
    if (v <= 0) return false;
    if (liveOnly && l.current === 0) return false;
    return true;
  });

  // Build a tree keyed by the chain read OUTWARD-IN: ultimate parent first.
  const root: IcicleNode = { key: '', label: 'All licensees', value: 0, depth: 0, children: [] };
  const index = new Map<string, IcicleNode>();
  index.set('', root);
  let maxDepth = 1;

  for (const l of pool) {
    const value = metric === 'current' ? l.current : l.total;
    // chain[0] is the immediate controller; reverse so the ultimate parent is first.
    const path = [...l.chain].reverse();
    let key = '';
    let parent = root;
    parent.value += value;
    path.forEach((link, d) => {
      key += `|${link.n}`;
      let node = index.get(key);
      if (!node) {
        node = {
          key, label: link.n, value: 0, depth: d + 1, children: [],
          ceased: link.c, owner: link.n ? ownerIdOf(link.n, meta) : null,
        };
        index.set(key, node);
        parent.children.push(node);
      }
      node.value += value;
      parent = node;
    });
    // The licensee itself is the last level.
    key += `|#${l.num}`;
    const leaf: IcicleNode = {
      key, label: l.name, value, depth: path.length + 1, children: [],
      owner: l.owner, ref: licensees.indexOf(l),
    };
    index.set(key, leaf);
    parent.children.push(leaf);
    maxDepth = Math.max(maxDepth, path.length + 1);
  }

  // THE LEGIBILITY PROBLEM, and why it is solved this way.
  //
  // Most licensees are one-office firms with no parent at all. Rolling them
  // into an aggregated "1,689 smaller firms" sibling put a single block across
  // 40% of the chart and squashed every real ownership chain — the only thing
  // this view exists to show — into 2px slivers.
  //
  // So the TOP level shows only groups big enough to read, and the remainder is
  // reported in the caption instead of drawn. Nothing is hidden: the excluded
  // count and headcount are stated, and they are all reachable in the Explorer.
  // Deeper levels still aggregate their tails, where the blocks are small
  // enough that an "other" sibling does not distort anything.
  const TOP_MIN = metric === 'current' ? 40 : 120;
  const excluded = root.children.filter((c) => c.value < TOP_MIN);
  const excludedFirms = excluded.reduce((s, c) => s + countLeaves(c), 0);
  const excludedAdvisers = excluded.reduce((s, c) => s + c.value, 0);
  root.children = root.children.filter((c) => c.value >= TOP_MIN);
  root.value -= excludedAdvisers;
  for (const c of root.children) prune(c, metric === 'current' ? 8 : 25);
  sortTree(root);

  // Column width is width / maxDepth, so measuring depth across the WHOLE tree
  // (including the chains just excluded) reserved columns nothing draws into
  // and left the right-hand third of the chart empty. Measure what survives.
  maxDepth = Math.max(1, treeDepth(root));

  const card = chartCard(
    'Ownership chains',
    `Each block is a company; its height is the number of advisers underneath it (${metric === 'current' ? 'currently authorised' : 'ever authorised'}). ` +
    'Greyed blocks are links ASIC records as ended, with the date. Click any block to open the licensee.',
  );

  const W = 960;
  const H = 620;
  const cells = icicle(root, W, H, maxDepth);
  const s = svgRoot({ viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(s, `Icicle chart of ${pool.length} licensees nested under their controlling companies, up to ${maxDepth} levels deep.`);

  for (const cell of cells) {
    if (cell.h < 0.7) continue;
    const n = cell.node;
    const dead = Boolean(n.ceased);
    const fill = n.owner ? ownerColor(n.owner) : (n.children.length ? '#b9c6d1' : INDEPENDENT_COLOR);
    const r = svg('rect', {
      x: finite(cell.x) + 0.5, y: finite(cell.y) + 0.5,
      width: Math.max(0.5, finite(cell.w) - 1), height: Math.max(0.5, finite(cell.h) - 1),
      fill, 'fill-opacity': dead ? 0.34 : 0.9, stroke: '#fff', 'stroke-width': 0.6, rx: 1.5,
    });
    const tip = `${titleCase(n.label)}\n${num(n.value)} advisers ${metric === 'current' ? 'now' : 'ever'} beneath this` +
      (dead ? `\nControl ended ${date(n.ceased!)}` : '') +
      (n.ref != null ? '\n(licensee — click to open)' : '');
    if (n.ref != null) {
      const lic = licensees[n.ref];
      mark(r, tip, { label: `${titleCase(n.label)}, ${num(n.value)} advisers`, onClick: () => void openLicensee(lic.num) });
    } else {
      mark(r, tip);
    }
    s.appendChild(r);
    if (cell.h > 12 && cell.w > 46) {
      const lab = svg('text', {
        x: finite(cell.x) + 5, y: finite(cell.y + cell.h / 2) + 3.5,
        'font-size': Math.min(11, Math.max(8.5, cell.h * 0.42)),
        fill: dead ? 'var(--text-secondary)' : '#fff', 'pointer-events': 'none',
      });
      lab.textContent = titleCase(n.label).slice(0, Math.floor(cell.w / 6.2));
      s.appendChild(lab);
    }
  }
  const host = el('div', 'zoom-host');
  host.appendChild(s);
  card.body.appendChild(host);
  // After insertion — attachSvgZoom appends its controls to svg.parentElement.
  attachSvgZoom(s);
  card.body.appendChild(legend([
    ...meta.owners.map((o) => ({ color: ownerColor(o.id), label: o.label })),
    { color: '#b9c6d1', label: 'Other holding company' },
    { color: INDEPENDENT_COLOR, label: 'Licensee' },
  ]));
  card.body.appendChild(el('p', 'sub',
    'Faded blocks are ownership links ASIC records as ceased — they are still printed on every historical row of ' +
    'the register, which is exactly why counting advisers by owner without checking those dates overstates the banks.'));
  if (excludedFirms > 0) {
    card.body.appendChild(el('p', 'sub',
      `Not drawn: ${num(excludedFirms)} licensees in groups of fewer than ${TOP_MIN} advisers ` +
      `(${num(excludedAdvisers)} advisers between them). Most are single-office firms with no parent company at ` +
      `all, and including them as one aggregated block squashed every real ownership chain into an unreadable ` +
      `sliver. All of them are searchable in Find an adviser.`));
  }
  return card.card;
}

/** Depth of the deepest surviving branch, measured AFTER pruning. */
function treeDepth(node: IcicleNode): number {
  if (!node.children.length) return node.depth;
  return Math.max(...node.children.map(treeDepth));
}

/** How many actual licensees sit under a node, for an honest exclusion count. */
function countLeaves(node: IcicleNode): number {
  if (!node.children.length) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

function ownerIdOf(name: string, meta: ViewCtx['meta']): string | null {
  const up = name.toUpperCase();
  for (const o of meta.owners) if (up.startsWith(o.match)) return o.id;
  return null;
}

function prune(node: IcicleNode, minValue: number): void {
  if (!node.children.length) return;
  const keep: IcicleNode[] = [];
  let otherValue = 0;
  let otherCount = 0;
  for (const c of node.children) {
    if (c.value >= minValue) keep.push(c);
    else { otherValue += c.value; otherCount++; }
  }
  if (otherCount > 1 && otherValue > 0) {
    keep.push({
      key: `${node.key}|__other`, label: `${otherCount} smaller firms`, value: otherValue,
      depth: node.depth + 1, children: [], owner: null,
    });
  } else if (otherCount === 1) {
    keep.push(node.children.find((c) => c.value < minValue)!);
  }
  node.children = keep;
  for (const c of node.children) prune(c, minValue);
}

function sortTree(node: IcicleNode): void {
  node.children.sort((a, b) => b.value - a.value);
  for (const c of node.children) sortTree(c);
}
