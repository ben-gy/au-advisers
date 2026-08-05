// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The industry as a directed movement graph. Settled to completion BEFORE the
// first paint — the layout is motionless from frame one, never animated.
//
// TWO things this view got wrong the first time and now handles deliberately:
//
//  * At a 5-adviser threshold it drew 595 nodes and 1,651 links as a uniform
//    blob with every label overprinting its neighbours. A movement graph whose
//    nodes all look alike and float without structure is near-useless, so the
//    default threshold now shows the BACKBONE of significant moves, only the
//    hubs are labelled (with a halo so labels survive crossing an edge), and
//    the density is a control the reader can turn up if they want the tail.
//
//  * Clicking a node used to do nothing but open a drawer, which wastes the
//    graph. Selecting a firm now highlights its actual connections and dims
//    everything else, so the picture answers "who did THIS firm exchange
//    people with" without leaving the view.

import type { ViewCtx } from '../router.ts';
import { getMovements, getLicensees } from '../data.ts';
import { el, chartCard, svg, svgRoot, mark, legend, describe } from './svg.ts';
import { finite } from './layout.ts';
import { forceLayout, mulberry32, type SimNode } from '../utils/forceLayout.ts';
import { attachSvgZoom } from '../utils/svgZoom.ts';
import { num, titleCase, esc } from '../format.ts';
import { ownerColor, INDEPENDENT_COLOR, EXIT_COLOR } from '../colors.ts';
import { glossaryButton } from '../glossary.ts';
import { openLicensee } from '../licenseeDrawer.ts';
import type { Licensee } from '../types.ts';

/** How many firms to label. Beyond this the labels collide and the graph
 *  becomes less readable, not more. Everything else labels on hover. */
const LABEL_COUNT = 14;

export async function renderMovements({ root, meta }: ViewCtx): Promise<void> {
  const [movements, licensees] = await Promise.all([getMovements(), getLicensees()]);

  const head = el('div', 'page-head');
  head.appendChild(el('h1', undefined, 'Where the advisers went'));
  head.appendChild(el('p', undefined,
    `${num(meta.transitions)} recorded moves between licensees, reconstructed by reading each adviser's ` +
    'appointments in date order. Every firm is a node; every arrow is people.'));
  root.appendChild(head);

  const note = el('div', 'note');
  note.innerHTML = `<strong>${num(meta.exits)} advisers left the register entirely</strong> rather than moving to
    another firm — more than went to any single firm. They flow into the grey <em>left the register</em> node,
    because a movement graph that only shows people landing somewhere would imply that everyone did.`;
  const gg = glossaryButton('exitnode');
  if (gg) note.appendChild(gg);
  root.appendChild(note);

  const controls = el('div', 'controls');

  const filter = el('select') as HTMLSelectElement;
  filter.setAttribute('aria-label', 'Filter the graph by owner group');
  filter.innerHTML = '<option value="">All licensees</option>' +
    meta.owners.map((o) => `<option value="${esc(o.id)}">${esc(o.label)} chain only</option>`).join('') +
    '<option value="indep">Independent / other only</option>';
  controls.appendChild(filter);

  const density = el('select') as HTMLSelectElement;
  density.setAttribute('aria-label', 'How many moves an arrow must represent to be drawn');
  density.innerHTML = [
    { v: 20, l: 'Backbone — 20+ advisers moved' },
    { v: 10, l: 'Major moves — 10+ advisers' },
    { v: 5, l: 'Everything — 5+ advisers (dense)' },
  ].map((o) => `<option value="${o.v}"${o.v === 20 ? ' selected' : ''}>${o.l}</option>`).join('');
  controls.appendChild(density);

  const clear = el('button', 'btn', 'Clear selection') as HTMLButtonElement;
  clear.hidden = true;
  controls.appendChild(clear);

  controls.appendChild(el('span', 'sub', 'Scroll to zoom · drag to pan · click a firm to trace its moves'));
  root.appendChild(controls);

  const card = chartCard(
    'The movement network',
    'Firms connected by advisers moving between them. Node size is current advisers, colour is the ultimate ' +
    'owner, and arrow thickness is how many people made that move. Only the largest firms are labelled — ' +
    'hover any node for its name.',
  );
  const host = el('div', 'zoom-host');
  card.body.appendChild(host);
  const caption = el('p', 'sub');
  card.body.appendChild(caption);
  card.body.appendChild(legend([
    ...meta.owners.map((o) => ({ color: ownerColor(o.id), label: o.label })),
    { color: INDEPENDENT_COLOR, label: 'Independent / other' },
    { color: EXIT_COLOR, label: 'Left the register' },
  ]));
  root.appendChild(card.card);

  const draw = () => {
    const built = buildGraph(movements, licensees, meta, filter.value, Number(density.value), (n) => {
      clear.hidden = n === 0;
    });
    host.replaceChildren(built.node);
    caption.textContent = built.caption;
    clear.hidden = true;
    // Zoom is attached AFTER the SVG is in the document: attachSvgZoom appends
    // its controls to svg.parentElement, which is null while the node is still
    // detached — attaching first silently shipped a dense graph with no way to
    // zoom into it. It also defers pointer capture until a real drag, so
    // clicking a node still works; never verify that with element.click().
    if (built.node instanceof SVGSVGElement) attachSvgZoom(built.node);
    clear.onclick = () => built.clearSelection?.();
  };
  filter.addEventListener('change', draw);
  density.addEventListener('change', draw);
  draw();
}

