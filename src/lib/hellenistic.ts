// The Hellenistic reading of a natal chart: whole-sign houses, sect,
// planetary condition, the lots, the annual profection and zodiacal
// releasing. Pure functions over longitudes; no DOM.

import {
  PLANETS7, RULER, MINOR_YEARS, signIndex, dignity, boundLord,
  type Planet7, type Dignity,
} from '../data/dignities';

export const norm360 = (x: number) => ((x % 360) + 360) % 360;

export interface ChartPoints { planets: Record<Planet7, number>; asc: number | null }

/** The seven planets and the ASC from computeChart's result. */
export function pointsFrom(data: { bodies: { name: string; longitude: number }[]; houses?: { ascendant: number } }): ChartPoints {
  const planets = {} as Record<Planet7, number>;
  for (const p of PLANETS7) {
    const b = data.bodies.find((x) => x.name === p.toLowerCase());
    if (!b) throw new Error(`The chart has no ${p}.`);
    planets[p] = b.longitude;
  }
  return { planets, asc: data.houses?.ascendant ?? null };
}

/** Whole-sign house, 1–12: the ASC's sign is the first house. */
export const wsHouse = (lon: number, asc: number) => ((signIndex(lon) - signIndex(asc) + 12) % 12) + 1;

/** A day chart has the Sun in the half of the ecliptic above the horizon, from the ASC through the MC to the DSC. */
export const isDayChart = (sun: number, asc: number) => norm360(sun - asc) >= 180;

export interface SectRoles { light: Planet7; benefic: Planet7; malefic: Planet7; contrary: Planet7 }

export const sectRoles = (day: boolean): SectRoles => day
  ? { light: 'Sun', benefic: 'Jupiter', malefic: 'Saturn', contrary: 'Mars' }
  : { light: 'Moon', benefic: 'Venus', malefic: 'Mars', contrary: 'Saturn' };

const DIURNAL = new Set<Planet7>(['Sun', 'Jupiter', 'Saturn']);

/** Whether a planet belongs to the chart's sect. Mercury is diurnal as a morning star, rising before the Sun. */
export function inSect(planet: Planet7, day: boolean, sun: number, mercury: number) {
  const diurnal = planet === 'Mercury' ? norm360(sun - mercury) < 180 : DIURNAL.has(planet);
  return diurnal === day;
}

export interface Condition {
  planet: Planet7; lon: number; house: number | null;
  dignity: Dignity; bound: Planet7; inSect: boolean | null;
}

export function condition(p: ChartPoints): Condition[] {
  const { planets, asc } = p;
  const day = asc === null ? null : isDayChart(planets.Sun, asc);
  return PLANETS7.map((planet) => ({
    planet,
    lon: planets[planet],
    house: asc === null ? null : wsHouse(planets[planet], asc),
    dignity: dignity(planet, planets[planet]),
    bound: boundLord(planets[planet]),
    inSect: day === null ? null : inSect(planet, day, planets.Sun, planets.Mercury),
  }));
}

export interface Lots { fortune: number; spirit: number }

/** Fortune is ASC + Moon − Sun by day; Spirit the reverse; both swap by night. */
export function lots(asc: number, sun: number, moon: number, day: boolean): Lots {
  const lunar = norm360(asc + moon - sun), solar = norm360(asc + sun - moon);
  return day ? { fortune: lunar, spirit: solar } : { fortune: solar, spirit: lunar };
}

export interface Profection { age: number; house: number; sign: number; lord: Planet7; next: string }

/** The annual profection on a date: one whole sign per year of life, from the ASC sign. */
export function profection(birth: string, today: string, ascSign: number): Profection {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const age = ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
  const sign = (ascSign + age) % 12;
  const next = new Date(Date.UTC(by + age + 1, bm - 1, bd)).toISOString().slice(0, 10);
  return { age, house: (age % 12) + 1, sign, lord: RULER[sign], next };
}
