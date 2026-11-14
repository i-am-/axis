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
const dateText = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
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
