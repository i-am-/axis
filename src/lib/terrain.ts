// A synthetic landscape for the home page's hachure backdrop: a random
// height map, where its water runs, and the strokes that draw it.
//
//   heightmap   fBm simplex noise with a gentle tilt, normalised to 0…1
//   flood       priority-flood (Barnes et al. 2014, +ε): every cell drains
//               to an outlet, never uphill. For the river the land is only
//               the side gutters beside the text, draining to the page foot
//   reach       the longest flow path above each cell
//   accumulate  how many cells drain through each cell
//   thalweg     the main river: up from the mouth with the longest reach,
//               always into the longest tributary, to its source
//   hachures    classic contour-row hachures: wedges set along each contour
//               and run downslope towards the next, broader where it is steep
//   signs       churches, windmills, mines and wells on the hilltops
//   settlements villages and walled towns in the valleys near the river
//   battles     crossed swords, a rare few on open ground
//   roads       roads joining every sign; the longest chain, through the
//               most places, is the main road, dotted and lit in gold
//
// Everything is in grid units (one cell = one height sample, the sample at
// the cell's centre, as d3-contour places it). Pure; no DOM. renderer:
// hachure-gl.ts.

import { contours } from 'd3-contour';

export interface Hole { x0: number; y0: number; x1: number; y1: number }
/** The text column, in grid x: the river and the map signs keep out of it. */
export interface Band { x0: number; x1: number }
export interface Stroke { x0: number; y0: number; x1: number; y1: number; weight: number }

// ---- randomness

/** mulberry32: small, fast, seedable. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** 2D simplex noise (Gustavson), about −1…1. */
export function simplex2(random: () => number) {
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const corner = (g: number[], dx: number, dy: number) => {
    let t = 0.5 - dx * dx - dy * dy;
    if (t < 0) return 0;
    t *= t;
    return t * t * (g[0] * dx + g[1] * dy);
  };
  return (x: number, y: number) => {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const n = corner(GRAD[p[ii + p[jj]] & 7], x0, y0)
      + corner(GRAD[p[ii + i1 + p[jj + j1]] & 7], x1, y1)
      + corner(GRAD[p[ii + 1 + p[jj + 1]] & 7], x2, y2);
    return Math.max(-1, Math.min(1, 70 * n));
  };
}

// ---- the land

/** Broad landforms about 110 cells across, four octaves, a random tilt; 0…1. */
export function heightmap(cols: number, rows: number, random: () => number, feature = 110) {
  const noise = simplex2(random);
  const angle = random() * Math.PI * 2, tilt = 0.35;
  const ox = random() * 1000, oy = random() * 1000;
  const span = Math.max(cols, rows);
  const h = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let v = 0, amp = 1, f = 1 / feature;
      for (let o = 0; o < 4; o++) {
        v += amp * noise(ox + x * f, oy + y * f);
        amp *= 0.42;
        f *= 2;
      }
      v += tilt * ((x * Math.cos(angle) + y * Math.sin(angle)) / span);
      h[y * cols + x] = v;
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo);
  return h;
}

const inHole = (hole: Hole | null, x: number, y: number) =>
  !!hole && x >= hole.x0 && x <= hole.x1 && y >= hole.y0 && y <= hole.y1;

// ---- water

export interface Flood {
  cols: number; rows: number;
  filled: Float32Array;   // heights with every pit filled to its spill point (+ε a cell)
  parent: Int32Array;     // the cell each cell drains into; −1 for an outlet
  order: Int32Array;      // cells from the outlets upstream
}

const EPS = 1e-5;
const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Priority-flood from the outlets: the map's edge and the hole; or, given
 *  `land`, only over those cells, from the ones on the bottom row. */
