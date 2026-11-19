// Firmware safety limiter and photosensitivity monitor (SR-PH-*, SR-CO-02, SR-EL-01).
// Pure module, no DOM.
//
// Flash analysis follows the WCAG 2.3.1 idea: a flash is a pair of opposing
// luminance transitions of >= 10 % of full scale where the darker state is < 0.8,
// measured over an area equal to the central 10° of the visual field at the
// configured viewing distance (a small moving point is not a flash; a big one may be).

export const SAFETY_DEFAULTS = {
  enabled: true,
  sensitive: false,
  maxBrightness: 0.6, // SR-CO-02 global cap (drive fraction)
  pointCap: 0.45, // SR-PH-09 moving-point cap
  sensitiveCap: 0.25, // SR-PH-05
  blueCap: 0.6, // SR-EL-01 blue channel cap
  slew: 2.0, // SR-PH-03: max drive change per second (area effects)
  flashLimit: 3, // SR-PH-01 flashes per second
  redFlashLimit: 1, // SR-PH-02 (stricter)
  flashDelta: 0.1, // WCAG: 10 % of max relative luminance
  bandLimit: 0.02, // SR-PH-08: max modulation amplitude in 3-60 Hz (fraction of full white)
  viewerDistance: 1.5, // m, sets the 10° analysis window
};

export const SIM_RATE = 120; // Hz firmware frame rate (Nyquist 60 Hz covers SR-PH-08 band)

class FlashCounter {
  constructor(delta) {
    this.delta = delta;
    this.dir = 0;
    this.lo = null;
    this.hi = null;
    this.times = [];
  }
  update(v, t) {
    const d = this.delta;
    if (this.lo === null) {
      this.lo = this.hi = v;
    }
    let fired = false;
    if (this.dir === 0) {
      if (v - this.lo >= d && this.lo < 0.8) {
        this.dir = 1;
        this.hi = v;
        fired = true;
      } else if (this.hi - v >= d && v < 0.8) {
        this.dir = -1;
        this.lo = v;
        fired = true;
      } else {
        this.lo = Math.min(this.lo, v);
        this.hi = Math.max(this.hi, v);
      }
    } else if (this.dir === 1) {
      if (v > this.hi) this.hi = v;
      else if (this.hi - v >= d) {
        if (v < 0.8) fired = true;
        this.dir = -1;
        this.lo = v;
      }
    } else {
      if (v < this.lo) this.lo = v;
      else if (v - this.lo >= d) {
        if (this.lo < 0.8) fired = true;
        this.dir = 1;
        this.hi = v;
      }
    }
    if (fired) this.times.push(t);
    while (this.times.length && this.times[0] <= t - 1) this.times.shift();
    return this.times.length; // transitions in the last second
  }
}

// Peak modulation amplitude of a signal in [f0, f1] Hz (Hann-windowed DFT).
export function bandAmplitude(buf, fs, f0, f1) {
  const N = buf.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += buf[i];
  mean /= N;
  let wsum = 0;
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    wsum += win[i];
  }
  const k0 = Math.max(1, Math.ceil((f0 * N) / fs));
  const k1 = Math.min(Math.floor(N / 2), Math.floor((f1 * N) / fs));
  let best = 0;
  let bestF = 0;
  for (let k = k0; k <= k1; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / N;
    for (let i = 0; i < N; i++) {
      const v = (buf[i] - mean) * win[i];
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    const amp = (2 * Math.hypot(re, im)) / wsum;
    if (amp > best) {
      best = amp;
      bestF = (k * fs) / N;
    }
  }
  return { amp: best, freq: bestF, mean };
}

// IEEE 1789 assessment for 100 % modulation PWM.
export function pwmAssessment(f) {
  if (f >= 3000) return { level: 'ok', text: `${f} Hz: no observable effect region (≥ 3 kHz)` };
  if (f >= 1250) return { level: 'warn', text: `${f} Hz: low-risk only (target ≥ 3 kHz)` };
  return { level: 'bad', text: `${f} Hz: below 1.25 kHz fail-stop (SR-PH-04)` };
}

