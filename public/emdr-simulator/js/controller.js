// Firmware model of the light controller (stage-2 behaviour from requirements-spec.md).
// Pure module: no DOM. Produces one RGBW frame (0..1 drive per channel) per step.

import { kelvinToLinear, channelVectors } from './materials.js';

export const MODES = {
  emdr: 'EMDR sweep (M1)',
  alternating: 'EMDR alternating (M1, FR-EM-07)',
  ambient: 'Ambient (M2)',
  clock: 'Session clock (M3)',
  breathing: 'Breathing pacer (FR-EX-01)',
  music: 'Music sync (M4)',
  custom: 'Custom script',
};

export const ALTERNATING_MAX_HZ = 1.5; // FR-EM-07

// Dual-attention task colours (RGBW drive). No saturated red: red transitions
// count separately toward the photosensitivity limit (SR-PH-02).
export const TASK_COLOURS = {
  blue: [0, 0.12, 0.9, 0],
  green: [0, 0.8, 0.12, 0.05],
  amber: [0.9, 0.38, 0, 0.05],
  violet: [0.45, 0, 0.85, 0],
  white: [0, 0, 0, 1],
};
export const TASK_PALETTES = {
  bga: ['blue', 'green', 'amber'],
  bgav: ['blue', 'green', 'amber', 'violet'],
  ba: ['blue', 'amber'],
  white: ['white'],
};
// Task timing limits, enforced by the firmware whatever the programme asks for.
export const TASK_MIN_GAP = 1.5; // s between the starts of two cues
export const TASK_MIN_FADE = 150; // ms fade in and out, so a cue is never a hard flash

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PROGRAMME_DEFAULTS = {
  name: 'Untitled',
  mode: 'emdr',
  transition: 1.5, // s, FR-AM-04 / SR-CO-01
  emdr: {
    speed: 1.0, // full L-R-L cycles per second (FR-EM-02)
    profile: 'sine', // 'linear' | 'sine' (FR-EM-06)
    dwell: 0, // ms at each end
    size: 4, // % of travel width (FR-EM-05: 2-6 %)
    color: [0, 0, 0, 1], // RGBW drive, warm white default
    brightness: 0.4,
    bgLevel: 0, // background glow, 0 = off
    bgColor: [0, 0, 0, 1],
    travel: 85, // % of light zone (FR-EM-13)
    offset: 0, // % shift of travel centre
    setMode: 'duration', // 'duration' | 'passes' (FR-EM-09)
    setSeconds: 30,
    setPasses: 60,
    render: 'aa', // 'aa' anti-aliased flat top | 'gauss' | 'nearest' (FR-EM-04)
    mirror: false,
    // Dual-attention second task during the set: the client counts coloured cues.
    task: 'off', // 'off' | 'segments' (segments appear on the bar) | 'point' (the point changes colour)
    taskRate: 12, // average cues per minute (random, at least TASK_MIN_GAP apart)
    taskShow: 600, // ms each cue is fully visible
    taskFade: 200, // ms fade in and out
    taskWidth: 3, // segment width, % of light zone
    taskPlace: 'away', // 'away' (not near the point) | 'anywhere'
    taskPalette: 'bga',
    taskTarget: 'all', // 'all' or a colour name the client counts
    taskBrightness: 0.8, // cue level: share of the brightest level every palette colour can reach
  },
  alternating: {
    speed: 1.0,
    segment: 8, // % of light zone lit at each end
    rise: 0.35, // fraction of a half-cycle spent rising/falling
    color: [0, 0, 0, 1],
    brightness: 0.4,
    setSeconds: 30,
  },
  ambient: {
    color: [0, 0, 0, 1],
    brightness: 0.4,
    useCct: false,
    cct: 2700,
    effect: 'solid', // 'solid' | 'drift' | 'gradient'
    color2: [0.1, 0.3, 0.6, 0.2],
    period: 60, // s, drift period (FR-AM-03: >= 30 s)
  },
  clock: {
    minutes: 50,
    keys: [
      [0.04, 0.18, 0.75, 0.1],
      [0.05, 0.3, 0.45, 0.35],
      [0, 0, 0, 0.9],
      [1, 0.42, 0, 0.15],
    ], // colours at 0 %, 30 %, 60 %, 100 % (blue-yellow axis, SR-CV-02)
    interp: 'gradient', // 'gradient' | 'steps' (Q3)
    stepFade: 60, // s of session time for a step change
    encode: 'colour', // 'colour' | 'fill' | 'brightness' (FR-CL-09)
    warnMin: 5, // FR-CL-04
    warnMode: 'discreet', // 'discreet' | 'overt' (FR-CL-05)
    brightness: 0.35,
  },
  breathing: {
    inhale: 4,
    hold1: 1,
    exhale: 6,
    hold2: 1,
    color: [0, 0.1, 0.25, 0.6],
    brightness: 0.4,
    style: 'width', // 'width' | 'brightness'
    min: 0.08,
    colorMode: 'single', // 'single' | 'follow' (blend with the breath) | 'phase' (inhale colour, exhale colour)
    colorIn: [0, 0.3, 0.6, 0.2], // inhale: cool
    colorOut: [0.45, 0.14, 0, 0.5], // exhale: warm
    colorFade: 1.0, // s, phase mode: cross-fade at the start of inhale and exhale
  },
  music: {
    source: 'synth', // 'synth' | 'mic'
    effect: 'vu', // 'vu' | 'bands' | 'pulse'
    sensitivity: 1.0,
    bpm: 120,
    color: [1, 0.35, 0, 0.3],
    brightness: 0.5,
  },
  custom: {
    code:
      '// Per-LED function. Return [r, g, b, w] drive 0..1.\n' +
      '// i: LED index, n: LED count, x: 0..1 position, t: seconds, s: state object\n' +
      'const c = 0.5 + 0.5 * Math.sin(2 * Math.PI * (x * 1.5 - t * 0.1));\n' +
      'return [0.6 * c, 0.2 * c, 0.05, 0.25 * (1 - c)];',
  },
};

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return structuredClone(over ?? base);
  if (typeof base !== 'object' || base === null) return over ?? base;
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(over ?? {})])) {
    const o = over?.[k];
    out[k] = o === undefined ? structuredClone(base[k]) : deepMerge(base[k], o);
  }
  return out;
}

