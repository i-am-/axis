// build-places.ts — turn GeoNames' cities1000 dump into the static place
// index the natal chart page searches: public/places/.
//
//   node scripts/build-places.ts <geonames dir> [out dir]
//
// The GeoNames dir holds cities1000.txt, admin1CodesASCII.txt and
// countryInfo.txt from https://download.geonames.org/export/dump/ (CC BY 4.0);
// scripts/fetch-data.sh downloads them.
//
// Every name of every place, in every language GeoNames records, becomes a
// normalised key; so does each name from each later word on, so "york"
// finds New York. Keys are sharded by their first character, or their first
// two when a one-character shard would be too big to fetch while typing:
//
//   index.json      { split: first characters sharded by two, countries }
//   <shard>.json    { c: places, k: keys, e: place of each key,
//                     t: kind of each key, m: name each key came from }
//
// A place is [name, lat, lon, country code, region, population, time zone].
// Kinds: 0 the place's own name, 1 another whole name, 2 a later word.

import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { normalize, shardName } from '../src/lib/normalize.ts';

const [src, out = 'public/places'] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/build-places.ts <geonames dir> [out dir]');
  process.exit(2);
}
const SPLIT_ABOVE = 1_200_000;      // bytes of JSON in a one-character shard

async function* lines(path: string) {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (line && !line.startsWith('#')) yield line.split('\t');
  }
}

async function table(path: string, k: number, v: number) {
  const m: Record<string, string> = {};
  for await (const f of lines(path)) if (f.length > v) m[f[k]] = f[v];
  return m;
}

type Place = [name: string, lat: number, lon: number, cc: string, region: string, pop: number, tz: string];
interface Entry { key: string; place: number; kind: number; name: string }

const countries = await table(`${src}/countryInfo.txt`, 0, 4);    // ISO → country name
const regions = await table(`${src}/admin1CodesASCII.txt`, 0, 1);  // "IE.L" → Leinster

const places: Place[] = [];
const entries: Entry[] = [];
for await (const f of lines(`${src}/cities1000.txt`)) {
  // geonameid name asciiname alternatenames lat lon fclass fcode cc cc2
  // admin1 admin2 admin3 admin4 population elevation dem timezone moddate
  if (f.length < 19) throw new Error(`cities1000.txt: ${f.length} fields`);
  const [, name, ascii, alternates] = f;
  const cc = f[8];
  const place = places.push([name, +f[4], +f[5], cc, regions[`${cc}.${f[10]}`] ?? '', +f[14] || 0, f[17]]) - 1;
  const own = normalize(name);
  // a key once per place, from the name that gives it its best kind
  const seen = new Map<string, Entry>();
  for (const n of [name, ascii, ...alternates.split(',')].map((s) => s.trim())) {
    const whole = normalize(n);
    if (!whole) continue;
    const add = (key: string, kind: number) => {
      const had = seen.get(key);
      if (!had) seen.set(key, entries[entries.push({ key, place, kind, name: n }) - 1]);
      else if (kind < had.kind) Object.assign(had, { kind, name: n });
    };
    add(whole, whole === own ? 0 : 1);
    for (let i = whole.indexOf(' '); i >= 0; i = whole.indexOf(' ', i + 1)) add(whole.slice(i + 1), 2);
  }
}

function shard(list: Entry[]) {
  const local = new Map<number, number>();
  const c: Place[] = [];
  const e: number[] = [], t: number[] = [], m: string[] = [];
  for (const x of list) {
    let i = local.get(x.place);
    if (i === undefined) local.set(x.place, i = c.push(places[x.place]) - 1);
    e.push(i);
    t.push(x.kind);
    m.push(x.name === places[x.place][0] ? '' : x.name);
  }
  return JSON.stringify({ c, k: list.map((x) => x.key), e, t, m });
}

const group = (list: Entry[], depth: number) => {
  const g = new Map<string, Entry[]>();
  for (const x of list) {
    const p = [...x.key].slice(0, depth).join('');
    if (!g.has(p)) g.set(p, []);
    g.get(p)!.push(x);
  }
  return g;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const split: string[] = [];
let files = 0, bytes = 0, biggest = 0;
const write = (prefix: string, json: string) => {
  writeFileSync(`${out}/${shardName(prefix)}.json`, json);
  files++;
  bytes += json.length;
  biggest = Math.max(biggest, json.length);
};
for (const [first, list] of group(entries, 1)) {
  const json = shard(list);
  if (json.length <= SPLIT_ABOVE) { write(first, json); continue; }
  split.push(first);
  for (const [two, sub] of group(list, 2)) write(two, shard(sub));
}
writeFileSync(`${out}/index.json`, JSON.stringify({ split, countries }));
console.log(`${places.length} places, ${entries.length} keys, ${files} shards, ` +
  `${(bytes / 1e6).toFixed(1)} MB, largest ${(biggest / 1e3).toFixed(0)} kB`);