class Analyzer {
  constructor(n, windows, cfg) {
    this.windows = windows;
    this.flash = windows.map(() => new FlashCounter(cfg.flashDelta));
    this.red = windows.map(() => new FlashCounter(cfg.flashDelta * 0.5));
    this.buf = new Float64Array(256);
    this.bufN = 0;
    this.band = { amp: 0, freq: 0, mean: 0 };
    this.flashRate = 0;
    this.redRate = 0;
    this.winFlash = new Int32Array(windows.length);
    this.winRed = new Int32Array(windows.length);
  }
  update(Y, R, t) {
    let maxF = 0;
    let maxR = 0;
    let barMean = 0;
    for (let i = 0; i < Y.length; i++) barMean += Y[i];
    barMean /= Y.length;
    this.windows.forEach(([a, b], w) => {
      let m = 0;
      let mr = 0;
      for (let i = a; i < b; i++) {
        m += Y[i];
        mr += R[i];
      }
      m /= b - a;
      mr /= b - a;
      const f = this.flash[w].update(m, t);
      const r = this.red[w].update(mr, t);
      this.winFlash[w] = f;
      this.winRed[w] = r;
      if (f > maxF) maxF = f;
      if (r > maxR) maxR = r;
    });
    this.flashRate = maxF / 2;
    this.redRate = maxR / 2;
    this.buf.copyWithin(0, 1);
    this.buf[this.buf.length - 1] = barMean;
    this.bufN++;
    if (this.bufN % 30 === 0) this.band = bandAmplitude(this.buf, SIM_RATE, 3, 60);
    this.barMean = barMean;
  }
}

export class SafetyLimiter {
  constructor(strip, cfg = {}) {
    this.cfg = { ...SAFETY_DEFAULTS, ...cfg };
    this.setStrip(strip);
  }

  setStrip(strip) {
    this.strip = strip;
    this.n = strip.count;
    this.pitch = 1000 / strip.ledsPerM;
    this.reset();
  }

  setConfig(cfg) {
    const old = this.cfg;
    this.cfg = { ...this.cfg, ...cfg };
    if (old.viewerDistance !== this.cfg.viewerDistance || old.flashDelta !== this.cfg.flashDelta) this.reset();
  }

  reset() {
    const n = this.n;
    const lw = 2 * this.cfg.viewerDistance * 1000 * Math.tan((5 * Math.PI) / 180); // mm
    const nw = Math.max(1, Math.min(n, Math.round(lw / this.pitch)));
    const stride = Math.max(1, Math.floor(nw / 4));
    const windows = [];
    for (let a = 0; a + nw <= n; a += stride) windows.push([a, a + nw]);
    if (!windows.length || windows[windows.length - 1][1] < n) windows.push([Math.max(0, n - nw), n]);
    this.windows = windows;
    this.windowMm = lw;
    this.pre = new Analyzer(n, windows, this.cfg);
    this.post = new Analyzer(n, windows, this.cfg);
    this.damp = new Float32Array(windows.length);
    this.dampGlobal = 0;
    this.avg = new Float32Array(n * 4);
    this.prev = new Float32Array(n * 4);
    this.Y = new Float32Array(n);
    this.R = new Float32Array(n);
    this.t = 0;
    this.stats = {};
    this.events = [];
    this._lastViol = {};
  }

  // Relative luminance (white channel at full = 1) and saturated-red quantity per LED.
  _lum(frame) {
    const f = this.strip.flux;
    const norm = f.w;
    for (let i = 0; i < this.n; i++) {
      const r = frame[i * 4];
      const g = frame[i * 4 + 1];
      const b = frame[i * 4 + 2];
      const w = frame[i * 4 + 3];
      this.Y[i] = (f.r * r + f.g * g + f.b * b + f.w * w) / norm;
      // Display-linear components; red counts when R/(R+G+B) >= 0.8.
      const er = (f.r * r) / 0.2126 + f.w * w * 2.0;
      const eg = (f.g * g) / 0.7152 + f.w * w * 0.8;
      const eb = (f.b * b) / 0.0722 + f.w * w * 0.2;
      const sat = er / (er + eg + eb + 1e-9);
      this.R[i] = sat >= 0.8 ? (f.r * r) / norm : 0;
    }
  }

  _event(id, msg) {
    const last = this._lastViol[id] ?? -10;
    if (this.t - last > 2) this.events.push({ t: this.t, id, msg });
    this._lastViol[id] = this.t;
    if (this.events.length > 80) this.events.shift();
  }

