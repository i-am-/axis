// Runs the Monte Carlo in workers, turns the tallies into a point-spread function
// (luminance on the face per lumen of one LED) and derives diffuser metrics.

import { buildMcConfig } from './materials.js';

const LUMA = [0.2126, 0.7152, 0.0722];

export class OpticsSim {
  constructor(label, onUpdate) {
    this.label = label;
    this.onUpdate = onUpdate;
    this.workers = [];
    this.version = 0;
    this.cfg = null;
    this.ready = false;
  }

  stop() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }

  run(stack, { photons = 1_000_000, similarity = true, viewModel = 'cone', workers } = {}) {
    this.stop();
    this.version++;
    const version = this.version;
    this.stack = structuredClone(stack);
    this.viewModel = viewModel;
    this.cfg = buildMcConfig(stack, { similarity });
    const nW = workers ?? Math.max(1, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
    this.target = photons;
    this.parts = new Array(nW).fill(null);
    this.paths = null;
    this.ready = false;
    this._dirty = false;
    const per = Math.ceil(photons / nW);
    for (let k = 0; k < nW; k++) {
      const w = new Worker(new URL('./mc-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => {
        if (version !== this.version) return;
        this.parts[k] = ev.data;
        if (ev.data.paths && !this.paths) this.paths = ev.data.paths;
        this._schedule();
      };
      w.postMessage({
        cfg: this.cfg,
        seed: (Date.now() + k * 7919) >>> 0,
        batch: k === 0 ? 4000 : 10000,
        maxPhotons: per,
        fluenceLimit: Math.min(per, 60000),
        maxPaths: k === 0 ? 40 : 0,
      });
      this.workers.push(w);
    }
  }

  _schedule() {
    if (this._timer) {
      this._dirty = true;
      return;
    }
    this._compute();
    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._dirty) {
        this._dirty = false;
        this._compute();
      }
    }, 300);
  }

  _merge() {
    const parts = this.parts.filter(Boolean);
    const out = {};
    for (const key of ['exitAll', 'exitCone', 'exitTotal', 'absVolume', 'absWall', 'absFloor', 'lost', 'angular', 'fluenceYZ', 'fluenceXZ']) {
      const len = parts[0][key].length;
      const a = new Float64Array(len);
      for (const p of parts) for (let i = 0; i < len; i++) a[i] += p[key][i];
      out[key] = a;
    }
    out.photons = parts.reduce((s, p) => s + p.photons, 0);
    out.done = parts.length === this.parts.length && parts.every((p) => p.done);
    return out;
  }

  setViewModel(m) {
    this.viewModel = m;
    if (this.parts?.some(Boolean)) this._compute();
  }

  _compute() {
    if (!this.parts.some(Boolean)) return;
    const acc = this._merge();
    const { nx, ny, rx } = this.cfg.grid;
    const W = this.cfg.width;
    const N = acc.photons;
    const binArea = ((2 * rx) / nx) * (W / ny) * 1e-6; // m²
    const cone = this.viewModel === 'cone';
    const src = cone ? acc.exitCone : acc.exitAll;
    const omega = cone ? Math.PI * Math.sin((this.cfg.coneDeg * Math.PI) / 180) ** 2 : Math.PI;
    const scale = 1 / (N * binArea * omega); // cd/m² per lm
    // Fold the four symmetric quadrants, then smooth.
    const psf = new Float32Array(nx * ny * 4);
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++)
        for (let c = 0; c < 3; c++) {
          const v =
            src[(iy * nx + ix) * 3 + c] +
            src[(iy * nx + (nx - 1 - ix)) * 3 + c] +
            src[((ny - 1 - iy) * nx + ix) * 3 + c] +
            src[((ny - 1 - iy) * nx + (nx - 1 - ix)) * 3 + c];
          psf[(iy * nx + ix) * 4 + c] = (v / 4) * scale;
        }
    const sx = cone ? 1.1 : 0.8;
    blur(psf, nx, ny, sx, 0.7);
    let max = 0;
    for (let i = 0; i < psf.length; i++) if (psf[i] > max) max = psf[i];

    // Centre-line profile per band (middle half of the face width).
    const prof = [new Float32Array(nx), new Float32Array(nx), new Float32Array(nx)];
    const y0 = Math.floor(ny / 4);
    const y1 = Math.ceil((3 * ny) / 4);
    for (let iy = y0; iy < y1; iy++)
      for (let ix = 0; ix < nx; ix++) for (let c = 0; c < 3; c++) prof[c][ix] += psf[(iy * nx + ix) * 4 + c] / (y1 - y0);

    this.acc = acc;
    this.psf = psf;
    this.psfMax = max || 1;
    this.profile = prof;
    this.ready = true;
    this.onUpdate?.(this);
  }

  // Luminance-weighted 1-D centre-line PSF value at dx mm (linear interpolation).
  profileAt(c, dx) {
    const { nx, rx } = this.cfg.grid;
    const f = ((dx + rx) / (2 * rx)) * nx - 0.5;
    if (f < 0 || f > nx - 1) return 0;
    const i = Math.floor(f);
    const t = f - i;
    const p = this.profile[c];
    return p[i] * (1 - t) + p[Math.min(nx - 1, i + 1)] * t;
  }

  // Luminance (cd/m²) along the centre line for given per-LED emission (linear rgb, lm-weighted).
  lineProfile(emission, xs, samples) {
    const rx = this.cfg.grid.rx;
    const out = new Float32Array(samples.length);
    for (let s = 0; s < samples.length; s++) {
      const x = samples[s];
      let L = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = x - xs[i];
        if (dx <= -rx || dx >= rx) continue;
        const e = i * 4;
        if (!emission[e] && !emission[e + 1] && !emission[e + 2]) continue;
        L +=
          LUMA[0] * emission[e] * this.profileAt(0, dx) +
          LUMA[1] * emission[e + 1] * this.profileAt(1, dx) +
          LUMA[2] * emission[e + 2] * this.profileAt(2, dx);
      }
      out[s] = L;
    }
    return out;
  }

  metrics(pitch) {
    if (!this.ready) return null;
    const acc = this.acc;
    const N = acc.photons;
    const luma = (a) => (LUMA[0] * a[0] + LUMA[1] * a[1] + LUMA[2] * a[2]) / N;
    const { nx, ny, rx } = this.cfg.grid;
    // Single-LED centre-line profile (green band ~ luminance).
    const p = this.profile[1];
    let pmax = 0;
    for (const v of p) pmax = Math.max(pmax, v);
    let above = 0;
    for (const v of p) if (v >= pmax / 2) above++;
    const fwhm = (above * 2 * rx) / nx;
    // Uniform strip: sum of shifted PSFs over one pitch.
    const M = 48;
    let umin = Infinity;
    let umax = 0;
    const ripple = new Float32Array(M);
    for (let s = 0; s < M; s++) {
      const x = (s / (M - 1) - 0.5) * pitch;
      let u = 0;
      for (let k = -Math.ceil(rx / pitch); k <= Math.ceil(rx / pitch); k++) u += this.profileAt(1, x + k * pitch);
      ripple[s] = u;
      umin = Math.min(umin, u);
      umax = Math.max(umax, u);
    }
    // Across-width uniformity at the LED position under uniform drive.
    let cmin = Infinity;
    let cmax = 0;
    for (let iy = Math.floor(ny * 0.1); iy < Math.ceil(ny * 0.9); iy++) {
      let u = 0;
      for (let k = -Math.ceil(rx / pitch); k <= Math.ceil(rx / pitch); k++) {
        const f = ((k * pitch + rx) / (2 * rx)) * nx - 0.5;
        const ix = Math.round(f);
        if (ix >= 0 && ix < nx) u += this.psf[(iy * nx + ix) * 4 + 1];
      }
      cmin = Math.min(cmin, u);
      cmax = Math.max(cmax, u);
    }
    const ang = acc.angular;
    const angSum = ang.reduce((a, v) => a + v, 0) || 1;
    return {
      photons: N,
      target: this.target,
      done: acc.done,
      efficiency: luma(acc.exitTotal),
      absVolume: luma(acc.absVolume),
      absWall: luma(acc.absWall),
      absFloor: luma(acc.absFloor),
      tint: [0, 1, 2].map((c) => acc.exitTotal[c] / Math.max(1e-9, acc.exitTotal[1])),
      fwhm,
      uniformity: umax > 0 ? umin / umax : 0,
      crossUniformity: cmax > 0 ? cmin / cmax : 0,
      uniformPeak: umax, // cd/m² per lm per LED, uniform drive
      ripple,
      angular: Array.from(ang, (v) => v / angSum),
    };
  }
}

function blur(data, nx, ny, sx, sy) {
  const kern = (s) => {
    const r = Math.max(1, Math.ceil(2.5 * s));
    const k = [];
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-0.5 * (i / s) ** 2);
      k.push(v);
      sum += v;
    }
    return { r, k: k.map((v) => v / sum) };
  };
  const kx = kern(sx);
  const ky = kern(sy);
  const tmp = new Float32Array(data.length);
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++)
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let j = -kx.r; j <= kx.r; j++) {
          const jx = Math.min(nx - 1, Math.max(0, ix + j));
          v += data[(iy * nx + jx) * 4 + c] * kx.k[j + kx.r];
        }
        tmp[(iy * nx + ix) * 4 + c] = v;
      }
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++)
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let j = -ky.r; j <= ky.r; j++) {
          const jy = Math.min(ny - 1, Math.max(0, iy + j));
          v += tmp[(jy * nx + ix) * 4 + c] * ky.k[j + ky.r];
        }
        data[(iy * nx + ix) * 4 + c] = v;
      }
}
