// App glue: state, UI panels, simulation loop, charts.

import { DeviceScene, MOUNT_DEFAULT } from './scene.js';
import { OpticsSim } from './optics.js';
import { Controller, MODES, SHIPPED_PROGRAMMES, makeProgramme, ALTERNATING_MAX_HZ, rgbwForCct } from './controller.js';
import { SafetyLimiter, SAFETY_DEFAULTS, SIM_RATE, pwmAssessment } from './safety.js';
import {
  MATERIALS, WALLS, FLOORS, STACK_PRESETS, stackFromPreset, makeLayer, applyInk,
  STRIP_DEFAULT, channelVectors, srgbToLinear, linearToSrgb, rgbToHex, hexToRgb,
  SPECIES, FINISHES, EDGES, BACK_EXITS, normaliseStack, bodySize, backGeometry, stackDepth,
} from './materials.js';
import { linePlot, prepCanvas, heatMap } from './charts.js';
import { ROOM_DEFAULT, FIGURES } from './room.js';

const $ = (s) => document.querySelector(s);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

// ---------------- persistent state ----------------
const store = {
  load(k, d) {
    try {
      const v = localStorage.getItem('emdrtwin.' + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  save(k, v) {
    try {
      localStorage.setItem('emdrtwin.' + k, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  },
};

const savedStrip = store.load('strip', {});
const validStack = (s) => s && Array.isArray(s.layers) && s.layers.length && WALLS[s.wall] && FLOORS[s.floor];
const savedStacks = store.load('stacks', null);
const state = {
  strip: { ...STRIP_DEFAULT, ...savedStrip, flux: { ...STRIP_DEFAULT.flux, ...(savedStrip.flux || {}) } },
  stacks: {
    A: validStack(savedStacks?.A) ? normaliseStack(savedStacks.A) : stackFromPreset('proto_opal'),
    B: validStack(savedStacks?.B) ? normaliseStack(savedStacks.B) : stackFromPreset('resin_white_slot'),
  },
  compare: store.load('compare', true),
  editing: 'A',
  sim: { photons: 1_000_000, similarity: true, viewModel: 'cone', ...store.load('sim', {}) },
  view: { lux: 120, lref: 150, bloom: 0.4, camera: 'viewer', charts: false, ...store.load('view', {}) },
  safety: { ...SAFETY_DEFAULTS, ...store.load('safety', {}) },
  userProgrammes: store.load('programmes', []),
  cycle: store.load('cycle', ['Ambient warm', 'Desensitise 1.0 Hz', 'Resource / slow 0.3 Hz', 'Breathing 4-1-6-1']),
  // Room settings; earlier versions kept wall colour and floor under `view`.
  room: (() => {
    const v = store.load('view', {});
    return { ...ROOM_DEFAULT, ...(v.wallColor ? { wallColor: v.wallColor, sideColor: v.wallColor } : {}), ...(v.floor ? { floor: v.floor } : {}), ...store.load('room', {}) };
  })(),
  mount: { ...MOUNT_DEFAULT, ...store.load('mount', {}) },
  section: 'A',
  selected: null,
};
// One-time migration: the old default display white (300 cd/m²) made the room look dark.
if (store.load('viewVer', 0) < 2) {
  if (state.view.lref === 300) state.view.lref = 150;
  store.save('viewVer', 2);
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.save('strip', state.strip);
    store.save('stacks', state.stacks);
    store.save('compare', state.compare);
    store.save('sim', state.sim);
    store.save('view', state.view);
    store.save('safety', state.safety);
    store.save('programmes', state.userProgrammes);
    store.save('cycle', state.cycle);
    store.save('room', state.room);
    store.save('mount', state.mount);
  }, 400);
}

function allProgrammes() {
  const user = state.userProgrammes.map((p) => ({ ...p, _user: true }));
  const names = new Set(user.map((p) => p.name));
  return [...SHIPPED_PROGRAMMES.filter((p) => !names.has(p.name)), ...user];
}
const findProgramme = (name) => allProgrammes().find((p) => p.name === name);

// ---------------- core objects ----------------
const ctrl = new Controller(state.strip);
const lim = new SafetyLimiter(state.strip, state.safety);
ctrl.sensitive = state.safety.sensitive;
let vectors = channelVectors(state.strip);

function syncCycle() {
  ctrl.programmeList = state.cycle.map(findProgramme).filter(Boolean);
}
syncCycle();
state.selected = SHIPPED_PROGRAMMES[0].name;
ctrl.setProgramme(SHIPPED_PROGRAMMES[0], { fade: false });
ctrl.onProgrammeChange = (p) => {
  state.selected = p.name;
  renderProgTab();
};

const scene = new DeviceScene($('#viewport'));
scene.setMount(state.mount);
scene.onTouch = (id) => (id === 1 ? ctrl.touchOnOff() : ctrl.touchNext());
scene.onContextRestored = () => {
  rebuildScene();
  scene.setCamera(state.view.camera, state.safety.viewerDistance);
  window.__twinClear?.();
};
const optics = {
  A: new OpticsSim('A', (o) => onOptics('A', o)),
  B: new OpticsSim('B', (o) => onOptics('B', o)),
};

function barSpecs() {
  const specs = [{ stack: state.stacks.A, label: 'A · ' + state.stacks.A.label }];
  if (state.compare) specs.push({ stack: state.stacks.B, label: 'B · ' + state.stacks.B.label });
  return specs;
}
let rebuildTimer = null;
// Sliders fire on every step; rebuild the 3D bars once the value settles.
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuildScene, 150);
}
function rebuildScene() {
  clearTimeout(rebuildTimer);
  scene.build(state.strip, barSpecs());
  if (optics.A.ready) scene.setPsf(0, optics.A);
  if (state.compare && optics.B.ready) scene.setPsf(1, optics.B);
  scene.setLighting(state.view);
}
function onOptics(which, o) {
  const idx = which === 'A' ? 0 : 1;
  if (which === 'A' || state.compare) scene.setPsf(idx, o);
  drawPsfChart();
  drawSection();
  updateMetrics();
}
const runTimers = {};
function runOptics(which, delay = 0) {
  clearTimeout(runTimers[which]);
  runTimers[which] = setTimeout(() => {
    if (which === 'B' && !state.compare) return;
    const nW = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / (state.compare ? 2 : 1)) - 1);
    optics[which].run(state.stacks[which], { ...state.sim, workers: Math.min(6, nW) });
    updateMetrics();
  }, delay);
}

// ---------------- generic form controls ----------------
function rangeRow(label, obj, key, { min, max, step, unit = '', fmt, onChange, log } = {}) {
  const val = el('span', { class: 'val' });
  const toSlider = (v) => (log ? Math.log10(Math.max(v, 1e-9)) : v);
  const fromSlider = (v) => (log ? 10 ** v : v);
  const show = () => {
    const v = obj[key];
    val.textContent = (fmt ? fmt(v) : +(+v).toFixed(3)) + (unit ? ' ' + unit : '');
  };
  const input = el('input', {
    type: 'range',
    min: toSlider(min),
    max: toSlider(max),
    step: log ? 0.01 : step,
    value: toSlider(obj[key]),
    oninput: (e) => {
      let v = fromSlider(+e.target.value);
      if (log) v = +v.toPrecision(2);
      obj[key] = v;
      show();
      onChange?.(v);
    },
  });
  show();
  return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'ctl' }, input, val));
}
function selectRow(label, obj, key, options, onChange) {
  const s = el(
    'select',
    {
      onchange: (e) => {
        const raw = e.target.value;
        obj[key] = typeof obj[key] === 'number' ? +raw : raw;
        onChange?.(obj[key]);
      },
    },
    Object.entries(options).map(([v, l]) => el('option', { value: v, selected: String(obj[key]) === v }, l)),
  );
  return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'ctl' }, s));
}
function checkRow(label, obj, key, onChange, text = '') {
  const c = el('input', {
    type: 'checkbox',
    checked: !!obj[key],
    onchange: (e) => {
      obj[key] = e.target.checked;
      onChange?.(obj[key]);
    },
  });
  return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'ctl' }, c, el('span', { class: 'muted' }, text)));
}
function numberRow(label, obj, key, { step = 0.1, min, max, unit = '', onChange } = {}) {
  const i = el('input', {
    type: 'number', step, min, max, value: obj[key],
    onchange: (e) => {
      obj[key] = +e.target.value;
      onChange?.(obj[key]);
    },
  });
  return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'ctl' }, i, el('span', { class: 'muted' }, unit)));
}
// RGBW drive: colour picker (display sRGB, converted to linear PWM duty) + W slider.
function rgbwRow(label, arr, onChange) {
  const hex = rgbToHex(arr.slice(0, 3).map(linearToSrgb));
  const val = el('span', { class: 'val' }, 'W ' + arr[3].toFixed(2));
  const color = el('input', {
    type: 'color', value: hex,
    oninput: (e) => {
      const rgb = hexToRgb(e.target.value).map(srgbToLinear);
      arr[0] = rgb[0];
      arr[1] = rgb[1];
      arr[2] = rgb[2];
      onChange?.();
    },
  });
  const w = el('input', {
    type: 'range', min: 0, max: 1, step: 0.01, value: arr[3],
    oninput: (e) => {
      arr[3] = +e.target.value;
      val.textContent = 'W ' + arr[3].toFixed(2);
      onChange?.();
    },
  });
  return el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'ctl' }, color, w, val));
}