  process(input, kind, dt) {
    const c = this.cfg;
    const n = this.n;
    this.t += dt;
    this._lum(input);
    this.pre.update(this.Y, this.R, this.t);

    const out = input.slice();
    let capped = 0;
    let slewed = 0;
    if (c.enabled) {
      let cap = c.maxBrightness;
      if (c.sensitive) cap = Math.min(cap, c.sensitiveCap);
      if (kind === 'point') cap = Math.min(cap, c.pointCap);
      for (let i = 0; i < n; i++) {
        const k = i * 4;
        if (out[k + 2] > c.blueCap) out[k + 2] = c.blueCap;
        const m = Math.max(out[k], out[k + 1], out[k + 2], out[k + 3]);
        if (m > cap) {
          const s = cap / m;
          for (let j = 0; j < 4; j++) out[k + j] *= s;
          capped++;
        }
      }
      // Flash guard: damp modulation depth in windows that approach the limit.
      const need = 2 * c.flashLimit - 1;
      const needR = 2 * c.redFlashLimit - 1;
      this.windows.forEach((_, w) => {
        const hot = this.post.winFlash[w] >= need || this.post.winRed[w] >= needR;
        this.damp[w] = hot ? Math.min(1, this.damp[w] + dt * 8) : Math.max(0, this.damp[w] - dt * 0.15);
      });
      const bandHot = this.post.band.amp > c.bandLimit;
      this.dampGlobal = bandHot ? Math.min(1, this.dampGlobal + dt * 4) : Math.max(0, this.dampGlobal - dt * 0.1);
      const a = 1 - Math.exp(-dt / 0.7);
      for (let i = 0; i < n; i++) {
        let k = this.dampGlobal;
        this.windows.forEach(([lo, hi], w) => {
          if (i >= lo && i < hi && this.damp[w] > k) k = this.damp[w];
        });
        for (let j = 0; j < 4; j++) {
          const q = i * 4 + j;
          this.avg[q] += (out[q] - this.avg[q]) * a;
          if (k > 0) out[q] = this.avg[q] + (1 - k) * (out[q] - this.avg[q]);
        }
      }
      // Slew limit for area effects (SR-PH-03). A moving point is exempt: its
      // per-LED edges are fast by design and handled by the area-based flash guard.
      if (kind !== 'point') {
        const maxStep = c.slew * dt;
        for (let q = 0; q < out.length; q++) {
          const d = out[q] - this.prev[q];
          if (d > maxStep) {
            out[q] = this.prev[q] + maxStep;
            slewed++;
          } else if (d < -maxStep) {
            out[q] = this.prev[q] - maxStep;
            slewed++;
          }
        }
      }
    } else {
      for (let q = 0; q < out.length; q++) this.avg[q] = out[q];
    }
    this.prev.set(out);

    this._lum(out);
    this.post.update(this.Y, this.R, this.t);
    let peakY = 0;
    for (let i = 0; i < n; i++) peakY = Math.max(peakY, this.Y[i]);

    const s = {
      preFlash: this.pre.flashRate,
      postFlash: this.post.flashRate,
      preRed: this.pre.redRate,
      postRed: this.post.redRate,
      preBand: this.pre.band,
      postBand: this.post.band,
      damping: Math.max(this.dampGlobal, ...this.damp),
      capped,
      slewed,
      peakY,
      barMean: this.post.barMean,
      windowMm: this.windowMm,
    };
    if (s.postFlash > c.flashLimit) this._event('SR-PH-01', `Output ${s.postFlash.toFixed(1)} flashes/s`);
    if (s.preFlash > c.flashLimit && c.enabled) this._event('SR-PH-01-pre', `Programme requested ${s.preFlash.toFixed(1)} flashes/s; limiter engaged`);
    if (s.postRed > c.redFlashLimit) this._event('SR-PH-02', `Output ${s.postRed.toFixed(1)} red flashes/s`);
    if (s.postBand.amp > c.bandLimit)
      this._event('SR-PH-08', `Whole-bar modulation ${(s.postBand.amp * 100).toFixed(1)} % at ${s.postBand.freq.toFixed(1)} Hz`);
    this.stats = s;
    return out;
  }
}
