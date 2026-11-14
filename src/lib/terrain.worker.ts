// Builds the backdrop's terrain off the main thread (a few hundred ms on a
// phone), so the hero never waits for it.

import { buildTerrain, type BuildOptions } from './terrain';

self.onmessage = (e: MessageEvent<BuildOptions>) => {
  const built = buildTerrain(e.data);
  (self as unknown as Worker).postMessage(built, [built.data.buffer]);
};
