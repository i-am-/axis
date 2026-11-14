// Birth data in a page's URL fragment, so /natal-chart/ and
// /astrocartography/ can hand a chart to each other:
//   #d=1990-06-15&t=14:30&n=Dublin, Leinster, Ireland&lat=53.3440&lon=-6.2672&tz=Europe/Dublin
// The place index has no stable ids, so the place travels as its label,
// coordinates and time zone. `t` is left out when the time is unknown.
// It is a fragment, not a query string, so it is never sent to a server or
// the page's analytics. Old ?d=... links are still read.

import type { Place } from './places';

export interface Birth { date: string; time: string | null; place: Place }

export function birthQuery(b: Birth, label: string) {
  const q = new URLSearchParams({ d: b.date });
  if (b.time) q.set('t', b.time);
  q.set('n', label);
  q.set('lat', b.place.latitude.toFixed(4));
  q.set('lon', b.place.longitude.toFixed(4));
  q.set('tz', b.place.time_zone);
  return `#${q}`;
}

export function readBirthQuery(s: string): Birth | null {
  const q = new URLSearchParams(s.replace(/^[#?]/, ''));
  const d = q.get('d') ?? '', t = q.get('t'), n = q.get('n') ?? '', tz = q.get('tz') ?? '';
  const lat = Number(q.get('lat')), lon = Number(q.get('lon'));
  if (!/^\d{4}-\d\d-\d\d$/.test(d)) return null;
  if (t !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  if (!n || !tz || !q.get('lat') || !q.get('lon')) return null;
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  return {
    date: d, time: t,
    place: { name: n, country: '', country_code: '', latitude: lat, longitude: lon, time_zone: tz, matched_name: n },
  };
}
