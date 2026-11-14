# Hellenistic reading and astrocartography — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hellenistic reading to `/natal-chart/` and a new astrocartography map at `/astrocartography/`, both computed in the browser.

**Architecture:** Pure calculation modules (`src/lib/hellenistic.ts`, `src/lib/acg.ts`, tables in `src/data/dignities.ts`) take plain data and return plain data, unit-tested with Vitest. `src/lib/ephemeris.ts` gains geocentric RA/Dec and sidereal time. Thin DOM modules and Astro pages render. The birth-data form is extracted into a shared component so both pages use it and hand birth data to each other through the query string.

**Tech Stack:** Astro 7, TypeScript, Swiss Ephemeris WASM (`@swisseph/browser`), d3-geo, d3-zoom, d3-selection, topojson-client, world-atlas, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-hellenistic-astrocartography-design.md`

## Global Constraints

- Everything runs in the browser and is prerendered; no outside service is called at runtime.
- Positions only from the Swiss Ephemeris files in `public/ephe/`; the Moshier fallback stays refused.
- English only. Colours only from the tokens in `src/styles/global.css` (`--void --plate --plate-lit --ocean --gold --gold-fill --rubric --ink --ink-soft --ink-faint --hair`), so light and dark both work.
- Meanings: 1–3 sentences, plain, coaching tone. The owner edits them in review.
- Zodiacal releasing: 360-day year (`ZR_YEAR_DAYS`), 30-day month. ACG orb 700 km (`ORB_KM`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on branch `feat/hellenistic-astrocartography`. Do not commit the owner's unrelated `deploy.sh` change.

## Deviations from the spec (decided while planning)

1. The world map is imported as `world-atlas/countries-110m.json?url`, so Vite hashes it into `/_astro/`, which `netlify.toml` already caches as immutable. No `public/geo/` copy and no new header.
2. The "Your lines" table gives each planet's ASC and DSC longitude **at the birth latitude** (the spec's "latitudes where the lines cross the map" was ambiguous).
3. Query-string parsing lives in its own pure module, `src/lib/birth-query.ts`, so it can be unit-tested.

Task 1 edits the spec to match.

## File map

| File | Status | Responsibility |
|---|---|---|
| `vitest.config.ts` | new | test runner config |
| `src/data/dignities.ts` | new | signs, rulers, exaltations, Egyptian bounds, minor years; `dignity()`, `boundLord()` |
| `src/lib/hellenistic.ts` | new | whole-sign houses, sect, condition, lots, profection, zodiacal releasing |
| `src/data/hellenistic.ts` | new | Hellenistic meanings |
| `src/lib/hellenistic-view.ts` | new | renders the Hellenistic section (DOM) |
| `src/lib/ephemeris.ts` | modify | shared moment/positions helpers; `computeEquatorial()` |
| `src/lib/acg.ts` | new | line geometry, distances |
| `src/data/acg-lines.ts` | new | 40 line meanings, planet colours |
| `src/lib/birth-query.ts` | new | `?d&t&n&lat&lon&tz` encode and decode |
| `src/lib/birth-form.ts` | new | place combobox (moved from the natal page), form wiring, `track()` |
| `src/components/BirthForm.astro` | new | form markup (moved from the natal page) |
| `src/pages/natal-chart.astro` | modify | uses BirthForm, WS column, Hellenistic section, map link |
| `src/pages/astrocartography.astro` | new | map page |
| `src/pages/resources.astro` | modify | map card |
| `src/styles/global.css` | modify | `hel-*`, `zr-*`, `acg-*` rules |

---

### Task 1: Test runner, dignity tables, spec touch-up

**Files:**
- Create: `vitest.config.ts`, `src/data/dignities.ts`, `src/data/dignities.test.ts`
- Modify: `package.json` (script `test`), `docs/superpowers/specs/2026-11-14-hellenistic-astrocartography-design.md`

**Interfaces:**
- Produces: `SIGNS: readonly string[12]`, `PLANETS7`, `type Planet7`, `signIndex(lon): number` (0 = Aries), `RULER: Planet7[12]`, `EXALTATION: Record<Planet7, number>`, `BOUNDS: [Planet7, number][][]`, `MINOR_YEARS: number[12]`, `type Dignity`, `dignity(planet, lon): Dignity`, `boundLord(lon): Planet7`.

- [ ] **Step 1: Install Vitest and add the script**

```bash
npm i -D vitest
npm pkg set scripts.test="vitest run"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 2: Write the failing test** — `src/data/dignities.test.ts`

```ts
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
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./dignities"`.

- [ ] **Step 4: Write `src/data/dignities.ts`**

```ts
// The traditional tables of Hellenistic astrology: sign rulers, exaltations
// and the Egyptian bounds (as Ptolemy, Tetrabiblos I.21, gives them), and
// each sign's minor years for zodiacal releasing (Valens, Anthology IV).

export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio',
  'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'] as const;

export const PLANETS7 = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'] as const;
export type Planet7 = typeof PLANETS7[number];

/** The sign a longitude falls in, 0 = Aries … 11 = Pisces. */
export const signIndex = (lon: number) => Math.floor((((lon % 360) + 360) % 360) / 30);

/** The domicile lord of each sign. */
export const RULER: Planet7[] = ['Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury',
  'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter'];

/** The sign each planet is exalted in. */
export const EXALTATION: Record<Planet7, number> = {
  Sun: 0, Moon: 1, Mercury: 5, Venus: 11, Mars: 9, Jupiter: 3, Saturn: 6,
};

/** Egyptian bounds: per sign, [lord, degree the bound ends at]. */
export const BOUNDS: [Planet7, number][][] = [
  [['Jupiter', 6], ['Venus', 12], ['Mercury', 20], ['Mars', 25], ['Saturn', 30]],
  [['Venus', 8], ['Mercury', 14], ['Jupiter', 22], ['Saturn', 27], ['Mars', 30]],
  [['Mercury', 6], ['Jupiter', 12], ['Venus', 17], ['Mars', 24], ['Saturn', 30]],
  [['Mars', 7], ['Venus', 13], ['Mercury', 19], ['Jupiter', 26], ['Saturn', 30]],
  [['Jupiter', 6], ['Venus', 11], ['Saturn', 18], ['Mercury', 24], ['Mars', 30]],
  [['Mercury', 7], ['Venus', 17], ['Jupiter', 21], ['Mars', 28], ['Saturn', 30]],
  [['Saturn', 6], ['Mercury', 14], ['Jupiter', 21], ['Venus', 28], ['Mars', 30]],
  [['Mars', 7], ['Venus', 11], ['Mercury', 19], ['Jupiter', 24], ['Saturn', 30]],
  [['Jupiter', 12], ['Venus', 17], ['Mercury', 21], ['Saturn', 26], ['Mars', 30]],
  [['Mercury', 7], ['Jupiter', 14], ['Venus', 22], ['Saturn', 26], ['Mars', 30]],
  [['Mercury', 7], ['Venus', 13], ['Jupiter', 20], ['Mars', 25], ['Saturn', 30]],
  [['Venus', 12], ['Jupiter', 16], ['Mercury', 19], ['Mars', 28], ['Saturn', 30]],
];

/** Minor years of each sign's lord, the period lengths of zodiacal releasing. */
export const MINOR_YEARS = [15, 8, 20, 25, 19, 20, 8, 15, 12, 27, 30, 12];

export type Dignity = 'domicile' | 'exaltation' | 'detriment' | 'fall' | 'peregrine';

/** The strongest dignity or debility a planet has at a longitude. */
export function dignity(planet: Planet7, lon: number): Dignity {
  const s = signIndex(lon), opposite = (s + 6) % 12;
  if (RULER[s] === planet) return 'domicile';
  if (EXALTATION[planet] === s) return 'exaltation';
  if (RULER[opposite] === planet) return 'detriment';
  if (EXALTATION[planet] === opposite) return 'fall';
  return 'peregrine';
}

/** The lord of the Egyptian bound a longitude falls in. */
export function boundLord(lon: number): Planet7 {
  const l = ((lon % 360) + 360) % 360;
  const within = l - signIndex(l) * 30;
  return BOUNDS[signIndex(l)].find(([, to]) => within < to)![0];
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, 6 tests.

- [ ] **Step 6: Update the spec for the three deviations**

In the spec's architecture table, replace the `public/geo/countries-110m.json` row with:

```
| `world-atlas/countries-110m.json` | dependency | imported with `?url`; Vite hashes it into `/_astro/`, already cached as immutable |
```

and delete the `netlify.toml` row. In "Accessibility", replace "the latitudes where its ASC and DSC lines cross the map" with "its ASC and DSC longitude at the birth latitude". In the architecture table, add the row `| src/lib/birth-query.ts | new, pure | encode and decode the hand-off query string |`.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/data/dignities.ts src/data/dignities.test.ts docs/superpowers/specs/2026-11-14-hellenistic-astrocartography-design.md
git commit -m "Hellenistic: dignity tables and Vitest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Whole-sign houses, sect, condition, lots, profection

**Files:**
- Create: `src/lib/hellenistic.ts`, `src/lib/hellenistic.test.ts`

**Interfaces:**
- Consumes: everything from `src/data/dignities.ts`.
- Produces:
  - `interface ChartPoints { planets: Record<Planet7, number>; asc: number | null }`
  - `pointsFrom(data: { bodies: { name: string; longitude: number }[]; houses?: { ascendant: number } }): ChartPoints` — reads lowercase body names (`sun`, `moon`, …) as `computeChart` returns them.
  - `norm360(x): number`, `wsHouse(lon, asc): number` (1–12), `isDayChart(sun, asc): boolean`
  - `interface SectRoles { light: Planet7; benefic: Planet7; malefic: Planet7; contrary: Planet7 }`, `sectRoles(day): SectRoles`
  - `inSect(planet, day, sun, mercury): boolean`
  - `interface Condition { planet: Planet7; lon: number; house: number | null; dignity: Dignity; bound: Planet7; inSect: boolean | null }`, `condition(p: ChartPoints): Condition[]`
  - `interface Lots { fortune: number; spirit: number }`, `lots(asc, sun, moon, day): Lots`
  - `interface Profection { age: number; house: number; sign: number; lord: Planet7; next: string }`, `profection(birth: string, today: string, ascSign: number): Profection` — dates as `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test** — `src/lib/hellenistic.test.ts`

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./hellenistic"`.