// ---------------- programme tab ----------------
const MODE_SCHEMA = {
  emdr: [
    ['speed', 'Speed', { min: 0.1, max: 2, step: 0.05, unit: 'cyc/s' }],
    ['profile', 'Motion profile', { options: { sine: 'Sinusoidal (slow at ends)', linear: 'Linear' } }],
    ['dwell', 'End dwell', { min: 0, max: 500, step: 10, unit: 'ms' }],
    ['size', 'Point size', { min: 1, max: 15, step: 0.5, unit: '% travel' }],
    ['render', 'Point rendering', { options: { aa: 'Anti-aliased flat top', gauss: 'Gaussian', nearest: 'Nearest LED (steps)' } }],
    ['color', 'Point colour', { rgbw: true }],
    ['brightness', 'Brightness', { min: 0, max: 1, step: 0.01 }],
    ['bgLevel', 'Background', { min: 0, max: 0.2, step: 0.005 }],
    ['bgColor', 'Background colour', { rgbw: true }],
    ['travel', 'Travel width', { min: 20, max: 100, step: 1, unit: '%' }],
    ['offset', 'Travel offset', { min: -50, max: 50, step: 1, unit: '%' }],
    ['mirror', 'Mirror direction', { check: true }],
    ['setMode', 'Set length by', { options: { duration: 'Duration', passes: 'Passes' } }],
    ['setSeconds', 'Set duration', { min: 5, max: 120, step: 1, unit: 's', show: (s) => s.setMode === 'duration' }],
    ['setPasses', 'Set passes', { min: 2, max: 200, step: 1, show: (s) => s.setMode === 'passes' }],
    ['task', 'Second task', { options: { off: 'Off', segments: 'Count coloured segments', point: 'Count point colour changes' } }],
    ['taskTarget', 'Client counts', { options: { all: 'Every cue', blue: 'Blue only', green: 'Green only', amber: 'Amber only', violet: 'Violet only' }, show: (s) => s.task !== 'off' }],
    ['taskPalette', 'Cue colours', { options: { bga: 'Blue, green, amber', bgav: 'Blue, green, amber, violet', ba: 'Blue, amber', white: 'White only' }, show: (s) => s.task !== 'off' }],
    ['taskRate', 'Cues per minute', { min: 2, max: 30, step: 1, unit: 'avg', show: (s) => s.task !== 'off' }],
    ['taskShow', 'Cue visible', { min: 200, max: 2000, step: 50, unit: 'ms', show: (s) => s.task !== 'off' }],
    ['taskFade', 'Cue fade', { min: 150, max: 800, step: 25, unit: 'ms', show: (s) => s.task !== 'off' }],
    ['taskWidth', 'Segment width', { min: 1, max: 10, step: 0.5, unit: '% bar', show: (s) => s.task === 'segments' }],
    ['taskPlace', 'Segment place', { options: { away: 'Away from the point', anywhere: 'Anywhere' }, show: (s) => s.task === 'segments' }],
    ['taskBrightness', 'Cue brightness', { min: 0.05, max: 1, step: 0.01, show: (s) => s.task === 'segments' }],
  ],
  alternating: [
    ['speed', 'Rate', { min: 0.1, max: 3, step: 0.05, unit: 'cyc/s' }],
    ['segment', 'Lit segment', { min: 2, max: 30, step: 1, unit: '%' }],
    ['rise', 'Soft rise/fall', { min: 0, max: 1, step: 0.05 }],
    ['color', 'Colour', { rgbw: true }],
    ['brightness', 'Brightness', { min: 0, max: 1, step: 0.01 }],
    ['setSeconds', 'Set duration', { min: 5, max: 120, step: 1, unit: 's' }],
  ],
  ambient: [
    ['useCct', 'Use colour temp.', { check: true }],
    ['cct', 'Colour temp.', { min: 2700, max: 6500, step: 100, unit: 'K', show: (s) => s.useCct }],
    ['color', 'Colour', { rgbw: true, show: (s) => !s.useCct }],
    ['brightness', 'Brightness', { min: 0, max: 1, step: 0.01 }],
    ['effect', 'Effect', { options: { solid: 'Solid', drift: 'Slow drift', gradient: 'Gradient' } }],
    ['color2', 'Second colour', { rgbw: true, show: (s) => s.effect !== 'solid' }],
    ['period', 'Drift period', { min: 30, max: 600, step: 5, unit: 's', show: (s) => s.effect === 'drift' }],
  ],
  clock: [
    ['minutes', 'Session', { min: 1, max: 180, step: 1, unit: 'min' }],
    ['keys', 'Colours', { keys: true }],
    ['interp', 'Milestone model', { options: { gradient: 'Continuous gradient', steps: 'Steps (A<30 %, B<60 %, C)' } }],
    ['stepFade', 'Step cross-fade', { min: 5, max: 300, step: 5, unit: 's', show: (s) => s.interp === 'steps' }],
    ['encode', 'Also encode by', { options: { colour: 'Colour only', fill: 'Fill level (SR-CV-01)', brightness: 'Brightness' } }],
    ['warnMin', 'Warn last', { min: 1, max: 15, step: 1, unit: 'min' }],
    ['warnMode', 'Warning', { options: { discreet: 'Discreet (therapist only)', overt: 'Overt (everyone)' } }],
    ['brightness', 'Brightness', { min: 0, max: 1, step: 0.01 }],
  ],
  breathing: [
    ['inhale', 'Inhale', { min: 1, max: 10, step: 0.5, unit: 's' }],
    ['hold1', 'Hold (full)', { min: 0, max: 10, step: 0.5, unit: 's' }],
    ['exhale', 'Exhale', { min: 1, max: 12, step: 0.5, unit: 's' }],
    ['hold2', 'Hold (empty)', { min: 0, max: 10, step: 0.5, unit: 's' }],
    ['style', 'Style', { options: { width: 'Expand from centre', brightness: 'Brightness' } }],
    ['min', 'Minimum', { min: 0, max: 0.5, step: 0.01 }],
    ['colorMode', 'Colour', { options: { single: 'One colour', follow: 'Blend with the breath', phase: 'Inhale colour / exhale colour' } }],
    ['color', 'Colour', { rgbw: true, show: (s) => s.colorMode === 'single' }],
    ['colorIn', 'Inhale colour', { rgbw: true, show: (s) => s.colorMode !== 'single' }],
    ['colorOut', 'Exhale colour', { rgbw: true, show: (s) => s.colorMode !== 'single' }],
    ['colorFade', 'Colour change', { min: 0.3, max: 4, step: 0.1, unit: 's', show: (s) => s.colorMode === 'phase' }],
    ['brightness', 'Brightness', { min: 0, max: 1, step: 0.01 }],
  ],
  music: [
    ['source', 'Source', { options: { synth: 'Synthetic test track', mic: 'Microphone (local only)' } }],
    ['effect', 'Effect', { options: { vu: 'Level from centre', bands: 'Bass / mid / treble zones', pulse: 'Beat pulse (whole bar)' } }],
    ['sensitivity', 'Sensitivity', { min: 0.2, max: 3, step: 0.05 }],
    ['bpm', 'Synthetic BPM', { min: 60, max: 180, step: 1, show: (s) => s.source === 'synth' }],
    ['color', 'Colour', { rgbw: true, show: (s) => s.effect !== 'bands' }],
    ['brightness', 'Brightness', { min: 0, max: 1, step: 0.01 }],
  ],
};

function modeForm(mode) {
  const box = el('div');
  const sect = ctrl.programme[mode];
  const rebuild = () => box.replaceWith(modeForm(mode));
  if (mode === 'custom') {
    const ta = el('textarea', { spellcheck: 'false' });
    ta.value = sect.code;
    const apply = () => {
      sect.code = ta.value;
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
    });
    box.append(
      el('div', { class: 'hint' }, 'Function body, run per LED at 120 Hz. Arguments: i (index), n (count), x (0..1), t (s since programme start), s (state object). Return [r, g, b, w], each 0..1. The firmware limiter still applies.'),
      ta,
      el('div', { class: 'btnrow' }, el('button', { class: 'btn primary small', onclick: apply }, 'Apply (Ctrl+Enter)')),
      el('div', { class: 'err', id: 'customErr' }),
    );
    return box;
  }
  for (const [key, label, opt] of MODE_SCHEMA[mode]) {
    if (opt.show && !opt.show(sect)) continue;
    if (opt.rgbw) box.append(rgbwRow(label, sect[key]));
    else if (opt.keys) ['Start', '30 %', '60 %', '100 %'].forEach((l, i) => box.append(rgbwRow(`${label} ${l}`, sect.keys[i])));
    else if (opt.options) box.append(selectRow(label, sect, key, opt.options, (v) => {
      if (mode === 'music' && key === 'source') v === 'mic' ? startMic() : stopMic();
      rebuild();
    }));
    else if (opt.check) box.append(checkRow(label, sect, key, rebuild));
    else box.append(rangeRow(label, sect, key, { ...opt, onChange: () => updateGeometry() }));
  }
  if (mode === 'emdr') box.append(el('div', { class: 'hint', id: 'emdrInfo' }));
  if (mode === 'emdr' && sect.task !== 'off') box.append(el('div', { class: 'hint' }, 'Dual attention: cues appear at random times while the point moves, and the client counts them. The answer key is in the status bar (hover for the colour breakdown) and in the Safety event log when the set ends. Firmware limits: at least 1.5 s between cues and at least 150 ms fade, so a cue is never a hard flash.'));
  if (mode === 'alternating') box.append(el('div', { class: 'hint' }, `Firmware caps the rate at ${ALTERNATING_MAX_HZ} cycles/s (3 transitions/s). Disabled in the sensitive profile.`));
  if (mode === 'clock') box.append(el('div', { class: 'hint' }, 'Start the clock in the top bar. Use the ×60 or ×300 time scale to see a whole session in minutes. The clock keeps running during EMDR sets (FR-CL-07).'));
  if (mode === 'music') box.append(el('div', { class: 'hint' }, 'Microphone audio is analysed in this browser only, never recorded or sent (FR-MU-03). Disabled in the sensitive profile.'));
  return box;
}

// Set, clock and client profile: operator controls that used to sit in the header.
function sessionBlock() {
  const clockSpeed = { v: ctrl.clock.timeScale };
  return el(
    'div',
    { class: 'session' },
    el('div', { class: 'btnrow' },
      el('button', { class: 'btn primary small', onclick: () => ctrl.startSet(), title: 'EMDR and alternating modes' }, 'Start set'),
      el('button', { class: 'btn small', id: 'btnSetPause', onclick: () => ctrl.pauseSet() }, 'Pause set'),
      el('button', { class: 'btn small', onclick: () => ctrl.stopSet(), title: 'Fades out in 0.8 s. Esc = STOP and power off.' }, 'Stop set'),
    ),
    el('div', { class: 'btnrow' },
      el('button', { class: 'btn small', id: 'btnClockRun', onclick: () => (ctrl.clock.started ? ctrl.clockPause() : ctrl.clockStart()) }, 'Start clock'),
      el('button', { class: 'btn small', onclick: () => ctrl.clockReset() }, 'Reset clock'),
      el('select', { title: 'Session clock acceleration (clock only)', onchange: (e) => (ctrl.clock.timeScale = +e.target.value) },
        [1, 10, 60, 300].map((v) => el('option', { value: v, selected: clockSpeed.v === v }, v === 1 ? 'clock ×1' : `clock ×${v}`))),
    ),
    checkRow('Sensitive client', state.safety, 'sensitive', (v) => setSensitive(v), 'SR-PH-05 profile'),
  );
}

