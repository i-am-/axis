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
//   chalk       the contours redrawn by hand: wobbling, pressing harder and
//               lighter, the chalk skipping; index contours bolder
//   labels      heights set into breaks in the index contours
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

// ---- the contours, drawn by hand in chalk

/** A contour as a hand draws it: points `pts`, the chalk's pressure at each
 *  (0…1), and `skip[i]` where the chalk lifted between point i and i + 1. */
export interface ChalkLine { level: number; index: number; pts: [number, number][]; press: number[]; skip: boolean[] }

const WOBBLE = 0.3;          // cells: how far the hand strays from the true contour
const CHALK_STEP = 0.5;      // cells between the hand's points
const SKIP = 0.6;            // noise above this lifts the chalk: a short gap

/** Contour rings redrawn by hand: resampled, pushed sideways by slow noise,
 *  the pressure rising and falling, the chalk skipping now and then, and a
 *  closed ring left a little open or overdrawn where the hand met its start. */
export function chalk(rings: Ring[], random: () => number): ChalkLine[] {
  const noise = simplex2(random);
  return rings.map(({ level, index, ring }) => {
    const cum = [0];
    for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
    const total = cum.at(-1)!;
    const row = random() * 1000;
    if (total < 2) return { level, index, pts: ring, press: ring.map(() => 0.5), skip: ring.map(() => false) };
    const first = ring[0], last = ring.at(-1)!;
    const closed = first[0] === last[0] && first[1] === last[1];
    const s0 = closed ? random() * total : 0;
    const drawn = closed ? total + (random() - 0.4) * 1.6 : total;
    let seg = 0;
    const at = (s: number) => {
      if (closed) s = ((s % total) + total) % total;
      if (s < cum[seg]) seg = 0;
      while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
      const a = ring[seg], b = ring[seg + 1], len = cum[seg + 1] - cum[seg];
      const f = len ? Math.min(1, Math.max(0, (s - cum[seg]) / len)) : 0;
      const tx = len ? (b[0] - a[0]) / len : 1, ty = len ? (b[1] - a[1]) / len : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, tx, ty];
    };
    const n = Math.max(2, Math.ceil(drawn / CHALK_STEP));
    const pts: [number, number][] = [], press: number[] = [], skip: boolean[] = [];
    for (let k = 0; k <= n; k++) {
      const u = (k / n) * drawn;
      const [x, y, tx, ty] = at(s0 + u);
      const off = WOBBLE * (0.7 * noise(u / 10, row) + 0.3 * noise(u / 3, row + 7));
      pts.push([x - ty * off, y + tx * off]);
      // index contours swell and thin more, and faster: a hand bearing down
      press.push(Math.min(1, Math.max(0, index % 5 === 4
        ? 0.5 + 0.8 * noise(u / 7, row + 13) + 0.35 * noise(u / 2.2, row + 41)
        : 0.5 + 0.7 * noise(u / 14, row + 13))));
      skip.push(noise(u / 2.5, row + 29) > SKIP);
    }
    return { level, index, pts, press, skip };
  });
}

// ---- height labels on the index contours

