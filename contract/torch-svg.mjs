// The torch-bearer for the contract: the site's wireframe figure
// (src/data/torchbearer.ts) in off-white hairlines, its flame in the brand's
// fire, on nothing (the page is black). Writes build/torchbearer.svg.
import { writeFileSync, mkdirSync } from 'node:fs';
import { viewBox, paths, flame } from '../src/data/torchbearer.ts';

const frame = (layer) => flame.find((f) => f.layer === layer).frames[0];
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="743" height="1461">
  <defs>
    <linearGradient id="outer" gradientUnits="userSpaceOnUse" x1="0" y1="340" x2="0" y2="140">
      <stop offset="0" stop-color="#D9AE52"/><stop offset=".45" stop-color="#C0612A"/>
      <stop offset=".8" stop-color="#800000" stop-opacity=".85"/><stop offset="1" stop-color="#800000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="body" gradientUnits="userSpaceOnUse" x1="0" y1="340" x2="0" y2="215">
      <stop offset="0" stop-color="#E9C46A"/><stop offset=".7" stop-color="#D08A2C"/><stop offset="1" stop-color="#C0612A" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="core" gradientUnits="userSpaceOnUse" x1="0" y1="340" x2="0" y2="262">
      <stop offset="0" stop-color="#FFF8E6"/><stop offset=".6" stop-color="#F5E3B0"/><stop offset="1" stop-color="#E9C46A" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="#EDE6D6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
${paths.map((p) => `    <path d="${p.d}"/>`).join('\n')}
  </g>
  <path d="${frame('outer')}" fill="url(#outer)"/>
  <path d="${frame('body')}" fill="url(#body)"/>
  <path d="${frame('core')}" fill="url(#core)"/>
</svg>
`;
mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
writeFileSync(new URL('./build/torchbearer.svg', import.meta.url), svg);
console.log(`torchbearer.svg: ${paths.length} paths`);