function renderProgTab() {
  const tab = $('#tab-prog');
  tab.replaceChildren();
  tab.append(sessionBlock());
  const p = ctrl.programme;
  // Library.
  const lib = el('div', { class: 'lib' });
  for (const q of allProgrammes()) {
    const inCycle = state.cycle.includes(q.name);
    lib.append(
      el(
        'div',
        {
          class: 'lib-item' + (q.name === state.selected ? ' sel' : ''),
          onclick: (e) => {
            if (e.target.type === 'checkbox') return;
            state.selected = q.name;
            ctrl.setProgramme(q);
            if (q.mode === 'music' && q.music.source === 'mic') startMic();
            renderProgTab();
          },
        },
        el('input', {
          type: 'checkbox', checked: inCycle, title: 'Include in the touch-2 "next programme" cycle',
          onchange: (e) => {
            if (e.target.checked) state.cycle.push(q.name);
            else state.cycle = state.cycle.filter((n) => n !== q.name);
            syncCycle();
            persist();
          },
        }),
        el('span', {}, q.name),
        el('span', { class: 'tag' }, (q._user ? 'user · ' : '') + q.mode),
      ),
    );
  }
  const fileIn = el('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: importProgrammes });
  tab.append(
    el('h3', {}, 'Programme library'),
    el('div', { class: 'hint' }, 'Click to load. Ticked programmes form the touch-2 cycle (FR-UI-08).'),
    lib,
    el(
      'div',
      { class: 'btnrow' },
      el('button', { class: 'btn small', onclick: () => saveProgramme(false) }, 'Save'),
      el('button', { class: 'btn small', onclick: () => saveProgramme(true) }, 'Save as…'),
      el('button', { class: 'btn small', onclick: deleteProgramme }, 'Delete'),
      el('button', { class: 'btn small', onclick: exportProgrammes }, 'Export'),
      el('button', { class: 'btn small', onclick: () => fileIn.click() }, 'Import'),
      fileIn,
    ),
    el('h3', {}, 'Current programme'),
    el('div', { class: 'row' }, el('label', {}, 'Name'), el('div', { class: 'ctl' }, el('input', { type: 'text', value: p.name, style: 'width:100%', oninput: (e) => (p.name = e.target.value) }))),
    selectRow('Mode', p, 'mode', MODES, () => {
      ctrl.setProgramme(ctrl.programme);
      if (ctrl.programme.mode === 'music' && ctrl.programme.music.source === 'mic') startMic();
      renderProgTab();
    }),
    rangeRow('Transition', p, 'transition', { min: 0, max: 5, step: 0.1, unit: 's' }),
    el('h3', {}, MODES[p.mode]),
    modeForm(p.mode),
  );
}

function saveProgramme(asNew) {
  const p = structuredClone(ctrl.programme);
  if (asNew) {
    const name = prompt('Programme name', p.name + ' (copy)');
    if (!name) return;
    p.name = name;
    ctrl.programme.name = name;
  }
  const i = state.userProgrammes.findIndex((q) => q.name === p.name);
  if (i >= 0) state.userProgrammes[i] = p;
  else state.userProgrammes.push(p);
  state.selected = p.name;
  syncCycle();
  persist();
  renderProgTab();
}
function deleteProgramme() {
  const i = state.userProgrammes.findIndex((q) => q.name === state.selected);
  if (i < 0) return alert('Only user programmes can be deleted. Shipped programmes stay.');
  state.userProgrammes.splice(i, 1);
  state.cycle = state.cycle.filter((n) => n !== state.selected);
  syncCycle();
  persist();
  renderProgTab();
}
function exportProgrammes() {
  const data = { format: 'emdr-twin-programmes', version: 1, cycle: state.cycle, programmes: [...state.userProgrammes, structuredClone(ctrl.programme)] };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'emdr-programmes.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importProgrammes(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.programmes ?? [data];
    for (const raw of list) {
      const p = makeProgramme(raw);
      const i = state.userProgrammes.findIndex((q) => q.name === p.name);
      if (i >= 0) state.userProgrammes[i] = p;
      else state.userProgrammes.push(p);
    }
    if (Array.isArray(data.cycle)) state.cycle = data.cycle;
    syncCycle();
    persist();
    renderProgTab();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
}

// ---------------- diffuser tab ----------------
function renderDiffTab() {
  const tab = $('#tab-diff');
  tab.replaceChildren();
  const which = state.editing;
  const st = state.stacks[which];
  const changed = ({ rebuild = false } = {}) => {
    st.presetId = null;
    if (!st.label.endsWith('(edited)')) st.label += ' (edited)';
    persist();
    if (rebuild) scheduleRebuild();
    runOptics(which, 500);
  };
  const seg = el(
    'div',
    { class: 'seg' },
    ['A', 'B'].map((k) =>
      el('button', { class: k === which ? 'active' : '', onclick: () => ((state.editing = k), renderDiffTab()) }, `Edit ${k}`),
    ),
  );
  const presetSel = el(
    'select',
    {
      onchange: (e) => {
        if (!e.target.value) return;
        // Optical presets keep the current housing and rear light unless they define their own.
        const prev = state.stacks[which];
        const pre = STACK_PRESETS.find((p) => p.id === e.target.value);
        const next = stackFromPreset(e.target.value);
        if (!pre?.housing) next.housing = { ...prev.housing };
        if (!pre?.back) next.back = { ...prev.back };
        state.stacks[which] = next;
        persist();
        rebuildScene();
        runOptics(which);
        renderDiffTab();
      },
    },
    el('option', { value: '' }, 'Load preset…'),
    STACK_PRESETS.map((s) => el('option', { value: s.id }, s.label)),
  );
  tab.append(
    el('h3', {}, 'Comparison'),
    checkRow('Compare A / B', state, 'compare', () => {
      persist();
      rebuildScene();
      if (state.compare) runOptics('B');
      else optics.B.stop();
      renderDiffTab();
    }, 'second bar below'),
    el('div', { class: 'btnrow' }, seg),
    el('h3', {}, `Stack ${which}: ${st.label}`),
    el('div', { class: 'row' }, el('label', {}, 'Preset'), el('div', { class: 'ctl' }, presetSel)),
    rangeRow('Face width', st, 'width', { min: 4, max: 30, step: 0.5, unit: 'mm', onChange: () => changed({ rebuild: true }) }),
    selectRow('Groove walls', st, 'wall', Object.fromEntries(Object.entries(WALLS).map(([k, v]) => [k, v.label])), () => changed({ rebuild: true })),
    selectRow('LED carrier', st, 'floor', Object.fromEntries(Object.entries(FLOORS).map(([k, v]) => [k, v.label])), () => changed()),
    rangeRow('Emitter size', st, 'emitter', { min: 0.5, max: 5, step: 0.1, unit: 'mm', onChange: () => changed() }),
    el('h3', {}, 'Layers'),
    el('div', { class: 'stack-end' }, '▲ viewer side (face)'),
  );
  const matOptions = Object.entries(MATERIALS).map(([k, v]) => [k, v.label]);
  [...st.layers].reverse().forEach((layer) => {
    const idx = st.layers.indexOf(layer);
    const m = MATERIALS[layer.materialId];
    const adv = el('div', { class: 'adv' });
    const advField = (k, lab, step) =>
      adv.append(el('label', {}, lab, el('input', { type: 'number', step, value: +(+layer[k]).toPrecision(4), onchange: (e) => ((layer[k] = +e.target.value), changed()) })));
    advField('n', 'n', 0.01);
    advField('mus', 'μs [1/mm]', 0.1);
    advField('g', 'g', 0.05);
    advField('muaR', 'μa R', 0.001);
    advField('muaG', 'μa G', 0.001);
    advField('muaB', 'μa B', 0.001);
    const head = el(
      'div',
      { class: 'layer-head' },
      el(
        'select',
        {
          onchange: (e) => {
            st.layers[idx] = makeLayer(e.target.value, layer.t);
            changed({ rebuild: true });
            renderDiffTab();
          },
        },
        matOptions.map(([k, l]) => el('option', { value: k, selected: k === layer.materialId }, l)),
      ),
      el('input', { type: 'number', step: 0.1, min: 0.05, value: layer.t, title: 'Thickness (mm)', onchange: (e) => ((layer.t = Math.max(0.05, +e.target.value)), changed({ rebuild: true })) }),
      el('span', { class: 'muted' }, 'mm'),
      el('button', { class: 'mini', title: 'Move toward face', onclick: () => moveLayer(idx, 1) }, '↑'),
      el('button', { class: 'mini', title: 'Move toward LED', onclick: () => moveLayer(idx, -1) }, '↓'),
      el('button', { class: 'mini', title: 'Remove', onclick: () => { if (st.layers.length > 1) { st.layers.splice(idx, 1); changed({ rebuild: true }); renderDiffTab(); } } }, '✕'),
    );
    const box = el('div', { class: 'layer' }, head);
    if (m.ink) {
      box.append(
        rangeRow(m.inkUnit ? `Pigment ${m.inkUnit}` : 'Ink drops/100 ml', layer, 'ink', {
          min: 0, max: m.inkUnit ? 10 : 30, step: 0.5,
          onChange: () => {
            applyInk(layer);
            changed();
          },
        }),
      );
    }
    box.append(el('details', {}, el('summary', {}, `n ${layer.n} · μs ${(+layer.mus).toFixed(2)}/mm · g ${layer.g}`), adv));
    tab.append(box);
  });
  const moveLayer = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= st.layers.length) return;
    [st.layers[i], st.layers[j]] = [st.layers[j], st.layers[i]];
    changed();
    renderDiffTab();
  };
  tab.append(
    el('div', { class: 'stack-end' }, '▼ LED strip / PCB'),
    el('div', { class: 'btnrow' }, el('button', { class: 'btn small', onclick: () => { st.layers.push(makeLayer('epoxy_clear', 2)); changed({ rebuild: true }); renderDiffTab(); } }, '+ Add layer at face')),
    el('h3', {}, 'Light transport (Monte Carlo)'),
    selectRow('Photons', state.sim, 'photons', { 250000: '250 k (quick)', 1000000: '1 M', 4000000: '4 M', 10000000: '10 M (slow)' }, () => { persist(); runOptics('A'); runOptics('B'); }),
    checkRow('Fast scattering', state.sim, 'similarity', () => { persist(); runOptics('A'); runOptics('B'); }, 'similarity μs′ = μs(1−g)'),
    selectRow('Viewer model', state.sim, 'viewModel', { cone: 'On-axis radiance (15° cone)', lambert: 'Lambertian from exitance' }, (v) => {
      persist();
      optics.A.setViewModel(v);
      optics.B.setViewModel(v);
    }),
    el('div', { class: 'btnrow' }, el('button', { class: 'btn primary small', onclick: () => { runOptics('A'); runOptics('B'); } }, 'Re-run')),
    el('div', { class: 'progress', id: 'progA' }, el('div')),
    el('div', { class: 'progress b', id: 'progB' }, el('div')),
    el('h3', {}, 'Results'),
    el('div', { id: 'metrics' }),
    el('div', { class: 'hint' }, 'Coefficients are nominal. To calibrate: cast a sample, photograph one lit LED through it, then tune μs (or ink dose) until the FWHM matches. Tune μa until light output matches a lux reading.'),
  );
  updateMetrics();
}