/** Digits as hand strokes in a box 0.6 wide, y −0.5 (top) … 0.5, y down. */
const DIGIT_STROKES: Record<string, [number, number][][]> = {
  '0': [Array.from({ length: 13 }, (_, i) => [0.3 + 0.29 * Math.sin((i / 12) * 2 * Math.PI), -0.5 * Math.cos((i / 12) * 2 * Math.PI)] as [number, number])],
  '1': [[[0.1, -0.3], [0.34, -0.5], [0.34, 0.5]]],
  '2': [[[0.04, -0.3], [0.14, -0.46], [0.32, -0.5], [0.5, -0.42], [0.56, -0.24], [0.48, -0.04], [0.03, 0.5], [0.6, 0.48]]],
  '3': [[[0.05, -0.4], [0.25, -0.5], [0.48, -0.44], [0.55, -0.27], [0.45, -0.09], [0.24, -0.03], [0.47, 0.03], [0.58, 0.22], [0.5, 0.43], [0.28, 0.5], [0.03, 0.4]]],
  '4': [[[0.46, 0.5], [0.44, -0.5], [0.02, 0.18], [0.62, 0.2]]],
  '5': [[[0.55, -0.5], [0.12, -0.49], [0.06, -0.04], [0.28, -0.12], [0.5, -0.05], [0.6, 0.18], [0.52, 0.42], [0.3, 0.5], [0.03, 0.42]]],
  '6': [[[0.52, -0.45], [0.32, -0.5], [0.12, -0.38], [0.03, -0.05], [0.05, 0.3], [0.25, 0.5], [0.48, 0.45], [0.58, 0.22], [0.48, 0.0], [0.28, -0.05], [0.07, 0.08]]],
  '7': [[[0.02, -0.49], [0.6, -0.5], [0.24, 0.5]]],
  '8': [[[0.3, -0.03], [0.09, -0.16], [0.07, -0.38], [0.3, -0.5], [0.52, -0.38], [0.5, -0.16], [0.3, -0.03], [0.06, 0.15], [0.06, 0.38], [0.3, 0.5], [0.55, 0.38], [0.54, 0.15], [0.3, -0.03]]],
  '9': [[[0.55, -0.16], [0.35, -0.02], [0.12, -0.06], [0.03, -0.28], [0.15, -0.47], [0.35, -0.5], [0.55, -0.38], [0.58, -0.1], [0.52, 0.25], [0.32, 0.5], [0.08, 0.45]]],
};
const ANGULAR = new Set(['1', '4', '7']);
const DIGITS = Object.fromEntries(Object.entries(DIGIT_STROKES).map(([d, lines]) =>
  [d, ANGULAR.has(d) ? lines : lines.map((l) => chaikin(l, 2))])) as Record<string, [number, number][][]>;

export const LABEL_SIZE = 1.2;   // cells (≈ 12 px): a digit's height
const LABEL_ADVANCE = 0.8;       // digit heights from one digit to the next
const LABEL_PAD = 0.6;           // cells of contour cut either side of a label
const LABEL_EVERY = 55;          // cells along an index contour between its labels
const LABEL_APART = 28;          // cells at least between any two labels
export const CONTOUR_METRES = 20;  // the interval between contours; every fifth is an index contour

/** A height label: centred at (x, y), its baseline along (tx, ty), reading
 *  left to right; `half` the half-length of contour it cuts. */
export interface Label { x: number; y: number; tx: number; ty: number; half: number; text: string }

/** Heights on the index contours, on straight stretches where `free` allows,
 *  in the manner of a survey map: the number set into a break in its line. */
export function heightLabels(lines: ChalkLine[], random: () => number, free: (x: number, y: number) => boolean, base: number): Label[] {
  const out: Label[] = [];
  for (const { index, pts } of lines) {
    if (index % 5 !== 4 || pts.length < 4) continue;
    const text = String(base + (index + 1) * CONTOUR_METRES);
    const half = ((text.length - 1) * LABEL_ADVANCE + 0.6) * LABEL_SIZE / 2 + LABEL_PAD;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum.at(-1)!;
    const indexAt = (s: number) => { let i = 0; while (i < cum.length - 1 && cum[i] < s) i++; return i; };
    for (let s = half + random() * LABEL_EVERY * 0.5; s < total - half;) {
      const i0 = indexAt(s - half), i1 = indexAt(s + half), im = indexAt(s);
      const [ax, ay] = pts[i0], [bx, by] = pts[i1], [x, y] = pts[im];
      const chord = Math.hypot(bx - ax, by - ay);
      let ok = chord > 0.9 * 2 * half && !out.some((l) => Math.hypot(l.x - x, l.y - y) < LABEL_APART);
      for (let i = i0; ok && i <= i1; i++) ok = free(pts[i][0], pts[i][1]);
      if (!ok) { s += 2; continue; }
      let tx = (bx - ax) / chord, ty = (by - ay) / chord;
      if (tx < 0) { tx = -tx; ty = -ty; }
      out.push({ x, y, tx, ty, half, text });
      s += LABEL_EVERY;
    }
  }
  return out;
}