export function flood(height: Float32Array, cols: number, rows: number, hole: Hole | null, land?: Uint8Array): Flood {
  const n = cols * rows;
  const filled = Float32Array.from(height);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const order = new Int32Array(n);
  // a binary min-heap of cells keyed by filled height, ties by insertion
  const heap: number[] = [], key = new Float64Array(n);
  let seq = 0;
  const less = (a: number, b: number) => filled[a] < filled[b] || (filled[a] === filled[b] && key[a] < key[b]);
  const push = (c: number) => {
    key[c] = seq++;
    heap.push(c);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (!less(heap[i], heap[up])) break;
      [heap[i], heap[up]] = [heap[up], heap[i]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  if (land) for (let c = 0; c < n; c++) if (!land[c]) closed[c] = 1;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (land) {
        const c = y * cols + x;
        if (y === rows - 1 && land[c]) { closed[c] = 1; push(c); }
        continue;
      }
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1 || inHole(hole, x + 0.5, y + 0.5)) {
        const c = y * cols + x;
        closed[c] = 1;
        push(c);
      }
    }
  }
  let k = 0;
  while (heap.length) {
    const c = pop();
    order[k++] = c;
    const cx = c % cols, cy = (c / cols) | 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const m = y * cols + x;
      if (closed[m]) continue;
      closed[m] = 1;
      filled[m] = Math.max(height[m], filled[c] + EPS);
      parent[m] = c;
      push(m);
    }
  }
  return { cols, rows, filled, parent, order: order.subarray(0, k) };
}

/** Cells draining through each cell, itself included. */
export function accumulate(f: Flood) {
  const acc = new Float32Array(f.parent.length).fill(1);
  for (let i = f.order.length - 1; i >= 0; i--) {
    const c = f.order[i];
    if (f.parent[c] >= 0) acc[f.parent[c]] += acc[c];
  }
  return acc;
}

/** The longest flow path above each cell, in cells (diagonal steps count √2). */
export function reach(f: Flood) {
  const len = new Float32Array(f.parent.length);
  for (let i = f.order.length - 1; i >= 0; i--) {
    const c = f.order[i], p = f.parent[c];
    if (p < 0) continue;
    const step = (c % f.cols) !== (p % f.cols) && ((c / f.cols) | 0) !== ((p / f.cols) | 0) ? Math.SQRT2 : 1;
    len[p] = Math.max(len[p], len[c] + step);
  }
  return len;
}

/** A river as cells, source first: up from the cell with the greatest weight
 *  (accumulation or reach) through its greatest tributary at every confluence. */
export function thalweg(f: Flood, acc: Float32Array) {
  const best = new Int32Array(acc.length).fill(-1);
  let mouth = -1;
  for (let c = 0; c < acc.length; c++) {
    const p = f.parent[c];
    if (p < 0) continue;
    if (best[p] < 0 || acc[c] > acc[best[p]]) best[p] = c;
    if (mouth < 0 || acc[c] > acc[mouth]) mouth = c;
  }
  const cells: number[] = [];
  for (let c = mouth; c >= 0; c = best[c]) cells.push(c);
  return cells.reverse();
}