function fmtPct(v) {
  return (v * 100).toFixed(0) + ' %';
}
let lastPointPeak = { A: 0, B: 0 };
function updateMetrics() {
  const box = $('#metrics');
  const pitch = 1000 / state.strip.ledsPerM;
  for (const k of ['A', 'B']) {
    const bar = $('#prog' + k + ' > div');
    if (!bar) continue;
    const o = optics[k];
    const show = k === 'A' || state.compare;
    bar.parentElement.style.display = show ? '' : 'none';
    const n = o.acc?.photons ?? 0;
    bar.style.width = o.target ? Math.min(100, (100 * n) / o.target) + '%' : '0';
  }
  if (!box) return;
  const mA = optics.A.metrics(pitch);
  const mB = state.compare ? optics.B.metrics(pitch) : null;
  const cols = state.compare ? ['A', 'B'] : ['A'];
  const ms = { A: mA, B: mB };
  const cap = state.safety.maxBrightness;
  const rows = [
    ['Photons', (m) => (m.photons / 1e6).toFixed(2) + ' M' + (m.done ? '' : ' …')],
    ['Light out', (m) => fmtPct(m.efficiency)],
    ['Absorbed: volume', (m) => fmtPct(m.absVolume)],
    ['Absorbed: walls', (m) => fmtPct(m.absWall)],
    ['Absorbed: LED PCB', (m) => fmtPct(m.absFloor)],
    ['Exit tint R:G:B', (m) => m.tint.map((v) => v.toFixed(2)).join(':')],
    ['Spot FWHM', (m) => `${m.fwhm.toFixed(1)} mm`],
    ['FWHM / LED pitch', (m) => (m.fwhm / pitch).toFixed(2)],
    ['Uniformity along', (m) => `<span class="${m.uniformity >= 0.7 ? 'pass' : 'fail'}">${fmtPct(m.uniformity)}</span>`],
    ['Uniformity across', (m) => fmtPct(m.crossUniformity)],
    ['Full white (W=1)', (m) => `${(m.uniformPeak * state.strip.flux.w).toFixed(0)} cd/m²`],
    [`At cap (${cap})`, (m) => `${(m.uniformPeak * state.strip.flux.w * cap).toFixed(0)} cd/m²`],
    ['Point peak, live', (m, k) => `${lastPointPeak[k].toFixed(0)} cd/m²`],
    ['Exit within 30°', (m) => fmtPct(m.angular.slice(0, 6).reduce((a, v) => a + v, 0))],
  ];
  const html = [
    '<table class="metrics"><tr><th></th>' + cols.map((c) => `<th class="${c}">${c}</th>`).join('') + '</tr>',
    ...rows.map(([label, f]) => `<tr><td>${label}</td>` + cols.map((c) => `<td>${ms[c] ? f(ms[c], c) : '…'}</td>`).join('') + '</tr>'),
    '</table>',
    '<div class="hint">Uniformity along = min/max of the centre line with all LEDs equal (NF-PH-03 target ≥ 70 %).</div>',
  ].join('');
  box.innerHTML = html;
}

// ---------------- strip & view tab ----------------
// ---------------- housing tab ----------------
// Epoxy fill options for the routed cavity. Each one rewrites the optical layers.
const FILLS = {
  ink: 'Epoxy + white alcohol ink',
  pigment: 'Epoxy + white pigment (TiO2)',
  clear: 'Clear epoxy (strip visible)',
  opal_clear: 'Opal insert, clear epoxy cap',
  air_opal: 'Air + opal cover (no epoxy)',
};
function fillLayers(type, depth, dose) {
  const cap = Math.min(3, depth * 0.3);
  switch (type) {
    case 'pigment': return [makeLayer('epoxy_pigment', depth, dose)];
    case 'clear': return [makeLayer('epoxy_clear', depth)];
    case 'opal_clear': return [makeLayer('air', Math.max(0.5, depth - cap - 1.5)), makeLayer('pc_opal', 1.5), makeLayer('epoxy_clear', cap)];
    case 'air_opal': return [makeLayer('air', Math.max(0.5, depth - 1.5)), makeLayer('pc_opal', 1.5)];
    default: return [makeLayer('epoxy_ink', depth, dose)];
  }
}
function guessFill(st) {
  const ids = st.layers.map((l) => l.materialId).join(',');
  const known = { epoxy_ink: 'ink', epoxy_pigment: 'pigment', epoxy_clear: 'clear', 'air,pc_opal,epoxy_clear': 'opal_clear', 'air,pc_opal': 'air_opal' };
  const ink = st.layers.find((l) => l.ink !== undefined)?.ink;
  return { type: known[ids] ?? 'custom', depth: +stackDepth(st).toFixed(1), dose: ink ?? 3 };
}
const LININGS = { wood: 'Bare wood (same species)', alu_white: 'White paint', alu_spec: 'Aluminium foil / channel', black: 'Black' };
const BEAMS = { 1: 'Diffuse (Lambertian)', 3: 'Medium (≈ 90° beam)', 10: 'Narrow (≈ 40° beam)' };

// Mounting applies to the whole device (both bars in compare mode).
function mountChanged() {
  persist();
  scene.setMount(state.mount);
  rebuildScene();
  applyRoom(true);
  scene.setCamera(state.view.camera, state.safety.viewerDistance);
}

function renderHousingTab() {
  const tab = $('#tab-housing');
  tab.replaceChildren();
  const which = state.editing;
  const st = state.stacks[which];
  const hs = st.housing;
  const bk = st.back;
  const edited = () => {
    st.presetId = null;
    if (!st.label.endsWith('(edited)')) st.label += ' (edited)';
  };
  // Visual-only changes rebuild the bars; optical ones also re-run Monte Carlo.
  const visual = () => {
    edited();
    persist();
    scheduleRebuild();
    housingInfo();
  };
  const optical = () => {
    visual();
    runOptics(which, 500);
  };
  const lining = { v: st.wall.startsWith('wood_') ? 'wood' : st.wall };
  const setLining = () => {
    st.wall = lining.v === 'wood' ? SPECIES[hs.species].wall : lining.v;
  };
  const fill = guessFill(st);
  const applyFill = () => {
    if (fill.type === 'custom') return;
    st.layers = fillLayers(fill.type, fill.depth, fill.dose);
    optical();
  };
  const seg = el(
    'div',
    { class: 'seg' },
    ['A', 'B'].map((k) => el('button', { class: k === which ? 'active' : '', onclick: () => ((state.editing = k), renderHousingTab()) }, `Edit ${k}`)),
  );
  const backRows = el('div');
  const renderBack = () => {
    backRows.replaceChildren();
    if (bk.mode === 'off') return;
    backRows.append(
      selectRow('Light exits', bk, 'exit', BACK_EXITS, () => { visual(); renderBack(); }),
      selectRow('Beam', bk, 'beam', BEAMS, visual),
    );
    if (bk.mode === 'slot') {
      backRows.append(
        rangeRow('Sent back', bk, 'fraction', { min: 0, max: 0.6, step: 0.01, fmt: (v) => fmtPct(v), onChange: () => persist() }),
        rangeRow('Escapes body', bk, 'efficiency', { min: 0.1, max: 1, step: 0.05, fmt: (v) => fmtPct(v), onChange: () => persist() }),
        el('div', { class: 'hint' }, 'Same LEDs as the face. "Sent back" is the share of each LED\'s light that goes backwards (for example through a translucent carrier or a gap behind the strip); the face loses the same share. "Escapes body" is how much of it gets out of the wood. Measure both on a sample and enter them here.'),
      );
    } else {
      backRows.append(selectRow('Rear strip drive', bk, 'drive', { follow: 'Follow the face', steady: 'Steady glow', steady_dim: 'Steady, dims during sets' }, () => { persist(); renderBack(); }));
      if (bk.drive === 'follow') backRows.append(rangeRow('Rear level', bk, 'gain', { min: 0, max: 1, step: 0.05, fmt: (v) => fmtPct(v) + ' of face', onChange: () => persist() }));
      else {
        backRows.append(
          rangeRow('Rear level', bk, 'level', { min: 0, max: 1, step: 0.01, fmt: (v) => fmtPct(v), onChange: () => persist() }),
          rangeRow('Colour temperature', bk, 'cct', { min: 2200, max: 6500, step: 100, unit: 'K', onChange: () => persist() }),
        );
        if (bk.drive === 'steady_dim') backRows.append(rangeRow('During a set', bk, 'dimTo', { min: 0, max: 1, step: 0.05, fmt: (v) => fmtPct(v) + ' of level', onChange: () => persist() }));
        backRows.append(el('div', { class: 'hint' }, 'A separate rear-facing strip of the same LED type. Level changes fade over about 1 s. The brightness cap from the Safety tab still applies.'));
      }
    }
    if (bk.exit === 'rear' && hs.standoff < 8) backRows.append(el('div', { class: 'hint warn' }, 'With the bar this close to the wall, the light behind it stays hidden. Increase the standoff to 10–30 mm to see a halo.'));
  };
  renderBack();
  tab.append(
    el('div', { class: 'btnrow' }, seg),
    el('h3', {}, `Housing ${which}: ${st.label}`),
    el('h3', {}, 'Exploded view'),
    el('div', { class: 'row' }, el('label', {}, 'Take apart'), el('div', { class: 'ctl' },
      el('input', { type: 'range', id: 'explodeRange', min: 0, max: 1, step: 0.01, value: explode.amount, oninput: (e) => setExplode(+e.target.value) }),
      el('button', { class: 'btn small', onclick: () => setExplode(1, { moveCamera: true }) }, 'Show inside'))),
    el('h3', {}, 'Wood'),
    selectRow('Species', hs, 'species', Object.fromEntries(Object.entries(SPECIES).map(([k, v]) => [k, v.label])), () => {
      if (lining.v === 'wood') {
        setLining();
        optical();
      } else visual();
    }),
    selectRow('Finish', hs, 'finish', FINISHES, visual),
    selectRow('Front edges', hs, 'edge', EDGES, visual),
    rangeRow('Edge size', hs, 'edgeR', { min: 0, max: 10, step: 0.5, unit: 'mm', onChange: visual }),
    rangeRow('Wood above / below window', hs, 'rail', { min: 3, max: 40, step: 0.5, unit: 'mm', onChange: visual }),
    rangeRow('Wood behind strip', hs, 'back', { min: 2, max: 30, step: 0.5, unit: 'mm', onChange: visual }),
    el('h3', {}, 'Cavity and epoxy fill'),
    rangeRow('Window width', st, 'width', { min: 4, max: 30, step: 0.5, unit: 'mm', onChange: optical }),
    selectRow('Fill', fill, 'type', fill.type === 'custom' ? { custom: 'Custom (edit in Diffuser tab)', ...FILLS } : FILLS, applyFill),
    rangeRow('Cavity depth', fill, 'depth', { min: 3, max: 40, step: 0.5, unit: 'mm', onChange: applyFill }),
    rangeRow('Ink / pigment dose', fill, 'dose', { min: 0, max: 20, step: 0.5, fmt: (v) => `${v} ${fill.type === 'pigment' ? '‰ w/w' : 'drops/100 ml'}`, onChange: applyFill }),
    selectRow('Cavity walls', lining, 'v', LININGS, () => { setLining(); optical(); }),
    el('div', { class: 'hint' }, 'Fill, depth, dose and walls change the optics (Monte Carlo re-runs). Species also does when the cavity walls are bare wood. Layer details are in the Diffuser tab.'),
    el('h3', {}, 'Mounting (whole device)'),
    selectRow('Mount', state.mount, 'type', { wall: 'On the wall', tripod: 'On a tripod' }, () => { mountChanged(); renderHousingTab(); }),
    ...(state.mount.type === 'wall'
      ? [rangeRow('Standoff from wall', hs, 'standoff', { min: 0, max: 50, step: 1, unit: 'mm', onChange: () => { visual(); renderBack(); } })]
      : [
          rangeRow('Distance from wall', state.mount, 'dist', { min: 0.3, max: 2.5, step: 0.05, unit: 'm', onChange: mountChanged }),
          rangeRow('Height (centre)', state.mount, 'height', { min: 0.8, max: 1.8, step: 0.01, unit: 'm', onChange: mountChanged }),
        ]),
    selectRow('Power cable', state.mount, 'cable', { visible: 'USB-C cable to a wall adaptor', concealed: 'Concealed in the wall', off: 'Hide' }, mountChanged),
    rangeRow('Tilt', state.mount, 'tilt', { min: -10, max: 30, step: 1, fmt: (v) => (v === 0 ? 'none' : `${v}° ${v > 0 ? 'face down' : 'face up'}`), onChange: mountChanged }),
    rangeRow('Rotation', state.mount, 'roll', { min: -45, max: 45, step: 1, fmt: (v) => (v === 0 ? 'level' : `${Math.abs(v)}° ${v > 0 ? 'right end up' : 'left end up'}`), onChange: mountChanged }),
    el('div', { class: 'hint' }, 'Tilt turns the face down toward a seated client. Rotation puts the bar on a diagonal, for diagonal eye movements. On a tripod the client chair moves with the device and keeps the viewer distance.'),
    el('h3', {}, 'Rear light onto the wall'),
    selectRow('Source', bk, 'mode', { off: 'Off', slot: 'Share of the face LEDs', strip: 'Separate rear strip' }, () => { visual(); renderBack(); }),
    backRows,
    el('div', { class: 'hint', id: 'housingInfo' }),
  );
  housingInfo();
}
function housingInfo() {
  const box = $('#housingInfo');
  if (!box) return;
  const st = state.stacks[state.editing];
  const { H, D } = bodySize(st);
  const h = haloEstimate(state.editing === 'A' ? 0 : 1);
  box.textContent =
    `Body ${H.toFixed(1)} × ${D.toFixed(1)} mm (height × depth), cavity ${st.width} × ${stackDepth(st).toFixed(1)} mm.` +
    (st.back.mode === 'off' ? '' : ` Wall halo now: peak ${h.peak.toFixed(1)} cd/m², ${h.at}.`);
}

