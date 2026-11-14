import { describe, it, expect } from 'vitest';
import { BOUNDS, PLANETS7, signIndex, dignity, boundLord, RULER, MINOR_YEARS } from './dignities';

describe('tables', () => {
  it('every sign\'s bounds end at 30°', () => {
    for (const sign of BOUNDS) expect(sign.at(-1)![1]).toBe(30);
  });
  it('bound degrees add up to the traditional planet totals', () => {
    const total = Object.fromEntries(PLANETS7.map((p) => [p, 0]));
    for (const sign of BOUNDS) {
      let from = 0;
      for (const [lord, to] of sign) { total[lord] += to - from; from = to; }
    }
    expect(total).toEqual({ Sun: 0, Moon: 0, Saturn: 57, Jupiter: 79, Mars: 66, Venus: 82, Mercury: 76 });
  });
  it('minor years', () => {
    expect(MINOR_YEARS).toEqual([15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12]);
    expect(RULER[9]).toBe('Saturn');
  });
});

describe('lookups', () => {
  it('signIndex wraps', () => {
    expect(signIndex(0)).toBe(0);
    expect(signIndex(359.99)).toBe(11);
    expect(signIndex(-1)).toBe(11);
    expect(signIndex(360)).toBe(0);
  });
  it('dignity', () => {
    expect(dignity('Sun', 130)).toBe('domicile');
    expect(dignity('Sun', 10)).toBe('exaltation');
    expect(dignity('Sun', 310)).toBe('detriment');
    expect(dignity('Sun', 190)).toBe('fall');
    expect(dignity('Sun', 70)).toBe('peregrine');
    expect(dignity('Mercury', 160)).toBe('domicile');   // Virgo: domicile wins over exaltation
    expect(dignity('Mercury', 340)).toBe('detriment');  // Pisces: detriment and fall, detriment named
  });
  it('bound lord at the edges', () => {
    expect(boundLord(0)).toBe('Jupiter');
    expect(boundLord(5.999)).toBe('Jupiter');
    expect(boundLord(6)).toBe('Venus');
    expect(boundLord(29.999)).toBe('Saturn');
    expect(boundLord(359.99)).toBe('Saturn');
    expect(boundLord(30 + 8)).toBe('Mercury');          // Taurus 8°: Venus ends, Mercury begins
  });
});