/** Chaikin corner cutting, the ends kept. */
export function chaikin(pts: [number, number][], rounds = 2) {
  let p = pts;
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const q: [number, number][] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// ---- drawing

/** Bilinear height at a point, the samples at cell centres (i + 0.5, j + 0.5). */
export function sampler(h: Float32Array, cols: number, rows: number) {
  return (x: number, y: number) => {
    const u = Math.min(Math.max(x - 0.5, 0), cols - 1), v = Math.min(Math.max(y - 0.5, 0), rows - 1);
    const i = Math.min(Math.floor(u), cols - 2), j = Math.min(Math.floor(v), rows - 2);
    const fx = u - i, fy = v - j;
    const a = h[j * cols + i], b = h[j * cols + i + 1], c = h[(j + 1) * cols + i], d = h[(j + 1) * cols + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

export interface Ring { level: number; index: number; ring: [number, number][] }

/** Contour rings at `levels` evenly spaced heights. */
export function contourRings(h: Float32Array, cols: number, rows: number, levels: number): Ring[] {
  const thresholds = Array.from({ length: levels }, (_, i) => (i + 0.5) / levels);
  const out: Ring[] = [];
  contours().size([cols, rows]).thresholds(thresholds)(Array.from(h)).forEach((mp, index) => {
    for (const poly of mp.coordinates) for (const ring of poly) out.push({ level: mp.value, index, ring: ring as [number, number][] });
  });
  return out;
}

const SPACING = 1.0;         // cells between hachures along a contour (≈ 10 px at 10 px a cell)
const MAX_LEN = 1.5;         // cells (≈ 15 px)
const MIN_SLOPE = 0.004;     // height per cell: flatter ground is left blank
const SLOPE_REF = 0.03;      // slope (height per cell) drawn at full weight

const nearFrame = (cols: number, rows: number, x: number, y: number) => x < 1 || y < 1 || x > cols - 1 || y > rows - 1;

/** Contour-row hachures: from each contour downslope towards the next one. */
export function hachures(h: Float32Array, cols: number, rows: number, random: () => number, hole: Hole | null, rings: Ring[], levels: number): Stroke[] {
  const at = sampler(h, cols, rows);
  const step = 1 / levels;
  const out: Stroke[] = [];
  for (const { ring } of rings) {
    let next = SPACING * random();
    let walked = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      while (next <= walked + len) {
        const f = len ? (next - walked) / len : 0;
        const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
        next += SPACING * (0.8 + 0.4 * random());
        if (nearFrame(cols, rows, x, y) || inHole(hole, x, y)) continue;
        const gx = (at(x + 0.5, y) - at(x - 0.5, y)), gy = (at(x, y + 0.5) - at(x, y - 0.5));
        const slope = Math.hypot(gx, gy);
        if (slope < MIN_SLOPE) continue;
        const l = Math.min(MAX_LEN, (0.85 * step) / slope);
        const x1 = x - (gx / slope) * l, y1 = y - (gy / slope) * l;
        if (nearFrame(cols, rows, x1, y1) || inHole(hole, x1, y1)) continue;
        if (at(x1, y1) >= at(x, y)) continue;   // a saddle or a ridge crest: no fall line here
        // weight: the slope's angle, as a share of the full-weight slope's angle
        out.push({ x0: x, y0: y, x1, y1, weight: Math.min(1, Math.atan(slope / SLOPE_REF) / (Math.PI / 4)) });
      }
      walked += len;
    }
  }
  return out;
}

// ---- map signs

export type Sign = 'church' | 'well' | 'mine' | 'windmill' | 'village' | 'town' | 'battle';
type Seg = [number, number, number, number];

const ring = (cx: number, cy: number, r: number, n = 10): Seg[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)];
  });

/** A gabled house standing on y = base, centred on cx. */
const house = (cx: number, base: number, w = 0.13, h = 0.24): Seg[] => [
  [cx - w, base, cx + w, base], [cx - w, base, cx - w, base - h], [cx + w, base, cx + w, base - h],
  [cx - w - 0.04, base - h, cx, base - h - 0.17], [cx, base - h - 0.17, cx + w + 0.04, base - h],
];

/** The signs as strokes in a unit box about the origin, y down, the way a
 *  seventeenth-century map draws them: upright, small, in outline. */