// Rear-light drive per bar, recomputed every frame. Steady levels fade (τ ≈ 1 s).
const backState = [{ level: 0 }, { level: 0 }];
const cctCache = new Map();
function steadyLm(cct, level) {
  const key = state.strip.wCct + '|' + cct;
  if (!cctCache.has(key)) cctCache.set(key, rgbwForCct(state.strip, cct));
  const d = cctCache.get(key);
  const V = vectors;
  return [0, 1, 2].map((k) => level * (d[0] * V.r[k] + d[1] * V.g[k] + d[2] * V.b[k] + d[3] * V.w[k]));
}
function backDrive(idx, dt) {
  const st = idx === 0 ? state.stacks.A : state.stacks.B;
  const b = st.back;
  const bs = backState[idx];
  if (b.mode === 'slot') return { follow: b.fraction * b.efficiency, front: 1 - b.fraction, steady: [0, 0, 0] };
  if (b.mode !== 'strip') return { follow: 0, front: 1, steady: [0, 0, 0] };
  if (b.drive === 'follow') return { follow: b.gain, front: 1, steady: [0, 0, 0] };
  const on = ctrl.power ? 1 : 0;
  const inSet = ctrl.set.state === 'running' || ctrl.set.state === 'paused';
  const target = on * Math.min(b.level, state.safety.maxBrightness) * (b.drive === 'steady_dim' && inSet ? b.dimTo : 1);
  bs.level += (target - bs.level) * (1 - Math.exp(-dt / 1.0));
  return { follow: 0, front: 1, steady: steadyLm(b.cct, bs.level) };
}
const lastBack = [{ follow: 0, front: 1, steady: [0, 0, 0] }, { follow: 0, front: 1, steady: [0, 0, 0] }];

// CPU estimate of the wall halo luminance (same model as the shader), for read-outs.
function haloEstimate(idx) {
  const st = idx === 0 ? state.stacks.A : state.stacks.B;
  if (st.back.mode === 'off') return { peak: 0, at: '—' };
  return scene.haloPeak(idx, lastEmission, scene.wallReflectance());
}