export function makeProgramme(over = {}) {
  return deepMerge(PROGRAMME_DEFAULTS, over);
}

// Shipped defaults (FR-EM-11) plus test programmes.
// Every built-in programme, including the limiter tests. The tests use it.
export const ALL_PROGRAMMES = [
  makeProgramme({ name: 'Desensitise 1.0 Hz', mode: 'emdr', emdr: { speed: 1.0, setSeconds: 30 } }),
  makeProgramme({ name: 'Fast 1.5 Hz', mode: 'emdr', emdr: { speed: 1.5, setSeconds: 30 } }),
  makeProgramme({
    name: 'Resource / slow 0.3 Hz', mode: 'emdr',
    emdr: { speed: 0.3, setSeconds: 60, color: [0.15, 0.05, 0, 0.8] },
  }),
  makeProgramme({
    name: 'Sensitive', mode: 'emdr',
    emdr: { speed: 0.8, brightness: 0.2, profile: 'sine', size: 5 },
  }),
  makeProgramme({ name: 'Linear + 200 ms dwell', mode: 'emdr', emdr: { profile: 'linear', dwell: 200 } }),
  makeProgramme({ name: 'Stepping (no anti-aliasing)', mode: 'emdr', emdr: { render: 'nearest', size: 2 } }),
  makeProgramme({ name: 'Alternating 1.0 Hz', mode: 'alternating' }),
  makeProgramme({ name: 'Ambient warm', mode: 'ambient' }),
  makeProgramme({ name: 'Ambient drift', mode: 'ambient', ambient: { effect: 'drift', period: 45 } }),
  makeProgramme({ name: 'Session clock 50 min', mode: 'clock' }),
  makeProgramme({ name: 'Clock fill-level 50 min', mode: 'clock', clock: { encode: 'fill' } }),
  makeProgramme({ name: 'Breathing 4-1-6-1', mode: 'breathing' }),
  makeProgramme({ name: 'Breathing colour 4-1-6-1 (blend)', mode: 'breathing', breathing: { colorMode: 'follow' } }),
  makeProgramme({
    name: 'Breathing colour 4-7-8 (phases)', mode: 'breathing',
    breathing: { inhale: 4, hold1: 7, exhale: 8, hold2: 0, colorMode: 'phase', style: 'brightness', min: 0.15 },
  }),
  makeProgramme({
    name: 'Dual attention: count segments', mode: 'emdr',
    emdr: { speed: 0.8, setSeconds: 40, task: 'segments', taskPalette: 'bga', taskTarget: 'all' },
  }),
  makeProgramme({
    name: 'Dual attention: count the blue ones', mode: 'emdr',
    emdr: { speed: 0.8, setSeconds: 40, task: 'segments', taskPalette: 'bgav', taskTarget: 'blue', taskRate: 15 },
  }),
  makeProgramme({
    name: 'Dual attention: point colour changes', mode: 'emdr',
    emdr: { speed: 0.8, setSeconds: 40, task: 'point', taskPalette: 'ba', taskRate: 10, taskShow: 800 },
  }),
  makeProgramme({ name: 'Music VU', mode: 'music' }),
  makeProgramme({ name: 'Music beat pulse (limiter test)', mode: 'music', music: { effect: 'pulse', brightness: 0.9 } }),
  makeProgramme({ name: 'Custom: slow wave', mode: 'custom' }),
  makeProgramme({
    name: 'Custom: 10 Hz strobe (limiter test)', mode: 'custom',
    custom: { code: '// Deliberately unsafe: whole-bar 10 Hz flash.\nconst on = Math.floor(t * 20) % 2;\nreturn [0, 0, 0, on];' },
  }),
  makeProgramme({
    name: 'Custom: big fast red point (limiter test)', mode: 'custom',
    custom: {
      code:
        '// Deliberately unsafe: wide saturated red point at 2 Hz.\n' +
        'const p = 0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * t);\n' +
        'const on = Math.abs(x - p) < 0.12 ? 1 : 0;\nreturn [on, 0, 0, 0];',
    },
  }),
];

