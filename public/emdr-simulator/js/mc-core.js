// Monte Carlo photon transport through the diffuser stack of one LED.
// Pure module (no DOM): used by mc-worker.js and by the Node tests.
//
// Geometry (all lengths in mm):
//   x  along the bar (infinite; neighbouring LEDs are added later by superposition)
//   y  across the face, groove walls at y = ±width/2
//   z  depth, LED/PCB plane at z = 0, layers stacked upward, face exit at z = sum(t)
// One photon carries three weights (R, G, B bands). Scattering is band-independent,
// absorption (mua) and wall/floor reflectance are per band.

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Unpolarised Fresnel reflectance; returns 1 for total internal reflection.
export function fresnel(n1, n2, cosi) {
  if (n1 === n2) return 0;
  const sint2 = (n1 / n2) ** 2 * (1 - cosi * cosi);
  if (sint2 >= 1) return 1;
  const cost = Math.sqrt(1 - sint2);
  const rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
  const rp = (n1 * cost - n2 * cosi) / (n1 * cost + n2 * cosi);
  return 0.5 * (rs * rs + rp * rp);
}

const LUMA = [0.2126, 0.7152, 0.0722];

export function createAccumulators(cfg) {
  const g = cfg.grid;
  const s = cfg.section;
  return {
    photons: 0,
    exitAll: new Float64Array(g.nx * g.ny * 3),
    exitCone: new Float64Array(g.nx * g.ny * 3),
    exitTotal: new Float64Array(3), // all photons leaving the face (incl. outside grid)
    absVolume: new Float64Array(3),
    absWall: new Float64Array(3),
    absFloor: new Float64Array(3),
    lost: new Float64Array(3), // roulette / step-limit losses
    angular: new Float64Array(18), // exit polar angle, 5° bins, luminance-weighted
    fluenceYZ: new Float64Array(s.ny * s.nz),
    fluenceXZ: new Float64Array(s.nx * s.nz),
    paths: [],
  };
}

// Prepare derived geometry once per configuration.
function prepare(cfg) {
  const layers = cfg.layers;
  const zb = [];
  const zt = [];
  let z = 0;
  for (const L of layers) {
    zb.push(z);
    z += L.t;
    zt.push(z);
  }
  return { zb, zt, ztop: z };
}

// Cosine-weighted direction about axis +z (or -z if sign < 0).
function lambertZ(rng, sign, out) {
  const r1 = rng();
  const phi = 2 * Math.PI * rng();
  const st = Math.sqrt(r1);
  out[0] = st * Math.cos(phi);
  out[1] = st * Math.sin(phi);
  out[2] = sign * Math.sqrt(1 - r1);
}

// Cosine-weighted direction about axis ±y.
function lambertY(rng, sign, out) {
  const r1 = rng();
  const phi = 2 * Math.PI * rng();
  const st = Math.sqrt(r1);
  out[0] = st * Math.cos(phi);
  out[2] = st * Math.sin(phi);
  out[1] = sign * Math.sqrt(1 - r1);
}

// Henyey-Greenstein scattering: rotate direction u in place.
function scatterHG(rng, g, u) {
  let cost;
  if (Math.abs(g) < 1e-4) cost = 2 * rng() - 1;
  else {
    const f = (1 - g * g) / (1 - g + 2 * g * rng());
    cost = (1 + g * g - f * f) / (2 * g);
    if (cost > 1) cost = 1;
    else if (cost < -1) cost = -1;
  }
  const sint = Math.sqrt(1 - cost * cost);
  const phi = 2 * Math.PI * rng();
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const [ux, uy, uz] = u;
  if (Math.abs(uz) > 0.99999) {
    u[0] = sint * cp;
    u[1] = sint * sp;
    u[2] = Math.sign(uz) * cost;
  } else {
    const tmp = Math.sqrt(1 - uz * uz);
    u[0] = (sint * (ux * uz * cp - uy * sp)) / tmp + ux * cost;
    u[1] = (sint * (uy * uz * cp + ux * sp)) / tmp + uy * cost;
    u[2] = -sint * cp * tmp + uz * cost;
  }
}