function buildGraph(
  movements: Awaited<ReturnType<typeof getMovements>>,
  licensees: Licensee[],
  meta: ViewCtx['meta'],
  mode: string,
  minEdge: number,
  onSelect: (n: number) => void,
): { node: SVGElement | HTMLElement; caption: string; clearSelection?: () => void } {
  const keep = (i: number) => {
    const l = licensees[i];
    if (!l) return false;
    if (!mode) return true;
    if (mode === 'indep') return !l.owner;
    return l.owner === mode;
  };

  const edges = movements.edges.filter((e) => e.c >= minEdge && keep(e.f) && keep(e.t));
  const exitEdges = movements.exits.filter((e) => e.c >= minEdge * 4 && keep(e.f));
  const ids = new Set<number>();
  for (const e of edges) { ids.add(e.f); ids.add(e.t); }
  for (const e of exitEdges) ids.add(e.f);

  if (!ids.size) {
    return {
      node: el('div', 'empty-state', `No moves of ${minEdge} or more advisers within this selection. Try a lower threshold.`),
      caption: '',
    };
  }

  const list = [...ids];
  const pos = new Map(list.map((id, i) => [id, i]));
  const EXIT_IDX = list.length;

  const W = 940;
  const H = 640;
  const rand = mulberry32(20260805);
  const nodes: SimNode[] = list.map((id) => {
    const l = licensees[id];
    const r = Math.max(4.5, Math.min(28, Math.sqrt(Math.max(1, l.current || l.total / 4)) * 1.6));
    const groupIdx = l.owner ? meta.owners.findIndex((o) => o.id === l.owner) : 5;
    const ang = (groupIdx / 6) * Math.PI * 2;
    return {
      x: W / 2 + Math.cos(ang) * (150 + rand() * 130) + (rand() - 0.5) * 90,
      y: H / 2 + Math.sin(ang) * (150 + rand() * 130) + (rand() - 0.5) * 90,
      r,
    };
  });
  nodes.push({ x: W / 2, y: H - 60, r: 30 });

  const links = edges.map((e) => ({ source: pos.get(e.f)!, target: pos.get(e.t)! }))
    .concat(exitEdges.map((e) => ({ source: pos.get(e.f)!, target: EXIT_IDX })));

  // Runs to completion synchronously; the graph is settled before it paints.
  forceLayout(nodes, links, {
    width: W, height: H, iterations: 400, linkDistance: 70, cutoff: 190,
  });

  const s = svgRoot({ viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
  describe(s, `Directed network of ${list.length} licensees connected by ${edges.length} adviser movements of ${minEdge} or more people, plus an explicit node for advisers who left the register.`);

  const defs = svg('defs');
  const marker = svg('marker', {
    id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse',
  });
  marker.appendChild(svg('path', { d: 'M0,1L9,5L0,9z', fill: 'var(--border-strong)' }));
  defs.appendChild(marker);
  s.appendChild(defs);

  // Adjacency, so a selection can highlight exactly what connects to a firm.
  const neighbours = new Map<number, Set<number>>();
  const touch = (a: number, b: number) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a)!.add(b);
  };
  edges.forEach((e) => { touch(pos.get(e.f)!, pos.get(e.t)!); touch(pos.get(e.t)!, pos.get(e.f)!); });
  exitEdges.forEach((e) => { touch(pos.get(e.f)!, EXIT_IDX); touch(EXIT_IDX, pos.get(e.f)!); });

  const gLinks = svg('g', { 'stroke-linecap': 'round' });
  const maxC = Math.max(...edges.map((e) => e.c), ...exitEdges.map((e) => e.c), 1);
  const linkEls: { el: SVGElement; a: number; b: number }[] = [];

  edges.forEach((e) => {
    const ai = pos.get(e.f)!;
    const bi = pos.get(e.t)!;
    const a = nodes[ai];
    const b = nodes[bi];
    const line = svg('line', {
      x1: finite(a.x), y1: finite(a.y), x2: finite(b.x), y2: finite(b.y),
      stroke: 'var(--border-strong)', 'stroke-opacity': 0.42,
      'stroke-width': Math.max(0.7, (e.c / maxC) * 5.5), 'marker-end': 'url(#arrow)',
    });
    mark(line, `${titleCase(licensees[e.f].name)}\n→ ${titleCase(licensees[e.t].name)}\n${num(e.c)} advisers moved`);
    gLinks.appendChild(line);
    linkEls.push({ el: line, a: ai, b: bi });
  });
  exitEdges.forEach((e) => {
    const ai = pos.get(e.f)!;
    const a = nodes[ai];
    const b = nodes[EXIT_IDX];
    const line = svg('line', {
      x1: finite(a.x), y1: finite(a.y), x2: finite(b.x), y2: finite(b.y),
      stroke: EXIT_COLOR, 'stroke-opacity': 0.5, 'stroke-dasharray': '4 3',
      'stroke-width': Math.max(0.7, (e.c / maxC) * 5.5),
    });
    mark(line, `${titleCase(licensees[e.f].name)}\n→ left the register\n${num(e.c)} advisers`);
    gLinks.appendChild(line);
    linkEls.push({ el: line, a: ai, b: EXIT_IDX });
  });
  s.appendChild(gLinks);

  const gNodes = svg('g');
  const nodeEls: SVGElement[] = [];
  let selected: number | null = null;

  const applySelection = () => {
    const active = selected;
    for (const { el: line, a, b } of linkEls) {
      const on = active == null || a === active || b === active;
      line.classList.toggle('mark-dim', !on);
    }
    nodeEls.forEach((n, i) => {
      const on = active == null || i === active || neighbours.get(active)?.has(i);
      n.classList.toggle('mark-dim', !on);
      n.classList.toggle('mark-hi', active != null && i === active);
    });
    for (const lab of labelEls) {
      const on = active == null || lab.i === active || neighbours.get(active)?.has(lab.i);
      lab.el.classList.toggle('mark-dim', !on);
    }
    onSelect(active == null ? 0 : 1);
  };

  const labelEls: { el: SVGElement; i: number }[] = [];

  list.forEach((id, i) => {
    const l = licensees[id];
    const n = nodes[i];
    const c = svg('circle', {
      cx: finite(n.x), cy: finite(n.y), r: n.r,
      fill: ownerColor(l.ownerLive ? l.owner : null), 'fill-opacity': l.alive ? 0.92 : 0.5,
      stroke: '#fff', 'stroke-width': 1.2,
    });
    mark(c, `${titleCase(l.name)}\n${num(l.current)} advisers now · ${num(l.total)} ever\n${l.ultimate ? `Owner: ${titleCase(l.ultimate)}` : 'No recorded owner'}\n\nClick to trace this firm's moves`, {
      label: `${titleCase(l.name)}, ${num(l.current)} current advisers`,
      onClick: () => {
        // Selection tells a story AND opens the detail — a click that only did
        // the latter would waste the graph entirely.
        selected = selected === i ? null : i;
        applySelection();
        if (selected != null) void openLicensee(l.num);
      },
    });
    gNodes.appendChild(c);
    nodeEls.push(c);
  });

  // Label only the biggest firms, with a white halo so a label crossing an edge
  // stays readable. Labelling all 595 produced overprinted mush.
  const labelled = list
    .map((id, i) => ({ i, r: nodes[i].r, name: licensees[id].name }))
    .sort((a, b) => b.r - a.r)
    .slice(0, LABEL_COUNT);
  for (const item of labelled) {
    const n = nodes[item.i];
    const lab = svg('text', {
      x: finite(n.x), y: finite(n.y - n.r - 5), 'text-anchor': 'middle',
      'font-size': 10.5, 'font-weight': 600, fill: 'var(--text-primary)',
      stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke',
      'pointer-events': 'none',
    });
    lab.textContent = titleCase(item.name).slice(0, 26);
    gNodes.appendChild(lab);
    labelEls.push({ el: lab, i: item.i });
  }

  const ex = nodes[EXIT_IDX];
  const exNode = svg('circle', {
    cx: finite(ex.x), cy: finite(ex.y), r: ex.r, fill: EXIT_COLOR, 'fill-opacity': 0.35,
    stroke: EXIT_COLOR, 'stroke-width': 2, 'stroke-dasharray': '5 3',
  });
  mark(exNode, `Left the register\n${num(meta.exits)} advisers in total ended their last appointment and never returned`);
  gNodes.appendChild(exNode);
  nodeEls.push(exNode);
  const exLab = svg('text', {
    x: finite(ex.x), y: finite(ex.y + 4), 'text-anchor': 'middle', 'font-size': 11,
    'font-weight': 600, fill: 'var(--text-primary)', 'pointer-events': 'none',
    stroke: '#ffffff', 'stroke-width': 3, 'paint-order': 'stroke',
  });
  exLab.textContent = 'left';
  gNodes.appendChild(exLab);
  s.appendChild(gNodes);

  // Clicking empty canvas clears the selection.
  s.addEventListener('click', (e) => {
    if ((e.target as Element).tagName === 'svg' && selected != null) {
      selected = null;
      applySelection();
    }
  });

  const caption = `${num(list.length)} firms and ${num(edges.length)} moves of ${minEdge}+ advisers shown` +
    `${exitEdges.length ? `, plus ${num(exitEdges.length)} flows out of the register` : ''}. ` +
    `Click a firm to dim everything it is not connected to.`;

  return {
    node: s,
    caption,
    clearSelection: () => { selected = null; applySelection(); },
  };
}