// ---------------- room tab ----------------
// Wall paints: label, sRGB colour. Light reflectance is shown next to the picker.
const PAINTS = {
  warm_white: ['Warm white', '#ece6dc'],
  soft_grey: ['Soft grey', '#c9c7c2'],
  greige: ['Greige', '#bfb3a2'],
  sage: ['Sage green', '#a9b29a'],
  dusty_blue: ['Dusty blue', '#8fa3b0'],
  terracotta: ['Terracotta', '#b9785e'],
  deep_green: ['Deep green', '#3f5247'],
  charcoal: ['Charcoal', '#4a4a4a'],
  custom: ['Custom colour', null],
};
const FABRICS = { '#8f8577': 'Warm grey', '#6d7a6a': 'Sage', '#7a8794': 'Slate blue', '#a98e6e': 'Camel', '#5b4a44': 'Brown' };
const lrvOf = (hex) => {
  const c = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
let roomTimer = null;
function applyRoom(now = false) {
  persist();
  clearTimeout(roomTimer);
  const go = () => scene.setRoom(state.room, state.safety.viewerDistance);
  if (now) go();
  else roomTimer = setTimeout(go, 120);
}
function paintRows(label, key) {
  const r = state.room;
  const pk = Object.keys(PAINTS).find((k) => PAINTS[k][1] === r[key]) ?? 'custom';
  const note = el('span', { class: 'muted' }, `reflects ${(lrvOf(r[key]) * 100).toFixed(0)} %`);
  return [
    selectRow(label, { v: pk }, 'v', Object.fromEntries(Object.entries(PAINTS).map(([k, v]) => [k, v[0]])), (v) => {
      if (v !== 'custom') r[key] = PAINTS[v][1];
      applyRoom();
      renderRoomTab();
    }),
    el('div', { class: 'row' }, el('label', {}, ''), el('div', { class: 'ctl' },
      el('input', { type: 'color', value: r[key], oninput: (e) => { r[key] = e.target.value; note.textContent = `reflects ${(lrvOf(r[key]) * 100).toFixed(0)} %`; applyRoom(); } }),
      note)),
  ];
}
function renderRoomTab() {
  const tab = $('#tab-room');
  tab.replaceChildren();
  const r = state.room;
  const re = () => applyRoom();
  tab.append(
    el('h3', {}, 'Walls'),
    ...paintRows('Wall behind device', 'wallColor'),
    ...paintRows('Other walls', 'sideColor'),
    el('div', { class: 'hint' }, 'The wall behind the device also sets how bright the rear-light halo looks: a darker wall reflects less of it.'),
    el('h3', {}, 'Ceiling and floor'),
    selectRow('Ceiling', r, 'ceilingColor', { '#f4f2ee': 'White', '#ece6dc': 'Warm white', '#d9d4cb': 'Light grey' }, re),
    rangeRow('Ceiling height', r, 'height', { min: 2.4, max: 3.4, step: 0.05, unit: 'm', onChange: re }),
    selectRow('Floor', r, 'floor', { oak: 'Oak planks', herringbone: 'Oak herringbone', walnut: 'Walnut planks', carpet: 'Grey carpet', concrete: 'Polished concrete' }, re),
    el('h3', {}, 'Light'),
    rangeRow('Room light', state.view, 'lux', { min: 0.5, max: 500, log: true, unit: 'lux', onChange: () => (scene.setLighting(state.view), persist()) }),
    selectRow('Ceiling lights', r, 'ceilingLights', { downlights: '4 downlights', pendant: 'Pendant lamp', off: 'Off' }, re),
    rangeRow('Light colour', r, 'lightCct', { min: 2200, max: 5000, step: 100, unit: 'K', onChange: re }),
    checkRow('Window', r, 'window', () => { re(); renderRoomTab(); }, 'left wall'),
    ...(r.window ? [
      selectRow('Outside', r, 'sky', { day: 'Sunny day', overcast: 'Overcast', dusk: 'Dusk', night: 'Night' }, re),
      rangeRow('Blind', r, 'blinds', { min: 0, max: 1, step: 0.05, fmt: (v) => (v === 0 ? 'open' : v === 1 ? 'closed' : fmtPct(v) + ' down'), onChange: re }),
    ] : []),
    el('div', { class: 'hint' }, '"Room light" is the illuminance on the walls; it is shared between ambient light, the ceiling lights and the window. A calm therapy room is about 5–30 lux, an office about 300–500.'),
    el('h3', {}, 'Furniture'),
    checkRow('Client chair', r, 'clientChair', re, 'facing the device'),
    checkRow('Therapist chair', r, 'therapistChair', re, 'beside the control end'),
    checkRow('People', r, 'people', re, 'seated figures'),
    selectRow('Client', r, 'clientFigure', Object.fromEntries(Object.entries(FIGURES).map(([k, v]) => [k, v.label])), re),
    selectRow('Therapist', r, 'therapistFigure', Object.fromEntries(Object.entries(FIGURES).map(([k, v]) => [k, v.label])), re),
    rangeRow('Facing angle', r, 'facing', { min: 0, max: 90, step: 5, unit: '° off face-to-face', onChange: re }),
    rangeRow('Client turned', r, 'clientTurn', { min: 0, max: 40, step: 1, unit: '° to therapist', onChange: re }),
    rangeRow('Chair distance', r, 'chairGap', { min: 0.9, max: 2.2, step: 0.05, unit: 'm', onChange: re }),
    selectRow('Upholstery', r, 'fabric', FABRICS, re),
    checkRow('Rug', r, 'rug', re),
    checkRow('Side table', r, 'table', re),
    checkRow('Plant', r, 'plant', re),
    el('div', { class: 'hint' }, 'The client chair stands at the viewer distance (Strip tab). In the Client seat view the client figure is hidden, because the camera is the client\'s eyes.'),
  );
}

function renderStripTab() {
  const tab = $('#tab-strip');
  tab.replaceChildren();
  const s = state.strip;
  const stripChanged = () => {
    persist();
    ctrl.setStrip(s);
    lim.setStrip(s);
    vectors = channelVectors(s);
    scheduleRebuild();
    updateGeometry();
    drawPsfChart();
    updateMetrics();
  };
  const geo = el('div', { class: 'hint', id: 'geoInfo' });
  tab.append(
    el('h3', {}, 'LED strip'),
    selectRow('LEDs per metre', s, 'ledsPerM', { 30: '30 /m', 60: '60 /m', 96: '96 /m', 144: '144 /m' }, stripChanged),
    rangeRow('LED count', s, 'count', { min: 10, max: 220, step: 1, onChange: stripChanged, fmt: (v) => `${v} · ${((v * 1000) / s.ledsPerM / 10).toFixed(1)} cm` }),
    selectRow('White channel', s, 'wCct', { 2700: '2700 K', 2900: '2900 K (RGBWW)', 3000: '3000 K', 4000: '4000 K', 6500: '6500 K' }, stripChanged),
    numberRow('Flux R', s.flux, 'r', { unit: 'lm/LED', onChange: stripChanged }),
    numberRow('Flux G', s.flux, 'g', { unit: 'lm/LED', onChange: stripChanged }),
    numberRow('Flux B', s.flux, 'b', { unit: 'lm/LED', onChange: stripChanged }),
    numberRow('Flux W', s.flux, 'w', { unit: 'lm/LED', onChange: stripChanged }),
    numberRow('PWM frequency', s, 'pwmHz', { step: 100, unit: 'Hz', onChange: () => { persist(); updateMonitor(); } }),
    rangeRow('End caps', s, 'endCap', { min: 20, max: 150, step: 5, unit: 'mm', onChange: stripChanged }),
    el('h3', {}, 'Viewing geometry'),
    rangeRow('Viewer distance', state.safety, 'viewerDistance', {
      min: 0.8, max: 2.5, step: 0.05, unit: 'm',
      onChange: () => {
        lim.setConfig(state.safety);
        updateGeometry();
        persist();
        if (state.view.camera === 'viewer') scene.setCamera('viewer', state.safety.viewerDistance);
        applyRoom();
      },
    }),
    geo,
    el('h3', {}, 'Display'),
    rangeRow('Display white', state.view, 'lref', { min: 20, max: 8000, log: true, unit: 'cd/m²', onChange: () => (scene.setLighting(state.view), persist()) }),
    rangeRow('Glow (bloom)', state.view, 'bloom', { min: 0, max: 1.5, step: 0.05, onChange: () => (scene.setLighting(state.view), persist()) }),
    el('div', { class: 'hint' }, '"Display white" is the face luminance shown as white on screen, like a camera exposure. A dark therapy room is about 5–30 lux.'),
  );
  updateGeometry();
}
function updateGeometry() {
  const box = $('#geoInfo');
  if (!box) return;
  const [a, b] = ctrl.travelRange();
  const L = b - a;
  const d = state.safety.viewerDistance * 1000;
  const theta = (2 * Math.atan(L / 2 / d) * 180) / Math.PI;
  const f = ctrl.status().speed;
  const peak = ctrl.programme.emdr.profile === 'linear' ? theta * 2 * f : (theta * Math.PI * f);
  box.innerHTML = `Active travel ${(L / 10).toFixed(1)} cm gives a <b>${theta.toFixed(1)}° sweep</b> at ${(d / 1000).toFixed(2)} m (target 20–30°, NF-PH-04). Peak eye speed ≈ ${peak.toFixed(0)}°/s at ${f.toFixed(2)} cyc/s. Flash analysis window (10° field): ${(lim.windowMm / 10).toFixed(1)} cm.`;
}

// ---------------- safety tab ----------------
function renderSafetyTab() {
  const tab = $('#tab-safety');
  tab.replaceChildren();
  const c = state.safety;
  const changed = () => {
    lim.setConfig(c);
    ctrl.sensitive = c.sensitive;
    persist();
    updateMetrics();
  };
  tab.append(
    el('h3', {}, 'Firmware limiter'),
    checkRow('Limiter on', c, 'enabled', changed, 'turn off to see raw programme output'),
    checkRow('Sensitive client', c, 'sensitive', changed, 'SR-PH-05'),
    rangeRow('Max brightness', c, 'maxBrightness', { min: 0.05, max: 1, step: 0.01, onChange: changed }),
    rangeRow('Point cap', c, 'pointCap', { min: 0.05, max: 1, step: 0.01, onChange: changed }),
    rangeRow('Sensitive cap', c, 'sensitiveCap', { min: 0.05, max: 1, step: 0.01, onChange: changed }),
    rangeRow('Blue cap', c, 'blueCap', { min: 0.1, max: 1, step: 0.01, onChange: changed }),
    rangeRow('Slew limit', c, 'slew', { min: 0.2, max: 20, step: 0.1, unit: 'FS/s', onChange: changed }),
    rangeRow('Flash limit', c, 'flashLimit', { min: 1, max: 3, step: 0.5, unit: '/s', onChange: changed }),
    rangeRow('Red flash limit', c, 'redFlashLimit', { min: 0.5, max: 3, step: 0.5, unit: '/s', onChange: changed }),
    rangeRow('3–60 Hz limit', c, 'bandLimit', { min: 0.005, max: 0.1, step: 0.005, onChange: changed, fmt: (v) => (v * 100).toFixed(1) + ' %' }),
    el('h3', {}, 'Live monitor'),
    el('div', { class: 'hint' }, 'Output after the limiter. Values in brackets are what the programme asked for.'),
    el('div', { id: 'monitor' }),
    el('h3', {}, 'Event log'),
    el('div', { class: 'log', id: 'log' }),
  );
  updateMonitor();
}
function monRow(level, id, txt) {
  return `<div class="mon"><span class="dot ${level}"></span><span class="id">${id}</span><span class="txt">${txt}</span></div>`;
}
function updateMonitor() {
  const box = $('#monitor');
  if (!box) return;
  const s = lim.stats;
  const c = state.safety;
  if (!s.postBand) return;
  const pwm = pwmAssessment(state.strip.pwmHz);
  const lvl = (v, lim) => (v > lim ? 'bad' : v > lim * 0.7 ? 'warn' : 'ok');
  const peak = lastPointPeak.A;
  box.innerHTML = [
    monRow(lvl(s.postFlash, c.flashLimit), 'SR-PH-01', `${s.postFlash.toFixed(1)} flashes/s, limit ${c.flashLimit} (${s.preFlash.toFixed(1)})`),
    monRow(lvl(s.postRed, c.redFlashLimit), 'SR-PH-02', `${s.postRed.toFixed(1)} red flashes/s, limit ${c.redFlashLimit} (${s.preRed.toFixed(1)})`),
    monRow(lvl(s.postBand.amp, c.bandLimit), 'SR-PH-08', `whole-bar 3–60 Hz: ${(s.postBand.amp * 100).toFixed(2)} %${s.postBand.amp > 0.002 ? ' at ' + s.postBand.freq.toFixed(1) + ' Hz' : ''} (${(s.preBand.amp * 100).toFixed(2)} %)`),
    monRow(s.slewed ? 'warn' : 'ok', 'SR-PH-03', s.slewed ? `slew limiting ${s.slewed} channels` : 'no slew limiting'),
    monRow(s.capped ? 'warn' : 'ok', 'SR-CO-02', s.capped ? `${s.capped} LEDs held at cap` : 'below brightness cap'),
    monRow(peak > 20 ? 'warn' : 'ok', 'SR-PH-09', `peak face luminance ${peak.toFixed(0)} cd/m² (bar A; flashes above 20 cd/m² count toward seizure risk)`),
    monRow(pwm.level, 'SR-PH-04', pwm.text),
    ...(state.stacks.A.back.mode === 'off' ? [] : [(() => {
      const h = haloEstimate(0);
      const moving = state.stacks.A.back.mode === 'slot' || state.stacks.A.back.drive === 'follow';
      return monRow(h.peak > 20 && moving ? 'warn' : 'ok', 'Wall halo', `peak ${h.peak.toFixed(1)} cd/m² ${h.at} (bar A)${moving ? '; follows the face, so it moves with the point' : '; steady'}`);
    })()]),
    monRow(s.damping > 0.01 ? 'warn' : 'ok', 'Guard', `flash damping ${(s.damping * 100).toFixed(0)} %`),
  ].join('');
  const log = $('#log');
  if (log) {
    const evs = [...lim.events.map((e) => ({ ...e, src: e.id })), ...ctrl.events.map((e) => ({ ...e, src: 'ctrl' }))]
      .sort((a, b) => b.t - a.t)
      .slice(0, 60);
    log.innerHTML = evs.map((e) => `<div>${e.t.toFixed(1).padStart(7)} s  ${e.src.padEnd(12)} ${e.msg}</div>`).join('');
  }
}

// ---------------- microphone ----------------
let mic = null;
async function startMic() {
  if (mic) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.6;
    ac.createMediaStreamSource(stream).connect(an);
    mic = { ac, an, stream, buf: new Float32Array(an.frequencyBinCount), bassAvg: 0, beat: 0 };
  } catch (err) {
    alert('Microphone unavailable: ' + err.message + '. Using the synthetic track.');
    ctrl.programme.music.source = 'synth';
    renderProgTab();
  }
}
function stopMic() {
  if (!mic) return;
  mic.stream.getTracks().forEach((t) => t.stop());
  mic.ac.close();
  mic = null;
}
function updateMic(dt) {
  if (!mic || ctrl.programme.mode !== 'music' || ctrl.programme.music.source !== 'mic') return;
  mic.an.getFloatFrequencyData(mic.buf);
  const sr = mic.ac.sampleRate;
  const hz = sr / mic.an.fftSize;
  const band = (f0, f1) => {
    let s = 0;
    let n = 0;
    for (let i = Math.floor(f0 / hz); i <= Math.min(mic.buf.length - 1, Math.ceil(f1 / hz)); i++) {
      s += Math.max(0, Math.min(1, (mic.buf[i] + 90) / 60));
      n++;
    }
    return n ? s / n : 0;
  };
  const bass = band(30, 250);
  const mid = band(250, 2000);
  const treble = band(2000, 8000);
  mic.bassAvg += (bass - mic.bassAvg) * Math.min(1, dt * 2);
  if (bass > mic.bassAvg * 1.25 + 0.03) mic.beat = 1;
  else mic.beat *= Math.exp(-dt / 0.15);
  ctrl.audio = { level: (bass + mid + treble) / 1.5, bass, mid, treble, beat: mic.beat };
}

// ---------------- charts ----------------
const tl = { n: 600, angle: [], pre: [], post: [], t: [] };
let lastEmission = new Float32Array(state.strip.count * 4);