export const GLYPHS: Record<Sign, Seg[]> = {
  // a ring with a cross standing on it
  church: [...ring(0, 0.2, 0.32), [0, -0.12, 0, -0.85], [-0.22, -0.6, 0.22, -0.6]],
  // a well head with its windlass
  well: [...ring(0, 0.25, 0.28), [-0.28, 0.25, -0.28, -0.4], [0.28, 0.25, 0.28, -0.4], [-0.4, -0.4, 0.4, -0.4], [0, -0.4, 0, -0.05]],
  // crossed hammers
  mine: [[-0.4, -0.4, 0.4, 0.45], [0.4, -0.4, -0.4, 0.45], [-0.58, -0.24, -0.24, -0.58], [0.24, -0.58, 0.58, -0.24]],
  // a post mill: a tapering body, four sails from the hub
  windmill: [[-0.16, 0.6, -0.08, 0], [0.16, 0.6, 0.08, 0], [-0.24, 0.6, 0.24, 0.6],
    [0, 0, -0.45, -0.45], [0, 0, 0.45, -0.45], [0, 0, -0.45, 0.45], [0, 0, 0.45, 0.45],
    [-0.45, -0.45, -0.3, -0.6], [0.45, -0.45, 0.6, -0.3], [0.45, 0.45, 0.3, 0.6], [-0.45, 0.45, -0.6, 0.3]],
  // a hamlet: a few houses about a small church
  village: [...house(-0.32, 0.35), ...house(0.34, 0.4), [0, 0.35, 0, -0.35], [-0.12, -0.2, 0.12, -0.2], ...ring(0, 0.38, 0.1, 6)],
  // a walled town: its ring of wall, houses within, a spire above
  town: [...ring(0, 0.1, 0.62, 16), ...house(-0.28, 0.45, 0.11, 0.2), ...house(0.28, 0.45, 0.11, 0.2), ...house(0, 0.5, 0.1, 0.18),
    [-0.08, 0.1, -0.08, -0.25], [0.08, 0.1, 0.08, -0.25], [-0.08, -0.25, 0, -0.85], [0, -0.85, 0.08, -0.25], [-0.1, -0.7, 0.1, -0.7]],
  // a battlefield: crossed swords, their guards and hilts below
  battle: [[-0.42, 0.42, 0.42, -0.42], [0.42, 0.42, -0.42, -0.42], [0.42, -0.42, 0.5, -0.5], [-0.42, -0.42, -0.5, -0.5],
    [-0.42, 0.18, -0.18, 0.42], [0.18, 0.42, 0.42, 0.18], [-0.42, 0.42, -0.52, 0.52], [0.42, 0.42, 0.52, 0.52]],
};
/** Glyph scale per sign: towns stand larger. */
const SIGN_SCALE: Record<Sign, number> = { church: 1, well: 1, mine: 1, windmill: 1, village: 1.25, town: 1.7, battle: 1.1 };

const SIGN_SIZE = 1.3;       // cells (≈ 13 px) a glyph's unit
const SIGN_GAP = 22;         // cells at least between signs
const SIGN_CLEAR = 1.1;      // cells of hachures cleared round a sign
const TOP_RADIUS = 3;        // cells: a top is the highest point this far round

/** Where the signs stand: on the tops, the local heights of the land, as an
 *  old map sets its churches and mills on the hills. Only where `free` allows. */
export function signs(h: Float32Array, cols: number, rows: number, random: () => number, free: (x: number, y: number) => boolean) {
  const tops: number[] = [];
  for (let y = TOP_RADIUS; y < rows - TOP_RADIUS; y++) {
    for (let x = TOP_RADIUS; x < cols - TOP_RADIUS; x++) {
      const c = y * cols + x;
      let top = true;
      for (let dy = -TOP_RADIUS; top && dy <= TOP_RADIUS; dy++)
        for (let dx = -TOP_RADIUS; dx <= TOP_RADIUS; dx++)
          if (h[c + dy * cols + dx] > h[c]) { top = false; break; }
      if (top && free(x + 0.5, y + 0.5)) tops.push(c);
    }
  }
  for (let i = tops.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tops[i], tops[j]] = [tops[j], tops[i]];
  }
  const out: { x: number; y: number; sign: Sign }[] = [];
  for (const c of tops) {
    const x = (c % cols) + 0.5, y = Math.floor(c / cols) + 0.5;
    if (out.some((s) => Math.hypot(s.x - x, s.y - y) < SIGN_GAP)) continue;
    const r = random();
    const sign: Sign = r < 0.38 ? 'windmill' : r < 0.72 ? 'church' : r < 0.88 ? 'mine' : 'well';
    out.push({ x, y, sign });
  }
  return out;
}

const ROAD_REACH = 60;       // cells: the longest single stretch of road
const SETTLE_GAP = 16;       // cells at least between a settlement and any other sign
const SETTLE_PER_CELL = 1 / 1400;

/** Villages and towns: on gentle ground in the valleys, near the river, as
 *  settlements grow; about one in three a town. */
