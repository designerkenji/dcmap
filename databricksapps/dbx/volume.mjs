// Reading the registry's data out of a Unity Catalog volume.
//
// A Databricks App does NOT mount /Volumes and does not ship dbutils, so
// "/Volumes/dcmap/app/data" is not a path from inside the container - it is a
// REST API. Everything here goes through the Files API
// (GET /api/2.0/fs/files/<path>), as the app's service principal.
//
// TWO STRATEGIES, AND THE REASON THERE ARE TWO.
//
//   stage()     Mirrors the volume onto the container's local disk ONCE at
//               startup, into the directory dcmap already reads. That is what
//               lets dcmap run BYTE-FOR-BYTE UNMODIFIED: its data layer is
//               ~60 synchronous fs.readFileSync calls spread over a dozen
//               modules, and making those async would be a larger change than
//               this whole app. The disk is ephemeral, which is exactly right
//               for a read-through cache whose durable home is the volume.
//
//   openRange() Proxies one Range request straight through, for the files that
//               must NOT be staged: basemap.pmtiles is 1.6 GB and PMTiles
//               reads a few kilobytes of it at a time. The Files API honours
//               Range, so dcmap's own client code cannot tell the difference.

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const VOLUME = (process.env.DCMAP_VOLUME || '').replace(/\/+$/, '');
const EPOCH_VOLUME = (process.env.DCMAP_EPOCH_VOLUME || '').replace(/\/+$/, '');
const HOST = (process.env.DATABRICKS_HOST || '').replace(/\/+$/, '');

export const enabled = () => !!VOLUME;

// The volume path for something under data/. The tile routes use this to ask
// for a file stage() deliberately left behind.
export const dataPath = (...parts) => [VOLUME, ...parts].join('/');

// ---- auth ------------------------------------------------------------------
// There is no official Databricks SDK for Node, so this is the whole of it:
// client credentials against the workspace's OIDC endpoint, cached until they
// expire. DATABRICKS_CLIENT_ID/SECRET are injected into every app container;
// nothing here needs a PAT and nothing here should ever be given one.
let tok = null;