function drawProfile() {
  const cv = $('#cProfile');
  const n = state.strip.count;
  const length = ctrl.length;
  const M = 400;
  const xs = Float32Array.from({ length: M }, (_, i) => (i / (M - 1)) * length);
  const series = [];
  lastPointPeak = { A: 0, B: 0 };
  for (const k of state.compare ? ['A', 'B'] : ['A']) {
    const o = optics[k];
    if (!o.ready || lastEmission.length !== n * 4) continue;
    const front = lastBack[k === 'A' ? 0 : 1].front;
    const y = o.lineProfile(lastEmission, ctrl.xs, xs).map((v) => v * front);
    lastPointPeak[k] = Math.max(...y);
    series.push({ x: xs, y, color: k === 'A' ? '#f0a64a' : '#6fb7c9', label: k, width: 1.6 });
  }
  if (!state.view.charts) return; // peak values above still feed the safety monitor
  const [a, b] = ctrl.travelRange();
  linePlot(cv, {
    title: 'Face luminance along the bar, centre line (live)',
    series,
    xlim: [0, length],
    xlabel: 'position along light zone (mm)',
    ylabel: 'cd/m²',
    marks: ctrl.programme.mode === 'emdr' ? [{ x: a, color: '#776d5e' }, { x: b, color: '#776d5e', label: 'travel' }] : [],
  });
}

function drawPsfChart() {
  if (!state.view.charts) return;
  const cv = $('#cPsf');
  const { g, w, h } = prepCanvas(cv);
  const pitch = 1000 / state.strip.ledsPerM;
  const ks = state.compare ? ['A', 'B'] : ['A'];
  let rx = 30;
  const series = [];
  const rip = [];
  const notes = [];
  for (const k of ks) {
    const o = optics[k];
    if (!o.ready) continue;
    rx = Math.max(rx, Math.min(o.cfg.grid.rx, 80));
    const p = o.profile[1];
    const max = Math.max(...p) || 1;
    const nx = p.length;
    const x = Array.from({ length: nx }, (_, i) => ((i + 0.5) / nx) * 2 * o.cfg.grid.rx - o.cfg.grid.rx);
    const color = k === 'A' ? '#f0a64a' : '#6fb7c9';
    series.push({ x, y: Array.from(p, (v) => v / max), color, label: `${k} FWHM ${o.metrics(pitch).fwhm.toFixed(1)} mm` });
    const m = o.metrics(pitch);
    const rmax = Math.max(...m.ripple) || 1;
    rip.push({ x: Array.from(m.ripple, (_, i) => (i / (m.ripple.length - 1) - 0.5) * pitch), y: Array.from(m.ripple, (v) => v / rmax), color, label: `${k} ${fmtPct(m.uniformity)}` });
    notes.push(`${k}: FWHM ${m.fwhm.toFixed(1)} mm`);
  }
  const split = Math.round(w * 0.6);
  linePlot(cv, {
    rect: { x: 0, y: 0, w: split, h },
    title: 'One LED through the diffuser (normalised)',
    series,
    xlim: [-rx, rx],
    ylim: [0, 1.05],
    xlabel: 'offset from LED (mm)',
    marks: [{ x: -pitch, color: '#776d5e' }, { x: pitch, color: '#776d5e', label: 'next LED' }],
  });
  linePlot(cv, {
    rect: { x: split, y: 0, w: w - split, h },
    title: 'All LEDs on: ripple per pitch',
    series: rip,
    xlim: [-pitch / 2, pitch / 2],
    ylim: [0, 1.05],
    xlabel: 'mm',
    marks: [{ y: 0.7, color: '#e2604f', label: '70 %' }],
  });
  if (!series.length) {
    g.fillStyle = '#776d5e';
    g.fillText('Tracing photons…', 50, h / 2);
  }
}

function drawSection() {
  if (!state.view.charts) return;
  const cv = $('#cSection');
  const { g, w, h } = prepCanvas(cv);
  const k = state.section === 'B' && state.compare ? 'B' : 'A';
  const o = optics[k];
  g.fillStyle = '#eee5d6';
  g.font = '600 11px "IBM Plex Sans", system-ui';
  g.fillText(`Photon fluence in stack ${k} (log scale, 3 decades) and sample paths`, 44, 13);
  if (!o.ready) return;
  const cfg = o.cfg;
  const depth = cfg.layers.reduce((a, l) => a + l.t, 0);
  const W = cfg.width;
  const top = 26;
  const ah = h - top - 26;
  const scale = Math.min(ah / depth, (w * 0.3) / W);
  const yz = { x: 44, y: top + (ah - depth * scale), w: W * scale, h: depth * scale };
  const rxShow = Math.min(cfg.grid.rx, 60);
  const xzW = w - yz.x - yz.w - 40;
  const sx = Math.min(xzW / (2 * rxShow), scale * 3);
  const xz = { x: yz.x + yz.w + 30, y: yz.y, w: 2 * rxShow * sx, h: yz.h };
  const sec = cfg.section;
  heatMap(g, o.acc.fluenceYZ, sec.ny, sec.nz, yz);
  // Crop x-z map to ±rxShow.
  const ix0 = Math.floor(((cfg.grid.rx - rxShow) / (2 * cfg.grid.rx)) * sec.nx);
  const ix1 = sec.nx - ix0;
  const nxc = ix1 - ix0;
  const crop = new Float64Array(nxc * sec.nz);
  for (let iz = 0; iz < sec.nz; iz++) for (let ix = 0; ix < nxc; ix++) crop[iz * nxc + ix] = o.acc.fluenceXZ[iz * sec.nx + ix0 + ix];
  heatMap(g, crop, nxc, sec.nz, xz);
  // Paths.
  g.lineWidth = 0.7;
  g.strokeStyle = 'rgba(160, 230, 255, 0.55)';
  for (const p of (o.paths || []).slice(0, 25)) {
    g.beginPath();
    for (let i = 0; i < p.length; i += 3) {
      const X = yz.x + (p[i + 1] + W / 2) * scale;
      const Y = yz.y + yz.h - p[i + 2] * scale;
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    g.stroke();
    g.beginPath();
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]) > rxShow) break;
      const X = xz.x + (p[i] + rxShow) * sx;
      const Y = xz.y + xz.h - p[i + 2] * sx * (xz.h / (depth * sx));
      i ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    g.stroke();
  }
  // Layer boundaries and labels.
  g.font = '10.5px "IBM Plex Mono", monospace';
  let z = 0;
  cfg.layers.forEach((l, i) => {
    const z1 = z + l.t;
    const Y = yz.y + yz.h - z1 * scale;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.moveTo(yz.x, Y);
    g.lineTo(xz.x + xz.w, Y);
    g.stroke();
    g.fillStyle = '#a99d89';
    g.textAlign = 'right';
    g.fillText(`${l.t} mm`, yz.x - 4, yz.y + yz.h - ((z + z1) / 2) * scale + 3);
    g.textAlign = 'left';
    const name = state.stacks[k].layers[i]?.name ?? '';
    g.fillText(name, xz.x + 4, yz.y + yz.h - ((z + z1) / 2) * scale + 3);
    z = z1;
  });
  g.fillStyle = '#ffd9a0';
  g.fillRect(yz.x + yz.w / 2 - (cfg.emitter * scale) / 2, yz.y + yz.h, cfg.emitter * scale, 3);
  g.fillRect(xz.x + xz.w / 2 - (cfg.emitter * sx) / 2, xz.y + xz.h, cfg.emitter * sx, 3);
  g.fillStyle = '#776d5e';
  g.textAlign = 'center';
  g.fillText(`cross-section, ${W} mm`, yz.x + yz.w / 2, yz.y + yz.h + 16);
  g.fillText(`along the bar, ±${rxShow.toFixed(0)} mm`, xz.x + xz.w / 2, xz.y + xz.h + 16);
  g.textAlign = 'left';
}

function drawTimeline() {
  if (!state.view.charts) return;
  const cv = $('#cTimeline');
  const { g, w, h } = prepCanvas(cv);
  const t = tl.t;
  if (!t.length) return;
  const t1 = t[t.length - 1];
  const t0 = t1 - 10;
  let pk = 0;
  for (let i = 1; i < t.length; i++) {
    const a = tl.angle[i];
    const b = tl.angle[i - 1];
    if (a !== null && b !== null) pk = Math.max(pk, Math.abs(a - b) / (t[i] - t[i - 1]));
  }
  const top = Math.round(h * 0.55);
  const amp = Math.max(5, ...tl.angle.filter((v) => v !== null).map(Math.abs));
  linePlot(cv, {
    rect: { x: 0, y: 0, w, h: top },
    title: `Client eye angle (from point position) · peak ${pk.toFixed(0)}°/s`,
    series: [{ x: t, y: tl.angle, color: '#f0a64a', width: 1.6 }],
    xlim: [t0, t1],
    ylim: [-amp * 1.1, amp * 1.1],
    ylabel: 'deg',
  });
  const maxL = Math.max(0.05, ...tl.pre, ...tl.post);
  linePlot(cv, {
    rect: { x: 0, y: top, w, h: h - top },
    series: [
      { x: t, y: tl.pre, color: '#776d5e', label: 'requested', dash: [3, 3], width: 1 },
      { x: t, y: tl.post, color: '#eee5d6', label: 'output (bar mean)', width: 1.3 },
    ],
    xlim: [t0, t1],
    ylim: [0, maxL * 1.1],
    xlabel: 'simulation time (s)',
    ylabel: 'rel. lum.',
  });
}

