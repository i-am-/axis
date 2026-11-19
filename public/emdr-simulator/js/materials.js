// Optical material library, diffuser stack presets and strip defaults.
//
// All coefficients are per mm. They are NOMINAL starting values from typical
// literature/datasheet ranges, not measurements of your samples. Calibrate them:
// cast a sample, measure spot spread or transmittance, then edit the layer's
// advanced fields until the simulated metric matches the measurement.
//
//   n    refractive index
//   mus  scattering coefficient [1/mm]
//   g    Henyey-Greenstein anisotropy (0 isotropic, ->1 forward)
//   mua  absorption coefficient per band [R, G, B] in 1/mm (tint)

export const MATERIALS = {
  air: { label: 'Air gap', n: 1.0, mus: 0, g: 0, mua: [0, 0, 0] },
  epoxy_clear: {
    label: 'Epoxy, clear (coating resin)',
    n: 1.55, mus: 0.002, g: 0, mua: [0.003, 0.004, 0.008],
  },
  epoxy_ink: {
    label: 'Epoxy + white alcohol ink',
    n: 1.55, g: 0.55, mua: [0.003, 0.004, 0.008],
    // Scattering scales with ink dose (drops per 100 ml). Uncalibrated guess.
    ink: true, inkMusPerDrop: 0.12, inkMuaPerDrop: 0.0005, defaultInk: 3,
  },
  epoxy_pigment: {
    label: 'Epoxy + white pigment paste (TiO2)',
    n: 1.55, g: 0.5, mua: [0.004, 0.005, 0.012],
    ink: true, inkUnit: '‰ w/w', inkMusPerDrop: 2.5, inkMuaPerDrop: 0.004, defaultInk: 1,
  },
  pc_opal: {
    label: 'Polycarbonate opal cover (LED channel)',
    n: 1.585, mus: 14, g: 0.8, mua: [0.004, 0.004, 0.006],
  },
  pmma_opal: {
    label: 'Opal acrylic (LED-grade PMMA)',
    n: 1.49, mus: 5, g: 0.9, mua: [0.002, 0.002, 0.003],
  },
  pmma_satin: {
    label: 'Satin / frosted acrylic',
    n: 1.49, mus: 1.2, g: 0.9, mua: [0.001, 0.001, 0.002],
  },
  pmma_clear: { label: 'Clear acrylic', n: 1.49, mus: 0, g: 0, mua: [0.0005, 0.0005, 0.001] },
  pet_film: {
    label: 'Diffuser film (PET, high haze)',
    n: 1.6, mus: 80, g: 0.7, mua: [0.01, 0.01, 0.015],
  },
  silicone: {
    label: 'Silicone diffuser (neon-flex type)',
    n: 1.41, mus: 3, g: 0.75, mua: [0.003, 0.003, 0.005],
  },
  wood_veneer: {
    label: 'Wood veneer, maple (translucent)',
    n: 1.5, mus: 60, g: 0.92, mua: [0.25, 0.45, 1.1],
  },
};

export const WALLS = {
  alu_spec: { label: 'Aluminium channel (specular)', R: [0.86, 0.86, 0.86], specular: true },
  alu_white: { label: 'White-painted channel (diffuse)', R: [0.9, 0.9, 0.9], specular: false },
  wood_ash: { label: 'Wood, ash (diffuse)', R: [0.6, 0.52, 0.4], specular: false },
  wood_oak: { label: 'Wood, oak (diffuse)', R: [0.52, 0.42, 0.28], specular: false },
  wood_walnut: { label: 'Wood, walnut (diffuse)', R: [0.26, 0.18, 0.12], specular: false },
  black: { label: 'Black (absorbing)', R: [0.05, 0.05, 0.05], specular: false },
};

export const FLOORS = {
  pcb_white: { label: 'White PCB', R: [0.75, 0.75, 0.73] },
  pcb_black: { label: 'Black PCB', R: [0.1, 0.1, 0.1] },
  mirror: { label: 'Reflective tape (mirror-like, diffuse model)', R: [0.92, 0.92, 0.92] },
};