- [ ] **Step 3: Write `src/lib/hellenistic.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. Note `Date.UTC` with a year below 100 maps to 19xx; birth years start at 1000 on this site, so it never applies.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hellenistic.ts src/lib/hellenistic.test.ts
git commit -m "Hellenistic: whole-sign houses, sect, condition, lots, profection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Zodiacal releasing

**Files:**
- Modify: `src/lib/hellenistic.ts` (append), `src/lib/hellenistic.test.ts` (append)

**Interfaces:**
- Produces:
  - `ZR_YEAR_DAYS = 360`, `ZR_MONTH_DAYS = 30`
  - `type Peak = 'tenth' | 'angular' | null`, `peakOf(sign, fortuneSign): Peak`
  - `interface ZRPeriod { sign: number; start: number; end: number; peak: Peak; lb: boolean }` — `start`/`end` in UTC milliseconds.
  - `releaseL1(lotSign, birthUTC, fortuneSign, years = 90): ZRPeriod[]`
  - `releaseL2(l1: ZRPeriod, fortuneSign): ZRPeriod[]`

**Rule check before coding (spec requirement):** the loosing of the bond as used here: L2 starts in the L1 sign and moves through the signs in order; after twelve sub-periods, instead of returning to the L1 sign it jumps to the sign opposite the L1 sign and continues in order from there (Brennan, *Hellenistic Astrology*, 2017, ch. 18, the Capricorn example jumping to Cancer). Only L1 periods longer than 211 months (Cancer, Leo, Capricorn, Aquarius) reach it. If the source you can consult says otherwise, stop and report before changing the rule.

- [ ] **Step 1: Append the failing test** to `src/lib/hellenistic.test.ts`

```ts
import { releaseL1, releaseL2, peakOf } from './hellenistic';

const DAY = 86_400_000;

describe('zodiacal releasing', () => {
  const birth = Date.UTC(2000, 0, 1);
  const l1 = releaseL1(9, birth, 3);   // from Capricorn; Fortune in Cancer

  it('peaks are the signs angular to Fortune, the 10th strongest', () => {
    expect(peakOf(3, 3)).toBe('angular');
    expect(peakOf(0, 3)).toBe('tenth');
    expect(peakOf(4, 3)).toBe(null);
  });
  it('L1 runs in minor years of 360 days to age 90', () => {
    expect(l1.map((p) => p.sign)).toEqual([9, 10, 11, 0, 1]);
    expect((l1[0].end - birth) / DAY).toBe(27 * 360);
    expect((l1[1].end - l1[1].start) / DAY).toBe(30 * 360);
    expect(l1[0].peak).toBe('angular');
  });
  it('L2 in Capricorn looses the bond to Cancer after twelve signs', () => {
    const l2 = releaseL2(l1[0], 3);
    expect(l2.map((p) => p.sign)).toEqual([9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 5, 6, 7, 8, 9]);
    expect(l2.map((p) => (p.end - birth) / DAY)).toEqual(
      [810, 1710, 2070, 2520, 2760, 3360, 4110, 4680, 5280, 5520, 5970, 6330, 7080, 7650, 8250, 8490, 8940, 9300, 9720]);
    expect(l2.map((p) => p.lb)).toEqual(l2.map((_, i) => i === 12));
    expect(l2[3].peak).toBe('tenth');
    expect(l2.at(-1)!.end).toBe(l1[0].end);   // cut at the end of L1
  });
  it('a short L1 never looses the bond', () => {
    const libra = releaseL1(6, birth, 3)[0];
    expect(releaseL2(libra, 3).some((p) => p.lb)).toBe(false);
  });
});
```

Move the new `import` line to the top of the file next to the first one.

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `releaseL1 is not a function` (or a missing export).

- [ ] **Step 3: Append to `src/lib/hellenistic.ts`**

```ts
// ---- zodiacal releasing (Valens, Anthology IV; Brennan 2017, ch. 18)

const DAY = 86_400_000;
/** Valens' year of 360 days; L2 counts the same numbers in 30-day months. */
export const ZR_YEAR_DAYS = 360;
export const ZR_MONTH_DAYS = 30;

export type Peak = 'tenth' | 'angular' | null;

/** Peak periods fall in the signs angular to Fortune; the 10th from it is the strongest. */
export function peakOf(sign: number, fortuneSign: number): Peak {
  const d = (sign - fortuneSign + 12) % 12;
  return d === 9 ? 'tenth' : d % 3 === 0 ? 'angular' : null;
}

export interface ZRPeriod { sign: number; start: number; end: number; peak: Peak; lb: boolean }

/** Level 1 from a lot's sign, from birth until `years` of age (calendar years). */
export function releaseL1(lotSign: number, birthUTC: number, fortuneSign: number, years = 90): ZRPeriod[] {
  const until = birthUTC + years * 365.25 * DAY;
  const out: ZRPeriod[] = [];
  for (let s = lotSign, t = birthUTC; t < until; s = (s + 1) % 12) {
    const end = t + MINOR_YEARS[s] * ZR_YEAR_DAYS * DAY;
    out.push({ sign: s, start: t, end, peak: peakOf(s, fortuneSign), lb: false });
    t = end;
  }
  return out;
}

