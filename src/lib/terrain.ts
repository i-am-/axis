// A synthetic landscape for the home page's hachure backdrop: a random
// height map, where its water runs, and the strokes that draw it.
//
//   heightmap   fBm simplex noise with a gentle tilt, normalised to 0…1
//   flood       priority-flood (Barnes et al. 2014, +ε): every cell drains
//               to the map's edge or to the hole (the hero panel, which
//               takes the water like the sea), never uphill
//   accumulate  how many cells drain through each cell
//   thalweg     the main river: up from the busiest mouth, always into the
//               busiest tributary, to its source
//   hachures    classic contour-row hachures: strokes set along each contour
//               and run downslope towards the next, heavier where it is steep
//
// Everything is in grid units (one cell = one height sample, the sample at
// the cell's centre, as d3-contour places it). Pure; no DOM. renderer:
// hachure-gl.ts.

import { contours } from 'd3-contour';

export interface Hole { x0: number; y0: number; x1: number; y1: number }
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

/** Priority-flood from the outlets: the map's edge and the hole. */
export function flood(height: Float32Array, cols: number, rows: number, hole: Hole | null): Flood {
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

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
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
  return { cols, rows, filled, parent, order };
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

/** The main river as cells, source first: up from the busiest mouth through the busiest tributary. */
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

const SPACING = 0.62;        // cells between hachures along a contour (≈ 5 px at 8 px a cell)
const MAX_LEN = 1.75;        // cells (≈ 14 px)
const MIN_SLOPE = 0.004;     // height per cell: flatter ground is left blank
const SLOPE_REF = 0.03;      // slope drawn at full weight

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
        out.push({ x0: x, y0: y, x1, y1, weight: Math.min(1, slope / SLOPE_REF) });
      }
      walked += len;
    }
  }
  return out;
}

// ---- the whole backdrop, packed for the GPU

/** Floats per stroke: x0, y0, x1, y1, weight, kind. */
export const STRIDE = 6;
/** kind: 0…1 a golden-path hachure at that point along the river; or one of these */
export const KIND_HACHURE = -1, KIND_CONTOUR = -2, KIND_INDEX = -3;
const GOLD_RADIUS = 1.75;    // cells (≈ 14 px) from the river
const LEVELS = 24;

export interface BuildOptions { cols: number; rows: number; hole: Hole | null; seed: number }
export interface Built { data: Float32Array; count: number; river: [number, number][] }

function nearestOnPath(path: [number, number][], cum: number[], x: number, y: number) {
  let best = Infinity, t = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * u - x, ay + dy * u - y);
    if (d < best) { best = d; t = cum[i] + u * Math.sqrt(l2); }
  }
  return { d: best, along: t };
}

export function buildTerrain({ cols, rows, hole, seed }: BuildOptions): Built {
  const random = rng(seed);
  const h = heightmap(cols, rows, random);
  const f = flood(h, cols, rows, hole);
  const river = chaikin(thalweg(f, accumulate(f)).map((c) => [(c % cols) + 0.5, Math.floor(c / cols) + 0.5] as [number, number]));
  const cum = [0];
  for (let i = 1; i < river.length; i++) cum.push(cum[i - 1] + Math.hypot(river[i][0] - river[i - 1][0], river[i][1] - river[i - 1][1]));
  const total = cum.at(-1) || 1;
  // a box around the river, to skip the distance test for most strokes
  const xs = river.map((p) => p[0]), ys = river.map((p) => p[1]);
  const box = { x0: Math.min(...xs) - GOLD_RADIUS, x1: Math.max(...xs) + GOLD_RADIUS, y0: Math.min(...ys) - GOLD_RADIUS, y1: Math.max(...ys) + GOLD_RADIUS };

  const rings = contourRings(h, cols, rows, LEVELS);
  const rows_: number[] = [];
  for (const s of hachures(h, cols, rows, random, hole, rings, LEVELS)) {
    let kind = KIND_HACHURE;
    const mx = (s.x0 + s.x1) / 2, my = (s.y0 + s.y1) / 2;
    if (mx >= box.x0 && mx <= box.x1 && my >= box.y0 && my <= box.y1) {
      const near = nearestOnPath(river, cum, mx, my);
      if (near.d <= GOLD_RADIUS) kind = near.along / total;
    }
    rows_.push(s.x0, s.y0, s.x1, s.y1, s.weight, kind);
  }
  for (const { index, ring } of rings) {
    const kind = index % 5 === 4 ? KIND_INDEX : KIND_CONTOUR;
    for (let i = 0; i < ring.length - 1; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[i + 1];
      if (nearFrame(cols, rows, ax, ay) && nearFrame(cols, rows, bx, by)) continue;
      if (inHole(hole, ax, ay) && inHole(hole, bx, by)) continue;
      rows_.push(ax, ay, bx, by, 0, kind);
    }
  }
  return { data: Float32Array.from(rows_), count: rows_.length / STRIDE, river };
}