// What the app offers: two EMDR and two breathing programmes.
export const SHIPPED_MODES = ['emdr', 'breathing'];
export const SHIPPED_PROGRAMMES = [
  'Desensitise 1.0 Hz',
  'Resource / slow 0.3 Hz',
  'Breathing 4-1-6-1',
  'Breathing colour 4-7-8 (phases)',
].map((name) => ALL_PROGRAMMES.find((p) => p.name === name));

const smooth = (a) => a * a * (3 - 2 * a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function lerpColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)];
}

// Trapezoid window over [a0, a1) with raised-cosine edges of width e.
function softWindow(a, a0, a1, e) {
  if (a < a0 || a >= a1) return 0;
  if (e <= 0) return 1;
  const up = (a - a0) / e;
  const down = (a1 - a) / e;
  const v = Math.min(1, up, down);
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(v));
}

// Solve RGBW drive (non-negative) that reproduces a target chromaticity, max drive 1.
export function rgbwForCct(strip, kelvin) {
  const vec = channelVectors(strip);
  const cols = [vec.r, vec.g, vec.b, vec.w];
  const target = kelvinToLinear(kelvin);
  const x = [0, 0, 0, 1];
  // Scale target to the white channel luminance, then projected gradient descent.
  const scale = strip.flux.w;
  const tgt = target.map((v) => v * scale);
  const lr = 0.02 / (scale * scale);
  for (let it = 0; it < 400; it++) {
    const res = [0, 1, 2].map((k) => cols.reduce((a, c, j) => a + c[k] * x[j], 0) - tgt[k]);
    for (let j = 0; j < 4; j++) {
      const grad = cols[j].reduce((a, c, k) => a + c * res[k], 0);
      x[j] = Math.max(0, x[j] - lr * grad);
    }
  }
  const m = Math.max(...x);
  return x.map((v) => v / m);
}