/** Level 2 inside one L1 period, with the loosing of the bond after twelve signs. */
export function releaseL2(l1: ZRPeriod, fortuneSign: number): ZRPeriod[] {
  const out: ZRPeriod[] = [];
  let s = l1.sign;
  for (let t = l1.start, n = 0; t < l1.end; n++) {
    const lb = n === 12;
    if (lb) s = (l1.sign + 6) % 12;
    const end = Math.min(t + MINOR_YEARS[s] * ZR_MONTH_DAYS * DAY, l1.end);
    out.push({ sign: s, start: t, end, peak: peakOf(s, fortuneSign), lb });
    t = end;
    s = (s + 1) % 12;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hellenistic.ts src/lib/hellenistic.test.ts
git commit -m "Hellenistic: zodiacal releasing, L1 and L2 with the loosing of the bond

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hellenistic meanings

**Files:**
- Create: `src/data/hellenistic.ts`

**Interfaces:**
- Produces: `INTRO`, `NO_TIME`, `SECT: { day: string; night: string }`, `ROLES: Record<keyof SectRoles, string>`, `DIGNITY: Record<Dignity, string>`, `LOTS: Record<'fortune' | 'spirit', string>`, `HOUSE: string[12]` (index 0 = 1st house), `LORD: Record<Planet7, string>`, `ZR: { intro: string; spirit: string; fortune: string; peak: string; tenth: string; lb: string }`.

- [ ] **Step 1: Write the file**

```ts
// Plain-language meanings for the Hellenistic reading on /natal-chart/.
// Short by design: one to three sentences each, for a visitor, not a scholar.

import type { Planet7, Dignity } from './dignities';

export const INTRO =
  'Hellenistic astrology is the form practised in the Greek-speaking Mediterranean two thousand years ago. ' +
  'It reads houses by whole signs, asks whether you were born by day or by night, and times life in chapters ' +
  'rather than single events.';

export const NO_TIME = 'Sect, lots, profections and releasing need your birth time.';

export const SECT = {
  day: 'You were born by day. The Sun leads your chart: you tend to grow by visible effort, aims and being seen to do things well.',
  night: 'You were born by night. The Moon leads your chart: you tend to grow by attunement, care and reading what the moment needs.',
};

export const ROLES = {
  light: 'The sect light: the planet that sets the chart’s tone and vitality.',
  benefic: 'The benefic of sect: the most reliable source of help and good fortune.',
  malefic: 'The malefic of sect: difficulty that is workable, even shaping.',
  contrary: 'The malefic out of sect: the harder edge; where you need the most care.',
};

export const DIGNITY: Record<Dignity, string> = {
  domicile: 'At home: acts freely, with its own resources.',
  exaltation: 'Honoured: acts with confidence and gets noticed.',
  detriment: 'Far from home: works hard with unfamiliar tools.',
  fall: 'Unseen: its efforts go under-recognised and need patience.',
  peregrine: 'A guest: depends on the planets it meets.',
};

export const LOTS = {
  fortune: 'The Lot of Fortune: your body, health and the circumstances that happen to you.',
  spirit: 'The Lot of Spirit: your mind, choices and the actions you take, career above all.',
};

/** The topic each house brings to the year it is profected to. */
export const HOUSE = [
  'A year about you: your body, appearance and the direction you set out in.',
  'A year about resources: income, savings and what you can rely on.',
  'A year about your near world: siblings, neighbours, writing, short trips and daily practices.',
  'A year about foundations: home, family, parents and where you put down roots.',
  'A year about joy: children, creativity, romance and what you make for pleasure.',
  'A year about work and health: routines, service, strain and repair.',
  'A year about others: partners, agreements and open rivals.',
  'A year about what is shared and what ends: debts, inheritances, fears and letting go.',
  'A year about horizons: travel, study, teaching and what you believe.',
  'A year about action and standing: career, reputation and what you are known for.',
  'A year about allies: friends, groups, patrons and hopes for the future.',
  'A year about the hidden: rest, solitude, behind-the-scenes work and what you have been avoiding.',
];

/** The lord of the year: the planet whose condition colours it. */
export const LORD: Record<Planet7, string> = {
  Sun: 'The Sun as lord of the year asks for visibility, leadership and a clear purpose.',
  Moon: 'The Moon as lord of the year brings change, sensitivity and attention to the body and home.',
  Mercury: 'Mercury as lord of the year favours learning, trade, paperwork and many conversations.',
  Venus: 'Venus as lord of the year brings relationships, pleasure, art and making peace.',
  Mars: 'Mars as lord of the year brings drive, conflict and decisive cuts; pace yourself.',
  Jupiter: 'Jupiter as lord of the year opens doors: growth, generosity and good counsel.',
  Saturn: 'Saturn as lord of the year asks for structure, patience and commitments that last.',
};

export const ZR = {
  intro: 'Zodiacal releasing divides your life into chapters, each ruled by a sign. It shows when the chapters turn and which of them peak.',
  spirit: 'Released from Spirit: the chapters of your career and the actions you choose.',
  fortune: 'Released from Fortune: the chapters of your body, health and circumstances.',
  peak: 'Peak period: a chapter angular to Fortune, when activity and visibility rise.',
  tenth: 'The strongest peak: the 10th sign from Fortune, often a career high point.',
  lb: 'Loosing of the bond: a sudden turn mid-chapter, often a change of direction that later makes sense.',
};
```

- [ ] **Step 2: Typecheck**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/hellenistic.ts
git commit -m "Hellenistic: first-draft meanings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Equatorial positions and sidereal time from the ephemeris

**Files:**
- Modify: `src/lib/ephemeris.ts` (the "the chart" section, from `export async function computeChart` to the end)

**Interfaces:**
- Produces: `interface EquatorialChart { utc: string; gast: number; bodies: { name: string; ra: number; dec: number }[] }` (`gast` in degrees), `computeEquatorial(datetime: string, tz: string, bodies: string[]): Promise<EquatorialChart>`. `computeChart` keeps its signature and output.

No unit test: the WASM engine runs only in the browser. Task 10 has a browser check of this function against a known sky.

- [ ] **Step 1: Replace everything from `// ---- the chart` to the end of the file**

```ts
// ---- the chart

const EQ_FLAGS = CalculationFlag.SwissEphemeris | CalculationFlag.Speed | CalculationFlag.Equatorial;

function bodyIds(bodies: string[]) {
  return bodies.map((b) => {
    const id = BODY_IDS[b];
    if (id === undefined) throw new Error(`Unknown body ${b}.`);
    return id;
  });
}

// the engine, the UTC instant and its Julian day, with the ephemeris block loaded
async function moment(datetime: string, tz: string) {
  const { utc, off } = toUTC(datetime, tz);
  const swe = await engine();
  const at = new Date(utc);
  const year = at.getUTCFullYear();
  if (!await loadBlock(swe, year)) throw new Error('No high-precision ephemeris file covers this date.');
  return { swe, at, off, year, jd: swe.dateToJulianDay(at) };
}

async function positions(swe: SwissEphemeris, jd: number, year: number, ids: number[], flags: number) {
  const calc = () => ids.map((id) => swe.calculatePosition(jd, id, flags));
  let found = calc();
  // the library drops to Moshier silently when a file is missing: a chart
  // at the edge of a block can need the neighbouring block's files too
  if (found.some((p) => (p.flags & SOURCE) !== CalculationFlag.SwissEphemeris)) {
    await Promise.all([loadBlock(swe, year - 600), loadBlock(swe, year + 600)]);
    found = calc();
    if (found.some((p) => (p.flags & SOURCE) !== CalculationFlag.SwissEphemeris)) {
      throw new Error('No high-precision ephemeris file covers this date.');
    }
  }
  return found;
}

export async function computeChart(r: ChartRequest): Promise<Positions> {
  const ids = bodyIds(r.bodies);
  const { swe, at, off, year, jd } = await moment(r.datetime, r.tz);
  swe.setTopocentric(r.lon, r.lat, r.alt ?? 0);
  const found = await positions(swe, jd, year, ids, FLAGS);

  const result: Positions = {
    input: { local: r.datetime, utc: at.toISOString(), utc_offset: offsetText(off) },
    bodies: found.map((p, i) => ({
      name: r.bodies[i], longitude: p.longitude, speed_longitude: p.longitudeSpeed, retrograde: p.longitudeSpeed < 0,
    })),
  };
  if (r.houses === 'placidus') {
    const h = swe.calculateHouses(jd, r.lat, r.lon, HouseSystem.Placidus);
    result.houses = { system: 'Placidus', cusps: h.cusps.slice(1, 13), ascendant: h.ascendant, mc: h.mc };
    // inside the polar circles Placidus is undefined and the library quietly
    // draws Porphyry houses instead; they then match Porphyry's own
    const p = swe.calculateHouses(jd, r.lat, r.lon, HouseSystem.Porphyrius);
    if (p.cusps.every((c, i) => c === h.cusps[i])) {
      result.houses.system = 'Porphyry';
      result.houses.note = 'Placidus is undefined at this latitude; Porphyry used instead';
    }
  }
  return result;
}

// ---- for astrocartography: geocentric right ascension and declination
// (lines are drawn for the Earth's centre, not one place on it) and
// Greenwich apparent sidereal time

export interface EquatorialChart { utc: string; gast: number; bodies: { name: string; ra: number; dec: number }[] }

export async function computeEquatorial(datetime: string, tz: string, bodies: string[]): Promise<EquatorialChart> {
  const ids = bodyIds(bodies);
  const { swe, at, year, jd } = await moment(datetime, tz);
  const found = await positions(swe, jd, year, ids, EQ_FLAGS);
  return {
    utc: at.toISOString(),
    gast: swe.siderealTime(jd) * 15,          // hours to degrees
    bodies: found.map((p, i) => ({ name: bodies[i], ra: p.longitude, dec: p.latitude })),
  };
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npx astro check && npm run build`
Expected: 0 errors; build completes.

- [ ] **Step 3: Check the natal chart still matches**

Before editing (Step 1), draw 1990-06-15 14:30 Dublin on the live site `https://igniting.coach/natal-chart/` and note every row of the positions table. After the edit, run `npm run dev`, draw the same chart at `http://localhost:4321/natal-chart/`, and compare: every row must be identical to the minute.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ephemeris.ts
git commit -m "Ephemeris: shared moment and positions helpers, equatorial positions and sidereal time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Astrocartography geometry

**Files:**
- Create: `src/lib/acg.ts`, `src/lib/acg.test.ts`

**Interfaces:**
- Produces:
  - `type Angle = 'MC' | 'IC' | 'ASC' | 'DSC'`, `ANGLES: Angle[]`
  - `type LonLat = [lon: number, lat: number]`
  - `interface Line { body: string; angle: Angle; paths: LonLat[][] }`
  - `ORB_KM = 700`, `LAT_MAX = 80`
  - `norm180(x): number`
  - `horizonLon(ra, dec, gast, lat, angle: 'ASC' | 'DSC'): number | null`
  - `linesFor(body, ra, dec, gast): Line[]` (4 lines)
  - `splitAntimeridian(points: LonLat[]): LonLat[][]`
  - `distanceKm(a: LonLat, b: LonLat): number`
  - `distanceToLine(p: LonLat, line: Line): number`
  - `interface Near { line: Line; km: number }`, `linesNear(p, lines, orb = ORB_KM): Near[]` (closest first)

- [ ] **Step 1: Write the failing test** — `src/lib/acg.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { linesFor, splitAntimeridian, distanceKm, distanceToLine, linesNear, horizonLon, norm180 } from './acg';

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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./acg"`.

- [ ] **Step 3: Write `src/lib/acg.ts`**

```ts
// Astrocartography: where on Earth each planet stood on an angle at the
// moment of birth. In-mundo lines (Jim Lewis's method) from geocentric
// right ascension α, declination δ and Greenwich apparent sidereal time.
//
//   MC  the meridian where the local sidereal time equals α: λ = α − GAST
//   IC  the opposite meridian
//   ASC / DSC  where the planet is on the horizon, rising or setting:
//       cos H₀ = −tan φ · tan δ,  λ = α − GAST ∓ H₀
//
// Longitudes east-positive, −180…180. Pure; no DOM.

export type Angle = 'MC' | 'IC' | 'ASC' | 'DSC';
export const ANGLES: Angle[] = ['MC', 'IC', 'ASC', 'DSC'];
export type LonLat = [lon: number, lat: number];
export interface Line { body: string; angle: Angle; paths: LonLat[][] }

export const ORB_KM = 700;
export const LAT_MAX = 80;
const LAT_STEP = 0.5;
const SAMPLE_DEG = 0.25;
const R_KM = 6371.0088;
const rad = Math.PI / 180;

export const norm180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

/** The longitude where a body rises (ASC) or sets (DSC) at a latitude; null where it never does. */
export function horizonLon(ra: number, dec: number, gast: number, lat: number, angle: 'ASC' | 'DSC'): number | null {
  const c = -Math.tan(lat * rad) * Math.tan(dec * rad);
  if (Math.abs(c) > 1) return null;
  const h0 = Math.acos(c) / rad;
  return norm180(ra - gast + (angle === 'ASC' ? -h0 : h0));
}

/** Break a path where it jumps across the antimeridian. */
export function splitAntimeridian(points: LonLat[]): LonLat[][] {
  const out: LonLat[][] = [];
  let cur: LonLat[] = [];
  for (const p of points) {
    if (cur.length && Math.abs(p[0] - cur[cur.length - 1][0]) > 180) { out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

function meridian(lon: number): LonLat[][] {
  const pts: LonLat[] = [];
  for (let lat = -LAT_MAX; lat <= LAT_MAX; lat += LAT_STEP) pts.push([lon, lat]);
  return [pts];
}

function horizon(ra: number, dec: number, gast: number, angle: 'ASC' | 'DSC'): LonLat[][] {
  const runs: LonLat[][] = [];
  let run: LonLat[] = [];
  for (let lat = -LAT_MAX; lat <= LAT_MAX; lat += LAT_STEP) {
    const lon = horizonLon(ra, dec, gast, lat, angle);
    if (lon === null) { if (run.length) runs.push(run); run = []; continue; }
    run.push([lon, lat]);
  }
  if (run.length) runs.push(run);
  return runs.flatMap(splitAntimeridian);
}

export function linesFor(body: string, ra: number, dec: number, gast: number): Line[] {
  const mc = norm180(ra - gast);
  return [
    { body, angle: 'MC', paths: meridian(mc) },
    { body, angle: 'IC', paths: meridian(norm180(mc + 180)) },
    { body, angle: 'ASC', paths: horizon(ra, dec, gast, 'ASC') },
    { body, angle: 'DSC', paths: horizon(ra, dec, gast, 'DSC') },
  ];
}

/** Great-circle distance (haversine). */
export function distanceKm([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) {
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance from a point to the nearest sample of a line, sampled every ≤ 0.25°. */
export function distanceToLine(p: LonLat, line: Line) {
  let best = Infinity;
  for (const path of line.paths) {
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[i + 1] ?? a;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / SAMPLE_DEG));
      for (let k = 0; k < n; k++) {
        const q: LonLat = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
        best = Math.min(best, distanceKm(p, q));
      }
    }
  }
  return best;
}

export interface Near { line: Line; km: number }

export function linesNear(p: LonLat, lines: Line[], orb = ORB_KM): Near[] {
  return lines
    .map((line) => ({ line, km: distanceToLine(p, line) }))
    .filter((n) => n.km <= orb)
    .sort((a, b) => a.km - b.km);
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acg.ts src/lib/acg.test.ts
git commit -m "Astrocartography: MC, IC, ASC and DSC lines and distances

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Line meanings and planet colours

**Files:**
- Create: `src/data/acg-lines.ts`

**Interfaces:**
- Produces: `ACG_BODIES: { id: string; label: string; glyph: string; color: string; outer: boolean }[]` (ids as `computeEquatorial` takes them; `color` a CSS `var(--…)`), `ANGLE_LABEL: Record<Angle, string>`, `MEANING: Record<string, string>` keyed `` `${id}-${angle}` ``, e.g. `venus-ASC`.

- [ ] **Step 1: Write the file**

```ts
// The planets drawn on the astrocartography map, and what each line means.
// Colours come from the site tokens, so the map follows light and dark.
// Several planets share a colour; each line is also labelled and its dash
// says the angle, so colour is never the only cue.

import type { Angle } from '../lib/acg';

export const ACG_BODIES = [
  { id: 'sun', label: 'Sun', glyph: '☉', color: 'var(--gold)', outer: false },
  { id: 'moon', label: 'Moon', glyph: '☽', color: 'var(--ink)', outer: false },
  { id: 'mercury', label: 'Mercury', glyph: '☿', color: 'var(--ocean)', outer: false },
  { id: 'venus', label: 'Venus', glyph: '♀', color: 'var(--rubric)', outer: false },
  { id: 'mars', label: 'Mars', glyph: '♂', color: 'var(--rubric)', outer: false },
  { id: 'jupiter', label: 'Jupiter', glyph: '♃', color: 'var(--gold)', outer: false },
  { id: 'saturn', label: 'Saturn', glyph: '♄', color: 'var(--ink-soft)', outer: false },
  { id: 'uranus', label: 'Uranus', glyph: '♅', color: 'var(--ocean)', outer: true },
  { id: 'neptune', label: 'Neptune', glyph: '♆', color: 'var(--ocean)', outer: true },
  { id: 'pluto', label: 'Pluto', glyph: '♇', color: 'var(--ink-faint)', outer: true },
];

export const ANGLE_LABEL: Record<Angle, string> = {
  MC: 'Midheaven', IC: 'Imum Coeli', ASC: 'Ascendant', DSC: 'Descendant',
};

export const MEANING: Record<string, string> = {
  'sun-MC': 'Recognition and leadership. A place to be seen for your work and step into authority.',
  'sun-IC': 'Roots and inner strength. Good for building a home and finding out who you are in private.',
  'sun-ASC': 'Confidence and vitality. You feel more yourself here and others notice you.',
  'sun-DSC': 'Prominent partners. Relationships and collaborations take centre stage, sometimes outshining you.',
  'moon-MC': 'Public warmth. Work in care, food, homes or the public, with a reputation that moves with feeling.',
  'moon-IC': 'Belonging. One of the strongest lines for feeling at home and close to family.',
  'moon-ASC': 'Sensitivity. Moods run nearer the surface; you feel open, intuitive and easily touched.',
  'moon-DSC': 'Nurturing ties. Partners who care for you, or who need caring for.',
  'mercury-MC': 'Voice and ideas. Good for writing, teaching, media and trading on what you know.',
  'mercury-IC': 'A busy mind at home. Study, home offices and family conversations.',
  'mercury-ASC': 'Curiosity. You come across as quick and talkative; learning comes easily.',
  'mercury-DSC': 'Meeting minds. Partnerships built on talk, contracts and shared projects.',
  'venus-MC': 'Charm at work. Success in art, beauty, diplomacy and anything that pleases people.',
  'venus-IC': 'A lovely home. Comfort, harmony in the family and a beautiful place to live.',
  'venus-ASC': 'Attractiveness. You feel at ease, look your best and are easy to like.',
  'venus-DSC': 'Love. One of the classic lines for romance and happy partnerships.',
  'mars-MC': 'Ambition and competition. Drive to achieve, with conflict along the way.',
  'mars-IC': 'Energy at home. Renovations and action, but also friction in the household.',
  'mars-ASC': 'Courage and heat. Physical energy and boldness, with a shorter temper.',
  'mars-DSC': 'Passionate partners and rivals. Strong attraction and open disputes.',
  'jupiter-MC': 'Opportunity. A place where career doors open and good fortune finds your work.',
  'jupiter-IC': 'A generous home. Space, family blessings and property that grows in value.',
  'jupiter-ASC': 'Optimism. You feel expansive, lucky and welcome; watch the waistline.',
  'jupiter-DSC': 'Helpful others. Benefactors, good partners and fair deals.',
  'saturn-MC': 'Hard-won standing. Slow, serious career progress that lasts.',
  'saturn-IC': 'Heavy foundations. Duty to family or home; good for building something lasting, rarely light.',
  'saturn-ASC': 'Discipline. You feel the weight of responsibility; good for focus, hard for ease.',
  'saturn-DSC': 'Committed ties. Older or serious partners and long contracts; loneliness is the risk.',
  'uranus-MC': 'Breakthroughs at work. Unusual careers, technology and sudden changes of direction.',
  'uranus-IC': 'Restless home. Frequent moves and unconventional households.',
  'uranus-ASC': 'Freedom. You feel unlike your usual self: original, unsettled and awake.',
  'uranus-DSC': 'Surprising partners. Exciting meetings and relationships that need space.',
  'neptune-MC': 'Inspiration and fog. Good for art, healing and spirit; careers can be unclear.',
  'neptune-IC': 'A dreamy home. Retreats by water and spiritual roots; keep the practical side in view.',
  'neptune-ASC': 'Openness. Imagination and empathy rise, and so does confusion about boundaries.',
  'neptune-DSC': 'Idealised partners. Soulful bonds, with a risk of seeing what you wish to see.',
  'pluto-MC': 'Power and transformation. Intense career change and dealings with power.',
  'pluto-IC': 'Deep roots. Family secrets and inner change; a place to rebuild from the ground up.',
  'pluto-ASC': 'Intensity. A place that changes you; you come across as magnetic and private.',
  'pluto-DSC': 'Transforming relationships. Deep, consuming partnerships and power struggles.',
};
```

- [ ] **Step 2: Add a coverage test** — append to `src/lib/acg.test.ts`

```ts
import { ACG_BODIES, MEANING } from '../data/acg-lines';
import { ANGLES } from './acg';

it('every planet and angle has a meaning', () => {
  for (const b of ACG_BODIES) for (const a of ANGLES) expect(MEANING[`${b.id}-${a}`], `${b.id}-${a}`).toBeTruthy();
  expect(Object.keys(MEANING)).toHaveLength(40);
});
```

Move the new imports to the top of the file.

- [ ] **Step 3: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/data/acg-lines.ts src/lib/acg.test.ts
git commit -m "Astrocartography: first-draft line meanings and planet colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Shared birth form and the hand-off query

**Files:**
- Create: `src/lib/birth-query.ts`, `src/lib/birth-query.test.ts`, `src/lib/birth-form.ts`, `src/components/BirthForm.astro`
- Modify: `src/pages/natal-chart.astro` (form markup lines 18–46; script: remove `FLAGS`, `flagURL`, `coords`, `placeName`, `initPlace` and the `declare global` block; replace `initNatal`)

**Interfaces:**
- Consumes: `searchPlaces`, `type Place` from `src/lib/places.ts`.
- Produces:
  - `birth-query.ts`: `interface Birth { date: string; time: string | null; place: Place }`, `birthQuery(b: Birth, label: string): string` (starts with `?`), `readBirthQuery(search: string): Birth | null`.
  - `birth-form.ts`: `placeName(p)`, `coords(p)`, `initPlace(input, list, onPick)`, `initBirthForm(form, onSubmit: (b: Birth) => Promise<void>): void`, `track(name: string, properties: Record<string, string>): void`.
  - `BirthForm.astro` props: `id: string`, `submitLabel: string`, `timeRequired?: boolean`. Element ids inside: `birth-date`, `birth-time`, `time-unknown` (absent when `timeRequired`), `birth-place`, `place-list`, `place-hint`, `birth-status`.

- [ ] **Step 1: Write the failing test** — `src/lib/birth-query.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { birthQuery, readBirthQuery } from './birth-query';

const place = {
  name: 'Dublin', region: 'Leinster', country: 'Ireland', country_code: 'IE',
  latitude: 53.34399, longitude: -6.26719, time_zone: 'Europe/Dublin', matched_name: 'Dublin',
};

describe('birth query', () => {
  it('round-trips date, time and place', () => {
    const q = birthQuery({ date: '1990-06-15', time: '14:30', place }, 'Dublin, Leinster, Ireland');
    expect(q).toBe('?d=1990-06-15&t=14%3A30&n=Dublin%2C+Leinster%2C+Ireland&lat=53.3440&lon=-6.2672&tz=Europe%2FDublin');
    const b = readBirthQuery(q)!;
    expect(b.date).toBe('1990-06-15');
    expect(b.time).toBe('14:30');
    expect(b.place).toMatchObject({ name: 'Dublin, Leinster, Ireland', latitude: 53.344, longitude: -6.2672, time_zone: 'Europe/Dublin' });
  });
  it('time may be absent', () => {
    expect(readBirthQuery('?d=1990-06-15&n=X&lat=1&lon=2&tz=UTC')!.time).toBeNull();
  });
  it('rejects broken input', () => {
    expect(readBirthQuery('')).toBeNull();
    expect(readBirthQuery('?d=1990-6-15&n=X&lat=1&lon=2&tz=UTC')).toBeNull();
    expect(readBirthQuery('?d=1990-06-15&t=25:00&n=X&lat=1&lon=2&tz=UTC')).toBeNull();
    expect(readBirthQuery('?d=1990-06-15&n=X&lat=91&lon=2&tz=UTC')).toBeNull();
    expect(readBirthQuery('?d=1990-06-15&lat=1&lon=2&tz=UTC')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL, `Failed to resolve import "./birth-query"`.

- [ ] **Step 3: Write `src/lib/birth-query.ts`**

```ts
// Birth data in a page's query string, so /natal-chart/ and
// /astrocartography/ can hand a chart to each other:
//   ?d=1990-06-15&t=14:30&n=Dublin, Leinster, Ireland&lat=53.3440&lon=-6.2672&tz=Europe/Dublin
// The place index has no stable ids, so the place travels as its label,
// coordinates and time zone. `t` is left out when the time is unknown.

import type { Place } from './places';

export interface Birth { date: string; time: string | null; place: Place }

export function birthQuery(b: Birth, label: string) {
  const q = new URLSearchParams({ d: b.date });
  if (b.time) q.set('t', b.time);
  q.set('n', label);
  q.set('lat', b.place.latitude.toFixed(4));
  q.set('lon', b.place.longitude.toFixed(4));
  q.set('tz', b.place.time_zone);
  return `?${q}`;
}

export function readBirthQuery(search: string): Birth | null {
  const q = new URLSearchParams(search);
  const d = q.get('d') ?? '', t = q.get('t'), n = q.get('n') ?? '', tz = q.get('tz') ?? '';
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!/^\d{4}-\d\d-\d\d$/.test(d)) return null;
  if (t !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  if (!n || !tz || !q.has('lat') || !q.has('lon')) return null;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  return {
    date: d, time: t,
    place: { name: n, country: '', country_code: '', latitude: lat, longitude: lon, time_zone: tz, matched_name: n },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Create `src/components/BirthForm.astro`**

Move the `<form …>…</form>` block (lines 18–46 of `natal-chart.astro`) here, with three changes: the `id` and button text come from props; the status line gets the id `birth-status`; the unknown-time box is replaced by a hint when the time is required.

```astro
---
// The birth-data form shared by /natal-chart/ and /astrocartography/.
// src/lib/birth-form.ts wires it up.
interface Props { id: string; submitLabel: string; timeRequired?: boolean }
const { id, submitLabel, timeRequired = false } = Astro.props;
---
<form class="natal-form" id={id} novalidate>
  <div class="natal-fields">
    <div>
      <label for="birth-date">Date of birth</label>
      <input type="date" id="birth-date" required min="1000-01-01" max="2999-12-31" />
    </div>
    <div>
      <label for="birth-time">Time of birth, local</label>
      <input type="time" id="birth-time" required step="60" value={timeRequired ? undefined : '12:00'} />
      {timeRequired ? (
        <p class="field-hint">Needed to the minute: four minutes either way moves every line by about 1° of longitude.</p>
      ) : (
        <label class="check-label">
          <input type="checkbox" id="time-unknown" /> I don’t know the time
        </label>
      )}
    </div>
    <div class="place-field">
      <label for="birth-place" id="birth-place-label">Place of birth</label>
      <input
        type="text" id="birth-place" required autocomplete="off" spellcheck="false"
        role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="place-list" aria-describedby="place-hint"
        placeholder="Start typing a town or city"
      />
      <ul id="place-list" role="listbox" aria-labelledby="birth-place-label" hidden></ul>
      <p id="place-hint" class="field-hint">Any language: Dublin, Baile Átha Cliath, Дублин.</p>
    </div>
  </div>
  <div class="natal-actions">
    <button class="btn btn-primary" type="submit">{submitLabel}</button>
    <p class="natal-status" id="birth-status" role="status" aria-live="polite"></p>
  </div>
</form>
```

- [ ] **Step 6: Create `src/lib/birth-form.ts`**

Move `FLAGS`, `flagURL`, `coords`, `placeName` and `initPlace` from the natal page's `<script>` verbatim, export them, and make one change in `initPlace`: option ids use the list's id, so two comboboxes can share a page. Then add `initBirthForm` and `track`.

```ts
// The birth-data form (components/BirthForm.astro): the place combobox,
// validation, and the hand-off query string. Shared by /natal-chart/ and
// /astrocartography/.

import { searchPlaces, type Place } from './places';
import { birthQuery, readBirthQuery, type Birth } from './birth-query';

// Liwan's tracker, when analytics are on (components/Liwan.astro)
declare global {
  interface Window {
    liwan?: { event?: (name: string, options?: { properties?: Record<string, string> }) => Promise<void> };
  }
}

/** One analytics event: place names and dates only, never coordinates. */
export function track(name: string, properties: Record<string, string>) {
  window.liwan?.event?.(name, { properties }).catch(() => {});
}

// ---- moved verbatim from natal-chart.astro: FLAGS, flagURL, coords, placeName
// (paste them here, each with `export` in front of coords and placeName)

// ---- moved from natal-chart.astro: initPlace, exported, with this change
// inside it — every `place-opt-${i}` becomes `${list.id}-opt-${i}`:
//   li.id = `${list.id}-opt-${i}`;
//   input.setAttribute('aria-activedescendant', `${list.id}-opt-${i}`);

export function initBirthForm(form: HTMLFormElement, onSubmit: (b: Birth) => Promise<void>) {
  const date = form.querySelector<HTMLInputElement>('#birth-date')!;
  const time = form.querySelector<HTMLInputElement>('#birth-time')!;
  const unknown = form.querySelector<HTMLInputElement>('#time-unknown');   // absent when the time is required
  const place = form.querySelector<HTMLInputElement>('#birth-place')!;
  const list = form.querySelector<HTMLUListElement>('#place-list')!;
  const status = form.querySelector<HTMLElement>('#birth-status')!;
  let chosen: Place | null = null;

  initPlace(place, list, (p) => { chosen = p; });

  // an unknown time is calculated for noon: the middle of the day keeps the
  // Moon, the fastest mover, within about 7° of where it really was
  const setUnknown = (on: boolean) => {
    if (!unknown) return;
    unknown.checked = on;
    time.disabled = on;
    if (on) time.value = '12:00';
  };
  unknown?.addEventListener('change', () => setUnknown(unknown.checked));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const noTime = unknown?.checked ?? false;
    if (!date.value) { status.textContent = 'Enter your date of birth.'; date.focus(); return; }
    if (!time.value && !noTime) {
      status.textContent = unknown ? 'Enter your time of birth, or tick that you don’t know it.' : 'Enter your time of birth.';
      time.focus();
      return;
    }
    if (!chosen) { status.textContent = 'Choose your place of birth from the list.'; place.focus(); return; }
    const birth: Birth = { date: date.value, time: noTime ? null : time.value, place: chosen };
    status.textContent = 'Calculating…';
    try {
      await onSubmit(birth);
    } catch (err) {
      status.textContent = (err as Error).message.replace(/^./, (c) => c.toUpperCase());
      return;
    }
    status.textContent = '';
    history.replaceState(null, '', birthQuery(birth, placeName(chosen)));
  });

  // a chart handed over in the query string draws at once
  const handed = readBirthQuery(location.search);
  if (handed) {
    date.value = handed.date;
    if (handed.time) { setUnknown(false); time.value = handed.time; } else setUnknown(true);
    place.value = placeName(handed.place);
    chosen = handed.place;
    if (handed.time || unknown) form.requestSubmit();
  }
}
```

Note for the implementer: the two comment blocks above are the only "paste" instructions in this plan; the code to paste is the existing code at `src/pages/natal-chart.astro` lines 111–230 (from `const FLAGS` to the end of `initPlace`). After pasting, the file must not contain those comments.

- [ ] **Step 7: Update `src/pages/natal-chart.astro`**

Frontmatter:

```astro
---
import Base from '../layouts/Base.astro';
import BirthForm from '../components/BirthForm.astro';
---
```

Replace the `<form …>…</form>` block with:

```astro
      <BirthForm id="natal-form" submitLabel="Draw my chart" />
```

In the `<script>`: delete the `declare global` block, `FLAGS`, `flagURL`, `coords`, `placeName` and `initPlace`. Change the imports to:

```ts
  import { Chart, AspectCalculator } from '@astrodraw/astrochart';
  import { initBirthForm, placeName, coords, track } from '../lib/birth-form';
  import type { Positions } from '../lib/ephemeris';
```

Replace `initNatal` with:

```ts
  function initNatal() {
    const form = document.getElementById('natal-form') as HTMLFormElement | null;
    if (!form) return;
    const result = document.getElementById('natal-result')!;
    const wheel = document.getElementById('natal-wheel')!;
    let last: Positions | null = null;

    initBirthForm(form, async (b) => {
      const { computeChart } = await import('../lib/ephemeris');
      last = await computeChart({
        datetime: `${b.date}T${b.time ?? '12:00'}`, tz: b.place.time_zone,
        lat: b.place.latitude, lon: b.place.longitude,
        bodies: BODIES.map(([api]) => api), houses: b.time ? 'placidus' : 'none',
      });
      const born = new Date(`${b.date}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      const h = last.houses;
      document.getElementById('natal-result-title')!.textContent = `Born ${born}, ${b.time ?? 'time unknown'}`;
      const utc = new Date(last.input.utc);
      const utcDate = utc.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
      const utcTime = utc.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' });
      document.getElementById('natal-result-utc')!.textContent =
        `In UTC: ${utcDate}, ${utcTime}. ` +
        (b.time ? `Local time was UTC${last.input.utc_offset}.`
                : `That is noon local time, which was UTC${last.input.utc_offset}.`);
      document.getElementById('natal-result-meta')!.textContent =
        `${placeName(b.place)} · ${coords(b.place)} · ` +
        (h ? `${h.system} houses${h.note ? ` (${h.note})` : ''}`
           : 'Drawn for noon. Houses and the Ascendant need a birth time, and the Moon may be up to 7° either way.');
      result.hidden = false;
      drawWheel(wheel, last);
      fillTable(document.getElementById('natal-rows')!, last);
      drawCards(last);
      track('natal-chart', { place: placeName(b.place), date: b.date });
      result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });

    // redraw for the new colours when the theme flips, and for a new size on resize
    let resize: ReturnType<typeof setTimeout> | undefined;
    const redraw = () => { if (last && !result.hidden) drawWheel(wheel, last); };
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
    new ResizeObserver(() => { clearTimeout(resize); resize = setTimeout(redraw, 150); }).observe(wheel);
  }
```

- [ ] **Step 8: Check and try it**

Run: `npx astro check && npm test && npm run build`
Expected: 0 errors, tests pass, build completes.

Run `npm run dev` and on `/natal-chart/`:
1. Draw 1990-06-15 14:30 Dublin. The chart draws; the URL becomes `?d=1990-06-15&t=14%3A30&n=…`.
2. Reload: the form fills and the chart draws by itself.
3. Tick "I don't know the time", draw: no houses, URL has no `t`.
4. The place list still opens with flags and works with the arrow keys.

- [ ] **Step 9: Commit**

```bash
git add src/lib/birth-query.ts src/lib/birth-query.test.ts src/lib/birth-form.ts src/components/BirthForm.astro src/pages/natal-chart.astro
git commit -m "Natal chart: shared birth form, birth data kept in the URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The Hellenistic section on the natal chart

**Files:**
- Create: `src/lib/hellenistic-view.ts`
- Modify: `src/pages/natal-chart.astro` (table head, `fillTable`, result markup, `initNatal`), `src/styles/global.css` (line 1200 and new rules after `.natal-credit a`)

**Interfaces:**
- Consumes: Task 2–4 exports; `Positions` from `ephemeris.ts`; `birthQuery`, `Birth` from `birth-query.ts`.
- Produces: `renderHellenistic(root: HTMLElement, data: Positions, birthDate: string, today?: Date): void`.

- [ ] **Step 1: Write `src/lib/hellenistic-view.ts`**

```ts
// Draws the Hellenistic reading under the natal chart from computeChart's
// result. The calculations are in hellenistic.ts; the words in
// data/hellenistic.ts.

import type { Positions } from './ephemeris';
import { SIGNS, signIndex, RULER } from '../data/dignities';
import {
  pointsFrom, isDayChart, sectRoles, condition, lots, profection, wsHouse,
  releaseL1, releaseL2, type ZRPeriod,
} from './hellenistic';
import * as M from '../data/hellenistic';

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const position = (lon: number) => {
  const d = lon % 30, deg = Math.floor(d), min = Math.floor((d - deg) * 60);
  return `${deg}°${String(min).padStart(2, '0')}′ ${SIGNS[signIndex(lon)]}`;
};
const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const dateText = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function block(title: string, ...children: Node[]) {
  const s = el('section', 'hel-block');
  s.append(el('h4', '', title), ...children);
  return s;
}

function table(head: string[], rows: string[][], caption: string) {
  const t = el('table', 'natal-table hel-table');
  t.append(el('caption', 'sr-only', caption));
  const thead = el('thead'), tr = el('tr');
  head.forEach((h) => { const th = el('th', '', h); th.scope = 'col'; tr.append(th); });
  thead.append(tr);
  const tbody = el('tbody');
  for (const r of rows) {
    const row = el('tr');
    r.forEach((c, i) => {
      if (i === 0) { const th = el('th', '', c); th.scope = 'row'; row.append(th); }
      else row.append(el('td', '', c));
    });
    tbody.append(row);
  }
  t.append(thead, tbody);
  return t;
}

function zrBlock(birthUTC: number, spiritSign: number, fortuneSign: number, now: number) {
  const wrap = el('div', 'zr');
  const intro = el('p', 'hel-note', M.ZR.intro);
  const toggle = el('div', 'zr-toggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Release from');
  const body = el('div');
  const draw = (from: 'spirit' | 'fortune') => {
    toggle.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.from === from)));
    const l1 = releaseL1(from === 'spirit' ? spiritSign : fortuneSign, birthUTC, fortuneSign);
    const span = 90 * YEAR;
    const band = el('div', 'zr-band');
    band.setAttribute('aria-hidden', 'true');
    for (const p of l1) {
      const seg = el('div', `zr-seg${p.peak ? ` zr-${p.peak}` : ''}`, SIGNS[p.sign].slice(0, 3));
      seg.style.flexGrow = String((Math.min(p.end, birthUTC + span) - p.start) / span);
      seg.title = `${SIGNS[p.sign]}: age ${Math.round((p.start - birthUTC) / YEAR)}–${Math.round((p.end - birthUTC) / YEAR)}`;
      band.append(seg);
    }
    const marker = el('div', 'zr-now');
    marker.style.left = `${Math.min(100, ((now - birthUTC) / span) * 100)}%`;
    band.append(marker);

    const current = l1.find((p) => p.start <= now && now < p.end);
    const parts: Node[] = [el('p', 'hel-note', M.ZR[from]), band];
    if (current) {
      parts.push(el('p', '', `Now: ${SIGNS[current.sign]}, ${dateText(current.start)} to ${dateText(current.end)}.` +
        (current.peak === 'tenth' ? ` ${M.ZR.tenth}` : current.peak ? ` ${M.ZR.peak}` : '')));
      const details = el('details', 'zr-l2');
      details.append(el('summary', '', `Sub-periods of ${SIGNS[current.sign]}`));
      const row = (p: ZRPeriod) => [
        SIGNS[p.sign], `${dateText(p.start)} – ${dateText(p.end)}`,
        [p.peak === 'tenth' ? 'strongest peak' : p.peak ? 'peak' : '', p.lb ? 'loosing of the bond' : '',
          p.start <= now && now < p.end ? 'now' : ''].filter(Boolean).join(', '),
      ];
      details.append(table(['Sign', 'Dates', ''], releaseL2(current, fortuneSign).map(row), 'Level 2 periods'));
      if (releaseL2(current, fortuneSign).some((p) => p.lb)) details.append(el('p', 'hel-note', M.ZR.lb));
      parts.push(details);
    }
    body.replaceChildren(...parts);
  };
  for (const [from, label] of [['spirit', 'Spirit'], ['fortune', 'Fortune']] as const) {
    const b = el('button', 'zr-chip', label);
    b.type = 'button';
    b.dataset.from = from;
    b.addEventListener('click', () => draw(from));
    toggle.append(b);
  }
  wrap.append(intro, toggle, body);
  draw('spirit');
  return wrap;
}

export function renderHellenistic(root: HTMLElement, data: Positions, birthDate: string, today = new Date()) {
  const pts = pointsFrom(data);
  const blocks: Node[] = [el('p', 'natal-spread-intro', M.INTRO)];
  const cond = condition(pts);
  const asc = pts.asc;
  const day = asc === null ? null : isDayChart(pts.planets.Sun, asc);

  if (asc !== null && day !== null) {
    const roles = sectRoles(day);
    const dl = el('dl', 'hel-roles');
    for (const k of ['light', 'benefic', 'malefic', 'contrary'] as const) {
      dl.append(el('dt', '', roles[k]), el('dd', '', M.ROLES[k]));
    }
    blocks.push(block('Sect', el('p', '', day ? M.SECT.day : M.SECT.night), dl));
  }

  const yes = (b: boolean | null) => (b === null ? '—' : b ? 'in sect' : 'out of sect');
  blocks.push(block('Planetary condition',
    table(['Planet', 'Position', 'WS house', 'Dignity', 'Bound', 'Sect'],
      cond.map((c) => [c.planet, position(c.lon), c.house ? String(c.house) : '—', c.dignity, c.bound, yes(c.inSect)]),
      'Condition of the seven planets'),
    el('ul', 'hel-dignities', ''),
  ));
  const ul = (blocks.at(-1) as HTMLElement).querySelector('.hel-dignities')!;
  for (const d of new Set(cond.map((c) => c.dignity))) {
    const li = el('li');
    li.append(el('strong', '', `${d[0].toUpperCase()}${d.slice(1)}: `), M.DIGNITY[d]);
    ul.append(li);
  }

  if (asc === null || day === null) {
    blocks.push(el('p', 'hel-note', M.NO_TIME));
    root.replaceChildren(...blocks);
    return;
  }

  const l = lots(asc, pts.planets.Sun, pts.planets.Moon, day);
  blocks.push(block('Lots',
    table(['Lot', 'Position', 'WS house', 'Lord'], [
      ['Fortune', position(l.fortune), String(wsHouse(l.fortune, asc)), RULER[signIndex(l.fortune)]],
      ['Spirit', position(l.spirit), String(wsHouse(l.spirit, asc)), RULER[signIndex(l.spirit)]],
    ], 'The lots of Fortune and Spirit'),
    el('p', 'hel-note', M.LOTS.fortune),
    el('p', 'hel-note', M.LOTS.spirit),
  ));

  const pr = profection(birthDate, localISO(today), signIndex(asc));
  const lordAt = cond.find((c) => c.planet === pr.lord)!;
  blocks.push(block('This year’s profection',
    el('p', '', `Age ${pr.age}: a ${ordinal(pr.house)}-house year in ${SIGNS[pr.sign]}. ` +
      `Lord of the year: ${pr.lord}, natally in ${SIGNS[signIndex(lordAt.lon)]}, ${ordinal(lordAt.house!)} house, ${lordAt.dignity}.`),
    el('p', 'hel-note', M.HOUSE[pr.house - 1]),
    el('p', 'hel-note', M.LORD[pr.lord]),
    el('p', 'hel-note', `The next profection year starts on ${dateText(Date.parse(`${pr.next}T00:00:00Z`))}.`),
  ));

  blocks.push(block('Zodiacal releasing',
    zrBlock(Date.parse(data.input.utc), signIndex(l.spirit), signIndex(l.fortune), today.getTime())));

  root.replaceChildren(...blocks);
}
```

- [ ] **Step 2: Markup on `natal-chart.astro`**

In the positions table head, after the House column:

```astro
            <thead><tr><th scope="col">Body</th><th scope="col">Position</th><th scope="col">House</th><th scope="col"><abbr title="whole-sign">WS</abbr></th></tr></thead>
```

After the closing `</section>` of `natal-spread` (still inside `natal-result`), add:

```astro
        <section class="natal-hellenistic" aria-labelledby="natal-hellenistic-title">
          <h3 id="natal-hellenistic-title">Hellenistic reading</h3>
          <div id="natal-hellenistic"></div>
        </section>

        <p class="natal-next">
          <a id="natal-map-link" href="/astrocartography/" hidden>See your lines on the map</a>
          <a class="btn btn-primary" href="/#ask" data-track="click/start-conversation-natal">Start a conversation</a>
        </p>
```

- [ ] **Step 3: WS column in `fillTable`**

Change `row` to take the whole-sign house, and the calls to pass it:

```ts
    const row = (label: string, position: string, house: string, ws: string, retro = false) => {
      // …unchanged up to `h.textContent = house;`, then:
      const w = document.createElement('td');
      w.textContent = ws;
      tr.append(th, pos, h, w);
      return tr;
    };
    const h = data.houses;
    const ws = (lon: number) => (h ? String(wsHouse(lon, h.ascendant)) : '');
    const rows = data.bodies.map((b) => {
      const label = BODIES.find(([api]) => api === b.name)?.[2] ?? b.name;
      return row(label, zodiacal(b.longitude), h ? String(houseOf(b.longitude, h.cusps)) : '', ws(b.longitude), b.retrograde);
    });
    if (h) rows.push(row('Ascendant', zodiacal(h.ascendant), '1', '1'), row('Midheaven', zodiacal(h.mc), '10', ws(h.mc)));
```

Add to the script's imports: `import { wsHouse } from '../lib/hellenistic';` and `import { birthQuery } from '../lib/birth-query';`.

- [ ] **Step 4: Call the renderer and set the map link** — in `initNatal`'s submit callback, after `drawCards(last);`:

```ts
      const { renderHellenistic } = await import('../lib/hellenistic-view');
      renderHellenistic(document.getElementById('natal-hellenistic')!, last, b.date);
      const map = document.getElementById('natal-map-link') as HTMLAnchorElement;
      map.hidden = !b.time;
      map.href = `/astrocartography/${birthQuery(b, placeName(b.place))}`;
```

- [ ] **Step 5: Styles** — in `src/styles/global.css`, change line 1200 so the unknown-time table hides both house columns:

```css
.natal-table.no-houses td:nth-child(n+3), .natal-table.no-houses thead th:nth-child(n+3) { display: none; }
```

and add after `.natal-credit a { … }`:

```css
/* Hellenistic reading under the natal chart */
.natal-hellenistic { margin-top: clamp(2.4rem, 6vw, 3.6rem); }
.hel-block { margin-top: 2rem; max-width: 46rem; font-family: var(--ui); }
.hel-block h4 { font-family: var(--serif); font-weight: 400; font-size: 1.2rem; margin: 0 0 .6rem; }
.hel-note { font-size: .92rem; color: var(--ink-soft); margin: .5rem 0 0; }
.hel-roles { display: grid; grid-template-columns: max-content 1fr; gap: .3rem 1rem; margin: .8rem 0 0; font-size: .92rem; }
.hel-roles dt { color: var(--gold); }
.hel-roles dd { margin: 0; color: var(--ink-soft); }
.hel-dignities { margin: .8rem 0 0; padding-left: 1.1rem; font-size: .88rem; color: var(--ink-soft); }
.hel-table { margin-top: .4rem; }
.zr-toggle { display: flex; gap: .5rem; margin: .8rem 0; }
.zr-chip { font: inherit; font-size: .85rem; padding: .3rem .8rem; border: 1px solid var(--hair); border-radius: 999px; background: transparent; color: var(--ink-soft); cursor: pointer; }
.zr-chip[aria-pressed="true"] { border-color: var(--gold); color: var(--ink); }
.zr-band { position: relative; display: flex; height: 2.2rem; margin: .8rem 0; border: 1px solid var(--hair); border-radius: 4px; overflow: hidden; }
.zr-seg { flex-basis: 0; min-width: 0; display: grid; place-items: center; font-size: .72rem; color: var(--ink-faint); border-right: 1px solid var(--hair); overflow: hidden; }
.zr-angular { background: color-mix(in srgb, var(--gold) 14%, transparent); color: var(--ink-soft); }
.zr-tenth { background: color-mix(in srgb, var(--gold) 30%, transparent); color: var(--ink); }
.zr-now { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--rubric); }
.zr-l2 { margin-top: .8rem; font-size: .9rem; }
.zr-l2 summary { cursor: pointer; color: var(--gold); }
.natal-next { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.6rem; margin-top: 2.4rem; font-family: var(--ui); }
```

- [ ] **Step 6: Check and try it**

Run: `npx astro check && npm test && npm run build`
Expected: 0 errors, tests pass, build completes.

On `/natal-chart/` with `npm run dev`:
1. 1990-06-15 14:30 Dublin: a day chart. Sect, condition, lots, profection and releasing all show; the WS column fills; "See your lines on the map" shows.
2. Same with 02:30: "You were born by night", Venus as the benefic of sect.
3. Time unknown: only the condition table and the note; WS and House columns hidden; no map link.
4. Toggle Spirit and Fortune: the band redraws. Open the sub-periods.
5. Light and dark mode, and at 375 px wide: no horizontal page scroll (the band shrinks; long tables may scroll inside their own block — wrap `.hel-table` in `overflow-x: auto` if they push the page).

- [ ] **Step 7: Commit**

```bash
git add src/lib/hellenistic-view.ts src/pages/natal-chart.astro src/styles/global.css
git commit -m "Natal chart: Hellenistic reading and whole-sign houses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The astrocartography page

**Files:**
- Create: `src/pages/astrocartography.astro`
- Modify: `src/pages/resources.astro` (`items`), `src/styles/global.css` (append `acg-*`), `package.json`

**Interfaces:**
- Consumes: `computeEquatorial`; `linesFor`, `linesNear`, `horizonLon`, `ANGLES`, `type Line`, `type Angle`, `type LonLat`; `ACG_BODIES`, `ANGLE_LABEL`, `MEANING`; `initBirthForm`, `initPlace`, `placeName`, `coords`, `track`; `birthQuery`.

- [ ] **Step 1: Dependencies**

```bash
npm i d3-geo d3-zoom d3-selection topojson-client world-atlas
npm i -D @types/d3-geo @types/d3-zoom @types/d3-selection @types/topojson-client @types/geojson
```

- [ ] **Step 2: Write `src/pages/astrocartography.astro`**

```astro
---
import Base from '../layouts/Base.astro';
import BirthForm from '../components/BirthForm.astro';
---
<Base
  title="Astrocartography"
  description="Where on Earth each planet stood on the horizon or the meridian when you were born: your astrocartography lines, calculated in your browser with the Swiss Ephemeris."
>
  <div class="page natal acg">
    <div class="container">
      <header class="page-header">
        <h1>Astrocartography</h1>
        <p>
          At the moment you were born, every planet was rising somewhere on Earth, setting somewhere
          else, and overhead along one meridian. These are your lines. Places near them are said to
          bring out that planet in your life.
        </p>
      </header>

      <BirthForm id="acg-form" submitLabel="Draw my lines" timeRequired />

      <section class="natal-result" id="acg-result" hidden aria-labelledby="acg-title">
        <h2 id="acg-title" class="natal-result-title"></h2>
        <p class="natal-result-meta" id="acg-meta"></p>

        <div class="acg-chips" id="acg-planets" role="group" aria-label="Planets shown"></div>
        <div class="acg-chips" id="acg-angles" role="group" aria-label="Lines shown"></div>
        <div class="acg-map" id="acg-map" aria-hidden="true"></div>
        <p class="acg-legend" aria-hidden="true">
          <span class="acg-key acg-MC"></span> Midheaven
          <span class="acg-key acg-IC"></span> Imum Coeli
          <span class="acg-key acg-ASC"></span> Ascendant
          <span class="acg-key acg-DSC"></span> Descendant
          · Drag to move, scroll or pinch to zoom, click a place to read it.
        </p>

        <section class="acg-city" aria-labelledby="acg-city-label">
          <div class="place-field">
            <label for="acg-city" id="acg-city-label">Look up a place</label>
            <input
              type="text" id="acg-city" autocomplete="off" spellcheck="false"
              role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="acg-city-list"
              placeholder="A town or city you are thinking of"
            />
            <ul id="acg-city-list" role="listbox" aria-labelledby="acg-city-label" hidden></ul>
          </div>
          <div id="acg-near" class="acg-near" aria-live="polite"></div>
        </section>

        <table class="natal-table acg-table">
          <caption>Your lines</caption>
          <thead><tr>
            <th scope="col">Planet</th><th scope="col">MC</th><th scope="col">IC</th>
            <th scope="col">ASC at your birth latitude</th><th scope="col">DSC at your birth latitude</th>
          </tr></thead>
          <tbody id="acg-rows"></tbody>
        </table>

        <p class="natal-next">
          <a id="acg-back" href="/natal-chart/">Back to your chart</a>
          <a class="btn btn-primary" href="/#ask" data-track="click/start-conversation-acg">Start a conversation</a>
        </p>
      </section>

      <p class="natal-credit">
        Map data: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain), via
        world-atlas. Place names © <a href="https://www.geonames.org/">GeoNames</a>, CC BY 4.0. Positions from
        the Swiss Ephemeris, calculated in your browser with{' '}
        <a href="https://github.com/swisseph-js/swisseph">swisseph-js</a>, open source under the AGPL.
      </p>
    </div>
  </div>
</Base>

<script>
  import { geoMercator, geoPath, geoGraticule10 } from 'd3-geo';
  import { zoom, type D3ZoomEvent } from 'd3-zoom';
  import { select, pointer } from 'd3-selection';
  import { feature } from 'topojson-client';
  import type { Topology, GeometryCollection } from 'topojson-specification';
  import worldURL from 'world-atlas/countries-110m.json?url';
  import { linesFor, linesNear, horizonLon, ANGLES, type Line, type Angle, type LonLat } from '../lib/acg';
  import { ACG_BODIES, ANGLE_LABEL, MEANING } from '../data/acg-lines';
  import { initBirthForm, initPlace, placeName, coords, track } from '../lib/birth-form';
  import { birthQuery } from '../lib/birth-query';

  const W = 960, H = 620;
  const SVG = 'http://www.w3.org/2000/svg';
  const projection = geoMercator().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]).clipExtent([[0, 0], [W, H]]);
  const path = geoPath(projection);

  const hiddenBodies = new Set<string>();
  const hiddenAngles = new Set<Angle>();
  let lines: Line[] = [];

  const lonText = (lon: number) => `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;

  function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  let world: Promise<string> | undefined;
  function countries() {
    world ??= fetch(worldURL).then((r) => r.json()).then((topo: Topology) =>
      path(feature(topo, topo.objects.countries as GeometryCollection)) ?? '');
    return world;
  }

  function applyVisibility(root: Element) {
    root.querySelectorAll<SVGElement>('[data-body]').forEach((e) => {
      const off = hiddenBodies.has(e.dataset.body!) || hiddenAngles.has(e.dataset.angle as Angle);
      e.style.display = off ? 'none' : '';
    });
  }

  function chips(host: HTMLElement, items: { id: string; label: string }[], hidden: Set<string>, onChange: () => void) {
    host.replaceChildren(...items.map(({ id, label }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zr-chip';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(!hidden.has(id)));
      b.addEventListener('click', () => {
        if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
        b.setAttribute('aria-pressed', String(!hidden.has(id)));
        onChange();
      });
      return b;
    }));
  }

  async function drawMap(host: HTMLElement, birthAt: LonLat, onPoint: (p: LonLat) => void) {
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'acg-svg' });
    const g = svgEl('g', {});
    g.append(
      svgEl('path', { d: path(geoGraticule10()) ?? '', class: 'acg-graticule' }),
      svgEl('path', { d: await countries(), class: 'acg-land' }),
    );
    for (const line of lines) {
      const body = ACG_BODIES.find((b) => b.id === line.body)!;
      const d = path({ type: 'MultiLineString', coordinates: line.paths }) ?? '';
      const p = svgEl('path', { d, class: `acg-line acg-${line.angle}${body.outer ? ' acg-outer' : ''}` });
      p.style.stroke = body.color;
      p.dataset.body = line.body;
      p.dataset.angle = line.angle;
      g.append(p);
      // label at the northern end of the line, inside the map
      const end = line.paths.flat().reduce((a, b) => (b[1] > a[1] ? b : a));
      const xy = projection([end[0], Math.min(end[1], 72)]);
      if (xy) {
        const t = svgEl('text', { x: String(xy[0]), y: String(xy[1] + 14), class: 'acg-label' });
        t.textContent = `${body.glyph} ${line.angle}`;
        t.style.fill = body.color;
        t.dataset.body = line.body;
        t.dataset.angle = line.angle;
        g.append(t);
      }
    }
    const birth = projection(birthAt);
    if (birth) g.append(svgEl('circle', { cx: String(birth[0]), cy: String(birth[1]), r: '4', class: 'acg-birth' }));
    const pick = svgEl('circle', { r: '5', class: 'acg-pick', visibility: 'hidden' });
    g.append(pick);
    svg.append(g);
    host.replaceChildren(svg);
    applyVisibility(svg);

    let k = 1;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .translateExtent([[0, 0], [W, H]])
      .on('zoom', (e: D3ZoomEvent<SVGSVGElement, unknown>) => {
        k = e.transform.k;
        g.setAttribute('transform', e.transform.toString());
        g.style.setProperty('--k', String(k));
      });
    const sel = select(svg as SVGSVGElement).call(z);
    sel.on('click', (e: MouseEvent) => {
      if (e.defaultPrevented) return;                 // the end of a drag
      const [x, y] = pointer(e, g);
      const ll = projection.invert?.([x, y]);
      if (!ll) return;
      pick.setAttribute('cx', String(x));
      pick.setAttribute('cy', String(y));
      pick.setAttribute('visibility', 'visible');
      onPoint([ll[0], ll[1]]);
    });
    return (p: LonLat) => {
      const xy = projection(p);
      if (!xy) return;
      pick.setAttribute('cx', String(xy[0]));
      pick.setAttribute('cy', String(xy[1]));
      pick.setAttribute('visibility', 'visible');
    };
  }

  function showNear(host: HTMLElement, p: LonLat, label: string) {
    const near = linesNear(p, lines.filter((l) => !hiddenBodies.has(l.body) && !hiddenAngles.has(l.angle)));
    const h = document.createElement('h3');
    h.textContent = label;
    if (!near.length) {
      const none = document.createElement('p');
      none.textContent = 'No line passes within 700 km of here: the place is quiet in your map, neither pulling nor pushing.';
      host.replaceChildren(h, none);
      return;
    }
    const ul = document.createElement('ul');
    ul.replaceChildren(...near.map(({ line, km }) => {
      const body = ACG_BODIES.find((b) => b.id === line.body)!;
      const li = document.createElement('li');
      const head = document.createElement('strong');
      head.textContent = `${body.label} ${ANGLE_LABEL[line.angle]}, ${Math.round(km)} km`;
      const text = document.createElement('p');
      text.textContent = MEANING[`${line.body}-${line.angle}`];
      li.append(head, text);
      return li;
    }));
    host.replaceChildren(h, ul);
  }

  function initACG() {
    const form = document.getElementById('acg-form') as HTMLFormElement | null;
    if (!form) return;
    const result = document.getElementById('acg-result')!;
    const mapHost = document.getElementById('acg-map')!;
    const nearHost = document.getElementById('acg-near')!;
    let mark: ((p: LonLat) => void) | undefined;
    let lastPoint: { p: LonLat; label: string } | null = null;
    let birthAt: LonLat = [0, 0];

    const refresh = () => {
      applyVisibility(mapHost);
      if (lastPoint) showNear(nearHost, lastPoint.p, lastPoint.label);
    };
    chips(document.getElementById('acg-planets')!, ACG_BODIES.map((b) => ({ id: b.id, label: `${b.glyph} ${b.label}` })), hiddenBodies, refresh);
    chips(document.getElementById('acg-angles')!, ANGLES.map((a) => ({ id: a, label: a })), hiddenAngles as Set<string>, refresh);

    const point = (p: LonLat, label: string) => { lastPoint = { p, label }; showNear(nearHost, p, label); };
    initPlace(document.getElementById('acg-city') as HTMLInputElement, document.getElementById('acg-city-list') as HTMLUListElement,
      (pl) => { if (!pl) return; const p: LonLat = [pl.longitude, pl.latitude]; mark?.(p); point(p, placeName(pl)); });

    initBirthForm(form, async (b) => {
      const { computeEquatorial } = await import('../lib/ephemeris');
      const eq = await computeEquatorial(`${b.date}T${b.time}`, b.place.time_zone, ACG_BODIES.map((x) => x.id));
      lines = eq.bodies.flatMap((x) => linesFor(x.name, x.ra, x.dec, eq.gast));
      birthAt = [b.place.longitude, b.place.latitude];

      const born = new Date(`${b.date}T00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      document.getElementById('acg-title')!.textContent = `Born ${born}, ${b.time}`;
      document.getElementById('acg-meta')!.textContent = `${placeName(b.place)} · ${coords(b.place)} · marked on the map with a dot`;
      (document.getElementById('acg-back') as HTMLAnchorElement).href = `/natal-chart/${birthQuery(b, placeName(b.place))}`;

      document.getElementById('acg-rows')!.replaceChildren(...eq.bodies.map((x) => {
        const body = ACG_BODIES.find((y) => y.id === x.name)!;
        const mc = lines.find((l) => l.body === x.name && l.angle === 'MC')!.paths[0][0][0];
        const cells = [
          lonText(mc), lonText(((mc + 360) % 360) - 180),
          ...(['ASC', 'DSC'] as const).map((a) => {
            const lon = horizonLon(x.ra, x.dec, eq.gast, b.place.latitude, a);
            return lon === null ? 'never on the horizon' : lonText(lon);
          }),
        ];
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.scope = 'row';
        th.textContent = body.label;
        tr.append(th, ...cells.map((c) => { const td = document.createElement('td'); td.textContent = c; return td; }));
        return tr;
      }));

      result.hidden = false;
      mark = await drawMap(mapHost, birthAt, (p) =>
        point(p, `${Math.abs(p[1]).toFixed(1)}° ${p[1] >= 0 ? 'N' : 'S'}, ${lonText(p[0])}`));
      point(birthAt, `${placeName(b.place)}, where you were born`);
      track('astrocartography', { place: placeName(b.place), date: b.date });
      result.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
  }
  document.addEventListener('astro:page-load', initACG);
</script>
```

Note: `lonText(((mc + 360) % 360) - 180)` gives the IC longitude: for `mc` in −180…180 it equals `norm180(mc + 180)`.

- [ ] **Step 3: Styles** — append to `src/styles/global.css`

```css
/* Astrocartography — /astrocartography/ */
.acg-chips { display: flex; flex-wrap: wrap; gap: .4rem; margin: 1rem 0 0; }
.acg-map { margin-top: 1rem; border: 1px solid var(--hair); border-radius: 6px; overflow: hidden; background: var(--plate); touch-action: none; }
.acg-svg { display: block; width: 100%; height: auto; cursor: grab; }
.acg-svg:active { cursor: grabbing; }
.acg-graticule { fill: none; stroke: var(--hair); stroke-width: .5; vector-effect: non-scaling-stroke; }
.acg-land { fill: var(--plate-lit); stroke: var(--hair); stroke-width: .6; vector-effect: non-scaling-stroke; }
.acg-line { fill: none; stroke-width: 1.8; vector-effect: non-scaling-stroke; }
.acg-outer { stroke-width: 1.1; }
.acg-MC { stroke-dasharray: none; }
.acg-IC { stroke-dasharray: 1.5 4; stroke-linecap: round; }
.acg-ASC { stroke-dasharray: 8 5; }
.acg-DSC { stroke-dasharray: 10 4 2 4; }
.acg-label { font: calc(11px / var(--k, 1)) var(--ui); text-anchor: middle; paint-order: stroke; stroke: var(--plate); stroke-width: calc(3px / var(--k, 1)); }
.acg-birth { fill: var(--gold); stroke: var(--plate); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.acg-pick { fill: none; stroke: var(--ink); stroke-width: 2; vector-effect: non-scaling-stroke; }
.acg-legend { font-family: var(--ui); font-size: .82rem; color: var(--ink-faint); margin: .6rem 0 0; }
.acg-key { display: inline-block; width: 1.8rem; height: 0; border-top: 2px solid var(--ink-soft); vertical-align: middle; margin: 0 .3rem 0 .8rem; }
.acg-key.acg-IC { border-top-style: dotted; }
.acg-key.acg-ASC, .acg-key.acg-DSC { border-top-style: dashed; }
.acg-city { margin-top: 2rem; max-width: 46rem; font-family: var(--ui); }
.acg-city label { display: block; margin-bottom: .35rem; font-size: .86rem; color: var(--ink-soft); }
.acg-near h3 { font-family: var(--serif); font-weight: 400; font-size: 1.2rem; margin: 1.2rem 0 .4rem; }
.acg-near ul { list-style: none; padding: 0; margin: 0; }
.acg-near li { padding: .7rem 0; border-bottom: 1px solid var(--hair); }
.acg-near li p { margin: .25rem 0 0; color: var(--ink-soft); font-size: .92rem; }
.acg-table { margin-top: 2rem; }
.acg-table caption { text-align: left; font-family: var(--serif); font-size: 1.2rem; padding-bottom: .5rem; }
```

The city input reuses `.natal-form input` styles only inside the form; give `#acg-city` the same look by adding `#acg-city` to the selector list of the `.natal-form input` rule at line 1145 (and its `:focus` rule at 1151), and `#acg-city-list` to the place-list rules (search `#place-list` in `global.css` and add `#acg-city-list` beside each).

- [ ] **Step 4: Resources card** — in `src/pages/resources.astro`, after the natal chart item:

```ts
  {
    title: 'Astrocartography',
    mark: '🗺️',
    url: '/astrocartography/',
    body: 'Your planetary lines on a world map: where each planet rose, set and culminated at your birth, and what living or travelling near each line brings.',
    kind: 'tool' as const,
  },
```

and change the comment `/* the one tool that lives on this site */` to `/* the tools that live on this site */`, and the intro text "all but the natal chart live elsewhere" to "all but the natal chart and the map live elsewhere".

- [ ] **Step 5: Check, build, and test in the browser**

Run: `npx astro check && npm test && npm run build`
Expected: 0 errors; tests pass; build completes and `dist/astrocartography/index.html` exists.

With `npm run dev`, on `/astrocartography/`:
1. **Known sky check:** 2000-01-01, 12:00, London (Europe/London, UTC+0). The Sun crosses the Greenwich meridian about 3 minutes after noon then, so the **Sun MC line must sit about 0.8° W** (table: `0.8° W`, give or take 0.1°). If it is off by more than 1°, `gast` or RA is wrong: stop and fix Task 5.
2. Sun ASC/DSC lines are curves crossing the MC near the equator; at London's latitude the Sun is never circumpolar, so the ASC/DSC cells have longitudes.
3. Toggle Moon off: its four lines and labels disappear. Toggle MC off: all MC lines go.
4. Click near a line: the panel lists it with km and its meaning. Search "Paris": same.
5. Zoom and drag: lines keep their width; labels stay readable.
6. From `/natal-chart/` with a known time, "See your lines on the map" opens this page and draws at once; "Back to your chart" returns and draws the chart.
7. Light and dark mode; 375 px wide: no horizontal page scroll (the map scales; the table may need `overflow-x: auto` on a wrapper if it pushes the page — add one if so).

Take screenshots with `agent-browser` (launch with `--args --no-sandbox`) of both pages in both themes, and look at them.

- [ ] **Step 6: Commit**

```bash
git add src/pages/astrocartography.astro src/pages/resources.astro src/styles/global.css package.json package-lock.json
git commit -m "Astrocartography: planetary lines on a world map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Final check and pull request

- [ ] **Step 1:** `npm test && npx astro check && npm run build` — all green.
- [ ] **Step 2:** `gitleaks detect --source . --no-git` on the changed files — no findings.
- [ ] **Step 3:** Update `README.md`: under "Natal chart data", add a line for the Hellenistic reading (`src/lib/hellenistic.ts`, tables in `src/data/dignities.ts`) and a short "Astrocartography" section (in-mundo lines, `src/lib/acg.ts`, Natural Earth via world-atlas). Commit.
- [ ] **Step 4:** Push the branch and open a PR with `gh pr create`; the body lists both features, the three deviations, the meanings as first drafts awaiting the owner's edit, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Ask the owner before pushing.
