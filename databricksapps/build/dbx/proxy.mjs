// The front layer: everything Databricks needs that dcmap does not have.
//
// WHY A PROXY RATHER THAN A PATCH. dcmap is 2,000 lines of routing and 28
// render modules, and it works. The three things this deployment needs -
// tiles from a volume instead of a disk, writes refused, the platform's port -
// are all things you can do IN FRONT of a server without touching it. So
// dcmap runs unmodified on an internal port and this sits ahead of it, which
// means dcmap can be updated by re-running build.mjs and nothing here has to
// be re-applied or re-merged.
//
// It is also where Phases 1-4 land: the Genie chat route, the SQL endpoints
// and the Lakebase ledger all belong to this layer, not to dcmap.

import http from 'node:http';
import { pipeline, Readable } from 'node:stream';
import * as volume from './volume.mjs';

const READONLY = process.env.DCMAP_READONLY === '1';

// The three archives src/tiles.py and src/basemap_tiles.py produce. They are
// the one thing volume.stage() deliberately leaves behind - 1.6 GB downloaded
// at boot to answer requests for 16 KB at a time would be absurd.
const ARCHIVE = /^\/(basemap|water|transmission)\.pmtiles$/;
const GLYPH = /^\/glyphs\/([^/]+)\/(\d{1,5}-\d{1,5})\.pbf$/;

const MIME_PMTILES = 'application/octet-stream';
const MIME_PBF = 'application/x-protobuf';

const text = (res, code, body, type = 'text/plain') => {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

export function startProxy({ appPort, innerPort, onListen }) {
  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res, innerPort);
    } catch (err) {
      console.error(`[dbx] ${req.method} ${req.url} failed:`, err);
      if (!res.headersSent) text(res, 500, 'server error');
    }
  });
  server.listen(appPort, onListen);
  return server;
}

async function handle(req, res, innerPort) {
  // ONE GATE, not a check in each of dcmap's eleven write routes.
  //
  // Every one of them ends in a file under data/, and on this deployment that
  // file is a staged copy on a disk that is discarded at the next restart - so
  // the save would appear to work and be gone by morning. Refusing is the
  // honest version of that. It lifts when the ledger moves to Lakebase.
  if (READONLY && req.method !== 'GET' && req.method !== 'HEAD') {
    return text(res, 403, JSON.stringify({ error: 'this deployment is read-only - '
      + 'hand corrections are disabled until the ledger has a durable home' }),
      'application/json; charset=utf-8');
  }

  // Without a volume this whole layer is a pass-through and dcmap serves the
  // archives off its own disk, exactly as it does on a laptop. That is what
  // makes `node boot.mjs` locally a real test of this file rather than of a
  // different code path.
  if (volume.enabled()) {
    const arch = req.url.split('?')[0].match(ARCHIVE);
    if (arch) return archive(req, res, `${arch[1]}.pmtiles`);
    const gy = req.url.split('?')[0].match(GLYPH);
    if (gy) return glyph(req, res, gy[1], gy[2]);
  }
  return pass(req, res, innerPort);
}

// ---- volume-backed tiles ---------------------------------------------------

// The Range header goes through untouched and the status and Content-Range
// come back from upstream, so the PMTiles client cannot tell that the bytes
// came from a REST API rather than a file descriptor. That is the point:
// dcmap's public/app.js is unchanged.
async function archive(req, res, name) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'GET or HEAD');
  let got;
  try {
    got = await volume.openRange(volume.dataPath('raw', name), req.headers.range || '');
  } catch (err) {
    console.error(`[dbx] volume range failed on ${name}:`, err.message);
    return text(res, 502, 'could not read that archive');
  }
  // Absent, not broken: a workspace where the tile scripts have never run gets
  // the same polite 404 dcmap gives, and the map degrades rather than filling
  // the console with failures.
  if (!got) return text(res, 404, 'not found');
  const head = {
    'Content-Type': MIME_PMTILES,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (got.length) head['Content-Length'] = got.length;
  if (got.range) head['Content-Range'] = got.range;
  res.writeHead(got.status, head);
  if (req.method === 'HEAD' || !got.body) return res.end();
  // pipeline(), not .pipe(): every pan of the map aborts the tiles that just
  // left the viewport, and the upstream response has to be destroyed with the
  // socket or the leak moves from file descriptors to sockets. dcmap's own
  // sendRange carries the measurement that taught this.
  pipeline(Readable.fromWeb(got.body), res, quiet(name));
}

async function glyph(req, res, rawStack, range) {
  let stack;
  try {
    stack = decodeURIComponent(rawStack);
  } catch {
    return text(res, 400, 'bad fontstack');
  }
  // decodeURIComponent is exactly what turns a %2e%2e back into a `..`, so the
  // check has to happen after it, not on what the client sent.
  if (stack.includes('/') || stack.includes('\\') || stack.split(/[.]/).includes('')
      || stack === '..' || stack.includes('..')) {
    return text(res, 400, 'bad fontstack');
  }
  const buf = await volume.cachedFile(volume.dataPath('raw', 'glyphs', stack, `${range}.pbf`));
  if (!buf) return text(res, 404, 'no such glyph range');
  res.writeHead(200, {
    'Content-Type': MIME_PBF,
    'Content-Length': buf.length,
    // A year. These are font data: they change when the font does, which is
    // never.
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') return res.end();
  res.end(buf);
}

// ---- pass-through ----------------------------------------------------------

// Headers go across verbatim, INCLUDING Accept-Encoding. dcmap pre-gzips its
// nine big payloads once at startup and hands back the compressed buffer; a
// proxy that decompressed and recompressed would throw that away and spend a
// core doing it.
function pass(req, res, innerPort) {
  const headers = { ...req.headers };
  delete headers.connection;          // hop-by-hop, not ours to forward
  const up = http.request(
    { host: '127.0.0.1', port: innerPort, method: req.method, path: req.url, headers },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      pipeline(r, res, quiet(req.url));
    });
  up.on('error', (err) => {
    console.error(`[dbx] upstream ${req.method} ${req.url}:`, err.code || err.message);
    if (!res.headersSent) text(res, 502, 'the map server is not answering');
  });
  pipeline(req, up, quiet(req.url));
}

// A client that hung up is not an error worth printing. It is the single most
// common way a tile request ends, and logging it would bury what matters.
const quiet = (what) => (err) => {
  if (!err || err.code === 'ERR_STREAM_PREMATURE_CLOSE'
      || err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
  console.error(`[dbx] ${err.code || 'stream failed'} on ${what}`);
};