/** A label's digits as strokes, each digit set a touch off the line, by hand. */
export function labelStrokes({ x, y, tx, ty, text }: Label, random: () => number): Seg[] {
  const k = LABEL_SIZE, out: Seg[] = [];
  const start = -((text.length - 1) * LABEL_ADVANCE + 0.6) * k / 2;
  [...text].forEach((ch, j) => {
    const dx = start + j * LABEL_ADVANCE * k, dy = (random() - 0.5) * 0.08 * k;
    const place = ([gx, gy]: [number, number]): [number, number] => {
      const lx = dx + gx * k, ly = dy + gy * k;
      return [x + tx * lx - ty * ly, y + ty * lx + tx * ly];
    };
    for (const line of DIGITS[ch] ?? []) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = place(line[i]), [bx, by] = place(line[i + 1]);
        out.push([ax, ay, bx, by]);
      }
    }
  });
  return out;
}

/** Whether a point falls in the break a label cuts into the map. */
export const underLabel = (labels: Label[], x: number, y: number) => labels.some((l) => {
  const dx = x - l.x, dy = y - l.y;
  return Math.abs(dx * l.tx + dy * l.ty) < l.half && Math.abs(dy * l.tx - dx * l.ty) < 0.8 * LABEL_SIZE;
});

const SPACING = 1.0;         // cells between hachures along a contour (≈ 10 px at 10 px a cell)
const WEDGE = 0.75;          // a hachure's length, as a share of the way to the next contour
const MAX_LEN = 1.5 * WEDGE; // cells (≈ 11 px)
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
        const l = Math.min(MAX_LEN, (0.85 * WEDGE * step) / slope);
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
const ROAD_ROOM = 0.45;      // a stretch may stray this share of its length off the straight line …
const ROAD_ROOM_MIN = 6;     // … and at least this many cells
const ROAD_CLIMB = 6;        // how dearly a step pays for its steepness
const ROAD_THIN = 3;         // keep every third cell of the way before smoothing it
/** The 8 neighbours and the 8 knight's moves: 16 headings, so a way across
 *  the grid need not zigzag in right angles and diagonals. */
