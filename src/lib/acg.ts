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