export class Controller {
  constructor(strip) {
    this.setStrip(strip);
    this.power = true;
    this.master = 1;
    this.sensitive = false;
    this.programme = makeProgramme(SHIPPED_PROGRAMMES[0]);
    this.programmeList = [];
    this.programmeIndex = 0;
    this.onProgrammeChange = null; // callback(programme, index)
    this.time = 0;
    this.modeTime = 0;
    this.set = this._newSet();
    this.clock = { started: false, running: false, elapsed: 0, timeScale: 1, notified: false };
    this.breath = 0;
    this.altPhase = 0;
    this.audio = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0 };
    this.customFn = null;
    this.customSrc = null;
    this.customError = null;
    this.customState = {};
    this.fadeFrom = null;
    this.fadeT = 0;
    this.last = new Float32Array(this.n * 4);
    this.events = [];
  }

  setStrip(strip) {
    this.strip = strip;
    this.n = strip.count;
    this.pitch = 1000 / strip.ledsPerM;
    this.length = this.n * this.pitch;
    this.xs = Float32Array.from({ length: this.n }, (_, i) => (i + 0.5) * this.pitch);
    this.last = new Float32Array(this.n * 4);
    this.fadeFrom = null;
  }

  _newSet() {
    return { state: 'idle', elapsed: 0, passes: 0, seg: 0, p: 0, gain: 0, task: null };
  }

  // Second task: a seeded random schedule of coloured cues, so a set can be replayed.
  _newTask(seed = (Math.random() * 2 ** 32) >>> 0) {
    const rng = mulberry32(seed);
    return { seed, rng, next: 1 + rng() * 2, active: null, total: 0, counts: {}, target: 0 };
  }

  taskAnswer(task = this.set.task ?? this.lastTask) {
    if (!task) return null;
    const e = this.programme.emdr;
    const parts = Object.entries(task.counts).map(([k, v]) => `${k} ${v}`).join(', ');
    return { total: task.total, target: e.taskTarget === 'all' ? task.total : task.counts[e.taskTarget] ?? 0, targetName: e.taskTarget, parts, seed: task.seed };
  }

  _event(msg) {
    this.events.push({ t: this.time, msg });
    if (this.events.length > 50) this.events.shift();
  }

  // ----- operator actions -----
  setProgramme(p, { fade = true } = {}) {
    const wasSet = this.set.state !== 'idle';
    this.programme = makeProgramme(p);
    if (fade) {
      this.fadeFrom = this.last.slice();
      this.fadeT = 0;
    }
    this.modeTime = 0;
    if (wasSet && !['emdr', 'alternating'].includes(this.programme.mode)) this.set = this._newSet();
    this.customState = {};
    this._event(`Programme: ${this.programme.name}`);
  }

  setPower(on) {
    this.power = on;
    if (!on && this.set.state !== 'idle') this.set = this._newSet();
    this._event(on ? 'Power on (fade-in)' : 'Power off (fade-out)');
  }

  touchOnOff() {
    this.setPower(!this.power); // FR-UI-08 sensor 1
  }

  touchNext() {
    // FR-UI-08 sensor 2: next programme in the ordered list
    if (!this.programmeList.length) return;
    if (!this.power) this.setPower(true);
    // Continue from the programme now running, if it is in the list.
    const cur = this.programmeList.findIndex((q) => q.name === this.programme.name);
    if (cur >= 0) this.programmeIndex = cur;
    this.programmeIndex = (this.programmeIndex + 1) % this.programmeList.length;
    const p = this.programmeList[this.programmeIndex];
    this.setProgramme(p);
    this.onProgrammeChange?.(p, this.programmeIndex);
  }

  startSet(seed) {
    if (!['emdr', 'alternating'].includes(this.programme.mode)) return;
    if (this.programme.mode === 'alternating' && this.sensitive) {
      this._event('Alternating disabled by sensitive profile (SR-PH-05)');
      return;
    }
    if (!this.power) this.setPower(true);
    this.set = this._newSet();
    this.set.state = 'running';
    if (this.programme.mode === 'emdr' && this.programme.emdr.task !== 'off') this.set.task = this._newTask(seed);
    this.altPhase = 0;
    this._event('Set started' + (this.set.task ? ` with counting task (seed ${this.set.task.seed})` : ''));
  }

  pauseSet() {
    if (this.set.state === 'running') {
      this.set.state = 'paused';
      this._event('Set paused');
    } else if (this.set.state === 'paused') {
      this.set.state = 'running';
      this._event('Set resumed');
    }
  }

  stopSet() {
    // FR-EM-08 / FR-UI-07: fade out <= 1 s
    if (this.set.state === 'running' || this.set.state === 'paused') {
      this.set.state = 'stopping';
      this._event(`Set stopped: ${this.set.passes} passes, ${this.set.elapsed.toFixed(1)} s`);
      if (this.set.task) {
        const a = this.taskAnswer(this.set.task);
        this.lastTask = this.set.task;
        this._event(`Task answer: ${a.targetName === 'all' ? '' : a.targetName + ' '}${a.target} (all cues: ${a.total}${a.parts ? '; ' + a.parts : ''})`);
      }
    }
  }

  emergencyStop() {
    this.stopSet();
    this.setPower(false);
  }

  clockStart() {
    if (!this.clock.started) {
      this.clock.started = true;
      this.clock.elapsed = 0;
      this.clock.notified = false;
    }
    this.clock.running = true;
    this._event('Clock started');
  }
  clockPause() {
    this.clock.running = !this.clock.running;
  }
  clockReset() {
    this.clock = { ...this.clock, started: false, running: false, elapsed: 0, notified: false };
  }

  // ----- derived values -----
  effectiveRate() {
    const e = this.programme.emdr;
    const f = this._speed();
    return 1 / (1 / f + (2 * e.dwell) / 1000);
  }

  _speed() {
    return Math.max(0.1, Math.min(2.0, this.programme.emdr.speed));
  }

  travelRange() {
    const e = this.programme.emdr;
    const lt = (clamp01(e.travel / 100) || 0.01) * this.length;
    let c = this.length / 2 + (e.offset / 100) * (this.length / 2);
    c = Math.max(lt / 2, Math.min(this.length - lt / 2, c));
    return [c - lt / 2, c + lt / 2];
  }

  clockStatus() {
    const c = this.programme.clock;
    const dur = c.minutes * 60;
    const progress = this.clock.started ? Math.min(1, this.clock.elapsed / dur) : 0;
    const remaining = Math.max(0, dur - this.clock.elapsed);
    return {
      ...this.clock,
      duration: dur,
      progress,
      remaining,
      warning: this.clock.started && remaining <= c.warnMin * 60,
      ended: this.clock.started && remaining <= 0,
    };
  }

  // ----- simulation step -----
  step(dt) {
    this.time += dt;
    this.modeTime += dt;
    const p = this.programme;

    // Clock keeps running in every mode (FR-CL-07).
    if (this.clock.running) this.clock.elapsed += dt * this.clock.timeScale;
    const cs = this.clockStatus();
    if (cs.warning && !this.clock.notified) {
      this.clock.notified = true;
      this._event(`Clock: last ${p.clock.warnMin} min (${p.clock.warnMode})`);
    }

    const frame = new Float32Array(this.n * 4);
    let kind = 'area';
    let pointX = null;
    let indicator = 0;

    const base = new Float32Array(this.n * 4);
    if (cs.started && (p.mode === 'clock' || p.mode === 'emdr' || p.mode === 'alternating')) {
      indicator = this._renderClock(base, cs);
    } else if (p.mode === 'emdr') {
      this._fill(base, p.emdr.bgColor, p.emdr.bgLevel);
    }

    if (p.mode === 'emdr' || p.mode === 'alternating') {
      const setFrame = new Float32Array(this.n * 4);
      pointX = this._advanceSet(dt, setFrame);
      const g = this.set.gain;
      for (let k = 0; k < frame.length; k++) frame[k] = lerp(base[k], setFrame[k], g);
      if (g > 0) kind = 'point';
    } else if (p.mode === 'clock') {
      frame.set(base);
    } else if (p.mode === 'ambient') {
      this._renderAmbient(frame);
    } else if (p.mode === 'breathing') {
      this._renderBreathing(frame, dt);
    } else if (p.mode === 'music') {
      this._renderMusic(frame, dt);
    } else if (p.mode === 'custom') {
      this._renderCustom(frame);
    }

    // Programme cross-fade (FR-AM-04).
    if (this.fadeFrom && this.fadeFrom.length === frame.length) {
      this.fadeT += dt;
      const t = smooth(clamp01(this.fadeT / Math.max(0.01, p.transition)));
      for (let k = 0; k < frame.length; k++) frame[k] = lerp(this.fadeFrom[k], frame[k], t);
      if (t >= 1) this.fadeFrom = null;
    }
    this.last.set(frame);

    // Master power fade: in 1.5 s (SR-CO-01), out 0.8 s (FR-UI-08 <= 1 s).
    if (this.power) this.master = Math.min(1, this.master + dt / 1.5);
    else this.master = Math.max(0, this.master - dt / 0.8);
    const m = smooth(this.master);
    for (let k = 0; k < frame.length; k++) frame[k] *= m;

    return { leds: frame, kind, pointX, indicator: indicator * m, clock: cs };
  }

  _fill(frame, color, level) {
    for (let i = 0; i < this.n; i++)
      for (let c = 0; c < 4; c++) frame[i * 4 + c] = color[c] * level;
  }

  _advanceSet(dt, out) {
    const s = this.set;
    const p = this.programme;
    if (s.state === 'idle') {
      // Between sets the EMDR point rests at its start position, so the bar is
      // never blank on an EMDR programme. Not while the session clock owns the bar.
      if (p.mode !== 'emdr' || this.clock.started) {
        s.gain = 0;
        return null;
      }
      s.gain = Math.min(1, s.gain + dt / 0.3);
    }
    if (s.state === 'running') s.gain = Math.min(1, s.gain + dt / 0.3);
    if (s.state === 'stopping') {
      s.gain = Math.max(0, s.gain - dt / 0.8);
      if (s.gain <= 0) {
        this.set = this._newSet();
        return null;
      }
    }
    const moving = s.state === 'running' || s.state === 'stopping';
    if (moving && s.state === 'running') s.elapsed += dt;
    if (p.mode === 'alternating') return this._alternating(dt, out, moving);

    const e = p.emdr;
    const f = this._speed();
    const dwell = e.dwell / 1000;
    if (moving) {
      let rem = dt;
      let guard = 0;
      while (rem > 1e-9 && guard++ < 8) {
        const isMove = s.seg % 2 === 0;
        const rate = isMove ? 2 * f : dwell > 0 ? 1 / dwell : Infinity;
        const need = (1 - s.p) / rate;
        if (need > rem) {
          s.p += rem * rate;
          rem = 0;
        } else {
          rem -= need;
          s.p = 0;
          if (isMove) {
            s.passes++;
            if (s.state === 'running' && e.setMode === 'passes' && s.passes >= e.setPasses) this.stopSet();
          }
          s.seg = (s.seg + 1) % 4;
        }
      }
      if (s.state === 'running' && e.setMode === 'duration' && s.elapsed >= e.setSeconds) this.stopSet();
    }
    // Normalised position 0..1 along travel.
    let u;
    if (s.seg === 0) u = s.p;
    else if (s.seg === 1) u = 1;
    else if (s.seg === 2) u = 1 - s.p;
    else u = 0;
    if (s.seg % 2 === 0) {
      const profile = this.sensitive ? 'sine' : e.profile;
      if (profile === 'sine') u = s.seg === 0 ? 0.5 - 0.5 * Math.cos(Math.PI * s.p) : 0.5 + 0.5 * Math.cos(Math.PI * s.p);
    }
    if (e.mirror) u = 1 - u;
    const [a, b] = this.travelRange();
    const size = Math.max(this.pitch * 0.5, (e.size / 100) * (b - a));
    const lo = a + size / 2;
    const hi = b - size / 2;
    const xp = lo + u * Math.max(0, hi - lo);
    this._fill(out, e.bgColor, e.bgLevel);
    const cue = s.task ? this._advanceTask(dt, s, xp, size, a, b) : null;
    let pointColor = e.color;
    if (cue && e.task === 'point') {
      // The point keeps its luminance while it changes colour (as far as the LEDs allow).
      const f = this.strip.flux;
      const lum = (c) => c[0] * f.r + c[1] * f.g + c[2] * f.b + c[3] * f.w;
      const raw = TASK_COLOURS[cue.name];
      const k = Math.min((lum(e.color) * e.brightness) / lum(raw), 1 / Math.max(...raw));
      const target = raw.map((v) => (v * k) / Math.max(1e-6, e.brightness));
      pointColor = lerpColor(e.color, target, cue.env);
    }
    const pitch = this.pitch;
    let xSnap = xp;
    if (e.render === 'nearest') xSnap = (Math.round(xp / pitch - 0.5) + 0.5) * pitch;
    for (let i = 0; i < this.n; i++) {
      const dx = Math.abs(this.xs[i] - xSnap);
      let v;
      if (e.render === 'gauss') {
        const sg = size / 2.355;
        v = Math.exp(-0.5 * (dx / sg) ** 2);
      } else if (e.render === 'nearest') {
        v = dx <= Math.max(size / 2, pitch * 0.5) + 1e-6 ? 1 : 0;
      } else {
        v = clamp01((size / 2 + pitch / 2 - dx) / pitch); // box-filtered flat top
      }
      if (v > 0) {
        for (let c = 0; c < 4; c++) {
          const k = i * 4 + c;
          out[k] = Math.max(out[k], pointColor[c] * e.brightness * v);
        }
      }
    }
    if (cue && e.task === 'segments') {
      const half = ((e.taskWidth / 100) * this.length) / 2;
      const lvl = cue.env;
      for (let i = 0; i < this.n; i++) {
        const v = clamp01((half + pitch / 2 - Math.abs(this.xs[i] - cue.x)) / pitch);
        if (v <= 0) continue;
        for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.max(out[i * 4 + c], cue.color[c] * lvl * v);
      }
    }
    return xp;
  }

  // Cue colours are scaled to equal luminance, so no colour stands out more than
  // the others (a brighter colour would be easier to count). The common level is a
  // share of the dimmest colour's maximum (blue limits it: blue LEDs give few lumens).
  _cueColour(name, pal) {
    const f = this.strip.flux;
    const lum = (c) => c[0] * f.r + c[1] * f.g + c[2] * f.b + c[3] * f.w;
    const maxLum = (c) => lum(c) / Math.max(...c);
    const target = clamp01(this.programme.emdr.taskBrightness) * Math.min(...pal.map((k) => maxLum(TASK_COLOURS[k])));
    const c = TASK_COLOURS[name];
    return c.map((v) => (v * target) / lum(c));
  }

  // Schedules and fades the counting cues. Returns the active cue (colour,
  // position, envelope 0..1) or null.
  _advanceTask(dt, s, xp, size, a, b) {
    const e = this.programme.emdr;
    const t = s.task;
    const fade = Math.max(TASK_MIN_FADE, e.taskFade) / 1000;
    const show = Math.max(0, e.taskShow) / 1000;
    if (t.active) {
      t.active.t += dt;
      if (t.active.t >= show + 2 * fade) t.active = null;
    }
    if (s.state === 'running') t.next -= dt;
    if (!t.active && t.next <= 0 && s.state === 'running') {
      const pal = TASK_PALETTES[e.taskPalette] ?? TASK_PALETTES.bga;
      const name = pal[Math.floor(t.rng() * pal.length) % pal.length];
      let x = (a + b) / 2;
      const half = ((e.taskWidth / 100) * this.length) / 2;
      for (let k = 0; k < 20; k++) {
        x = a + half + t.rng() * Math.max(0, b - a - 2 * half);
        if (e.task !== 'segments' || e.taskPlace !== 'away' || Math.abs(x - xp) > size + half + 0.1 * (b - a)) break;
      }
      t.active = { name, color: this._cueColour(name, pal), x, t: 0 };
      t.total++;
      t.counts[name] = (t.counts[name] ?? 0) + 1;
      // Exponential gaps (random, memoryless) with a firmware minimum.
      const mean = 60 / Math.max(1, e.taskRate);
      const gap = Math.max(TASK_MIN_GAP, show + 2 * fade + 0.5);
      t.next = gap + -Math.log(1 - t.rng()) * Math.max(0, mean - gap);
    }
    if (!t.active) return null;
    const u = t.active.t;
    const env = u < fade ? smooth(u / fade) : u < fade + show ? 1 : smooth(clamp01((show + 2 * fade - u) / fade));
    return { ...t.active, env };
  }

  _alternating(dt, out, moving) {
    const a = this.programme.alternating;
    const f = Math.min(ALTERNATING_MAX_HZ, Math.max(0.1, a.speed)); // firmware cap
    if (moving) this.altPhase = (this.altPhase + f * dt) % 1;
    if (this.set.state === 'running' && this.set.elapsed >= a.setSeconds) this.stopSet();
    const [lo, hi] = this.travelRange();
    const seg = (a.segment / 100) * this.length;
    const edge = Math.max(0, Math.min(0.5, a.rise * 0.5));
    const vl = softWindow(this.altPhase, 0, 0.5, edge * 0.5 + 1e-9);
    const vr = softWindow(this.altPhase, 0.5, 1, edge * 0.5 + 1e-9);
    for (let i = 0; i < this.n; i++) {
      const x = this.xs[i];
      const inL = clamp01((lo + seg - x) / this.pitch + 0.5) * clamp01((x - lo) / this.pitch + 0.5);
      const inR = clamp01((x - (hi - seg)) / this.pitch + 0.5) * clamp01((hi - x) / this.pitch + 0.5);
      const v = inL * vl + inR * vr;
      for (let c = 0; c < 4; c++) out[i * 4 + c] = a.color[c] * a.brightness * v;
    }
    return vl >= vr ? lo + seg / 2 : hi - seg / 2;
  }

  _renderAmbient(frame) {
    const a = this.programme.ambient;
    let c1 = a.useCct ? rgbwForCct(this.strip, a.cct) : a.color;
    if (a.effect === 'drift') {
      const t = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.time) / Math.max(30, a.period));
      c1 = lerpColor(c1, a.color2, t);
    }
    for (let i = 0; i < this.n; i++) {
      const col = a.effect === 'gradient' ? lerpColor(c1, a.color2, i / Math.max(1, this.n - 1)) : c1;
      for (let c = 0; c < 4; c++) frame[i * 4 + c] = col[c] * a.brightness;
    }
  }

  _clockColour(progress) {
    const c = this.programme.clock;
    const stops = [0, 0.3, 0.6, 1.0];
    const keys = c.keys;
    if (c.interp === 'steps') {
      // Colour A until 30 %, B until 60 %, C until 100 %; slow cross-fade at each boundary.
      const dur = c.minutes * 60;
      const fadeFrac = Math.min(0.1, c.stepFade / Math.max(1, dur));
      let col = keys[1];
      if (progress >= 0.3) col = lerpColor(keys[1], keys[2], clamp01((progress - 0.3) / fadeFrac));
      if (progress >= 0.6) col = lerpColor(keys[2], keys[3], clamp01((progress - 0.6) / fadeFrac));
      return col;
    }
    for (let k = 0; k < 3; k++) {
      if (progress <= stops[k + 1]) {
        return lerpColor(keys[k], keys[k + 1], (progress - stops[k]) / (stops[k + 1] - stops[k]));
      }
    }
    return keys[3];
  }

  // Returns the therapist-facing indicator level (discreet warning, FR-CL-06).
  _renderClock(frame, cs) {
    const c = this.programme.clock;
    let col = this._clockColour(cs.progress);
    let level = c.brightness;
    let indicator = 0;
    if (c.encode === 'brightness') level *= 0.4 + 0.6 * cs.progress;
    if (cs.warning) {
      const into = (c.warnMin * 60 - cs.remaining) / this.clock.timeScale; // real seconds
      if (c.warnMode === 'discreet') {
        indicator = clamp01(into / 3); // soft fade-in, steady
      } else {
        // Overt: gentle 0.1 Hz breathing of +-20 % (SR-CO-04, no blink).
        const ramp = clamp01(into / 5);
        level *= 1 - 0.2 * ramp * (0.5 - 0.5 * Math.cos(2 * Math.PI * 0.1 * this.time));
        col = lerpColor(col, c.keys[3], 0.5 * ramp);
      }
    }
    const fill = cs.progress * this.length;
    for (let i = 0; i < this.n; i++) {
      let v = 1;
      if (c.encode === 'fill') {
        const cov = clamp01((fill - (this.xs[i] - this.pitch / 2)) / this.pitch);
        v = 0.12 + 0.88 * cov;
      }
      for (let k = 0; k < 4; k++) frame[i * 4 + k] = col[k] * level * v;
    }
    return indicator;
  }

  _renderBreathing(frame, dt) {
    const b = this.programme.breathing;
    const phases = [b.inhale, b.hold1, b.exhale, b.hold2].map((v) => Math.max(0, v));
    const total = phases.reduce((a, v) => a + v, 0) || 1;
    this.breath = (this.breath + dt) % total;
    let t = this.breath;
    let v = 0;
    if (t < phases[0]) v = 0.5 - 0.5 * Math.cos((Math.PI * t) / phases[0]);
    else if ((t -= phases[0]) < phases[1]) v = 1;
    else if ((t -= phases[1]) < phases[2]) v = 0.5 + 0.5 * Math.cos((Math.PI * t) / phases[2]);
    else v = 0;
    this.breathValue = v;
    // Colour: one colour, a blend that follows the breath, or one colour per phase.
    let col = b.color;
    if (b.colorMode === 'follow') col = lerpColor(b.colorOut, b.colorIn, v);
    else if (b.colorMode === 'phase') {
      const tb = this.breath;
      const exStart = phases[0] + phases[1];
      const f = Math.max(0.05, b.colorFade);
      if (tb < exStart) col = lerpColor(b.colorOut, b.colorIn, smooth(clamp01(tb / f)));
      else col = lerpColor(b.colorIn, b.colorOut, smooth(clamp01((tb - exStart) / f)));
    }
    const centre = this.length / 2;
    for (let i = 0; i < this.n; i++) {
      let lv;
      if (b.style === 'width') {
        const half = (b.min + (1 - b.min) * v) * (this.length / 2);
        lv = clamp01((half - Math.abs(this.xs[i] - centre)) / (this.pitch * 2) + 0.5);
      } else {
        lv = b.min + (1 - b.min) * v;
      }
      for (let c = 0; c < 4; c++) frame[i * 4 + c] = col[c] * b.brightness * lv;
    }
  }

  _synthAudio(dt) {
    const m = this.programme.music;
    const beatT = (this.time * m.bpm) / 60;
    const ph = beatT % 1;
    const env = Math.exp(-ph * 60 / m.bpm / 0.12);
    const bar = Math.floor(beatT / 4);
    const mid = 0.45 + 0.3 * Math.sin(this.time * 2.1) * Math.sin(this.time * 0.37 + bar);
    const hat = Math.exp(-((beatT * 2) % 1) * 4) * 0.6;
    this.audio = { level: 0.25 + 0.6 * env + 0.15 * mid, bass: env, mid, treble: hat, beat: env };
  }

  _renderMusic(frame, dt) {
    const m = this.programme.music;
    if (this.sensitive) {
      this._fill(frame, [0, 0, 0, 1], 0.1); // music disabled in sensitive profile (SR-PH-05)
      return;
    }
    if (m.source === 'synth') this._synthAudio(dt);
    const A = this.audio;
    const s = m.sensitivity;
    const centre = this.length / 2;
    for (let i = 0; i < this.n; i++) {
      const x = this.xs[i];
      let col = m.color;
      let v = 0;
      if (m.effect === 'vu') {
        const half = clamp01(A.level * s) * (this.length / 2);
        v = clamp01((half - Math.abs(x - centre)) / this.pitch + 0.5);
      } else if (m.effect === 'bands') {
        const zone = Math.min(2, Math.floor((x / this.length) * 3));
        v = clamp01([A.bass, A.mid, A.treble][zone] * s);
        col = [
          [1, 0.25, 0, 0.1],
          [0.2, 0.5, 0.1, 0.3],
          [0.1, 0.25, 0.9, 0.2],
        ][zone];
      } else {
        v = clamp01(A.beat * s);
      }
      for (let c = 0; c < 4; c++) frame[i * 4 + c] = col[c] * m.brightness * v;
    }
  }

  _renderCustom(frame) {
    const code = this.programme.custom.code;
    if (code !== this.customSrc) {
      this.customSrc = code;
      try {
        // eslint-disable-next-line no-new-func
        this.customFn = new Function('i', 'n', 'x', 't', 's', code);
        this.customError = null;
      } catch (err) {
        this.customFn = null;
        this.customError = String(err.message || err);
      }
    }
    if (!this.customFn) return;
    try {
      for (let i = 0; i < this.n; i++) {
        const r = this.customFn(i, this.n, this.xs[i] / this.length, this.modeTime, this.customState);
        if (r)
          for (let c = 0; c < 4; c++) frame[i * 4 + c] = clamp01(Number(r[c]) || 0);
      }
      this.customError = null;
    } catch (err) {
      this.customError = String(err.message || err);
    }
  }

  status() {
    const e = this.programme.emdr;
    const eff = this.effectiveRate();
    return {
      power: this.power,
      mode: this.programme.mode,
      name: this.programme.name,
      setState: this.set.state,
      passes: this.set.passes,
      setElapsed: this.set.elapsed,
      speed: this._speed(),
      effRate: eff,
      passesPerMin: eff * 2 * 60,
      dwell: e.dwell,
      altRate: Math.min(ALTERNATING_MAX_HZ, this.programme.alternating.speed),
      clock: this.clockStatus(),
      customError: this.customError,
      task: this.programme.mode === 'emdr' && this.programme.emdr.task !== 'off' ? this.taskAnswer() : null,
    };
  }
}
