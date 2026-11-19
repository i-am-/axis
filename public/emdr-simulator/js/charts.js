// Minimal 2-D canvas charts (line plots, heat maps) with HiDPI support.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function prepCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function niceTicks(a, b, n = 5) {
  const span = b - a || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmt = (v) => {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (a >= 10 || v === 0) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
};

// series: [{ x: Float32Array|Array, y: ..., color, width, dash, label, fill }]
export function linePlot(canvas, { series, xlim, ylim, xlabel, ylabel, title, marks, bands, rect }) {
  const { g, w, h } = rect ? { g: canvas.getContext('2d'), w: rect.w, h: rect.h } : prepCanvas(canvas);
  const ox = rect?.x ?? 0;
  const oy = rect?.y ?? 0;
  const pad = { l: 44, r: 10, t: title ? 20 : 8, b: xlabel ? 30 : 18 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  let [x0, x1] = xlim ?? [0, 1];
  let [y0, y1] = ylim ?? autoY(series);
  if (y1 <= y0) y1 = y0 + 1;
  const X = (v) => ox + pad.l + ((v - x0) / (x1 - x0)) * pw;
  const Y = (v) => oy + pad.t + ph - ((v - y0) / (y1 - y0)) * ph;
  const ink = css('--ink-2');
  const grid = css('--grid');
  g.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
  g.lineWidth = 1;
  if (title) {
    g.fillStyle = css('--ink');
    g.font = '600 11px "IBM Plex Sans", system-ui, sans-serif';
    g.fillText(title, ox + pad.l, oy + 13);
    g.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
  }
  for (const b of bands ?? []) {
    g.fillStyle = b.color;
    g.fillRect(X(b.x0), oy + pad.t, X(b.x1) - X(b.x0), ph);
  }
  g.strokeStyle = grid;
  g.fillStyle = ink;
  g.textAlign = 'right';
  for (const t of niceTicks(y0, y1, 4)) {
    g.beginPath();
    g.moveTo(ox + pad.l, Y(t) + 0.5);
    g.lineTo(ox + pad.l + pw, Y(t) + 0.5);
    g.stroke();
    g.fillText(fmt(t), ox + pad.l - 5, Y(t) + 3.5);
  }
  g.textAlign = 'center';
  for (const t of niceTicks(x0, x1, 6)) {
    g.fillText(fmt(t), X(t), oy + pad.t + ph + 13);
  }
  if (xlabel) g.fillText(xlabel, ox + pad.l + pw / 2, oy + h - 4);
  if (ylabel) {
    g.save();
    g.translate(ox + 10, oy + pad.t + ph / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(ylabel, 0, 0);
    g.restore();
  }
  for (const m of marks ?? []) {
    g.strokeStyle = m.color;
    g.setLineDash(m.dash ?? [3, 3]);
    g.beginPath();
    if (m.y !== undefined) {
      g.moveTo(ox + pad.l, Y(m.y));
      g.lineTo(ox + pad.l + pw, Y(m.y));
    } else {
      g.moveTo(X(m.x), oy + pad.t);
      g.lineTo(X(m.x), oy + pad.t + ph);
    }
    g.stroke();
    g.setLineDash([]);
    if (m.label) {
      g.fillStyle = m.color;
      g.textAlign = 'left';
      g.fillText(m.label, m.y !== undefined ? ox + pad.l + 4 : X(m.x) + 3, m.y !== undefined ? Y(m.y) - 3 : oy + pad.t + 10);
    }
  }
  g.save();
  g.beginPath();
  g.rect(ox + pad.l, oy + pad.t, pw, ph);
  g.clip();
  for (const s of series) {
    if (!s.y?.length) continue;
    g.strokeStyle = s.color;
    g.lineWidth = s.width ?? 1.5;
    g.setLineDash(s.dash ?? []);
    g.beginPath();
    let started = false;
    for (let i = 0; i < s.y.length; i++) {
      const yv = s.y[i];
      if (yv === null || Number.isNaN(yv)) {
        started = false;
        continue;
      }
      const px = X(s.x[i]);
      const py = Y(yv);
      if (!started) {
        g.moveTo(px, py);
        started = true;
      } else g.lineTo(px, py);
    }
    g.stroke();
    if (s.fill) {
      g.lineTo(X(s.x[s.x.length - 1]), Y(y0));
      g.lineTo(X(s.x[0]), Y(y0));
      g.closePath();
      g.fillStyle = s.fill;
      g.fill();
    }
    g.setLineDash([]);
  }
  g.restore();
  // Legend.
  const labelled = series.filter((s) => s.label);
  g.textAlign = 'left';
  let lx = ox + pad.l + pw;
  for (const s of labelled.slice().reverse()) {
    const tw = g.measureText(s.label).width;
    lx -= tw + 22;
    g.fillStyle = s.color;
    g.fillRect(lx, oy + pad.t + 4, 12, 2.5);
    g.fillStyle = ink;
    g.fillText(s.label, lx + 15, oy + pad.t + 8);
  }
}

function autoY(series) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series)
    for (const v of s.y ?? []) {
      if (v === null || Number.isNaN(v)) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  if (!isFinite(lo)) return [0, 1];
  lo = Math.min(0, lo);
  return [lo, hi * 1.08 || 1];
}

// Perceptual "magma-like" map, t in 0..1.
export function heat(t) {
  const stops = [
    [0, 4, 4, 18],
    [0.25, 80, 18, 123],
    [0.5, 183, 55, 121],
    [0.75, 252, 137, 97],
    [1, 252, 253, 191],
  ];
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
  }
  return stops[stops.length - 1].slice(1);
}

// Draw a heat map (data row-major, rows = z from bottom) into a rect, log scale.
export function heatMap(g, data, nx, nz, rect, { decades = 3 } = {}) {
  let max = 0;
  for (const v of data) max = Math.max(max, v);
  if (max <= 0) return;
  const img = g.createImageData(nx, nz);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const v = data[iz * nx + ix];
      const t = v > 0 ? 1 + Math.log10(v / max) / decades : 0;
      const [r, gg, b] = heat(t);
      const k = ((nz - 1 - iz) * nx + ix) * 4;
      img.data[k] = r;
      img.data[k + 1] = gg;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  const tmp = document.createElement('canvas');
  tmp.width = nx;
  tmp.height = nz;
  tmp.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, rect.x, rect.y, rect.w, rect.h);
}
