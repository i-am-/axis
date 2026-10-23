// The Symbolon spread under the natal chart: the cards the personal
// planets and the Ascendant cast, fanned over a cloth.
//
// Ported from Natalist: the casting rules from modules/card-spread
// (cardspread.py) and the fan from \symbolonspread in symbolon.sty, with
// its numbers from report.cfg /report/cards/*. Lengths are in that
// figure's centimetres, so the SVG's viewBox is the cloth at 12.8 × 12.48.
//
// The card scans are the publisher's and are not in this repo; the build
// fetches them into /symbolon/ (scripts/fetch-symbolon.sh). Without them
// each card is drawn as a plate carrying its number and name.

import deck from '../data/symbolon.json';
import type { Positions } from './ephemeris';

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio',
  'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const signOf = (lon: number) => SIGNS[Math.floor(lon / 30) % 12];

// the reading of each card from Natalist's assets/symbolon.csv
export interface Card {
  n: number; name: string;
  description: string; imagery: string; symbols: string[]; motifs: string[]; quote: string;
}
export interface Slot { body: string; sign: string; cards: Card[] }

// ---- casting (cardspread.py)

interface DeckCard extends Card { signs: string[]; ruler?: string }
const archetype = new Map<string, DeckCard>();      // sign → its one-sign card
const pair = new Map<string, DeckCard>();           // "Aries|Cancer" → the two-sign card
const ruled = new Map<string, string[]>();          // planet → the signs it rules
for (const c of deck as DeckCard[]) {
  if (c.signs.length === 1) {
    archetype.set(c.signs[0], c);
    ruled.set(c.ruler!, [...(ruled.get(c.ruler!) ?? []), c.signs[0]]);
  } else {
    pair.set(c.signs.join('|'), c);
    pair.set([...c.signs].reverse().join('|'), c);
  }
}

// the Sun takes the card of its sign; every other body, for each sign it
// rules, the card of that sign and the one it stands in — the archetype
// when they are the same sign, the combination card otherwise. Rulerships
// are read off the deck's archetype cards.
function match(body: string, sign: string): Card[] {
  const found: DeckCard[] = [];
  const add = (c?: DeckCard) => { if (c && !found.includes(c)) found.push(c); };
  if (body === 'Sun') add(archetype.get(sign));
  else for (const home of ruled.get(body) ?? []) add(home === sign ? archetype.get(home) : pair.get(`${home}|${sign}`));
  return found.map(({ signs, ruler, ...card }) => card);
}

const SPREAD = ['Ascendant', 'Sun', 'Moon', 'Mercury', 'Venus', 'Mars'] as const;

// the six slots; with no birth time there is no Ascendant, and its slot
// stays empty
export function castSpread(data: Positions): Slot[] {
  const lon = (name: string) => data.bodies.find((b) => b.name === name.toLowerCase())?.longitude;
  const slots: Slot[] = [];
  for (const body of SPREAD) {
    if (body === 'Ascendant') {
      if (!data.houses) continue;
      const sign = signOf(data.houses.ascendant);
      slots.push({ body, sign, cards: match('Sun', sign) });   // the archetype of the rising sign
      continue;
    }
    const l = lon(body);
    if (l === undefined) continue;
    const sign = signOf(l);
    slots.push({ body, sign, cards: match(body, sign) });
  }
  return slots;
}

// ---- the fan (\symbolonspread, /report/cards/*)

const BG_W = 12.8, BG_H = 12.48;                   // background.jpg is 1280 × 1248
const CARD_W = 1.5, CARD_H = CARD_W * 500 / 325;   // the scans are 325 × 500
const RADIUS = 4.35, PAIR_GAP = 1.45, JITTER = 0.12, TILT = 14, OPACITY = 0.96;
const CARD_PAD = 0.042, CARD_RULE = 0.011;         // 1.2pt and 0.3pt
const LABEL_W = 1.25, LABEL_OPACITY = 0.65, LABEL_PAD = 0.035;
// the label plate's centre below the card's: (label_pos − 0.5) × width × 1.5
const LABEL_Y = -(-0.05 - 0.5) * CARD_W * 1.5;
// per slot, in SPREAD order: the ray's direction, degrees anticlockwise from
// east, and a nudge along the page's vertical in per cent of the radius
const ANGLES: Record<string, number> = { Ascendant: 90, Sun: 30, Moon: -30, Mercury: -90, Venus: -150, Mars: 150 };
const NUDGES: Record<string, number> = { Ascendant: -10, Sun: 0, Moon: 0, Mercury: 20, Venus: 0, Mars: 0 };

