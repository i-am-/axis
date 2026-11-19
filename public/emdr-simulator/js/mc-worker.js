// Module worker: runs photon batches and posts cumulative accumulators.
import { makeRng, createAccumulators, runPhotons } from './mc-core.js';

self.onmessage = (ev) => {
  const { cfg, seed, batch, maxPhotons, fluenceLimit, maxPaths } = ev.data;
  const rng = makeRng(seed);
  const acc = createAccumulators(cfg);
  let first = true;
  const loop = () => {
    const n = Math.min(batch, maxPhotons - acc.photons);
    runPhotons(cfg, acc, n, rng, { fluenceLimit, maxPaths });
    self.postMessage({
      photons: acc.photons,
      exitAll: acc.exitAll,
      exitCone: acc.exitCone,
      exitTotal: acc.exitTotal,
      absVolume: acc.absVolume,
      absWall: acc.absWall,
      absFloor: acc.absFloor,
      lost: acc.lost,
      angular: acc.angular,
      fluenceYZ: acc.fluenceYZ,
      fluenceXZ: acc.fluenceXZ,
      paths: first ? acc.paths : null,
      done: acc.photons >= maxPhotons,
    });
    first = false;
    if (acc.photons < maxPhotons) setTimeout(loop, 0);
  };
  loop();
};