const MOVES = [...NEIGHBOURS, [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

/** The gentlest way from a to b: a least-cost path over the grid's cells (16
 *  headings), each step costing its length × (1 + ROAD_CLIMB · (slope /
 *  SLOPE_REF)²), so the road takes the least slope it can, winding round
 *  hills and along the contours as an old road does, but only within the
 *  locality of a and b (their box, widened by ROAD_ROOM) and where `free`
 *  allows. Smoothed; null if there is no way. */
export function gentlest(h: Float32Array, cols: number, rows: number, a: { x: number; y: number }, b: { x: number; y: number },
  free: (x: number, y: number) => boolean): [number, number][] | null {
  const room = Math.max(ROAD_ROOM_MIN, ROAD_ROOM * Math.hypot(b.x - a.x, b.y - a.y));
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - room)), x1 = Math.min(cols - 1, Math.ceil(Math.max(a.x, b.x) + room));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - room)), y1 = Math.min(rows - 1, Math.ceil(Math.max(a.y, b.y) + room));
  const w = x1 - x0 + 1, n = w * (y1 - y0 + 1);
  const cell = (x: number, y: number) => (Math.min(y1, Math.max(y0, Math.floor(y))) - y0) * w + Math.min(x1, Math.max(x0, Math.floor(x))) - x0;
  const from = cell(a.x, a.y), to = cell(b.x, b.y);
  const open = new Uint8Array(n);
  for (let i = 0; i < n; i++) open[i] = free(x0 + (i % w) + 0.5, y0 + Math.floor(i / w) + 0.5) ? 1 : 0;
  open[from] = open[to] = 1;
  const height = (i: number) => h[(y0 + Math.floor(i / w)) * cols + x0 + (i % w)];
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  // a binary min-heap of [cost, cell]
  const heap: [number, number][] = [];
  const push = (d: number, c: number) => {
    heap.push([d, c]);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
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
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  dist[from] = 0;
  push(0, from);
  while (heap.length) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    if (c === to) break;
    const cx = c % w, cy = Math.floor(c / w);
    for (const [dx, dy] of MOVES) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= w || y > y1 - y0) continue;
      const m = y * w + x;
      if (!open[m]) continue;
      // a knight's move must not hop over closed ground
      if ((Math.abs(dx) === 2 || Math.abs(dy) === 2) && !open[(cy + Math.trunc(dy / 2)) * w + cx + Math.trunc(dx / 2)]) continue;
      const len = Math.hypot(dx, dy);
      const slope = Math.abs(height(m) - height(c)) / len / SLOPE_REF;
      const nd = d + len * (1 + ROAD_CLIMB * slope * slope);
      if (nd < dist[m]) { dist[m] = nd; prev[m] = c; push(nd, m); }
    }
  }
  if (prev[to] < 0 && to !== from) return null;
  const cells: [number, number][] = [];
  for (let c = to; c >= 0; c = prev[c]) cells.push([x0 + (c % w) + 0.5, y0 + Math.floor(c / w) + 0.5]);
  cells.reverse();
  const thin = cells.filter((_, i) => i % ROAD_THIN === 0 || i === cells.length - 1);
  thin[0] = [a.x, a.y];
  thin[thin.length - 1] = [b.x, b.y];
  return chaikin(thin, 4);
}
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
export function roads(places: { x: number; y: number; sign: Sign }[], random: () => number, free: (x: number, y: number) => boolean,
  reroute?: (a: { x: number; y: number }, b: { x: number; y: number }) => [number, number][] | null) {
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
    // the main road's stretches follow the relief where `reroute` finds a way
    const way = reroute?.(places[e.i], places[e.j]) ?? e.pts;
    const pts = e.i === c ? way : [...way].reverse();   // from c towards a
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
export const KIND_HACHURE = -1, KIND_CONTOUR = -2, KIND_INDEX = -3, KIND_SIGN = -4, KIND_ROAD = -5, KIND_LABEL = -6, KIND_DOT = 2;
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

  const lines = chalk(contourRings(h, cols, rows, LEVELS), random);
  const base = 100 * Math.floor(random() * 6);   // the lowest contour's height, a new valley floor each load
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
  // heights on the index contours, in the gutters, clear of the signs
  const clearOfSigns = (x: number, y: number) => placed.every((p) => Math.hypot(p.x - x, p.y - y) > 2.5 * SIGN_SIZE * SIGN_SCALE[p.sign]);
  const labels = heightLabels(lines, random, (x, y) => roomy(1)(x, y) && clearOfSigns(x, y), base);
  for (const l of labels) for (const [ax, ay, bx, by] of labelStrokes(l, random)) rows_.push(ax, ay, bx, by, 0, KIND_LABEL);
  const cut = (x: number, y: number) => underLabel(labels, x, y);
  const { main, byways } = roads(placed, random, (x, y) => gutter(x, y), (a, b) => gentlest(h, cols, rows, a, b, gutter));
  // roads stop short of the signs they join
  const atSign = (x: number, y: number) => placed.some((p) => Math.hypot(p.x - x, p.y - y) < 0.8 * SIGN_SIZE * SIGN_SCALE[p.sign]);
  for (const [ax, ay, bx, by] of byways) if (!atSign(ax, ay) && !atSign(bx, by) && !cut(ax, ay) && !cut(bx, by)) rows_.push(ax, ay, bx, by, 0, KIND_ROAD);
  const underSign = (x: number, y: number) => placed.some((p) => {
    const r = SIGN_CLEAR * SIGN_SIZE * SIGN_SCALE[p.sign];
    return Math.abs(p.x - x) < r && Math.abs(p.y - y) < r;
  });
  const rings = lines.map(({ level, index, pts }) => ({ level, index, ring: pts }));
  for (const s of hachures(h, cols, rows, random, hole, rings, LEVELS)) {
    if (underSign(s.x0, s.y0) || underSign(s.x1, s.y1) || cut(s.x0, s.y0) || cut(s.x1, s.y1)) continue;
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
  // contours: weight is the chalk's pressure, drawn as the stroke's width
  for (const { index, pts, press, skip } of lines) {
    const kind = index % 5 === 4 ? KIND_INDEX : KIND_CONTOUR;
    for (let i = 0; i < pts.length - 1; i++) {
      if (skip[i]) continue;
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if (nearFrame(cols, rows, ax, ay) && nearFrame(cols, rows, bx, by)) continue;
      if (inHole(hole, ax, ay) && inHole(hole, bx, by)) continue;
      if (underSign(ax, ay) || underSign(bx, by) || cut(ax, ay) || cut(bx, by)) continue;
      rows_.push(ax, ay, bx, by, (press[i] + press[i + 1]) / 2, kind);
    }
  }
  return { data: Float32Array.from(rows_), count: rows_.length / STRIDE, river, road: main };
}
