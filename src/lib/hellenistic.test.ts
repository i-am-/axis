import { describe, it, expect } from 'vitest';
import { wsHouse, isDayChart, sectRoles, inSect, lots, profection, condition, pointsFrom } from './hellenistic';

describe('houses and sect', () => {
  it('whole-sign house counts signs from the ASC sign', () => {
    expect(wsHouse(45, 350)).toBe(3);    // ASC Pisces, Taurus is the 3rd
    expect(wsHouse(355, 350)).toBe(1);
    expect(wsHouse(340, 0)).toBe(12);
  });
  it('day chart when the Sun is above the horizon', () => {
    expect(isDayChart(270, 0)).toBe(true);
    expect(isDayChart(90, 0)).toBe(false);
    expect(isDayChart(99.5, 100)).toBe(true);    // just risen, 12th house
    expect(isDayChart(100.5, 100)).toBe(false);  // about to rise, 1st house
  });
  it('sect roles', () => {
    expect(sectRoles(true)).toEqual({ light: 'Sun', benefic: 'Jupiter', malefic: 'Saturn', contrary: 'Mars' });
    expect(sectRoles(false)).toEqual({ light: 'Moon', benefic: 'Venus', malefic: 'Mars', contrary: 'Saturn' });
  });
  it('Mercury joins the day as a morning star', () => {
    expect(inSect('Mercury', true, 100, 90)).toBe(true);    // behind the Sun: rises first
    expect(inSect('Mercury', false, 100, 90)).toBe(false);
    expect(inSect('Mercury', false, 100, 110)).toBe(true);  // evening star
    expect(inSect('Saturn', true, 0, 0)).toBe(true);
    expect(inSect('Venus', true, 0, 0)).toBe(false);
  });
});

describe('lots', () => {
  it('day formulas', () => {
    expect(lots(0, 270, 30, true)).toEqual({ fortune: 120, spirit: 240 });
  });
  it('reversed by night', () => {
    expect(lots(0, 90, 30, false)).toEqual({ fortune: 60, spirit: 300 });
  });
});

describe('profection', () => {
  it('the day before the birthday', () => {
    expect(profection('1990-06-15', '2026-06-14', 0))
      .toEqual({ age: 35, house: 12, sign: 11, lord: 'Jupiter', next: '2026-06-15' });
  });
  it('on the birthday', () => {
    expect(profection('1990-06-15', '2026-06-15', 0))
      .toEqual({ age: 36, house: 1, sign: 0, lord: 'Mars', next: '2027-06-15' });
  });
  it('a 29 February birthday rolls to 1 March', () => {
    expect(profection('2000-02-29', '2026-01-10', 0).next).toBe('2026-03-01');
  });
});

describe('condition', () => {
  const data = {
    bodies: [
      ['sun', 270], ['moon', 30], ['mercury', 260], ['venus', 300], ['mars', 10],
      ['jupiter', 100], ['saturn', 200], ['uranus', 5],
    ].map(([name, longitude]) => ({ name: name as string, longitude: longitude as number })),
    houses: { ascendant: 0 },
  };
  it('reads the seven planets and the ASC', () => {
    const p = pointsFrom(data);
    expect(p.asc).toBe(0);
    expect(Object.keys(p.planets)).toHaveLength(7);
  });
  it('rows for a day chart', () => {
    const rows = condition(pointsFrom(data));
    const mars = rows.find((r) => r.planet === 'Mars')!;
    expect(mars).toEqual({ planet: 'Mars', lon: 10, house: 1, dignity: 'domicile', bound: 'Venus', inSect: false });
    expect(rows.find((r) => r.planet === 'Saturn')!.dignity).toBe('exaltation');
  });
  it('no time: no houses, no sect', () => {
    const rows = condition(pointsFrom({ bodies: data.bodies }));
    expect(rows.every((r) => r.house === null && r.inSect === null)).toBe(true);
  });
});