// Make a flat layer object that the Monte Carlo core understands.
export function makeLayer(materialId, t, ink) {
  const m = MATERIALS[materialId];
  const layer = {
    materialId,
    name: m.label,
    t,
    n: m.n,
    g: m.g,
    mus: m.mus ?? 0,
    muaR: m.mua[0],
    muaG: m.mua[1],
    muaB: m.mua[2],
  };
  if (m.ink) {
    layer.ink = ink ?? m.defaultInk;
    applyInk(layer);
  }
  return layer;
}

export function applyInk(layer) {
  const m = MATERIALS[layer.materialId];
  if (!m || !m.ink) return layer;
  const c = layer.ink;
  layer.mus = m.inkMusPerDrop * c;
  layer.muaR = m.mua[0] + m.inkMuaPerDrop * c;
  layer.muaG = m.mua[1] + m.inkMuaPerDrop * c;
  layer.muaB = m.mua[2] + m.inkMuaPerDrop * c;
  return layer;
}

export const STACK_PRESETS = [
  {
    id: 'proto_opal',
    label: 'Prototype: alu deep channel + opal PC cover',
    width: 12, wall: 'alu_spec', floor: 'pcb_white',
    layers: [['air', 11], ['pc_opal', 1.5]],
  },
  {
    id: 'proto_opal_clear',
    label: 'Prototype + 2.5 mm clear resin face',
    width: 12, wall: 'alu_spec', floor: 'pcb_white',
    layers: [['air', 11], ['pc_opal', 1.5], ['epoxy_clear', 2.5]],
  },
  {
    id: 'proto_opal_ink',
    label: 'Prototype + 2.5 mm inked resin face',
    width: 12, wall: 'alu_spec', floor: 'pcb_white',
    layers: [['air', 11], ['pc_opal', 1.5], ['epoxy_ink', 2.5, 8]],
  },
  {
    id: 'bare',
    label: 'Bare strip in channel (no diffuser)',
    width: 12, wall: 'alu_spec', floor: 'pcb_white',
    layers: [['air', 11]],
  },
  {
    id: 'shallow_opal',
    label: 'Shallow channel (5 mm) + opal PC',
    width: 12, wall: 'alu_spec', floor: 'pcb_white',
    layers: [['air', 5], ['pc_opal', 1.5]],
  },
  {
    id: 'resin_wood',
    label: 'Spec NF-PH-02: inked resin between wood panels, 25 mm',
    width: 10, wall: 'wood_ash', floor: 'pcb_white',
    layers: [['epoxy_ink', 25, 3]],
  },
  {
    id: 'resin_wood_low',
    label: 'Resin between wood panels, low ink (1 drop / 100 ml)',
    width: 10, wall: 'wood_ash', floor: 'pcb_white',
    layers: [['epoxy_ink', 25, 1]],
  },
  {
    id: 'oak_epoxy_ink',
    label: 'Oak, routed cavity, inked epoxy fill 20 mm',
    width: 10, wall: 'wood_oak', floor: 'pcb_white',
    layers: [['epoxy_ink', 20, 3]],
    housing: { species: 'oak' },
  },
  {
    id: 'oak_epoxy_white_lined',
    label: 'Oak, white-painted cavity, inked epoxy 20 mm',
    width: 10, wall: 'alu_white', floor: 'pcb_white',
    layers: [['epoxy_ink', 20, 3]],
    housing: { species: 'oak' },
  },
  {
    id: 'ash_epoxy_clear_opal',
    label: 'Ash, cavity: opal insert under 3 mm clear epoxy',
    width: 12, wall: 'alu_white', floor: 'pcb_white',
    layers: [['air', 10], ['pc_opal', 1.5], ['epoxy_clear', 3]],
    housing: { species: 'ash' },
  },
  {
    id: 'oak_halo',
    label: 'Oak, inked epoxy, 15 % rear light onto wall (20 mm standoff)',
    width: 10, wall: 'wood_oak', floor: 'pcb_white',
    layers: [['epoxy_ink', 20, 3]],
    housing: { species: 'oak', standoff: 20 },
    back: { mode: 'slot', exit: 'rear', fraction: 0.15 },
  },
  {
    id: 'resin_walnut',
    label: 'Inked resin between walnut panels, 25 mm',
    width: 10, wall: 'wood_walnut', floor: 'pcb_white',
    layers: [['epoxy_ink', 25, 3]],
  },
  {
    id: 'resin_white_slot',
    label: 'Inked resin in white-painted slot, 25 mm',
    width: 10, wall: 'alu_white', floor: 'pcb_white',
    layers: [['epoxy_ink', 25, 3]],
  },
  {
    id: 'veneer',
    label: 'Maple veneer face over 12 mm air',
    width: 12, wall: 'alu_white', floor: 'pcb_white',
    layers: [['air', 12], ['wood_veneer', 0.6]],
  },
  {
    id: 'neon',
    label: 'Silicone neon-flex, 8 mm',
    width: 10, wall: 'alu_white', floor: 'pcb_white',
    layers: [['silicone', 8]],
  },
];

