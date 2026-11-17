// The website's map, faint, for the top of the contract's first page: the
// same landscape generator as the home page backdrop (src/lib/terrain.ts),
// its strokes drawn as SVG at the site's dark-theme strengths, fading out
// downwards. A fixed seed, so every build draws the same land.
// Writes build/map.svg (210 × 120 mm).
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildTerrain, STRIDE, KIND_HACHURE, KIND_CONTOUR, KIND_INDEX, KIND_SIGN, KIND_ROAD, KIND_LABEL } from '../src/lib/terrain.ts';

const W_MM = 210, H_MM = 120;
const CELL_MM = 2.4;                      // a terrain cell on paper (≈ 10 px on screen)
const SEED = 11;
const cols = Math.ceil(W_MM / CELL_MM) + 1, rows = Math.ceil(H_MM / CELL_MM) + 1;
const { data, count } = buildTerrain({ cols, rows, hole: null, band: null, seed: SEED });

// stroke half-widths in screen px (as hachure-gl.ts draws them), to cells
const PX = 1 / 10;
const mix = (a, b, t) => a + (b - a) * t;
const INK = '#ECE6DA', GOLD = '#C9A24E';
// the site's dark-theme alphas, a touch fainter on paper
const ALPHA = { hachure: 0.09, contour: 0.12, index: 0.2, sign: 0.3, road: 0.18, label: 0.26, dot: 0.55 };

const groups = { hachure: [], contour: [], index: [], sign: [], road: [], label: [], dot: [] };
const f = (v) => v.toFixed(2);
for (let i = 0; i < count; i++) {
  const [x0, y0, x1, y1, w, k] = data.subarray(i * STRIDE, (i + 1) * STRIDE);
  if (k >= 2) { groups.dot.push(`<circle cx="${f(x0)}" cy="${f(y0)}" r="${f(1.2 * PX)}"/>`); continue; }
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  if (k === KIND_HACHURE) {
    // a wedge: broad at the top of the slope, as broad as the slope is steep
    const a = mix(0.35, 1.9, w) * PX, b = 0.12 * PX;
    groups.hachure.push(`<path d="M${f(x0 + nx * a)} ${f(y0 + ny * a)}L${f(x1 + nx * b)} ${f(y1 + ny * b)}L${f(x1 - nx * b)} ${f(y1 - ny * b)}L${f(x0 - nx * a)} ${f(y0 - ny * a)}Z"/>`);
    continue;
  }
  const half = k === KIND_INDEX ? mix(0.45, 2.0, w) : k === KIND_CONTOUR ? mix(0.28, 0.6, w)
    : k === KIND_SIGN ? 0.95 : k === KIND_ROAD ? 0.5 : 0.6;
  const key = k === KIND_INDEX ? 'index' : k === KIND_CONTOUR ? 'contour' : k === KIND_SIGN ? 'sign' : k === KIND_ROAD ? 'road' : k === KIND_LABEL ? 'label' : null;
  if (!key) continue;
  groups[key].push(`<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke-width="${f(2 * half * PX)}"/>`);
}

const lines = (key, colour) =>
  // opacity on the layer, not each stroke, so overlapping joints don't bead
  `<g opacity="${ALPHA[key]}" fill="none" stroke="${colour}" stroke-linecap="round" stroke-linejoin="round">${groups[key].join('')}</g>`;
const scale = W_MM / CELL_MM;   // cells across the page
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W_MM}mm" height="${H_MM}mm" viewBox="0 0 ${f(scale)} ${f((H_MM / W_MM) * scale)}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="1"/>
      <stop offset=".45" stop-color="#fff" stop-opacity=".75"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${f(scale)}" height="${f((H_MM / W_MM) * scale)}">
      <rect width="${f(scale)}" height="${f((H_MM / W_MM) * scale)}" fill="url(#fade)"/>
    </mask>
  </defs>
  <g mask="url(#m)">
    <g opacity="${ALPHA.hachure}" fill="${INK}">${groups.hachure.join('')}</g>
    ${lines('contour', INK)}
    ${lines('index', INK)}
    ${lines('road', INK)}
    ${lines('sign', INK)}
    ${lines('label', INK)}
    <g opacity="${ALPHA.dot}" fill="${GOLD}">${groups.dot.join('')}</g>
  </g>
</svg>
`;
mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
writeFileSync(new URL('./build/map.svg', import.meta.url), svg);
console.log(`map.svg: ${cols}×${rows} cells, ${count} strokes`);
