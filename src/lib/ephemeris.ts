// Planetary positions for the natal chart, calculated in the browser by the
// Swiss Ephemeris compiled to WebAssembly (@swisseph/browser).
//
// It answers what ephem-api's /v1/positions did, in the same shape: apparent
// topocentric positions from the JPL DE441 ephemeris files, never the
// library's lower-precision analytical (Moshier) fallback. The site serves
// the files itself from /ephe/ and fetches only the centuries a chart needs.

import {
  SwissEphemeris, Planet, LunarPoint, Asteroid, HouseSystem, CalculationFlag,
} from '@swisseph/browser';
import wasmURL from '@swisseph/browser/dist/swisseph.wasm?url';

export interface Body { name: string; longitude: number; speed_longitude: number; retrograde: boolean }
export interface Positions {
  input: { local: string; utc: string; utc_offset: string };
  bodies: Body[];
  houses?: { system: string; note?: string; cusps: number[]; ascendant: number; mc: number };
}

export interface ChartRequest {
  datetime: string;     // local wall-clock time, 2026-10-22T14:30
  tz: string;           // IANA time zone, Europe/Dublin
  lat: number; lon: number; alt?: number;
  bodies: string[];
  houses: 'placidus' | 'none';
}

const BODY_IDS: Record<string, number> = {
  sun: Planet.Sun, moon: Planet.Moon, mercury: Planet.Mercury, venus: Planet.Venus,
  mars: Planet.Mars, jupiter: Planet.Jupiter, saturn: Planet.Saturn, uranus: Planet.Uranus,
  neptune: Planet.Neptune, pluto: Planet.Pluto, mean_node: LunarPoint.MeanNode,
  true_node: LunarPoint.TrueNode, mean_lilith: LunarPoint.MeanApogee,
  true_lilith: LunarPoint.OsculatingApogee, chiron: Asteroid.Chiron,
};

const EPHE_URL = '/ephe/';
const FLAGS = CalculationFlag.SwissEphemeris | CalculationFlag.Speed | CalculationFlag.Topocentric;
// which ephemeris a calculation actually used
const SOURCE = CalculationFlag.JPLEphemeris | CalculationFlag.SwissEphemeris | CalculationFlag.MoshierEphemeris;

let ready: Promise<SwissEphemeris> | undefined;
const loaded = new Set<string>();

function engine() {
  ready ??= (async () => {
    const swe = new SwissEphemeris();
    await swe.init(wasmURL);
    return swe;
  })().catch((e: unknown) => { ready = undefined; throw e; });
  return ready;
}

// the planet, Moon and asteroid files for a 600-year block: sepl_18.se1
// holds 1800–2399. Returns false when the site has no file for it.
async function loadBlock(swe: SwissEphemeris, year: number) {
  const block = String(Math.floor(year / 600) * 6).padStart(2, '0');
  const files = ['sepl', 'semo', 'seas'].map((k) => `${k}_${block}.se1`).filter((f) => !loaded.has(f));
  if (!files.length) return true;
  try {
    await swe.loadEphemerisFiles(files.map((name) => ({ name, url: EPHE_URL + name })));
  } catch {
    return false;
  }
  files.forEach((f) => loaded.add(f));
  return true;
}

// ---- time: local wall-clock time in an IANA zone to UTC

const formats = new Map<string, Intl.DateTimeFormat>();

// offset of tz from UTC at an instant, in milliseconds, to the second
function zoneOffset(tz: string, utc: number) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formats.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(utc).map(({ type, value }) => [type, Number(value)]));
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  d.setUTCHours(p.hour, p.minute, p.second);
  return d.getTime() - Math.floor(utc / 1000) * 1000;
}

// the UTC instant of a local time: when clocks went back and the time came
// twice, the earlier one; an error when clocks went forward past it
function toUTC(local: string, tz: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(local);
  if (!m) throw new Error(`${local} is not a date and time such as 2026-10-22T14:30.`);
  const d = new Date(0);
  d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]);
  d.setUTCHours(+m[4], +m[5]);
  const wall = d.getTime();
  try { zoneOffset(tz, wall); } catch { throw new Error(`Unknown time zone ${tz}.`); }
  const HALF_DAY = 43_200_000;
  const fits = [...new Set([zoneOffset(tz, wall - HALF_DAY), zoneOffset(tz, wall + HALF_DAY)])]
    .filter((off) => zoneOffset(tz, wall - off) === off)
    .map((off) => ({ utc: wall - off, off }))
    .sort((a, b) => a.utc - b.utc);
  if (!fits.length) throw new Error(`${local.replace('T', ' ')} did not exist in ${tz}: the clocks went forward past it.`);
  return fits[0];
}

// +01:00, as ephem-api wrote it: whole minutes, seconds dropped
function offsetText(ms: number) {
  const min = Math.trunc(ms / 60_000), a = Math.abs(min);
  return `${ms < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// ---- the chart

export async function computeChart(r: ChartRequest): Promise<Positions> {
  const { utc, off } = toUTC(r.datetime, r.tz);
  const ids = r.bodies.map((b) => {
    const id = BODY_IDS[b];
    if (id === undefined) throw new Error(`Unknown body ${b}.`);
    return id;
  });
  const swe = await engine();
  const at = new Date(utc);
  const year = at.getUTCFullYear();
  if (!await loadBlock(swe, year)) throw new Error('No high-precision ephemeris file covers this date.');

  const jd = swe.dateToJulianDay(at);
  swe.setTopocentric(r.lon, r.lat, r.alt ?? 0);
  const calc = () => ids.map((id) => swe.calculatePosition(jd, id, FLAGS));
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