export function settlements(h: Float32Array, cols: number, rows: number, random: () => number,
  free: (x: number, y: number) => boolean, river: [number, number][], taken: { x: number; y: number }[], area: number) {
  const at = sampler(h, cols, rows);
  const want = Math.max(1, Math.round(area * SETTLE_PER_CELL));
  const out: { x: number; y: number; sign: Sign }[] = [];
  const riverDist = (x: number, y: number) => river.reduce((d, [rx, ry]) => Math.min(d, Math.hypot(rx - x, ry - y)), Infinity);
  for (let tries = 0; tries < want * 60 && out.length < want; tries++) {
    const x = 2 + random() * (cols - 4), y = 2 + random() * (rows - 4);
    if (!free(x, y)) continue;
    if ([...taken, ...out].some((s) => Math.hypot(s.x - x, s.y - y) < SETTLE_GAP)) continue;
    const slope = Math.hypot(at(x + 0.5, y) - at(x - 0.5, y), at(x, y + 0.5) - at(x, y - 0.5));
    if (slope > 0.5 * SLOPE_REF) continue;
    const d = riverDist(x, y);
    if (river.length && (d < 3 || d > 4 + 8 * random())) continue;
    out.push({ x, y, sign: random() < 0.33 ? 'town' : 'village' });
  }
  return out;
}

const BATTLE_PER_CELL = 1 / 5000;

/** Battlefields: a rare few on open, gentle ground, away from the towns. */
export function battles(h: Float32Array, cols: number, rows: number, random: () => number,
  free: (x: number, y: number) => boolean, taken: { x: number; y: number }[], area: number) {
  const at = sampler(h, cols, rows);
  const want = Math.max(1, Math.round(area * BATTLE_PER_CELL));
  const out: { x: number; y: number; sign: Sign }[] = [];
  for (let tries = 0; tries < want * 80 && out.length < want; tries++) {
    const x = 2 + random() * (cols - 4), y = 2 + random() * (rows - 4);
    if (!free(x, y) || [...taken, ...out].some((s) => Math.hypot(s.x - x, s.y - y) < SETTLE_GAP)) continue;
    const slope = Math.hypot(at(x + 0.5, y) - at(x - 0.5, y), at(x, y + 0.5) - at(x, y - 0.5));
    if (slope < 0.35 * SLOPE_REF) out.push({ x, y, sign: 'battle' });
  }
  return out;
}

/** The roads: the shortest links that join every sign into one network (a
 *  minimum spanning tree), each bowed a little and kept where `free` allows.
 *  The main road is the network's longest chain, the one through the most
 *  places, running from its upper end; the rest are byways. */