export function stackFromPreset(id) {
  const p = STACK_PRESETS.find((s) => s.id === id) ?? STACK_PRESETS[0];
  const species = p.housing?.species ?? (p.wall === 'wood_walnut' ? 'walnut' : 'ash');
  return normaliseStack({
    presetId: p.id,
    label: p.label,
    width: p.width,
    wall: p.wall,
    floor: p.floor,
    emitter: 2.0,
    layers: p.layers.map(([m, t, ink]) => makeLayer(m, t, ink)),
    housing: { ...p.housing, species },
    back: { ...p.back },
  });
}

// ---------- housing (wooden body, mounting) and rear light ----------

export const SPECIES = {
  ash: { label: 'Ash', wall: 'wood_ash' },
  oak: { label: 'Oak', wall: 'wood_oak' },
  walnut: { label: 'Walnut', wall: 'wood_walnut' },
};
export const FINISHES = {
  raw: 'Raw / sanded',
  oil: 'Natural oil (warmer)',
  white_oil: 'White oil (stays pale)',
  lacquer: 'Matt lacquer',
};
export const EDGES = { square: 'Square', chamfer: 'Chamfer', round: 'Round-over' };

export const HOUSING_DEFAULT = {
  species: 'ash',
  finish: 'oil',
  rail: 10, // mm of wood above and below the epoxy window on the face
  back: 6, // mm of wood behind the LED strip
  edge: 'chamfer',
  edgeR: 3, // mm
  standoff: 0, // mm gap between the back of the bar and the wall
};

// Rear light: part of the light goes backwards and lights the wall behind the bar.
//   mode  off   | slot: the same LEDs, a fraction is sent back (translucent carrier,
//                 gap behind the strip); the front loses that fraction
//               | strip: a separate rear-facing strip with its own drive
//   exit  rear (back face; needs a standoff) | top | bottom | both (edge slots)
export const BACK_DEFAULT = {
  mode: 'off',
  exit: 'rear',
  fraction: 0.15, // slot: share of each LED's light sent back
  efficiency: 0.7, // share of the diverted light that leaves the body
  beam: 1, // cos^m intensity exponent: 1 = Lambertian, higher = narrower
  drive: 'follow', // strip: follow | steady | steady_dim
  gain: 0.5, // strip + follow: rear drive = front drive × gain
  level: 0.3, // strip + steady: drive level 0..1
  cct: 2700,
  dimTo: 0.2, // steady_dim: level factor while an EMDR set runs
};

export const BACK_EXITS = { rear: 'Back face (needs standoff)', top: 'Top edge slot', bottom: 'Bottom edge slot', both: 'Top + bottom edge slots' };

