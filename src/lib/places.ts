// Place search for the natal chart, over the static index that
// scripts/build-places.ts writes to /places/ from GeoNames' cities1000.
//
// The page fetches the shard for the query's first character (or first two)
// once, then answers every keystroke in memory: names that begin with the
// query first, as ephem-api's /v1/cities ranked them, then near misses —
// one typo, a swapped or missing letter — found by uFuzzy.

import uFuzzy from '@leeoniya/ufuzzy';
import { normalize, minQueryLength, shardName } from './normalize.ts';

export interface Place {
  name: string; region?: string; country: string; country_code: string;
  latitude: number; longitude: number; time_zone: string; matched_name: string;
}

type Row = [name: string, lat: number, lon: number, cc: string, region: string, pop: number, tz: string];
interface Shard { c: Row[]; k: string[]; e: number[]; t: number[]; m: string[] }
interface Manifest { split: string[]; countries: Record<string, string> }

const BASE = '/places/';

let manifest: Promise<Manifest> | undefined;
const shards = new Map<string, Promise<Shard | null>>();

async function getJSON<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The place index answered ${res.status}.`);
  return res.json();
}

function load(prefix: string) {
  let s = shards.get(prefix);
  if (!s) {
    s = getJSON<Shard>(`${BASE}${shardName(prefix)}.json`);
    s.catch(() => shards.delete(prefix));
    shards.set(prefix, s);
  }
  return s;
}

// the shards a query needs: one, except for a single character whose shard
// is split by two (a one-character query only happens in CJK scripts)
async function shardsFor(q: string) {
  manifest ??= getJSON<Manifest>(`${BASE}index.json`).then((m) => m ?? { split: [], countries: {} });
  const m = await manifest;
  const [first, second] = [...q];
  if (!m.split.includes(first)) return { m, list: [await load(first)] };
  if (second) return { m, list: [await load(first + second)] };
  return { m, list: [] };
}

const fuzzy = new uFuzzy({
  unicode: true,
  interSplit: "[^\\p{L}\\p{M}\\d']+",
  intraSplit: null,
  intraBound: null,
  intraChars: "[\\p{L}\\p{M}\\d']",
  intraContr: "'\\p{L}{1,2}\\b",
  intraMode: 1,            // one typo per word of the query
  interLft: 2,             // and each word must start a word of the name
});

// how well a key matches: the place's own name exactly, another of its
// names exactly, a name beginning with the query, a later word of one, a
// near miss
const rank = (s: Shard, i: number, q: string) =>
  !s.k[i].startsWith(q) ? 4 : s.t[i] === 2 ? 3 : s.k[i] !== q ? 2 : s.t[i];

export async function searchPlaces(query: string, limit = 8): Promise<Place[]> {
  const q = normalize(query);
  if ([...q].length < minQueryLength(q)) return [];
  const { m, list } = await shardsFor(q);

  interface Hit { s: Shard; row: number; key: number; rank: number }
  const best = new Map<Row, Hit>();
  const consider = (s: Shard, key: number, r: number) => {
    const row = s.e[key], place = s.c[row];
    const had = best.get(place);
    if (!had || r < had.rank || (r === had.rank && !s.m[key] && had.s.m[had.key])) {
      best.set(place, { s, row, key, rank: r });
    }
  };

  for (const s of list) {
    if (!s) continue;
    for (let i = 0; i < s.k.length; i++) if (s.k[i].startsWith(q)) consider(s, i, rank(s, i, q));
  }
  // near misses only when the exact matches leave room, and only for
  // queries long enough for a typo to be told from a different name
  if (best.size < limit && [...q].length >= 3) {
    for (const s of list) {
      if (!s) continue;
      // up to 2000 matches are checked against the word-start rule; past
      // that the query is too loose for its near misses to matter
      const [idxs, info] = fuzzy.search(s.k, q, 0, 2000);
      for (const i of info?.idx ?? idxs ?? []) consider(s, i, rank(s, i, q));
    }
  }

  return [...best.entries()]
    .sort(([a, x], [b, y]) => x.rank - y.rank || b[5] - a[5])
    .slice(0, limit)
    .map(([p, h]) => ({
      name: p[0], latitude: p[1], longitude: p[2], country_code: p[3],
      country: m.countries[p[3]] ?? p[3], region: p[4] || undefined, time_zone: p[6],
      matched_name: h.s.m[h.key] || p[0],
    }));
}