export function roads(places: { x: number; y: number; sign: Sign }[], random: () => number, free: (x: number, y: number) => boolean) {
  const n = places.length;
  const route = (a: typeof places[0], b: typeof places[0]) => {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const bow = (random() - 0.5) * 0.35 * len;
    const mx = (a.x + b.x) / 2 - (dy / len) * bow, my = (a.y + b.y) / 2 + (dx / len) * bow;
    const pts = chaikin([[a.x, a.y], [mx, my], [b.x, b.y]], 3);
    return pts.every(([x, y]) => free(x, y)) ? pts : null;
  };
  const edges: { i: number; j: number; len: number; pts: [number, number][] }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const len = Math.hypot(places[i].x - places[j].x, places[i].y - places[j].y);
      if (len > ROAD_REACH) continue;
      const pts = route(places[i], places[j]);
      if (pts) edges.push({ i, j, len, pts });
    }
  }
  edges.sort((a, b) => a.len - b.len);
  const root = places.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  const tree: typeof edges = [];
  const links: { to: number; e: number }[][] = places.map(() => []);
  for (const e of edges) {
    const a = find(e.i), b = find(e.j);
    if (a === b) continue;
    root[a] = b;
    links[e.i].push({ to: e.j, e: tree.length });
    links[e.j].push({ to: e.i, e: tree.length });
    tree.push(e);
  }
  // the longest chain by places passed, then by length: twice the farthest walk
  const walk = (from: number) => {
    const hops = new Array(n).fill(-1), dist = new Array(n).fill(0), via = new Array(n).fill(-1);
    hops[from] = 0;
    const queue = [from];
    while (queue.length) {
      const c = queue.shift()!;
      for (const { to, e } of links[c]) {
        if (hops[to] >= 0) continue;
        hops[to] = hops[c] + 1; dist[to] = dist[c] + tree[e].len; via[to] = e;
        queue.push(to);
      }
    }
    let far = from;
    for (let i = 0; i < n; i++) if (hops[i] > hops[far] || (hops[i] === hops[far] && dist[i] > dist[far])) far = i;
    return { far, hops: hops[far], dist: dist[far], via };
  };
  let best = { a: -1, b: -1, hops: 0, dist: 0, via: [] as number[] };
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (seen.has(find(i))) continue;
    seen.add(find(i));
    const a = walk(i).far, w = walk(a);
    if (w.hops > best.hops || (w.hops === best.hops && w.dist > best.dist)) best = { a, b: w.far, hops: w.hops, dist: w.dist, via: w.via };
  }
  // the chain as one line, from its upper end
  const onMain = new Set<number>();
  let main: [number, number][] = [];
  for (let c = best.b; c !== best.a && best.a >= 0;) {
    const e = tree[best.via[c]];
    onMain.add(best.via[c]);
    const pts = e.i === c ? e.pts : [...e.pts].reverse();   // from c towards a
    main.push(...(main.length ? pts.slice(1) : pts));
    c = e.i === c ? e.j : e.i;
  }
  if (main.length && main[0][1] > main[main.length - 1][1]) main = main.reverse();
  const byways: Seg[] = [];
  tree.forEach((e, k) => {
    if (onMain.has(k)) return;
    for (let q = 0; q < e.pts.length - 1; q++) byways.push([e.pts[q][0], e.pts[q][1], e.pts[q + 1][0], e.pts[q + 1][1]]);
  });
  return { main, byways };
}

// ---- the whole backdrop, packed for the GPU

/** Floats per stroke: x0, y0, x1, y1, weight, kind. */
export const STRIDE = 6;
/** kind: 2…3 a dot of the main road at 2 + its point along the road (0 at
 *  its upper end … 1); or one of these */
export const KIND_HACHURE = -1, KIND_CONTOUR = -2, KIND_INDEX = -3, KIND_SIGN = -4, KIND_ROAD = -5, KIND_DOT = 2;
const VALLEY = 0.45;         // height the ridge behind the text stands above a gutter's floor
const DOT_GAP = 0.9;         // cells between the main road's dots
const LEVELS = 18;

export interface BuildOptions { cols: number; rows: number; hole: Hole | null; band?: Band | null; seed: number }
export interface Built { data: Float32Array; count: number; river: [number, number][]; road: [number, number][] }

