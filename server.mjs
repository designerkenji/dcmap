// dcmap — one-process server for the registry map and per-site pages.
//
//   /                the 2D/3D map app
//   /site/<site_id>  server-rendered detail page (the shareable URL)
//   /data/*.json     datasets, held in memory from startup
//   /vendor/*        maplibre-gl and globe.gl straight from node_modules
//
// No framework: four routes and a static file map don't justify one, and the
// data is loaded once so requests never touch disk except for static assets.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadAll, paths } from './lib/data.mjs';
import { renderSitePage } from './lib/sitepage.mjs';
import { renderOperatorPage } from './lib/operatorpage.mjs';
import { captures, tileXY, ZOOM } from './lib/wayback.mjs';
import { FIELDS, validate, appendOverrides } from './lib/overrides.mjs';

const PORT = process.env.PORT || 8787;
const PUB = path.join(import.meta.dirname, 'public');
const NM = path.join(import.meta.dirname, 'node_modules');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

const VENDOR = {
  '/vendor/maplibre-gl.js': path.join(NM, 'maplibre-gl', 'dist', 'maplibre-gl.js'),
  '/vendor/maplibre-gl.css': path.join(NM, 'maplibre-gl', 'dist', 'maplibre-gl.css'),
  '/vendor/globe.gl.min.js': path.join(NM, 'globe.gl', 'dist', 'globe.gl.min.js'),
};

// Reassigned when a hand correction is saved. The derived payloads - map
// dots, the search index, operator pages, country counts - are COPIES built
// at load time, not references to the site objects, so patching a site in
// place would fix the detail page and leave the map showing the old name.
// Reloading everything is a second of CSV parsing and is the only version of
// this that cannot go half-applied.
let data = await loadAll();

// Pre-serialised, because these are read on every page load and re-stringifying
// six megabytes per request would be absurd. They were also, until sites became
// editable, immutable for the process lifetime - so a correction has to
// re-serialise them or the map keeps serving the name the registry no longer
// holds. That is one function call rather than a rule to remember, which is the
// point of it being here and not at each call site.
let JSON_ROUTES;
function serialiseRoutes() {
  JSON_ROUTES = {
    '/data/sites.json': JSON.stringify(data.mapSites),
    '/data/ercot.json': JSON.stringify(data.ercot),
    '/data/pjm.json': JSON.stringify(data.pjm),
    '/data/nyiso.json': JSON.stringify(data.nyiso),
    '/data/countries.json': JSON.stringify(data.countries),
    '/data/basemap.json': JSON.stringify(data.basemap),
    '/data/timeline.json': JSON.stringify(data.timelinePayload),
    '/data/quakes.json': JSON.stringify(data.quakes),
    '/data/operators.json': JSON.stringify(data.operatorsPayload),
  };
}
serialiseRoutes();

// ---- satellite basemap ----------------------------------------------------
// Two providers, and which one you get depends on whether a key is present.
//
// esri     Publicly reachable without a key, which is NOT the same as free.
//          Esri's terms of use (tou_summary.pdf, 21 Apr 2025) grant the right
//          to use these basemaps to subscribers: "Use with Esri software and
//          comply with its terms of use. If you do not have Esri software, you
//          must purchase an ArcGIS Online subscription." They also say plainly
//          "YOU MAY NOT ... Redistribute basemap tiles" or "Download,
//          redistribute or self-host any content hosted by Esri."
//
//          MapLibre is not Esri software. So this default is fine for local
//          development and evaluation, and a deployment needs either an ArcGIS
//          subscription or a different provider. It is left as the default
//          because it makes the feature work out of the box, and it is labelled
//          in the UI rather than left for someone to discover later.
//
// google   Map Tiles API. NOT the Maps JavaScript API - Google's terms forbid
//          putting Maps imagery in a third-party renderer like MapLibre, and
//          Map Tiles is the product that is licensed for exactly that. Needs
//          an API key AND an enabled billing account.
//
// THE KEY NEVER REACHES THE BROWSER. Google's tile URL carries the key as a
// query parameter, so pointing MapLibre straight at it would publish the key
// to anyone who opens devtools. Tiles are proxied through this server instead:
// the key stays in the environment, and the client only ever sees /tiles/google.
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