export function normaliseStack(st) {
  st.housing = { ...HOUSING_DEFAULT, ...(st.housing || {}) };
  if (!SPECIES[st.housing.species]) st.housing.species = st.wall === 'wood_walnut' ? 'walnut' : 'ash';
  st.back = { ...BACK_DEFAULT, ...(st.back || {}) };
  return st;
}

export const stackDepth = (st) => st.layers.reduce((a, l) => a + l.t, 0);

// Overall body cross-section in mm: the epoxy window plus wood rails, and the
// cavity depth plus the wood behind the strip.
export function bodySize(st) {
  const h = st.housing;
  return { H: st.width + 2 * h.rail, D: stackDepth(st) + h.back };
}

// Wall illuminance model shared by the shader (scene.js) and the CPU estimate.
// One rear source per LED; intensity I(θ) = Φ (m+1)/(2π) cos^m θ about its axis.
// Returns the source geometry in metres relative to the wall (z = 0).
export function backGeometry(st, barY) {
  const { H, D } = bodySize(st);
  const s = st.housing.standoff;
  const exit = st.back.exit;
  if (exit === 'rear') return [{ y: barY, z: Math.max(0.5, s) / 1000, dir: 0, share: 1 }];
  const zMid = (s + D / 2) / 1000;
  const top = { y: barY + H / 2000, z: zMid, dir: 1, share: 1 };
  const bot = { y: barY - H / 2000, z: zMid, dir: -1, share: 1 };
  if (exit === 'top') return [top];
  if (exit === 'bottom') return [bot];
  return [{ ...top, share: 0.5 }, { ...bot, share: 0.5 }];
}

// Build the Monte Carlo configuration from a stack.
// similarity: replace (mus, g) by (mus*(1-g), 0). 4-10x faster, spot width within ~10 %.
export function buildMcConfig(stack, { similarity = false } = {}) {
  const depth = stack.layers.reduce((a, l) => a + l.t, 0);
  const rx = Math.min(150, Math.max(30, 3.5 * depth + 2 * stack.width));
  const wall = WALLS[stack.wall];
  const floor = FLOORS[stack.floor];
  const layers = stack.layers.map((l) => ({ ...l }));
  if (similarity) {
    for (const l of layers) {
      l.mus *= 1 - l.g;
      l.g = 0;
    }
  }
  return {
    layers,
    width: stack.width,
    wall: { R: wall.R.slice(), specular: wall.specular },
    floorR: floor.R.slice(),
    emitter: stack.emitter,
    coneDeg: 15,
    grid: { nx: 192, ny: 24, rx },
    section: { ny: 48, nz: 64, nx: 160 },
  };
}

export const STRIP_DEFAULT = {
  ledsPerM: 60,
  count: 54,
  wCct: 2900, // RGBWW 2700-3000 K
  flux: { r: 1.6, g: 3.2, b: 0.9, w: 6.0 }, // lm per LED at full drive (nominal SK6812 class)
  pwmHz: 1200, // measure! SR-PH-04
  barHeight: 30,
  barDepth: 25,
  endCap: 70, // mm of wood beyond the light zone at each end (controls end)
};

// ---------- colour helpers ----------

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
export function rgbToHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

// Approximate black-body colour (Tanner Helland fit), linear sRGB normalised to Y = 1.
export function kelvinToLinear(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const lin = [r, g, b].map((v) => srgbToLinear(Math.max(0, Math.min(255, v)) / 255));
  const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return lin.map((v) => v / Y);
}

// Per-channel emission vectors (linear sRGB, luminance-normalised so Y = lumens).
export function channelVectors(strip) {
  return {
    r: [1 / 0.2126, 0, 0].map((v) => v * strip.flux.r),
    g: [0, 1 / 0.7152, 0].map((v) => v * strip.flux.g),
    b: [0, 0, 1 / 0.0722].map((v) => v * strip.flux.b),
    w: kelvinToLinear(strip.wCct).map((v) => v * strip.flux.w),
  };
}