// pgf's rnd, seeded as the PDF is (\pgfmathsetseed{2026}): Park–Miller with
// pgf's multiplier, so the jitter and tilt fall as they do in print
function pgfRandom(seed: number) {
  let s = seed;
  return () => { s = (69621 * s) % 2147483647; return s / 2147483647; };
}

const SVG = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: Node[]) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
}

// a card's name broken into lines for a plate drawn in its place
function wrap(text: string, max = 12) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  return lines;
}

let images: Promise<boolean> | undefined;
// whether the build fetched the scans
export function haveImages() {
  images ??= new Promise((done) => {
    const probe = new Image();
    probe.onload = () => done(true);
    probe.onerror = () => done(false);
    probe.src = '/symbolon/background.webp';
  });
  return images;
}

export function drawSpread(slots: Slot[], withImages: boolean): SVGSVGElement {
  const rnd = pgfRandom(2026);
  const cards = el('g', { class: 'spread-cards' });
  const labels = el('g', { class: 'spread-labels' });
  for (const slot of slots) {
    const a = ANGLES[slot.body] * Math.PI / 180;
    slot.cards.forEach((card, i) => {
      // a pair sits side by side across the ray, half the gap either way
      const off = slot.cards.length === 1 ? 0 : (i === 0 ? -0.5 : 0.5) * PAIR_GAP;
      const jx = JITTER * (2 * rnd() - 1), jy = JITTER * (2 * rnd() - 1);
      const x = RADIUS * Math.cos(a) - off * Math.sin(a) + jx;
      const y = RADIUS * Math.sin(a) + off * Math.cos(a) + jy + NUDGES[slot.body] * RADIUS / 100;
      const tilt = TILT * (2 * rnd() - 1);
      // TikZ's y and rotation run up and anticlockwise, SVG's down and clockwise
      const at = `translate(${x.toFixed(3)} ${(-y).toFixed(3)}) rotate(${(-tilt).toFixed(2)})`;
      const title = el('title', {});
      title.textContent = `${slot.body} in ${slot.sign}: ${card.n}. ${card.name}`;
      const frame = el('rect', {
        x: -CARD_W / 2 - CARD_PAD, y: -CARD_H / 2 - CARD_PAD,
        width: CARD_W + 2 * CARD_PAD, height: CARD_H + 2 * CARD_PAD, class: 'spread-frame', 'stroke-width': CARD_RULE,
      });
      const face = withImages
        ? el('image', {
          href: `/symbolon/cards/${String(card.n).padStart(2, '0')}.webp`,
          x: -CARD_W / 2, y: -CARD_H / 2, width: CARD_W, height: CARD_H,
        })
        : el('g', { class: 'spread-plate' },
          el('rect', { x: -CARD_W / 2, y: -CARD_H / 2, width: CARD_W, height: CARD_H }),
          el('text', { y: -0.45, class: 'spread-plate-n' }, document.createTextNode(String(card.n))),
          ...wrap(card.name).map((line, j) =>
            el('text', { y: 0.05 + j * 0.24, class: 'spread-plate-name' }, document.createTextNode(line))));
      cards.append(el('g', { transform: at, opacity: OPACITY }, title, frame, face));
      // the label on its own layer, so a later card cannot cover it
      labels.append(el('g', { transform: at },
        el('rect', {
          x: -LABEL_W / 2, y: LABEL_Y - 0.13 - LABEL_PAD, width: LABEL_W, height: 0.26 + 2 * LABEL_PAD,
          class: 'spread-label-plate', 'fill-opacity': LABEL_OPACITY,
        }),
        el('text', { y: LABEL_Y, class: 'spread-label' }, document.createTextNode(slot.body))));
    });
  }
  const bg = withImages
    ? el('image', { href: '/symbolon/background.webp', x: -BG_W / 2, y: -BG_H / 2, width: BG_W, height: BG_H })
    : el('rect', { x: -BG_W / 2, y: -BG_H / 2, width: BG_W, height: BG_H, class: 'spread-cloth' });
  return el('svg', {
    viewBox: `${-BG_W / 2} ${-BG_H / 2} ${BG_W} ${BG_H}`, class: 'spread-svg', role: 'img',
    'aria-label': 'Symbolon spread: ' + slots.map((s) => `${s.body}, ${s.cards.map((c) => c.name).join(' and ')}`).join('; '),
  }, bg, cards, labels);
}