let gSession = null;          // { session, expiresAt }

async function googleSession() {
  if (gSession && gSession.expiresAt > Date.now() + 60_000) return gSession.session;
  const r = await fetch(`https://tile.googleapis.com/v1/createSession?key=${GOOGLE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }),
  });
  if (!r.ok) throw new Error(`createSession ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  // `expiry` is unix seconds. Cache until then rather than per request: a
  // session is good for hours and creating one per tile would be absurd.
  gSession = { session: j.session, expiresAt: (+j.expiry || 0) * 1000 || Date.now() + 3600_000 };
  return gSession.session;
}

const PROVIDERS = {
  esri: {
    id: 'esri',
    label: 'Satellite',
    tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19,
    // Verbatim from the service's own accessInformation field. It says Vantor,
    // not Maxar - Maxar renamed, and an attribution naming the wrong company
    // is not attribution.
    attribution: 'Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    licence: 'Esri Master License Agreement — requires an ArcGIS subscription for non-Esri apps',
  },
  google: {
    id: 'google',
    label: 'Satellite (Google)',
    tiles: ['/tiles/google/{z}/{x}/{y}'],
    maxzoom: 22,
    attribution: '&copy; Google',
    licence: 'Google Maps Platform — billed per tile request',
  },
};

// ---- land-change imagery -------------------------------------------------
// Users drop dated screenshots (Google Maps, Sentinel, anything) against a
// site so the land can be compared over time. Files live outside public/ and
// are served through a checked route, never by the static handler.
const IMG_ROOT = path.join(paths.data, 'site_images');
const IMG_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const MAX_IMG = 12 * 1024 * 1024;
const SITE_ID_RE = /^site-[a-z0-9-]+$/;

function listSiteImages(siteId) {
  const dir = path.join(IMG_ROOT, siteId);
  if (!SITE_ID_RE.test(siteId) || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}(-\d+)?\.(png|jpg|webp)$/.test(f))
    .map(f => ({ file: f, date: f.slice(0, 10) }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendFile(res, file) {
  if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  try {
    send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    // existsSync passing does not mean the read will succeed. A file readable
    // at startup can stop being readable later - macOS revoked this app's
    // Downloads access mid-session when Claude Code updated itself into a new
    // versioned path, and every open after that returned EPERM. Whatever the
    // cause, one unreadable file must not be fatal.
    console.error(`[dcmap] ${err.code || 'read failed'} on ${file}`);
    send(res, 500, 'could not read that file', 'text/plain');
  }
}

// An uncaught throw inside a Node request handler takes the WHOLE PROCESS
// down. That is how a single unreadable file turned into a dead server: the
// app served fine, one request hit EPERM, and the process exited. One bad
// request must cost one 500, not everyone else's session.
const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    console.error(`[dcmap] ${req.method} ${req.url} failed:`, err);
    if (!res.headersSent) send(res, 500, 'server error', 'text/plain');
  }
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUB, 'index.html'));

  if (p.startsWith('/site/')) {
    const id = decodeURIComponent(p.slice('/site/'.length));
    if (!/^site-[a-z0-9-]+$/.test(id)) return send(res, 400, 'bad site id', 'text/plain');
    const site = data.siteById.get(id);
    if (!site) return send(res, 404, 'unknown site', 'text/plain');
    const epochKey = (site.epoch_name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const opKey = data.rawToKey[(site.operator || '').trim()] || '';
    const html = renderSitePage({
      site,
      rows: data.rowsBySite.get(id) || [],
      va: data.vaBySite.get(id) || [],
      traj: epochKey ? data.trajByName.get(epochKey) : null,
      timeline: epochKey ? data.timelineByName.get(epochKey) || [] : [],
      epoch: epochKey ? data.epochMeta.get(epochKey) || null : null,
      images: listSiteImages(id),
      link: data.siteLinks[id] || null,
      operator: opKey ? data.operatorProfiles[opKey] || null : null,
      opKey,
      mates: (data.byBuilding.get(site.building) || []).filter(x => x.site_id !== id),
    });
    return send(res, 200, html, MIME['.html']);
  }

  // Correct a site by hand. Writes to data/site_overrides.csv, which is a
  // SOURCE the pipeline never rewrites, then re-applies it to the in-memory
  // site so the change is live without a restart.
  const ed = req.method === 'POST' && p.match(/^\/api\/site\/(site-[a-z0-9-]+)$/);
  if (ed) {
    const site = data.siteById.get(ed[1]);
    if (!site) return send(res, 404, '{"error":"unknown site"}', MIME['.json']);
    let body;
    try {
      body = JSON.parse(await readBody(req, 64 * 1024));
    } catch {
      return send(res, 400, '{"error":"expected JSON"}', MIME['.json']);
    }
    const edits = {};
    for (const [field, value] of Object.entries(body.fields || {})) {
      const bad = validate(field, value);
      if (bad) {
        return send(res, 400, JSON.stringify({ error: field + ': ' + bad }), MIME['.json']);
      }
      // Only what actually differs. Re-asserting a value the pipeline already
      // produces would pin it against future sources for no reason.
      if (String(value) !== String(site[field] ?? '')) edits[field] = value;
    }
    if (!Object.keys(edits).length) {
      return send(res, 200, '{"saved":0}', MIME['.json']);
    }
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
    try {
      appendOverrides(paths.data, site.site_id, site, edits, note,
                      new Date().toISOString().slice(0, 19) + 'Z');
      data = await loadAll();     // see the note where `data` is declared
      serialiseRoutes();
      return send(res, 200, JSON.stringify({ saved: Object.keys(edits).length }),
                  MIME['.json']);
    } catch (err) {
      console.error('[overrides] write failed:', err);
      return send(res, 500, JSON.stringify({ error: err.message }), MIME['.json']);
    }
  }

  // The dated imagery series for one site. Lazy on purpose: the scan behind it
  // is 195 upstream requests, so it runs when the page asks rather than on
  // every render, and the answer is cached per tile for the life of the
  // process. An immutable-ish Cache-Control covers the reloads in between -
  // the archive gains a release every few weeks, not every few minutes.
  const wb = p.match(/^\/api\/wayback\/(site-[a-z0-9-]+)$/);
  if (wb) {
    const site = data.siteById.get(wb[1]);
    if (!site) return send(res, 404, '{"error":"unknown site"}', MIME['.json']);
    if (site.lat == null || site.lon == null) {
      return send(res, 200, JSON.stringify({ captures: [] }), MIME['.json']);
    }
    try {
      const list = await captures(+site.lat, +site.lon);
      const { x, y, z } = tileXY(+site.lat, +site.lon, ZOOM);
      const body = JSON.stringify({ z, x, y, captures: list });
      res.writeHead(200, { 'Content-Type': MIME['.json'],
                           'Cache-Control': 'public, max-age=86400' });
      return res.end(body);
    } catch (err) {
      // The page degrades to its uploaded screenshots, so this is a 200 with
      // an empty series and a reason, not a 500 that shows the user a stack.
      console.warn('[wayback] scan failed:', err.message);
      return send(res, 200, JSON.stringify({ captures: [], error: err.message }),
                  MIME['.json']);
    }
  }

  // Which satellite providers this deployment can actually offer. Google only
  // appears when a key is configured, so the UI never shows an option that
  // would 500 on click.
  if (p === '/api/basemaps') {
    const list = [PROVIDERS.esri];
    if (GOOGLE_KEY) list.push(PROVIDERS.google);
    return send(res, 200, JSON.stringify(list), MIME['.json']);
  }

  const gt = p.match(/^\/tiles\/google\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/);
  if (gt) {
    if (!GOOGLE_KEY) return send(res, 404, 'no Google key configured', 'text/plain');
    const [, z, x, y] = gt;
    try {
      const session = await googleSession();
      const r = await fetch(
        `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${session}&key=${GOOGLE_KEY}`);
      if (!r.ok) {
        // A 401/403 here is almost always billing not enabled or the Map Tiles
        // API not switched on - say which, rather than a bare status code.
        const hint = r.status === 403 || r.status === 401
          ? ' (check the key is valid, Map Tiles API is enabled, and billing is on)' : '';
        console.error(`[dcmap] google tile ${z}/${x}/${y} -> ${r.status}${hint}`);
        return send(res, 502, `google tile ${r.status}${hint}`, 'text/plain');
      }
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || 'image/jpeg',
        // Tiles are immutable for a session; let the browser keep them.
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(buf);
    } catch (err) {
      console.error('[dcmap] google tiles:', err.message);
      return send(res, 502, 'google tiles unavailable', 'text/plain');
    }
  }

  if (p.startsWith('/operator/')) {
    // Keys are the registry's own, and several contain a space ("digital
    // realty", "iron mountain"), so the key is decoded and then looked up in
    // the directory rather than pattern-matched.
    const key = decodeURIComponent(p.slice('/operator/'.length)).replace(/\/$/, '');
    const op = data.operatorsPayload.operators.find(o => o.key === key);
    if (!op) return send(res, 404, 'unknown operator', 'text/plain');
    const html = renderOperatorPage({
      op,
      profile: data.operatorProfiles[key] || null,
      sites: data.sites.filter(s => data.rawToKey[(s.operator || '').trim()] === key),
      regions: data.operatorsPayload.regions,
      links: data.siteLinks,
    });
    return send(res, 200, html, MIME['.html']);
  }

  // Upload a dated image for a site. Deliberately strict: the id must match
  // the registry's own pattern, the date must be a real ISO date, and the
  // extension comes from the declared content-type rather than any
  // user-supplied filename - so nothing here can name a path.
  if (req.method === 'POST' && p === '/upload') {
    const q = url.searchParams;
    const id = q.get('site') || '';
    const date = q.get('date') || '';
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (!SITE_ID_RE.test(id) || !data.siteById.has(id)) {
      return send(res, 400, 'unknown site id', 'text/plain');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return send(res, 400, 'date must be YYYY-MM-DD', 'text/plain');
    }
    const ext = IMG_EXT[type];
    if (!ext) return send(res, 415, 'png, jpeg or webp only', 'text/plain');
    let buf;
    try {
      buf = await readBody(req, MAX_IMG);
    } catch {
      return send(res, 413, 'image over 12 MB', 'text/plain');
    }
    // Trust the bytes, not the header: check the magic number too.
    const okMagic = (ext === '.png' && buf.subarray(0, 8).equals(
                       Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      || (ext === '.jpg' && buf[0] === 0xff && buf[1] === 0xd8)
      || (ext === '.webp' && buf.subarray(0, 4).toString() === 'RIFF');
    if (!okMagic) return send(res, 415, 'content does not match its type', 'text/plain');
    const dir = path.join(IMG_ROOT, id);
    fs.mkdirSync(dir, { recursive: true });
    let name = `${date}${ext}`;
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${date}-${n}${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return send(res, 200, JSON.stringify({ ok: true, file: name }), MIME['.json']);
  }

  const img = p.match(/^\/site-image\/(site-[a-z0-9-]+)\/(\d{4}-\d{2}-\d{2}(?:-\d+)?\.(?:png|jpg|webp))$/);
  if (img) {
    const f = path.join(IMG_ROOT, img[1], img[2]);
    if (!f.startsWith(IMG_ROOT) || !fs.existsSync(f)) {
      return send(res, 404, 'no such image', 'text/plain');
    }
    return sendFile(res, f);
  }

  if (JSON_ROUTES[p]) return send(res, 200, JSON_ROUTES[p], MIME['.json']);

  // Per-event ShakeMap detail, loaded when an epicentre is clicked. The id is
  // regex-gated and basename'd: it becomes a filesystem path.
  const ev = p.match(/^\/data\/quake\/([a-z0-9]{6,24})$/);
  if (ev) {
    const f = path.join(paths.data, 'quake_events', `${ev[1]}.json`);
    if (!fs.existsSync(f)) return send(res, 404, 'no detail for that event', 'text/plain');
    return send(res, 200, fs.readFileSync(f), MIME['.json']);
  }
  if (VENDOR[p]) return sendFile(res, VENDOR[p]);

  // Static assets from public/, path-traversal safe.
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUB, safe);
  if (file.startsWith(PUB) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return sendFile(res, file);
  }
  send(res, 404, 'not found', 'text/plain');
}

server.listen(PORT, () => console.log(`dcmap listening on http://localhost:${PORT}`));