async function token() {
  if (tok && tok.expiresAt > Date.now() + 60_000) return tok.value;
  const id = process.env.DATABRICKS_CLIENT_ID;
  const secret = process.env.DATABRICKS_CLIENT_SECRET;
  const r = await fetch(`${HOST}/oidc/v1/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'all-apis' }),
  });
  if (!r.ok) throw new Error(`oidc token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  tok = { value: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
  return tok.value;
}

// encodeURI, not encodeURIComponent: the slashes are path separators and must
// survive, but the glyph fontstacks are directories with SPACES in their names
// ("Noto Sans Regular") and an unencoded space is a malformed request line.
//
// The HOST check is here rather than only in token() because it has to run
// FIRST: an empty DATABRICKS_HOST otherwise builds an origin-less URL and the
// operator gets `Invalid URL: /api/2.0/fs/...` from deep inside a fetch,
// instead of being told which variable is missing.
function api(kind, p) {
  if (!HOST) throw new Error('DCMAP_VOLUME is set but DATABRICKS_HOST is not - '
    + 'a volume is only reachable from inside a Databricks App');
  return `${HOST}/api/2.0/fs/${kind}${encodeURI(p)}`;
}

const get = async (url, extra = {}) =>
  fetch(url, { headers: { Authorization: `Bearer ${await token()}`, ...extra } });

// ---- listing ---------------------------------------------------------------

async function listDir(dir) {
  const out = [];
  let pageToken = '';
  do {
    const u = new URL(api('directories', dir));
    u.searchParams.set('page_size', '1000');
    if (pageToken) u.searchParams.set('page_token', pageToken);
    const r = await get(u.toString());
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`list ${dir} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    out.push(...(j.contents || []));
    pageToken = j.next_page_token || '';
  } while (pageToken);
  return out;
}

// ---- staging ---------------------------------------------------------------

// What never gets staged, and why each one is here:
//
//   *.pmtiles   1.6 GB for the basemap alone. Range-proxied instead.
//   glyphs/     512 small files of which a session touches about six. Fetched
//               on demand and memoised, which beats 512 round trips at boot.
//   *_cache/    pipeline scratch (parcels_regrid_cache is 1,562 entries). Only
//               src/*.py has ever read it.
//   runlogs/    pipeline run output, which is a job's business now.
const SKIP_DIR = (n) => n === 'glyphs' || n === 'runlogs' || n.endsWith('_cache');
const SKIP_FILE = (n) => n.endsWith('.pmtiles');

async function mirror(srcDir, destDir, stats) {
  fs.mkdirSync(destDir, { recursive: true });
  const jobs = [];
  for (const e of await listDir(srcDir)) {
    if (e.is_directory) {
      if (SKIP_DIR(e.name)) { stats.skipped++; continue; }
      jobs.push(() => mirror(`${srcDir}/${e.name}`, path.join(destDir, e.name), stats));
      continue;
    }
    if (SKIP_FILE(e.name)) { stats.skipped++; continue; }
    jobs.push(async () => {
      const r = await get(api('files', `${srcDir}/${e.name}`));
      if (!r.ok) throw new Error(`get ${srcDir}/${e.name} -> ${r.status}`);
      // Straight to disk, never through a Buffer: footprints.geojson is 25 MB
      // and there is no reason for it to exist twice in a 6 GB container.
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(path.join(destDir, e.name)));
      stats.files++;
      stats.bytes += e.file_size || 0;
    });
  }
  await pool(jobs, 8);
}

// Eight at a time. The Files API is latency bound, not bandwidth bound, so
// this turns ~90 sequential round trips into ~11.
async function pool(jobs, n) {
  const running = new Set();
  for (const job of jobs) {
    const p = job().finally(() => running.delete(p));
    running.add(p);
    if (running.size >= n) await Promise.race(running);
  }
  await Promise.all(running);
}

// Mirror the volume into the directories dcmap reads.
//
// Throws on failure rather than carrying on: an app that silently serves an
// empty map is worse than one that refuses to start, because the empty map
// looks like a data problem and is a startup one.
export async function stage({ data, epoch }) {
  if (!enabled()) return null;
  const missing = ['DATABRICKS_HOST', 'DATABRICKS_CLIENT_ID', 'DATABRICKS_CLIENT_SECRET']
    .filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`DCMAP_VOLUME is set but ${missing.join(', ')} `
      + `${missing.length > 1 ? 'are' : 'is'} not - a volume is only reachable from `
      + 'inside a Databricks App. Unset DCMAP_VOLUME to run against local files.');
  }
  const t0 = Date.now();
  const stats = { files: 0, bytes: 0, skipped: 0 };
  await mirror(VOLUME, data, stats);
  // The Epoch release sits beside data/ rather than inside it, so it gets its
  // own volume directory too.
  if (EPOCH_VOLUME) await mirror(EPOCH_VOLUME, epoch, stats);
  console.log(`[dbx] staged ${stats.files} file(s), ${(stats.bytes / 1048576).toFixed(1)} MB `
    + `from ${VOLUME} in ${Date.now() - t0} ms (${stats.skipped} left on the volume)`);
  return stats;
}

// ---- range proxy -----------------------------------------------------------

// One Range request against one volume file, passed through to the client.
// Returns null when the file is not there, so the tile routes keep the
// graceful absence dcmap already has: a workspace where basemap_tiles.py has
// never run degrades to the map it had before rather than 500ing.
export async function openRange(volPath, rangeHeader) {
  const r = await get(api('files', volPath), rangeHeader ? { Range: rangeHeader } : {});
  if (r.status === 404) return null;
  if (!r.ok && r.status !== 206) throw new Error(`range ${volPath} -> ${r.status}`);
  return {
    status: r.status,
    length: r.headers.get('content-length'),
    range: r.headers.get('content-range'),
    body: r.body,
  };
}

// Whole small file, memoised. Only the glyph ranges use this: 512 exist, a
// session touches a handful, and they are immutable font data - so the right
// cache size is "however many were asked for".
const memo = new Map();

export async function cachedFile(volPath) {
  if (memo.has(volPath)) return memo.get(volPath);
  const r = await get(api('files', volPath));
  const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  memo.set(volPath, buf);
  return buf;
}