export function buildTerrain({ cols, rows, hole, band = null, seed }: BuildOptions): Built {
  const random = rng(seed);
  const h = heightmap(cols, rows, random);
  const hills = Float32Array.from(h);   // the landscape's own hills, before the gutter valleys
  // the gutters: beside the text column, outside the hole, off the frame
  const gutter = (x: number, y: number) =>
    !(band && x >= band.x0 && x <= band.x1) && !inHole(hole, x, y) && x >= 1 && x <= cols - 1 && y >= 1;
  const land = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) land[y * cols + x] = gutter(x + 0.5, y + 0.5) ? 1 : 0;
  // each gutter is a valley in the land itself, under a ridge behind the
  // text: the river follows the relief down the valley floor, meandering
  // with the landscape's own folds, and the hachures draw the same relief
  if (band) {
    // centred on each gutter where it is narrowest, beside the hero
    const inL = hole ? Math.min(band.x0, hole.x0) : band.x0, inR = hole ? Math.max(band.x1, hole.x1) : band.x1;
    const cL = (1 + inL) / 2, cR = (inR + cols - 1) / 2;
    const wL = Math.max(2, (inL - 1) / 2), wR = Math.max(2, (cols - 1 - inR) / 2);
    for (let x = 0; x < cols; x++) {
      const u = Math.min(Math.abs(x + 0.5 - cL) / wL, Math.abs(x + 0.5 - cR) / wR);
      const lift = VALLEY * (1 - Math.exp(-u * u));
      for (let y = 0; y < rows; y++) h[y * cols + x] += lift;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo);
  }
  const f = flood(h, cols, rows, hole, band ? land : undefined);
  const cells = thalweg(f, reach(f));
  const river = chaikin(cells.map((c) => [(c % cols) + 0.5, Math.floor(c / cols) + 0.5] as [number, number]));

  const rings = contourRings(h, cols, rows, LEVELS);
  const rows_: number[] = [];
  // map signs in the gutters, clear of the river
  const nearRiver = (x: number, y: number) => river.some(([rx, ry]) => Math.abs(rx - x) < 2.5 && Math.abs(ry - y) < 2.5);
  const roomy = (r: number) => (x: number, y: number) =>
    gutter(x - r, y - r) && gutter(x + r, y + r) && gutter(x - r, y + r) && gutter(x + r, y - r) && !nearRiver(x, y);
  const tops = signs(hills, cols, rows, random, roomy(1));
  let area = 0;
  for (const v of land) area += v;
  const towns = settlements(h, cols, rows, random, roomy(1.6), river, tops, area);
  const placed = [...tops, ...towns, ...battles(h, cols, rows, random, roomy(1.2), [...tops, ...towns], area)];
  for (const { x, y, sign } of placed) {
    const k = SIGN_SIZE * SIGN_SCALE[sign];
    for (const [ax, ay, bx, by] of GLYPHS[sign]) rows_.push(x + ax * k, y + ay * k, x + bx * k, y + by * k, 0, KIND_SIGN);
  }
  const { main, byways } = roads(placed, random, (x, y) => gutter(x, y));
  // roads stop short of the signs they join
  const atSign = (x: number, y: number) => placed.some((p) => Math.hypot(p.x - x, p.y - y) < 0.8 * SIGN_SIZE * SIGN_SCALE[p.sign]);
  for (const [ax, ay, bx, by] of byways) if (!atSign(ax, ay) && !atSign(bx, by)) rows_.push(ax, ay, bx, by, 0, KIND_ROAD);
  const underSign = (x: number, y: number) => placed.some((p) => {
    const r = SIGN_CLEAR * SIGN_SIZE * SIGN_SCALE[p.sign];
    return Math.abs(p.x - x) < r && Math.abs(p.y - y) < r;
  });
  for (const s of hachures(h, cols, rows, random, hole, rings, LEVELS)) {
    if (underSign(s.x0, s.y0) || underSign(s.x1, s.y1)) continue;
    rows_.push(s.x0, s.y0, s.x1, s.y1, s.weight, KIND_HACHURE);
  }
  // the main road, dotted from its upper end (0) to its lower (1)
  const cum = [0];
  for (let k = 1; k < main.length; k++) cum.push(cum[k - 1] + Math.hypot(main[k][0] - main[k - 1][0], main[k][1] - main[k - 1][1]));
  const total = cum.at(-1) || 1;
  for (let k = 0, next = 0; k < main.length - 1; k++) {
    const [ax, ay] = main[k], [bx, by] = main[k + 1];
    const len = cum[k + 1] - cum[k];
    for (; next <= cum[k + 1]; next += DOT_GAP) {
      const u = len ? (next - cum[k]) / len : 0;
      const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
      if (!gutter(x, y) || atSign(x, y)) continue;
      rows_.push(x, y, x, y, 1, KIND_DOT + next / total);
    }
  }
  for (const { index, ring } of rings) {
    const kind = index % 5 === 4 ? KIND_INDEX : KIND_CONTOUR;
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
      if (nearFrame(cols, rows, ax, ay) && nearFrame(cols, rows, bx, by)) continue;
      if (inHole(hole, ax, ay) && inHole(hole, bx, by)) continue;
      if (underSign(ax, ay) || underSign(bx, by)) continue;
      rows_.push(ax, ay, bx, by, 0, kind);
    }
  }
  return { data: Float32Array.from(rows_), count: rows_.length / STRIDE, river, road: main };
}
