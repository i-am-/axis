import { describe, it, expect } from 'vitest';
import { ACG_BODIES, MEANING } from '../data/acg-lines';
import { linesFor, splitAntimeridian, distanceKm, distanceToLine, linesNear, horizonLon, norm180, ANGLES } from './acg';

const rad = Math.PI / 180;
// altitude from the standard formula, independent of acg.ts's acos
const altitude = (ra: number, dec: number, gast: number, [lon, lat]: [number, number]) => {
  const H = (gast + lon - ra) * rad;
  return Math.asin(Math.sin(lat * rad) * Math.sin(dec * rad) + Math.cos(lat * rad) * Math.cos(dec * rad) * Math.cos(H)) / rad;
};
const hourSin = (ra: number, gast: number, lon: number) => Math.sin((gast + lon - ra) * rad);

describe('lines', () => {
  const [ra, dec, gast] = [100, 20, 50];
  const lines = linesFor('sun', ra, dec, gast);
  const by = (a: string) => lines.find((l) => l.angle === a)!;

  it('MC and IC are meridians at α − GAST and opposite', () => {
    expect(by('MC').paths.flat().every(([lon]) => lon === 50)).toBe(true);
    expect(by('IC').paths.flat().every(([lon]) => lon === -130)).toBe(true);
  });
  it('the planet is on the horizon along ASC and DSC, rising and setting', () => {
    for (const p of by('ASC').paths.flat()) {
      expect(Math.abs(altitude(ra, dec, gast, p))).toBeLessThan(1e-6);
      // east of the meridian: rising. At the circumpolar edge (±70° here)
      // H₀ is 0° or 180° and sin H is 0, hence the tolerance
      expect(hourSin(ra, gast, p[0])).toBeLessThanOrEqual(1e-9);
    }
    for (const p of by('DSC').paths.flat()) {
      expect(Math.abs(altitude(ra, dec, gast, p))).toBeLessThan(1e-6);
      expect(hourSin(ra, gast, p[0])).toBeGreaterThanOrEqual(-1e-9);
    }
    // away from the edge the sign is strict
    const mid = by('ASC').paths.flat().find(([, lat]) => lat === 40)!;
    expect(hourSin(ra, gast, mid[0])).toBeLessThan(-0.5);
  });
  it('ASC stops where the planet never sets (δ 20° ⇒ about 70° N)', () => {
    const lats = by('ASC').paths.flat().map(([, lat]) => lat);
    expect(Math.max(...lats)).toBeLessThanOrEqual(70.1);
    expect(Math.min(...lats)).toBeGreaterThanOrEqual(-80);
  });
  it('horizonLon at 40° N', () => {
    expect(horizonLon(ra, dec, gast, 40, 'ASC')).toBeCloseTo(-57.78, 1);
    expect(horizonLon(ra, dec, gast, 40, 'DSC')).toBeCloseTo(157.78, 1);
    expect(horizonLon(ra, dec, gast, 75, 'ASC')).toBeNull();
  });
});

describe('geometry', () => {
  it('norm180', () => {
    expect(norm180(190)).toBe(-170);
    expect(norm180(-190)).toBe(170);
    expect(norm180(180)).toBe(-180);
  });
  it('splits at the antimeridian', () => {
    expect(splitAntimeridian([[170, 0], [179, 1], [-179, 2], [-170, 3]]))
      .toEqual([[[170, 0], [179, 1]], [[-179, 2], [-170, 3]]]);
  });
  it('Dublin to London', () => {
    expect(distanceKm([-6.2603, 53.3498], [-0.1278, 51.5074])).toBeCloseTo(464, -1);
  });
  it('distance to a meridian line along the equator', () => {
    const mc = linesFor('sun', 0, 0, 0).find((l) => l.angle === 'MC')!;
    expect(Math.abs(distanceToLine([10, 0], mc) - 1111.95)).toBeLessThan(2);
  });
  it('linesNear sorts and filters by the orb', () => {
    const lines = linesFor('sun', 0, 0, 0);
    const near = linesNear([3, 0], lines);
    expect(near[0].line.angle).toBe('MC');
    expect(near.every((n) => n.km <= 700)).toBe(true);
  });
});

it('every planet and angle has a meaning', () => {
  for (const b of ACG_BODIES) for (const a of ANGLES) expect(MEANING[`${b.id}-${a}`], `${b.id}-${a}`).toBeTruthy();
  expect(Object.keys(MEANING)).toHaveLength(40);
});