// ---------------- status bar ----------------
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function updateStatus() {
  const s = ctrl.status();
  const chips = [];
  chips.push(`<span class="chip ${s.power ? 'on' : ''}">${s.power ? 'ON' : 'OFF'}</span>`);
  chips.push(`<span class="chip"><b>${s.name}</b></span>`);
  if (s.mode === 'emdr') {
    chips.push(`<span class="chip">set <b>${s.setState}</b> · ${s.passes} passes · ${s.setElapsed.toFixed(1)} s</span>`);
    chips.push(`<span class="chip">${s.speed.toFixed(2)} cyc/s${s.dwell ? ` → ${s.effRate.toFixed(2)} eff.` : ''} · <b>${s.passesPerMin.toFixed(0)}</b> passes/min</span>`);
    if (s.task) chips.push(`<span class="chip" title="Answer key for the therapist. All cues: ${s.task.total}${s.task.parts ? ' (' + s.task.parts + ')' : ''}. Seed ${s.task.seed}.">task answer: <b>${s.task.target}</b>${s.task.targetName === 'all' ? '' : ' ' + s.task.targetName}</span>`);
  } else if (s.mode === 'alternating') {
    chips.push(`<span class="chip">set <b>${s.setState}</b> · ${s.setElapsed.toFixed(1)} s · ${s.altRate.toFixed(2)} cyc/s</span>`);
  }
  const c = s.clock;
  if (c.started) {
    chips.push(`<span class="chip ${c.warning ? 'warn' : ''}">clock ${mmss(c.elapsed)} / ${mmss(c.duration)} · ${(c.progress * 100).toFixed(0)} %${c.running ? '' : ' ❚❚'}</span>`);
  }
  if (state.safety.sensitive) chips.push('<span class="chip on">sensitive</span>');
  if (!state.safety.enabled) chips.push('<span class="chip warn">limiter OFF</span>');
  if (mic && ctrl.programme.mode === 'music') chips.push('<span class="chip mic">● mic active</span>');
  $('#status').innerHTML = chips.join('');
  const sp = $('#btnSetPause');
  if (sp) sp.textContent = ctrl.set.state === 'paused' ? 'Resume set' : 'Pause set';
  const cb = $('#btnClockRun');
  if (cb) cb.textContent = !ctrl.clock.started ? 'Start clock' : ctrl.clock.running ? 'Pause clock' : 'Resume clock';
  const toast = $('#toast');
  const showToast = c.warning && ctrl.programme.clock.warnMode === 'discreet';
  toast.classList.toggle('show', showToast);
  if (showToast) toast.innerHTML = `<div class="t-title">Therapist phone · discreet</div>${c.ended ? 'Session time is up.' : `${mmss(c.remaining)} left in the session.`}<div class="muted">The amber dot on the bar's end face is the therapist-side indicator.</div>`;
  const info = $('#emdrInfo');
  if (info) info.textContent = `Cycle = one full left→right→left movement. ${s.speed.toFixed(2)} cyc/s${s.dwell ? ` with ${s.dwell} ms dwell = ${s.effRate.toFixed(2)} cyc/s effective` : ''} = ${s.passesPerMin.toFixed(0)} one-way passes/min.`;
  const ce = $('#customErr');
  if (ce) ce.textContent = s.customError ? 'Error: ' + s.customError : '';
  $('#hudNote').textContent = `${state.strip.count} LEDs · ${(ctrl.length / 10).toFixed(1)} cm · viewer ${state.safety.viewerDistance.toFixed(2)} m · room ${state.view.lux} lux`;
}

// ---------------- transport wiring ----------------
$('#btnPower').onclick = () => ctrl.touchOnOff();
$('#btnNext').onclick = () => ctrl.touchNext();
// Playback: pause and speed of the whole simulation (firmware, limiter, clock).
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const playback = { paused: false, speed: 1 };
const PAUSE_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>';
function showPlayback() {
  const b = $('#btnPlayPause');
  // Always the pause symbol (the triangle means "next programme"); lit while paused.
  b.innerHTML = PAUSE_ICON;
  b.classList.toggle('on', playback.paused);
  b.title = playback.paused ? 'Paused: click (or Space) to resume' : 'Pause the simulation (Space)';
  const l = $('#speedLabel');
  l.textContent = playback.paused ? 'paused' : '×' + (playback.speed < 1 ? playback.speed.toString().replace(/^0/, '') : playback.speed);
  l.classList.toggle('off', playback.paused || playback.speed !== 1);
}
function stepSpeed(d) {
  const i = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(playback.speed) + d));
  playback.speed = SPEEDS[i];
  showPlayback();
}
$('#btnPlayPause').onclick = () => ((playback.paused = !playback.paused), showPlayback());
$('#btnSlower').onclick = () => stepSpeed(-1);
$('#btnFaster').onclick = () => stepSpeed(1);
showPlayback();
function setSensitive(on) {
  state.safety.sensitive = on;
  lim.setConfig(state.safety);
  ctrl.sensitive = on;
  persist();
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    playback.paused = !playback.paused;
    showPlayback();
  } else if (e.key === 'Escape') ctrl.emergencyStop(); // STOP: fade out and power off (FR-UI-07)
});

for (const t of document.querySelectorAll('.tab')) {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
    ({ prog: renderProgTab, diff: renderDiffTab, housing: renderHousingTab, strip: renderStripTab, room: renderRoomTab, safety: renderSafetyTab })[t.dataset.tab]();
  };
}
for (const k of ['A', 'B']) {
  $('#sec' + k).onclick = () => {
    state.section = k;
    $('#secA').classList.toggle('active', k === 'A');
    $('#secB').classList.toggle('active', k === 'B');
    drawSection();
  };
}
// Charts are hidden by default to keep the view simple.
function applyCharts() {
  document.body.classList.toggle('charts-on', !!state.view.charts);
  $('#btnCharts').classList.toggle('active', !!state.view.charts);
  $('#btnCharts').textContent = state.view.charts ? 'Hide charts' : 'Show charts';
  if (state.view.charts) requestAnimationFrame(() => {
    drawPsfChart();
    drawSection();
    drawProfile();
    drawTimeline();
  });
}
$('#btnCharts').onclick = () => {
  state.view.charts = !state.view.charts;
  persist();
  applyCharts();
};
applyCharts();

// Exploded view: parts of the device pulled apart, with labels.
const explode = { amount: 0, prevCam: null };
function setExplode(v, { moveCamera = false } = {}) {
  explode.amount = v;
  scene.setExplode(v);
  $('#btnExplode').classList.toggle('active', v > 0);
  $('#btnExplode').textContent = v > 0 ? 'Assemble' : 'Explode';
  if (moveCamera) {
    if (v > 0) {
      explode.prevCam = state.view.camera;
      scene.setCamera('exploded', state.safety.viewerDistance, { animate: true });
    } else if (explode.prevCam) {
      scene.setCamera(explode.prevCam, state.safety.viewerDistance, { animate: true });
    }
    document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('active', v === 0 && b.dataset.cam === state.view.camera));
  }
  const r = $('#explodeRange');
  if (r) r.value = v;
}
$('#btnExplode').onclick = () => setExplode(explode.amount > 0 ? 0 : 1, { moveCamera: true });

const CAMS = { viewer: 'Client seat', overview: 'Room', oblique: 'Oblique', close: 'Close-up', end: 'Control end' };
$('#cams').append(
  ...Object.entries(CAMS).map(([k, l]) =>
    el('button', {
      class: k === state.view.camera ? 'active' : '', 'data-cam': k,
      onclick: (e) => {
        state.view.camera = k;
        scene.setCamera(k, state.safety.viewerDistance);
        document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('active', b === e.target));
        persist();
      },
    }, l),
  ),
);

// ---------------- main loop ----------------
const guard = { until: -1, ema: null };
let acc = 0;
let lastT = performance.now();
let lastUi = 0;
let simT = 0;
const DT = 1 / SIM_RATE;
const emission = () => new Float32Array(state.strip.count * 4);

let tickErrors = 0;
function tick(now) {
  // Keep the loop alive even if one frame throws, and show the error on the page.
  requestAnimationFrame(tick);
  try {
    frame(now);
  } catch (err) {
    if (tickErrors++ < 3) {
      console.error(err);
      window.__twinFail?.('Error in the simulation loop (the loop keeps running)', err?.stack || String(err));
    }
  }
}

function frame(now) {
  const real = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const dt = playback.paused ? 0 : real * playback.speed;
  acc += dt;
  updateMic(dt);
  let out = null;
  let o = null;
  let steps = 0;
  while (acc >= DT && steps < 64) {
    o = ctrl.step(DT);
    out = lim.process(o.leds, o.kind, DT);
    acc -= DT;
    simT += DT;
    if (++steps % 2 === 0) {
      const d = state.safety.viewerDistance * 1000;
      tl.t.push(simT);
      tl.angle.push(o.pointX === null ? null : (Math.atan((o.pointX - ctrl.length / 2) / d) * 180) / Math.PI);
      tl.pre.push(lim.pre.barMean);
      tl.post.push(lim.post.barMean);
      if (tl.t.length > tl.n) for (const k of ['t', 'angle', 'pre', 'post']) tl[k].shift();
    }
  }
  if (steps === 64) acc = 0;
  if (out) {
    const n = state.strip.count;
    const e = emission();
    const V = vectors;
    for (let i = 0; i < n; i++) {
      const r = out[i * 4];
      const gg = out[i * 4 + 1];
      const b = out[i * 4 + 2];
      const w = out[i * 4 + 3];
      e[i * 4] = r * V.r[0] + gg * V.g[0] + b * V.b[0] + w * V.w[0];
      e[i * 4 + 1] = r * V.r[1] + gg * V.g[1] + b * V.b[1] + w * V.w[1];
      e[i * 4 + 2] = r * V.r[2] + gg * V.g[2] + b * V.b[2] + w * V.w[2];
    }
    lastEmission = e;
    // Display guard: never put > 3 flashes/s or strong 3-60 Hz modulation on this screen.
    const st = lim.stats;
    // On screen, sim rates are multiplied by the playback speed.
    if (st.postFlash * playback.speed > 3 || (playback.speed >= 1 && st.postBand.amp > 0.03) || (playback.speed > 1 && st.postBand.amp > 0.01)) guard.until = simT + 2;
    const guarding = simT < guard.until;
    if (!guard.ema || guard.ema.length !== e.length) guard.ema = e.slice();
    const a = guarding ? 1 - Math.exp(-(steps * DT) / 0.8) : 1;
    for (let i = 0; i < e.length; i++) guard.ema[i] += (e[i] - guard.ema[i]) * a;
    scene.setEmission(guard.ema);
    for (const idx of state.compare ? [0, 1] : [0]) {
      lastBack[idx] = backDrive(idx, steps * DT);
      scene.setBack(idx, lastBack[idx]);
    }
    scene.setIndicator(o.indicator);
    const gEl = $('#guard');
    gEl.classList.toggle('show', guarding);
    if (guarding) gEl.textContent = `Display guard: output flashes ${st.postFlash.toFixed(1)}/s, 3–60 Hz ${(st.postBand.amp * 100).toFixed(1)} %. Showing a time-averaged view.`;
  }
  scene.render();
  if (now - lastUi > 100) {
    lastUi = now;
    updateStatus();
    drawProfile();
    drawTimeline();
    if ($('#tab-safety').classList.contains('active')) updateMonitor();
    if ($('#tab-housing').classList.contains('active') && now % 500 < 110) housingInfo();
    if ($('#tab-strip').classList.contains('active') && now % 1000 < 110) updateGeometry();
  }
}

// ---------------- start ----------------
rebuildScene();
applyRoom(true);
scene.setCamera(state.view.camera, state.safety.viewerDistance);
renderProgTab();
runOptics('A');
if (state.compare) runOptics('B');
new ResizeObserver(() => {
  drawPsfChart();
  drawSection();
}).observe($('.charts'));
requestAnimationFrame(tick);
if (!store.load('introSeen', false)) {
  $('#intro').showModal();
  $('#intro').addEventListener('close', () => store.save('introSeen', true));
}
window.__twin = { ctrl, lim, optics, scene, state };
