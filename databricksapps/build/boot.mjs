// The Databricks App entry point.
//
// Three steps, in this order and for this reason:
//
//   1. Stage the volume into the directory dcmap reads. This MUST happen
//      before dcmap is imported: its loadAll() runs at module scope, and
//      against an unstaged directory it finds nothing and the app comes up
//      serving a map with no dots on it - which looks like a data problem and
//      is a startup-order one.
//
//   2. Import dcmap, unmodified, on an internal port. PORT is an environment
//      variable it already reads, so telling it where to listen needs no
//      change to it. The import is DYNAMIC because a static one would be
//      hoisted above step 1.
//
//   3. Put the front layer on the port the platform actually routes to.

import net from 'node:net';
import path from 'node:path';
import * as volume from './dbx/volume.mjs';
import { startProxy } from './dbx/proxy.mjs';

const HERE = import.meta.dirname;
const APP_PORT = Number(process.env.DATABRICKS_APP_PORT || process.env.PORT || 8787);
// Not routed by the platform - only DATABRICKS_APP_PORT is - so this is an
// implementation detail of the container, not a second way in.
const INNER_PORT = Number(process.env.DCMAP_INNER_PORT || 8799);

await volume.stage({
  data: path.join(HERE, 'data'),
  epoch: path.join(HERE, 'data_centers_from_EPOCH_AI'),
});

process.env.PORT = String(INNER_PORT);
await import('./server.mjs');
await listening(INNER_PORT);

startProxy({
  appPort: APP_PORT,
  innerPort: INNER_PORT,
  onListen: () => console.log(
    `[dbx] dcmap on :${INNER_PORT}; serving on :${APP_PORT}`
    + (volume.enabled() ? ' (volume-backed, tiles proxied)' : ' (local files)')),
});

// The dynamic import resolves when dcmap's module body finishes, and listen()
// is asynchronous - so the import returning is not the same as the socket
// being open. Poll for it rather than racing the first request.
async function listening(port, tries = 100) {
  for (let i = 0; i < tries; i++) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1')
        .on('connect', () => { s.end(); resolve(true); })
        .on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`dcmap never opened :${port}`);
}