// Run `count` photons, adding into accumulators `acc`.
// opts.fluenceLimit: only the first N photons (acc.photons < N) deposit fluence.
// opts.maxPaths: number of photon paths to keep for display.
export function runPhotons(cfg, acc, count, rng, opts = {}) {
  const { zb, zt, ztop } = prepare(cfg);
  const layers = cfg.layers;
  const nL = layers.length;
  const half = cfg.width / 2;
  const es = cfg.emitter;
  const { nx, ny, rx } = cfg.grid;
  const sec = cfg.section;
  const cosCone = Math.cos((cfg.coneDeg * Math.PI) / 180);
  const wallR = cfg.wall.R;
  const wallSpec = !!cfg.wall.specular;
  const floorR = cfg.floorR;
  const fluenceLimit = opts.fluenceLimit ?? 0;
  const maxPaths = opts.maxPaths ?? 0;
  const secDy = cfg.width / sec.ny;
  const secDz = Math.max(ztop, 1e-6) / sec.nz;
  const secDx = (2 * rx) / sec.nx;
  const depStep = Math.min(secDy, secDz, secDx);
  const u = [0, 0, 1];
  const w = [1, 1, 1];
  const EPS = 1e-7;

  for (let p = 0; p < count; p++) {
    let x = (rng() - 0.5) * es;
    let y = (rng() - 0.5) * Math.min(es, cfg.width);
    let z = EPS;
    lambertZ(rng, 1, u);
    w[0] = w[1] = w[2] = 1;
    let li = 0;
    const doFluence = acc.photons < fluenceLimit;
    const path = acc.paths.length < maxPaths ? [x, y, z] : null;
    let alive = true;
    let steps = 0;

    while (alive) {
      if (++steps > 20000) {
        for (let c = 0; c < 3; c++) acc.lost[c] += w[c];
        break;
      }
      const L = layers[li];
      const s = L.mus > 0 ? -Math.log(1 - rng()) / L.mus : Infinity;
      let dz = Infinity;
      if (u[2] > 0) dz = (zt[li] - z) / u[2];
      else if (u[2] < 0) dz = (zb[li] - z) / u[2];
      let dy = Infinity;
      if (u[1] > 0) dy = (half - y) / u[1];
      else if (u[1] < 0) dy = (-half - y) / u[1];
      let d = s;
      let event = 0; // 0 scatter, 1 z-boundary, 2 wall
      if (dz < d) {
        d = dz;
        event = 1;
      }
      if (dy < d) {
        d = dy;
        event = 2;
      }
      if (!isFinite(d)) {
        for (let c = 0; c < 3; c++) acc.lost[c] += w[c];
        break;
      }
      if (d < 0) d = 0;

      // Fluence deposit along the segment (track-length estimator).
      if (doFluence && d > 0) {
        const lum = LUMA[0] * w[0] + LUMA[1] * w[1] + LUMA[2] * w[2];
        const n = Math.max(1, Math.ceil(d / depStep));
        const h = d / n;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) * h;
          const px = x + u[0] * t;
          const py = y + u[1] * t;
          const pz = z + u[2] * t;
          const iz = Math.min(sec.nz - 1, Math.max(0, Math.floor(pz / secDz)));
          const iy = Math.min(sec.ny - 1, Math.max(0, Math.floor((py + half) / secDy)));
          acc.fluenceYZ[iz * sec.ny + iy] += lum * h;
          const ix = Math.floor((px + rx) / secDx);
          if (ix >= 0 && ix < sec.nx) acc.fluenceXZ[iz * sec.nx + ix] += lum * h;
        }
      }

      x += u[0] * d;
      y += u[1] * d;
      z += u[2] * d;
      if (L.muaR || L.muaG || L.muaB) {
        const a0 = Math.exp(-L.muaR * d);
        const a1 = Math.exp(-L.muaG * d);
        const a2 = Math.exp(-L.muaB * d);
        acc.absVolume[0] += w[0] * (1 - a0);
        acc.absVolume[1] += w[1] * (1 - a1);
        acc.absVolume[2] += w[2] * (1 - a2);
        w[0] *= a0;
        w[1] *= a1;
        w[2] *= a2;
      }

      if (event === 0) {
        scatterHG(rng, L.g, u);
      } else if (event === 2) {
        // Groove wall.
        const side = u[1] > 0 ? 1 : -1;
        y = side * (half - EPS);
        for (let c = 0; c < 3; c++) {
          acc.absWall[c] += w[c] * (1 - wallR[c]);
          w[c] *= wallR[c];
        }
        if (wallSpec) u[1] = -u[1];
        else lambertY(rng, -side, u);
      } else {
        // z boundary.
        if (u[2] < 0 && li === 0) {
          z = EPS;
          for (let c = 0; c < 3; c++) {
            acc.absFloor[c] += w[c] * (1 - floorR[c]);
            w[c] *= floorR[c];
          }
          lambertZ(rng, 1, u);
        } else {
          const up = u[2] > 0;
          const nj = up ? li + 1 : li - 1;
          const n1 = L.n;
          const n2 = nj >= nL ? 1.0 : layers[nj].n;
          z = up ? zt[li] : zb[li];
          let crossed = true;
          if (n1 !== n2) {
            const cosi = Math.abs(u[2]);
            const R = fresnel(n1, n2, cosi);
            if (rng() < R) {
              u[2] = -u[2];
              crossed = false;
            } else {
              const ratio = n1 / n2;
              u[0] *= ratio;
              u[1] *= ratio;
              const st2 = u[0] * u[0] + u[1] * u[1];
              u[2] = (up ? 1 : -1) * Math.sqrt(Math.max(0, 1 - st2));
            }
          }
          if (crossed) {
            li = nj;
            z += up ? EPS : -EPS;
            if (li >= nL) {
              // Left the face into air.
              acc.exitTotal[0] += w[0];
              acc.exitTotal[1] += w[1];
              acc.exitTotal[2] += w[2];
              const ix = Math.floor(((x + rx) / (2 * rx)) * nx);
              const iy = Math.floor(((y + half) / cfg.width) * ny);
              if (ix >= 0 && ix < nx && iy >= 0 && iy < ny) {
                const k = (iy * nx + ix) * 3;
                acc.exitAll[k] += w[0];
                acc.exitAll[k + 1] += w[1];
                acc.exitAll[k + 2] += w[2];
                if (u[2] >= cosCone) {
                  acc.exitCone[k] += w[0];
                  acc.exitCone[k + 1] += w[1];
                  acc.exitCone[k + 2] += w[2];
                }
              }
              const th = (Math.acos(Math.min(1, u[2])) * 180) / Math.PI;
              acc.angular[Math.min(17, Math.floor(th / 5))] +=
                LUMA[0] * w[0] + LUMA[1] * w[1] + LUMA[2] * w[2];
              alive = false;
            }
          }
        }
      }

      if (path) {
        path.push(x, y, z);
        if (path.length > 1500) path.length = 1500;
      }

      if (alive) {
        const m = Math.max(w[0], w[1], w[2]);
        if (m < 1e-3) {
          if (rng() < 0.1) {
            w[0] *= 10;
            w[1] *= 10;
            w[2] *= 10;
          } else {
            alive = false;
          }
        }
      }
    }
    if (path) acc.paths.push(path);
    acc.photons++;
  }
  return acc;
}
