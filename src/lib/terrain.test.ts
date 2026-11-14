import { describe, it, expect } from 'vitest';
import {
  rng, simplex2, heightmap, flood, accumulate, thalweg, contourRings, sampler,
  hachures, buildTerrain, STRIDE, type Hole,
} from './terrain';

const COLS = 90, ROWS = 60;
const HOLE: Hole = { x0: 30, y0: 20, x1: 60, y1: 40 };

describe('noise', () => {
  it('a seed gives the same numbers', () => {
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(8)()).not.toBe(rng(7)());
  });
  it('simplex stays within ±1', () => {
    const n = simplex2(rng(1));
    for (let i = 0; i < 2000; i++) {
      const v = n(i * 0.137, i * 0.071);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
  it('heightmap is normalised to 0…1', () => {
    const h = heightmap(COLS, ROWS, rng(3));
    expect(Math.min(...h)).toBeCloseTo(0, 6);
    expect(Math.max(...h)).toBeCloseTo(1, 6);
  });
});

describe('drainage', () => {
  const h = heightmap(COLS, ROWS, rng(11));
  const f = flood(h, COLS, ROWS, HOLE);

  it('every cell drains to the edge or the hole, never uphill', () => {
    for (let c = 0; c < COLS * ROWS; c++) {
      let steps = 0;
      for (let x = c; f.parent[x] >= 0; x = f.parent[x]) {
        expect(f.filled[x]).toBeGreaterThanOrEqual(f.filled[f.parent[x]]);
        expect(++steps).toBeLessThan(COLS * ROWS);
      }
    }
  });
  it('accumulation counts every draining cell once', () => {
    const acc = accumulate(f);
    let atOutlets = 0, draining = 0;
    for (let c = 0; c < COLS * ROWS; c++) {
      if (f.parent[c] < 0) continue;
      draining++;
      if (f.parent[f.parent[c]] < 0) atOutlets += acc[c];
    }
    expect(atOutlets).toBe(draining);
  });
  it('the main river is 8-connected and runs downhill from source to mouth', () => {
    const acc = accumulate(f);
    const cells = thalweg(f, acc);
    expect(cells.length).toBeGreaterThan(10);
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1], b = cells[i];
      expect(Math.max(Math.abs((a % COLS) - (b % COLS)), Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)))).toBe(1);
      expect(f.filled[a]).toBeGreaterThanOrEqual(f.filled[b]);
    }
    expect(f.parent[f.parent[cells.at(-1)!]]).toBe(-1);   // the mouth meets an outlet
  });
});

describe('drawing', () => {
  const h = heightmap(COLS, ROWS, rng(5));
  const at = sampler(h, COLS, ROWS);

  it('contour vertices lie on their level', () => {
    for (const { level, ring } of contourRings(h, COLS, ROWS, 12)) {
      for (const [x, y] of ring) {
        if (x < 1 || y < 1 || x > COLS - 1 || y > ROWS - 1) continue;   // the frame
        expect(Math.abs(at(x, y) - level)).toBeLessThan(1e-6);
      }
    }
  });
  it('hachures run downslope and avoid the hole', () => {
    const strokes = hachures(h, COLS, ROWS, rng(2), HOLE, contourRings(h, COLS, ROWS, 12), 12);
    expect(strokes.length).toBeGreaterThan(100);
    for (const s of strokes) {
      expect(at(s.x1, s.y1)).toBeLessThan(at(s.x0, s.y0));
      const inHole = s.x0 > HOLE.x0 && s.x0 < HOLE.x1 && s.y0 > HOLE.y0 && s.y0 < HOLE.y1;
      expect(inHole).toBe(false);
    }
  });
});

describe('buildTerrain', () => {
  it('packs strokes and tags the golden path from source (0) to mouth (1)', () => {
    const t = buildTerrain({ cols: COLS, rows: ROWS, hole: HOLE, seed: 42 });
    expect(t.data.length).toBe(t.count * STRIDE);
    const kinds = new Set<number>();
    let gold = 0, tMin = 1, tMax = 0;
    for (let i = 0; i < t.count; i++) {
      const k = t.data[i * STRIDE + 5];
      kinds.add(k < 0 ? k : 0);
      if (k >= 0) { gold++; tMin = Math.min(tMin, k); tMax = Math.max(tMax, k); }
    }
    expect(kinds).toEqual(new Set([0, -1, -2, -3]));
    expect(gold).toBeGreaterThan(5);
    expect(tMin).toBeLessThan(0.2);
    expect(tMax).toBeGreaterThan(0.8);
  });
  it('is deterministic for a seed', () => {
    const a = buildTerrain({ cols: COLS, rows: ROWS, hole: HOLE, seed: 9 });
    const b = buildTerrain({ cols: COLS, rows: ROWS, hole: HOLE, seed: 9 });
    expect(a.data).toEqual(b.data);
  });
});
