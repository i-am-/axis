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
//   symbols     a sprinkling of old map signs: churches, wells, mines and
//               windmills, each where such a thing would stand
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

export type Sign = 'church' | 'well' | 'mine' | 'windmill';
type Seg = [number, number, number, number];

const ring = (cx: number, cy: number, r: number, n = 10): Seg[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)];
  });

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
};

const SIGN_SIZE = 1.3;       // cells (≈ 13 px) a glyph's unit
const SIGN_GAP = 14;         // cells at least between signs
const SIGN_CLEAR = 1.1;      // cells of hachures cleared round a sign
const SIGNS_PER_CELL = 1 / 1100;

/** Where the signs stand: windmills on the heights, wells in the low ground,
 *  mines on steep slopes, churches between. Only where `free` allows. */
export function signs(h: Float32Array, cols: number, rows: number, random: () => number, free: (x: number, y: number) => boolean) {
  const at = sampler(h, cols, rows);
  const out: { x: number; y: number; sign: Sign }[] = [];
  const want = Math.round(cols * rows * SIGNS_PER_CELL);
  for (let tries = 0; tries < want * 40 && out.length < want; tries++) {
    const x = 2 + random() * (cols - 4), y = 2 + random() * (rows - 4);
    if (!free(x, y) || out.some((s) => Math.hypot(s.x - x, s.y - y) < SIGN_GAP)) continue;
    const z = at(x, y), slope = Math.hypot(at(x + 0.5, y) - at(x - 0.5, y), at(x, y + 0.5) - at(x, y - 0.5));
    const r = random();
    const sign: Sign = slope > 0.6 * SLOPE_REF ? (r < 0.7 ? 'mine' : 'church')
      : z > 0.62 ? (r < 0.65 ? 'windmill' : 'church')
      : z < 0.35 ? (r < 0.65 ? 'well' : 'church')
      : (r < 0.5 ? 'church' : r < 0.75 ? 'windmill' : 'well');
    out.push({ x, y, sign });
  }
  return out;
}

// ---- the whole backdrop, packed for the GPU

/** Floats per stroke: x0, y0, x1, y1, weight, kind. */
export const STRIDE = 6;
/** kind: 2…3 a dot of the river's dotted line at 2 + its point (0 source … 1
 *  mouth) along the river; or one of these */
export const KIND_HACHURE = -1, KIND_CONTOUR = -2, KIND_INDEX = -3, KIND_SIGN = -4, KIND_DOT = 2;
const VALLEY = 0.5;          // height a gutter's sides stand above its middle
const DOT_GAP = 0.9;         // cells between the river's dots
const LEVELS = 18;

export interface BuildOptions { cols: number; rows: number; hole: Hole | null; band?: Band | null; seed: number }
export interface Built { data: Float32Array; count: number; river: [number, number][] }

export function buildTerrain({ cols, rows, hole, band = null, seed }: BuildOptions): Built {
  const random = rng(seed);
  const h = heightmap(cols, rows, random);
  // the gutters: beside the text column, outside the hole, off the frame
  const gutter = (x: number, y: number) =>
    !(band && x >= band.x0 && x <= band.x1) && !inHole(hole, x, y) && x >= 1 && x <= cols - 1 && y >= 1;
  const land = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) land[y * cols + x] = gutter(x + 0.5, y + 0.5) ? 1 : 0;
  // each gutter is a gentle valley, so the river wanders down its middle
  // rather than along a wall; the landscape's own folds make it meander
  const valley = Float32Array.from(h);
  if (band) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols;) {
        if (!land[y * cols + x]) { x++; continue; }
        let e = x;
        while (e < cols && land[y * cols + e]) e++;
        const mid = (x + e - 1) / 2, half = Math.max(1, (e - x) / 2);
        for (let i = x; i < e; i++) valley[y * cols + i] += VALLEY * ((i - mid) / half) ** 2;
        x = e;
      }
    }
  }
  const f = flood(valley, cols, rows, hole, band ? land : undefined);
  const cells = thalweg(f, reach(f));
  const river = chaikin(cells.map((c) => [(c % cols) + 0.5, Math.floor(c / cols) + 0.5] as [number, number]));
  const cum = [0];
  for (let i = 1; i < river.length; i++) cum.push(cum[i - 1] + Math.hypot(river[i][0] - river[i - 1][0], river[i][1] - river[i - 1][1]));
  const total = cum.at(-1) || 1;

  const rings = contourRings(h, cols, rows, LEVELS);
  const rows_: number[] = [];
  // map signs in the gutters, clear of the river
  const nearRiver = (x: number, y: number) => river.some(([rx, ry]) => Math.abs(rx - x) < 2.5 && Math.abs(ry - y) < 2.5);
  const placed = signs(h, cols, rows, random, (x, y) => gutter(x - 1, y - 1) && gutter(x + 1, y + 1) && gutter(x - 1, y + 1) && gutter(x + 1, y - 1) && !nearRiver(x, y));
  for (const { x, y, sign } of placed) {
    for (const [ax, ay, bx, by] of GLYPHS[sign]) rows_.push(x + ax * SIGN_SIZE, y + ay * SIGN_SIZE, x + bx * SIGN_SIZE, y + by * SIGN_SIZE, 0, KIND_SIGN);
  }
  const underSign = (x: number, y: number) => placed.some((p) => Math.abs(p.x - x) < SIGN_CLEAR * SIGN_SIZE && Math.abs(p.y - y) < SIGN_CLEAR * SIGN_SIZE);
  for (const s of hachures(h, cols, rows, random, hole, rings, LEVELS)) {
    if (underSign(s.x0, s.y0) || underSign(s.x1, s.y1)) continue;
    rows_.push(s.x0, s.y0, s.x1, s.y1, s.weight, KIND_HACHURE);
  }
  // the river itself, dotted from source to mouth
  for (let i = 0, next = 0; i < river.length - 1; i++) {
    const [ax, ay] = river[i], [bx, by] = river[i + 1];
    const len = cum[i + 1] - cum[i];
    for (; next <= cum[i + 1]; next += DOT_GAP) {
      const u = len ? (next - cum[i]) / len : 0;
      const x = ax + (bx - ax) * u, y = ay + (by - ay) * u;
      if (!gutter(x, y)) continue;
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
  return { data: Float32Array.from(rows_), count: rows_.length / STRIDE, river };
}
