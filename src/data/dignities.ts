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
