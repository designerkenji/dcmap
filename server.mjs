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
import { pipeline } from 'node:stream';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadAll, paths } from './lib/data.mjs';
import { renderSitePage } from './lib/sitepage.mjs';
import { renderOperatorPage } from './lib/operatorpage.mjs';
import { renderFabsPage } from './lib/fabspage.mjs';
import { renderPlantsPage } from './lib/plantspage.mjs';
import { renderDcPage } from './lib/dcpage.mjs';
import { renderSupplyPage, renderFootprintsPage } from './lib/layerpages.mjs';
import { renderPowerPage } from './lib/powerpage.mjs';
import { renderPlantPage, renderFabPage, wayback } from './lib/dotpage.mjs';
import { renderSubstationPage } from './lib/substationpage.mjs';
import { renderPointPage } from './lib/pointpage.mjs';
import { POINT_KINDS, pointErrors, fieldError, POINT_ID_RE } from './lib/points.mjs';
import { renderEventPage } from './lib/eventpage.mjs';
import { EVENT_KINDS, eventErrors, DEFAULT_RADIUS_KM, MAX_RADIUS_KM } from './lib/events.mjs';
import { renderQuakesPage, renderQuakePage } from './lib/quakepage.mjs';
import { readPlacements, applyPlacements, placementErrors, placementRow,
         PLACEMENT_COLUMNS, PLACEMENT_BASIS } from './lib/placements.mjs';
import { renderDataPage } from './lib/datapage.mjs';
import { describeParcel, factCount } from './lib/parcelfields.mjs';
import { gitChanges, workingTree, ledgerActivity, dirSummary, touchedFiles,
         sinceDate, BLIND_SPOTS } from './lib/datachanges.mjs';
import { stepFreshness, STEPS, stepByKey, isLocal, startRun, stopRun, tailLog, runState }
  from './lib/pipeline.mjs';
import { makeGeo } from './lib/summary.mjs';
import { renderLicencesPage } from './lib/licences.mjs';
import { FIELDS, validate, appendOverrides, linkError, kindError,
         plantLinkError, footprintError, footprintProps,
         appendFootprintOverride, readNameReviews,
         appendNameReview, validateAsset,
         appendAssetOverrides } from './lib/overrides.mjs';
import { renderReviewPage } from './lib/reviewpage.mjs';
import { pullParcel } from './lib/parcelpull.mjs';

const PORT = process.env.PORT || 8787;
const PUB = path.join(import.meta.dirname, 'public');
const NM = path.join(import.meta.dirname, 'node_modules');

// The vector basemap: one PMTiles archive plus the glyph ranges its labels are
// lettered from, both built by src/basemap_tiles.py. Neither is tracked - a
// 1.6 GB tileset does not belong in git - so a fresh clone has no labels until
// that script is run, and both routes below 404 politely until it is.
const TILES = path.join(paths.data, 'raw', 'basemap.pmtiles');
const GLYPHS = path.join(paths.data, 'raw', 'glyphs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.pbf': 'application/x-protobuf', '.pmtiles': 'application/octet-stream',
};

const VENDOR = {
  '/vendor/maplibre-gl.js': path.join(NM, 'maplibre-gl', 'dist', 'maplibre-gl.js'),
  '/vendor/maplibre-gl.css': path.join(NM, 'maplibre-gl', 'dist', 'maplibre-gl.css'),
  '/vendor/globe.gl.min.js': path.join(NM, 'globe.gl', 'dist', 'globe.gl.min.js'),
  // 20 kB. Teaches MapLibre to read tiles out of a single addressable
  // archive over range requests - see the labels block in app.js.
  '/vendor/pmtiles.js': path.join(NM, 'pmtiles', 'dist', 'pmtiles.js'),
};

// Reassigned when a hand correction is saved. The derived payloads - map
// dots, the search index, operator pages, country counts - are COPIES built
// at load time, not references to the site objects, so patching a site in
// place would fix the detail page and leave the map showing the old name.
// Reloading everything is a second of CSV parsing and is the only version of
// this that cannot go half-applied.
let data = await loadAll();

// One place that turns any registry id into something readable, for the
// pages that render dependency edges pointing at assets they do not hold.
const assetNameOf = (id) => {
  const s = data.siteById.get(id);
  if (s) return s.name || s.epoch_name || id;
  const f = data.fabById.get(id);
  if (f) return f.n || id;
  const p = data.plantById.get(id);
  if (p) return p.n || id;
  return id;
};

// Pre-serialised, because these are read on every page load and re-stringifying
// six megabytes per request would be absurd. They were also, until sites became
// editable, immutable for the process lifetime - so a correction has to
// re-serialise them or the map keeps serving the name the registry no longer
// holds. That is one function call rather than a rule to remember, which is the
// point of it being here and not at each call site.
//
// AND PRE-GZIPPED, for the same reason twice over. These payloads are JSON
// objects with the same short keys repeated tens of thousands of times, which
// is close to the best case for deflate: the nine of them together are 9.4 MB
// raw and 1.8 MB compressed. Going global on power plants added 5.3 MB of
// uncompressed transfer, and compressing what was already here more than pays
// it back - the app loads less over the wire now than before the layer existed.
//
// Compressed once at serialise time, not per request. gzip -9 on 6 MB is far
// too slow to do on every page load, and these bytes never change between
// loads; a site correction re-runs this and re-compresses along with it.
let JSON_ROUTES;
function serialiseRoutes() {
  const routes = {
    '/data/sites.json': JSON.stringify(data.mapSites),
    '/data/ercot.json': JSON.stringify(data.ercot),
    '/data/pjm.json': JSON.stringify(data.pjm),
    '/data/nyiso.json': JSON.stringify(data.nyiso),
    '/data/countries.json': JSON.stringify(data.countries),
    '/data/basemap.json': JSON.stringify(data.basemap),
    '/data/timeline.json': JSON.stringify(data.timelinePayload),
    '/data/quakes.json': JSON.stringify(data.quakes),
    // `edited` is the hand-correction record - was-values and the editor's
    // "how I know" notes. The pages render it server-side; the map client
    // never reads it, and notes written for the ledger should not ship to
    // every visitor. Same policy as mapSites, which is a slim projection.
    '/data/plants.json': JSON.stringify(data.plants.map(({ edited, ...p }) => p)),
    '/data/fabs.json': JSON.stringify(data.fabs.map(({ edited, ...f }) => f)),
    // Small enough to ship whole, unlike the footprints: a couple thousand
    // parcels at most, and the layer wants them all at once for comparison.
    '/data/regrid.json': JSON.stringify(data.regrid),
    '/data/precisely.json': JSON.stringify(data.precisely),
    '/data/cadastre.json': JSON.stringify(data.cadastre),
    // A handful of researched site<->plant pairings; tiny, shipped whole.
    '/data/supply_links.json': JSON.stringify(data.supplyLinks),
    // [lon,lat] per footprint-bearing asset, for the world-zoom locators.
    '/data/fp_locators.json': JSON.stringify(data.fpLocators),
    '/data/operators.json': JSON.stringify(data.operatorsPayload),
    // Substations that carry a dependency edge AND have been placed on the
    // ground. Unlocated ones are omitted rather than dropped at zero-zero:
    // the /power page is where a name without a coordinate is honest, a map
    // is where it would be a lie. Each carries its accumulation so a hover
    // can say what stands behind it without a second request.
    // The physical dependency links with BOTH ends on the ground, as
    // straight segments. These are the LINK, not the conductor's route: no
    // surveyed line geometry exists in this registry yet, so a curve here
    // would be an invention. Contracts are excluded - they share no
    // equipment, so drawing them as transmission would be the same lie the
    // /power page spends a section refusing to tell.
    // Corridors, trimmed for the wire: geometry plus the two fields the hover
    // tip reads. Everything else stays in the file on disk - shipping
    // operator, cables and circuits for thousands of ways would multiply the
    // payload for facts nothing on the map shows.
    '/data/power_lines.json': JSON.stringify({
      type: 'FeatureCollection',
      attribution: data.powerLines.attribution || '© OpenStreetMap contributors',
      features: (data.powerLines.features || []).map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: { kv: f.properties.kv ?? null, n: f.properties.name || f.properties.ref || '' },
      })),
    }),
    '/data/dep_links.json': JSON.stringify((() => {
      const posOf = (id) => {
        const s = data.siteById.get(id);
        if (s && s.lat) return [+s.lon, +s.lat];
        const f = data.fabById.get(id);
        if (f && f.lat != null) return [f.lon, f.lat];
        const p = data.plantById.get(id);
        if (p && p.lat != null) return [p.lon, p.lat];
        const b = data.substationById.get(id);
        if (b && b.lat != null) return [b.lon, b.lat];
        return null;
      };
      const nameOf = (id) => {
        const b = data.substationById.get(id);
        if (b) return b.name;
        return assetNameOf(id);
      };
      const seen = new Set();
      const out = [];
      for (const e of data.powerDeps) {
        if (!e.physical) continue;
        const k = e.asset_id + '>' + e.dependency_asset_id;
        if (seen.has(k)) continue;
        const a = posOf(e.asset_id), b = posOf(e.dependency_asset_id);
        if (!a || !b) continue;
        seen.add(k);
        out.push({ a, b, an: nameOf(e.asset_id), bn: nameOf(e.dependency_asset_id),
                   rel: e.relationship, ev: e.evidence,
                   to: data.substationById.has(e.dependency_asset_id) ? 'sub' : 'plant' });
      }
      return out;
    })()),
    // Simulated events, for the event layer.
    '/data/events.json': JSON.stringify([...data.eventById.values()]),
    // Dropped points, for the draft layer.
    '/data/points.json': JSON.stringify([...data.pointById.values()].map(p => ({
      id: p.id, lat: p.lat, lon: p.lon, kind: p.kind || '',
      n: (p.fields && p.fields.name) || '' }))),
    '/data/substations.json': JSON.stringify(
      data.accumulation
        .filter(a => a.kind === 'substation' && a.lat != null && a.lon != null)
        .map(a => {
          // The names, not just the count: "3 mega-loads" is a number to look
          // up, "Micron, TeraWulf, Arsenal" is an answer.
          // Sum per LOAD, not per edge: Micron holds two queue positions into
          // Clay, and showing the first one's 480 MW beside a 1,376 MW total
          // invites the reader to think the arithmetic is broken.
          const byLoad = new Map();
          for (const e of a.edges) {
            const cur = byLoad.get(e.asset_id) || {
              n: e.load ? e.load.name : assetNameOf(e.asset_id),
              mw: 0, reg: !e.asset_id.startsWith('load-') };
            cur.mw += e.mw || 0;
            byLoad.set(e.asset_id, cur);
          }
          const who = [...byLoad.values()]
            .map(w => ({ ...w, mw: w.mw ? Math.round(w.mw) : null }))
            .sort((x, y) => (y.mw || 0) - (x.mw || 0));
          return { id: a.id, n: a.name, kv: a.kv, lat: a.lat, lon: a.lon,
                   as: a.assets, reg: a.registry, mw: Math.round(a.mw), who };
        })),
    // The edit form's type-ahead suggestions: every operator, city, country
    // and utility the registry already holds. Fetched only when a pen opens.
    '/data/edit_options.json': JSON.stringify(data.editOptions),
    // NOT the footprints: see /api/footprints above. 19,367 of them is more
    // than MapLibre's worker survives in one source, and more than any one
    // view needs.
  };
  // Gzip is memoised on the body string. serialiseRoutes() runs after EVERY
  // save - a footprint traced, an override written, a pin dropped, 14 call
  // sites - and it used to re-compress every route each time. The transmission
  // corridors alone are 5.9 MB and cost 416 ms at level 9, so dropping one pin
  // paid nearly half a second to recompress a file that had not changed. Most
  // routes are byte-identical between saves; the ones that changed recompress
  // and the rest are handed back their previous buffer.
  const prev = JSON_ROUTES || {};
  JSON_ROUTES = {};
  for (const [p, body] of Object.entries(routes)) {
    const was = prev[p];
    JSON_ROUTES[p] = (was && was.raw === body)
      ? was
      : { raw: body, gz: zlib.gzipSync(body, { level: 9 }) };
  }
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

function send(res, code, body, type, extra) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
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

// sendFile's readFileSync is fine for the megabyte-scale files everything else
// serves and would be fatal here: the basemap archive is 1.6 GB and PMTiles
// asks for a few kilobytes of it at a time. The whole format is built on HTTP
// range requests - the client reads the header, walks the directory, then
// fetches individual tiles - so a server that ignores Range and returns the
// whole file turns every tile into a 1.6 GB download.
function sendRange(req, res, file, type) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return send(res, 404, 'not found', 'text/plain');
  }
  const total = st.size;
  const head = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  const stream = (opts, code, extra) => {
    res.writeHead(code, { ...head, ...extra });
    if (req.method === 'HEAD') return res.end();
    // pipeline(), NOT rs.pipe(res). This is the difference between a tile
    // server that runs for a week and one that dies, and it is invisible until
    // you measure it: .pipe() does not destroy the SOURCE when the destination
    // goes away, and a client going away mid-tile is the normal case here -
    // every pan of the map cancels the tiles that just left the viewport.
    //
    // Measured on this file: 200 aborted range requests leaked 200 open file
    // descriptors on a 1.5 GB archive and 86 MB of RSS, none of it reclaimed.
    // That ends in EMFILE, at which point nothing in the process can open a
    // file - the same class of failure sendFile's catch block was written for.
    //
    // pipeline() destroys both ends on error OR premature close, so the fd is
    // returned the moment the socket drops.
    pipeline(fs.createReadStream(file, opts), res, (err) => {
      // A client that hung up is not an error worth printing. It is the single
      // most common way a tile request ends, and logging it would bury the
      // failures that do matter.
      if (!err || err.code === 'ERR_STREAM_PREMATURE_CLOSE'
          || err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
      console.error(`[dcmap] ${err.code || 'stream failed'} on ${file}`);
    });
  };

  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (!m || (!m[1] && !m[2])) return stream({}, 200, { 'Content-Length': total });

  // A range with no start is a SUFFIX range - the last N bytes, which is how
  // PMTiles readers find a trailing directory. Reading it as start=0 would
  // hand back the beginning of the file and the parse would fail somewhere
  // far away from the cause.
  const [start, end] = m[1] === ''
    ? [Math.max(0, total - Number(m[2])), total - 1]
    : [Number(m[1]), m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1)];
  if (!Number.isFinite(start) || start > end || start >= total) {
    res.writeHead(416, { ...head, 'Content-Range': `bytes */${total}` });
    return res.end();
  }
  stream({ start, end }, 206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': end - start + 1,
  });
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
  let p = url.pathname;

  // Every page this app serves lives under /maps/, the way Google nests them:
  // /maps/@lat,lon,zoom for the camera and /maps/<kind>/<id> for a thing.
  //
  // Both directions are handled HERE rather than in the six route matchers
  // below, which are left exactly as they were: the canonical form has its
  // prefix stripped so the old matchers still see /site/<id>, and a bare
  // /site/<id> is redirected to the canonical one. One place decides the
  // scheme; nothing downstream has to know it changed.
  const PAGE_KINDS = 'site|plant|fab|substation|point';
  const maps = p.match(new RegExp(`^/maps/(${PAGE_KINDS})(/.*)?$`));
  if (maps) {
    p = '/' + maps[1] + (maps[2] || '');
  } else if (new RegExp(`^/(${PAGE_KINDS})(/|$)`).test(p)) {
    // A permanent redirect, not a quiet alias: links already in the world keep
    // working AND converge on one spelling.
    res.writeHead(301, { Location: '/maps' + p + (url.search || '') });
    return res.end();
  }

  // Google-style view paths: /@lat,lon,4370m (or ...,12z) is the map app at
  // that camera - the client parses the path and keeps it updated as the
  // view moves, so the address bar is always a shareable link.
  if (p === '/' || p === '/index.html' || p.startsWith('/maps/@')
      || p === '/maps' || p === '/maps/') {
    return sendFile(res, path.join(PUB, 'index.html'));
  }

  // The camera used to live at /@lat,lon,zoom and now lives under /maps/,
  // the way Google writes it. Old links are not broken for it: every one of
  // them is answered with a permanent redirect to the new spelling, so a
  // coordinate someone pasted into a note last month still lands, and lands
  // on the canonical form rather than quietly keeping a second one alive.
  if (p.startsWith('/@')) {
    const to = '/maps' + p + (url.search || '');
    res.writeHead(301, { Location: to });
    return res.end();
  }

  // An id pasted into the wrong route flavour gets redirected to the right
  // one - /site/e6076 is a person holding a plant id, not an error.
  const cross = p.match(/^\/(site|plant|fab)\/([^/]+)$/);
  if (cross) {
    const id = decodeURIComponent(cross[2]);
    const rightRoute = /^site-[a-z0-9-]+$/.test(id) ? 'site'
      : /^f\d+$/.test(id) && data.fabs.some(f => f.id === id) ? 'fab'
      : data.plantById.has(id) ? 'plant'
      : null;
    if (rightRoute && rightRoute !== cross[1]) {
      res.writeHead(302, { Location: `/maps/${rightRoute}/${encodeURIComponent(id)}` });
      return res.end();
    }
  }

  if (p.startsWith('/site/')) {
    const id = decodeURIComponent(p.slice('/site/'.length));
    if (!/^site-[a-z0-9-]+$/.test(id)) {
      return send(res, 404, 'not a site id — sites live at /maps/site/site-…, '
        + 'plants at /maps/plant/<EIA or GEM id>, fabs at /maps/fab/f<nnn>', 'text/plain');
    }
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
      // undefined = never asked; {} = asked, nothing registered; else a hit.
      poi: data.poiEvidence[id],
      water: data.waterByAsset.get(id) || null,
      depsByAsset: data.depsByAsset, depsByDep: data.depsByDep,
      accumulation: data.accumulation, nameOf: assetNameOf,
      operator: opKey ? data.operatorProfiles[opKey] || null : null,
      opKey,
      mates: (data.byBuilding.get(site.building) || []).filter(x => x.site_id !== id),
      parent: site.parent_site_id ? data.siteById.get(site.parent_site_id) || null : null,
      children: data.childrenBySite.get(id) || [],
      plant: site.linked_plant_id ? data.plantById.get(site.linked_plant_id) || null : null,
      // Just the names, for the "the outline round this dot is called X"
      // suggestion. The geometry the archive viewer draws comes from
      // /api/footprints on demand - inlining it would put a megabyte of rings
      // into a page that may never open the overlay.
      footprints: data.footprints.features
        .filter(f => (f.properties.sites || []).includes(id))
        .map(f => ({ id: f.properties.id, name: f.properties.name || '',
                     kind: f.properties.kind, src: f.properties.src,
                     m2: f.properties.m2 || 0 })),
    });
    return send(res, 200, html, MIME['.html']);
  }

  // The registry's own dots around one site. Straight out of memory - 6,249
  // sites is a linear scan nobody can measure - so no index and nothing to
  // keep in step. Sorted by distance and capped, because the answer feeds a
  // frame a few hundred metres across and a dense campus can hold dozens.
  // Sites take site- ids; the dot pages ask with their plant/fab id and get
  // the registry sites around THAT coordinate - same list, same shape.
  const nb = p.match(/^\/api\/nearby\/(site-[a-z0-9-]+|sub-[\w.-]{1,60}|pt-[\w-]{1,44}|[a-z]\w{1,40})$/);
  if (nb) {
    const site = data.siteById.get(nb[1]) || data.plantById.get(nb[1])
              || data.fabById.get(nb[1]) || data.substationById.get(nb[1])
              || data.pointById.get(nb[1]);
    if (!site) return send(res, 404, '{"error":"unknown site"}', MIME['.json']);
    if (site.lat == null || site.lon == null) {
      return send(res, 200, '{"near":[]}', MIME['.json']);
    }
    const km = Math.min(25, Math.max(0.1, +url.searchParams.get('km') || 3));
    const lat = +site.lat, lon = +site.lon;
    const near = [];
    for (const s of data.sites) {
      if (s.site_id === site.site_id || s.lat == null) continue;
      const d = data.kmBetween(lon, lat, +s.lon, +s.lat);
      if (d > km) continue;
      near.push({
        id: s.site_id, name: s.name || s.epoch_name || '', operator: s.operator || '',
        lat: +s.lat, lon: +s.lon, kind: s.site_kind || 'point',
        parent: s.parent_site_id || '', ft: s.facility_type || '',
        children: (data.childrenBySite.get(s.site_id) || []).length,
        km: +d.toFixed(3),
      });
    }
    near.sort((a, b) => a.km - b.km);
    return send(res, 200, JSON.stringify({ km, near: near.slice(0, 250) }), MIME['.json']);
  }

  // Footprints inside a viewport, for the map layer.
  //
  // The layer used to ship whole in /data/footprints.json, and that stopped
  // working the moment the untagged halls arrived: 19,367 features and 308,000
  // vertices puts MapLibre's worker into the same silent failure the basemap
  // note in lib/data.mjs describes - isSourceLoaded() stays false forever, no
  // error is raised, and the layer simply never appears. 189,000 vertices was
  // already enough to break it there.
  //
  // Raising the size floor would fit under the limit by throwing away 1,400
  // sites' outlines, which is paying for the bug with the data. Serving what
  // the viewport asks for costs nothing instead: a footprint is a building
  // seen from a few hundred metres, and at the zoom where the whole layer
  // would matter every shape in it is smaller than a pixel.
  //
  // A linear scan over 19k bounding boxes, like /api/nearby over 6k sites -
  // there is no index to keep in step and nobody can measure the difference.
  if (p === '/api/footprints') {
    // An ABSENT parameter is not a zero. url.searchParams.get() returns null
    // when the key is missing, +null is 0, and Number.isFinite(0) is true - so
    // the obvious one-liner silently answered every default as 0, which capped
    // this route at a single feature and made the whole viewport look empty.
    const num = (k, d) => {
      const raw = url.searchParams.get(k);
      return raw !== null && raw !== '' && Number.isFinite(+raw) ? +raw : d;
    };
    const w = num('w', -180), s = num('s', -90), e = num('e', 180), n = num('n', 90);
    const max = Math.min(6000, Math.max(1, num('max', 4000)));
    const out = [];
    let clipped = false;
    for (const f of data.footprints.features) {
      const b = f.properties.bbox;
      if (!b || b[2] < w || b[0] > e || b[3] < s || b[1] > n) continue;
      if (out.length >= max) { clipped = true; break; }
      out.push(f);
    }
    // `clipped` is the honest half: a viewport holding more shapes than the cap
    // gets a partial answer, and the client says so rather than letting a
    // half-drawn layer read as the whole truth.
    return send(res, 200, JSON.stringify({
      type: 'FeatureCollection', clipped, total: data.footprints.features.length,
      features: out,
    }), MIME['.json']);
  }

  // Footprint outlines around a site, for the archive viewer's overlay. Sent
  // with geometry, which /api/nearby never needs - the point of drawing them
  // over dated imagery is to see whether the outline matches what was actually
  // on the ground that year, and an outline is the one thing a bounding box
  // cannot stand in for.
  //
  // `mine` is the pipeline's own attachment (containment, osm_id or nearest
  // within 250 m), not a fresh containment test, so the viewer and the map
  // layer can never disagree about which footprint belongs to this dot.
  const nfp = p.match(/^\/api\/footprints\/(site-[a-z0-9-]+)$/);
  if (nfp) {
    const site = data.siteById.get(nfp[1]);
    if (!site) return send(res, 404, '{"error":"unknown site"}', MIME['.json']);
    if (site.lat == null || site.lon == null) {
      return send(res, 200, '{"near":[]}', MIME['.json']);
    }
    const km = Math.min(10, Math.max(0.2, +url.searchParams.get('km') || 1.5));
    const lat = +site.lat, lon = +site.lon;
    const out = [];
    for (const f of data.footprints.features) {
      const b = f.properties.bbox;
      if (!b) continue;
      // Distance to the bbox, not to its centre: a campus can be a kilometre
      // across, and measuring from the middle hides the one you are standing on.
      const cx = Math.min(Math.max(lon, b[0]), b[2]);
      const cy = Math.min(Math.max(lat, b[1]), b[3]);
      if (data.kmBetween(lon, lat, cx, cy) > km) continue;
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates]
                  : g.type === 'MultiPolygon' ? g.coordinates : [];
      out.push({
        id: f.properties.id, kind: f.properties.kind, src: f.properties.src,
        name: f.properties.name || '', op: f.properties.op || '',
        m2: f.properties.m2 || 0, bbox: b,
        mine: (f.properties.sites || []).includes(site.site_id),
        // Flat list of rings. The viewer fills with the even-odd rule, so a
        // hole needs no marking - it is simply a ring inside another.
        rings: polys.flat(),
      });
    }
    // The ones that are this site come first, then biggest: at a shared fence
    // line the campus you are on is the one worth drawing on top.
    out.sort((a, b2) => (b2.mine - a.mine) || (b2.m2 - a.m2));
    return send(res, 200, JSON.stringify({ km, near: out.slice(0, 150) }), MIME['.json']);
  }

  // Plants within reach of a site, for the supply picker. A wider default than
  // the site version: a campus's neighbours are metres away, but the plant it
  // buys from is a drive, and every real co-location deal so far has been a
  // fence line or a substation - so the list has to cover both without the
  // reader guessing a radius.
  const npl = p.match(/^\/api\/nearby-plants\/(site-[a-z0-9-]+)$/);
  if (npl) {
    const site = data.siteById.get(npl[1]);
    if (!site) return send(res, 404, '{"error":"unknown site"}', MIME['.json']);
    if (site.lat == null || site.lon == null) {
      return send(res, 200, '{"near":[]}', MIME['.json']);
    }
    const km = Math.min(200, Math.max(1, +url.searchParams.get('km') || 50));
    const lat = +site.lat, lon = +site.lon;
    const near = [];
    for (const pl of data.plants) {
      const d = data.kmBetween(lon, lat, pl.lon, pl.lat);
      if (d > km) continue;
      near.push({ ...pl, km: +d.toFixed(2) });
    }
    // Nearest first: the question is "which plant is this one next to", and a
    // 6 GW dam 90 km away is not a better answer than the gas unit over the road.
    near.sort((a, b) => a.km - b.km);
    return send(res, 200, JSON.stringify({ km, near: near.slice(0, 120) }), MIME['.json']);
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
      // Whether a link is legal depends on the rest of the registry, so it is
      // checked here rather than in the field validator.
      const rel = field === 'parent_site_id'  ? linkError(site, value, data.siteById)
                : field === 'site_kind'       ? kindError(site, value, data.siteById)
                : field === 'linked_plant_id' ? plantLinkError(value, data.plantById)
                : null;
      if (rel) return send(res, 400, JSON.stringify({ error: rel }), MIME['.json']);
      // Only what actually differs. Re-asserting a value the pipeline already
      // produces would pin it against future sources for no reason.
      //
      // `point` and blank are the SAME CLAIM, and comparing them as strings is
      // not academic: site_kind is blank on all 6,269 rows, so the form's
      // <select> finds no option to mark selected, the browser falls back to
      // the first one - point - and every save posted it as a change. Saving a
      // corrected NAME therefore also wrote "this dot is a point", which is an
      // assertion nobody made. kindOf() already reads a blank site as a point,
      // so the row records nothing and costs the distinction the field exists
      // for: "we have not looked" has to stay sayable.
      const same = (v) => (field === 'site_kind' && v === 'point' ? '' : v);
      if (same(String(value)) !== same(String(site[field] ?? ''))) edits[field] = value;
    }
    // Cross-field, so it cannot live in the per-field loop: the two halves of
    // a supply link only mean anything together. An arrangement with no plant
    // is a claim about a relationship with nothing at the other end, and a
    // plant with no arrangement is the more common half-finished edit - both
    // would render as a supply section that says nothing.
    const finalLink = 'linked_plant_id' in edits ? edits.linked_plant_id
                    : (site.linked_plant_id || '');
    const finalStruct = 'link_structure' in edits ? edits.link_structure
                      : (site.link_structure || '');
    if (finalStruct && !finalLink) {
      return send(res, 400, JSON.stringify({
        error: 'Pick the plant before setting the arrangement.' }), MIME['.json']);
    }
    if (finalLink && !finalStruct) {
      return send(res, 400, JSON.stringify({
        error: 'Say what the arrangement is — behind the meter, net-metered, a '
             + 'contract, or announced only. A bare link does not distinguish a '
             + 'signed co-location from a press release.' }), MIME['.json']);
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

  // POST /api/asset/<id> - the same edit, for plants (e/g ids) and fabs (f
  // ids). Appends to data/asset_overrides.csv and reloads, exactly the site
  // route's contract; the field tables are per-flavour and much shorter.
  const ae = req.method === 'POST' && p.match(/^\/api\/asset\/([a-z]\w{1,40})$/);
  if (ae) {
    const asset = data.plantById.get(ae[1]) || data.fabById.get(ae[1]);
    if (!asset) {
      return send(res, 404, '{"error":"no plant or fab with that id"}', MIME['.json']);
    }
    let body;
    try {
      body = JSON.parse(await readBody(req, 64 * 1024));
    } catch {
      return send(res, 400, '{"error":"expected JSON"}', MIME['.json']);
    }
    const edits = {};
    for (const [field, raw] of Object.entries(body.fields || {})) {
      const bad = validateAsset(asset.id, field, raw);
      if (bad) {
        return send(res, 400, JSON.stringify({ error: field + ': ' + bad }), MIME['.json']);
      }
      // Every consumer of cy does an uppercase-keyed lookup; store what they
      // can find. And the numeric fields live as JSON numbers, so "45.88310"
      // for 45.8831 is the same claim - a string comparison would append a
      // no-op override that pins the value against future sources.
      const value = field === 'cy' ? raw.toUpperCase() : raw;
      const numeric = field === 'lat' || field === 'lon' || field === 'mw';
      const same = numeric && value !== '' && asset[field] != null && asset[field] !== ''
        ? Number(value) === Number(asset[field])
        : String(value) === String(asset[field] ?? '');
      if (!same) edits[field] = value;
    }
    if (!Object.keys(edits).length) {
      return send(res, 200, '{"saved":0}', MIME['.json']);
    }
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
    try {
      appendAssetOverrides(paths.data, asset.id, asset, edits, note,
                           new Date().toISOString().slice(0, 19) + 'Z');
      data = await loadAll();
      serialiseRoutes();
      return send(res, 200, JSON.stringify({ saved: Object.keys(edits).length }),
                  MIME['.json']);
    } catch (err) {
      console.error('[asset overrides] write failed:', err);
      return send(res, 500, JSON.stringify({ error: err.message }), MIME['.json']);
    }
  }

  // Draw, correct or hide a footprint. Writes one Feature line to
  // data/footprint_overrides.geojsonl - a SOURCE with the same contract as
  // site_overrides.csv - then reloads, so the shape is live without a restart.
  // One parcel from one vendor for one site, at the user's click - the spend
  // is theirs to aim, unlike the sweeps. Cached answers cost nothing and the
  // vendor layer payloads are refreshed in place when something new lands.
  const pp = req.method === 'POST'
    && p.match(/^\/api\/pull-parcel\/(regrid|precisely|cadastre)\/(site-[a-z0-9-]+|sub-[\w.-]{1,60}|pt-[\w-]{1,44}|[a-z]\w{1,40})$/);
  if (pp) {
    const vendor = pp[1], sid = pp[2];
    // Plants and fabs pull too - the parcel cache keys by whatever id asked,
    // and the coverage check already reads asset ids out of footprint tags.
    const site = data.siteById.get(sid) || data.plantById.get(sid)
              || data.fabById.get(sid) || data.substationById.get(sid)
              || data.pointById.get(sid);
    if (!site || !site.lat) {
      return send(res, 404, '{"error":"unknown or unmapped site"}', MIME['.json']);
    }
    let covered = false;
    for (const f of data.footprintById.values()) {
      if ((f.properties.sites || []).includes(sid)) { covered = true; break; }
    }
    try {
      // ?force=1 is the deliberate "ask again anyway" — it costs money on a
      // parcel we already hold, so it is never the default.
      const force = url.searchParams.get('force') === '1';
      // ?lat&lon aim the ask at a clicked spot. Bounded to the site's
      // neighbourhood: the cache slot means "this site's parcel", and a click
      // that wandered to another town must not overwrite it.
      const qlat = parseFloat(url.searchParams.get('lat'));
      const qlon = parseFloat(url.searchParams.get('lon'));
      let at = null;
      if (Number.isFinite(qlat) && Number.isFinite(qlon)) {
        const dKm = Math.hypot((qlat - site.lat) * 111.32,
          (qlon - site.lon) * 111.32 * Math.cos(site.lat * Math.PI / 180));
        if (dKm > 5) {
          return send(res, 400, JSON.stringify({ error:
            'that spot is ' + dKm.toFixed(1) + ' km from this site — too far to be its parcel' }),
            MIME['.json']);
        }
        at = { lat: qlat, lon: qlon };
      }
      const out = await pullParcel(vendor, sid, +site.lon, +site.lat,
                                   path.join(paths.data, 'raw'),
                                   covered ? 'verify' : 'new',
                                   { force, counties: data.regridCounties, at });
      if (out.parcel && !out.cached) {
        data[vendor] = JSON.parse(fs.readFileSync(
          path.join(paths.data, 'raw', `parcels_${vendor}.geojson`), 'utf8'));
        serialiseRoutes();
      }
      // Formatting lives here rather than in the browser: one table of field
      // labels, server-side, instead of a copy shipped to every page that can
      // draw a parcel. The client renders `groups` and needs to know nothing
      // about Regrid's schema.
      if (out.parcel) {
        const attrs = out.parcel.properties || {};
        out.groups = describeParcel(attrs);
        out.facts = factCount(attrs);
        // A record fetched before this app started keeping the whole field set
        // carries about four facts. Saying so stops a thin popup reading as
        // "the county knows nothing about this parcel".
        out.thin = out.facts <= 5;
      }
      return send(res, 200, JSON.stringify(out), MIME['.json']);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: String(e.message || e) }), MIME['.json']);
    }
  }

  if (req.method === 'POST' && p === '/api/footprint') {
    let body;
    try {
      body = JSON.parse(await readBody(req, 512 * 1024));
    } catch {
      return send(res, 400, '{"error":"expected JSON"}', MIME['.json']);
    }
    const bad = footprintError(body, data.siteById, data.footprintById,
      (id) => data.plantById.has(id) || data.fabs.some(f => f.id === id)
             || data.substationById.has(id) || data.pointById.has(id));
    if (bad) return send(res, 400, JSON.stringify({ error: bad }), MIME['.json']);
    // Idempotent creates: a second click on "adopt this parcel" (or a
    // double-submitted draw) must not mint a twin. If a live shape already
    // carries this exact geometry for the same asset, that IS the save.
    if (!body.id && !body.delete && body.geometry && Array.isArray(body.sites)) {
      const gstr = JSON.stringify(body.geometry);
      for (const f of data.footprintById.values()) {
        if (!f.geometry || !(f.properties.sites || []).some(s => body.sites.includes(s))) continue;
        if (JSON.stringify(f.geometry) === gstr) {
          return send(res, 200, JSON.stringify({ id: f.properties.id, existing: true }),
            MIME['.json']);
        }
      }
    }
    const id = body.id || `fp-man-${Date.now().toString(36)}`;
    const now = new Date().toISOString().slice(0, 19) + 'Z';
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
    const was = data.footprintById.get(id);
    const feature = body.delete
      ? { type: 'Feature', geometry: null,
          properties: { id, deleted: true, note, edited: now } }
      : { type: 'Feature', geometry: body.geometry,
          properties: {
            id,
            kind: body.kind || was?.properties.kind || 'campus',
            // A person now vouches for this shape, whatever first derived it.
            src: 'manual',
            name: typeof body.name === 'string' ? body.name.slice(0, 120)
              : was?.properties.name || '',
            op: was?.properties.op || '',
            sites: Array.isArray(body.sites) ? body.sites : was?.properties.sites || [],
            ...footprintProps(body.geometry),
            note, edited: now,
          } };
    try {
      appendFootprintOverride(paths.data, feature);
      data = await loadAll();     // see the note where `data` is declared
      serialiseRoutes();
      return send(res, 200, JSON.stringify({ id }), MIME['.json']);
    } catch (err) {
      console.error('[footprints] write failed:', err);
      return send(res, 500, JSON.stringify({ error: err.message }), MIME['.json']);
    }
  }

  // /api/wayback/<id> used to live here and does not any more. The archive
  // scan runs in the browser: both endpoints it needs send
  // Access-Control-Allow-Origin: *, so proxying them bought nothing except a
  // server that makes 195 outbound requests while someone waits for a page.
  // See the scan in lib/sitepage.mjs for why the client is the better home.

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

  // Comparative view of the fab layer. Static from the loaded data, so it is
  // rendered per request rather than cached - it is one page of tables.
  if (p === '/fabs' || p === '/fabs/') {
    return send(res, 200, renderFabsPage(data.fabs, data.operatorsPayload.regions, data.outlined), MIME['.html']);
  }
  if (p === '/plants' || p === '/plants/') {
    return send(res, 200, renderPlantsPage(data.plants, data.operatorsPayload.regions, data.outlined), MIME['.html']);
  }
  // The name-conflict queue. Read from disk per request rather than held in
  // `data`, because src/site_names.py rewrites it and a reviewer should see
  // the current queue without a restart.
  if (p === '/review/names' || p === '/review/names/') {
    const qf = path.join(paths.data, 'name_conflicts.json');
    const queue = fs.existsSync(qf) ? JSON.parse(fs.readFileSync(qf, 'utf8')) : [];
    const done = readNameReviews(paths.data);
    const seen = new Set(done.map(r => r.site_id));
    return send(res, 200,
      renderReviewPage(queue.filter(c => !seen.has(c.site_id)), seen.size),
      MIME['.html']);
  }

  // Settle one. `keep` and `neither` write only the review; `take` also writes
  // the name through the same override path the site page uses, so a name set
  // here is indistinguishable from one typed there - which it should be.
  if (req.method === 'POST' && p === '/api/name-review') {
    let body;
    try {
      body = JSON.parse(await readBody(req, 16 * 1024));
    } catch {
      return send(res, 400, '{"error":"expected JSON"}', MIME['.json']);
    }
    const site = data.siteById.get(String(body.site_id || ''));
    if (!site) return send(res, 404, '{"error":"unknown site"}', MIME['.json']);
    if (!['keep', 'take', 'neither'].includes(body.decision)) {
      return send(res, 400, '{"error":"decision must be keep, take or neither"}',
                  MIME['.json']);
    }
    const chosen = typeof body.chosen === 'string' ? body.chosen.slice(0, 300) : '';
    const note = typeof body.note === 'string' ? body.note.slice(0, 300) : '';
    const now = new Date().toISOString().slice(0, 19) + 'Z';
    try {
      if (body.decision === 'take') {
        const bad = validate('name', chosen);
        if (bad) return send(res, 400, JSON.stringify({ error: bad }), MIME['.json']);
        if (chosen && chosen !== String(site.name ?? '')) {
          appendOverrides(paths.data, site.site_id, site, { name: chosen },
                          note || 'settled at /review/names', now);
        }
      }
      appendNameReview(paths.data, {
        site_id: site.site_id, decision: body.decision, chosen, note, reviewed: now,
      });
      data = await loadAll();
      serialiseRoutes();
      return send(res, 200, JSON.stringify({ ok: true }), MIME['.json']);
    } catch (err) {
      console.error('[reviews] write failed:', err);
      return send(res, 500, JSON.stringify({ error: err.message }), MIME['.json']);
    }
  }

  if (p === '/quakes' || p === '/quakes/') {
    return send(res, 200, renderQuakesPage(data.quakes), MIME['.html']);
  }
  // One page per event. The id is the USGS event id and is regex-gated because
  // it becomes a filesystem path below.
  const qk = p.match(/^\/quake\/([a-z0-9]{6,24})$/);
  if (qk) {
    const quake = data.quakes.find(q => q.id === qk[1]);
    if (!quake) return send(res, 404, 'unknown earthquake', 'text/plain');
    // The detail file is optional: quakes.py only writes one where an event is
    // big enough or reached something, so a page for a quiet M5 still renders
    // from the layer record alone.
    const df = path.join(paths.data, 'quake_events', `${qk[1]}.json`);
    const detail = fs.existsSync(df) ? JSON.parse(fs.readFileSync(df, 'utf8')) : null;
    return send(res, 200, renderQuakePage({
      quake, detail, geo: makeGeo(data.operatorsPayload.regions),
    }), MIME['.html']);
  }

  if (p === '/licences' || p === '/licences/' || p === '/licenses') {
    return send(res, 200, renderLicencesPage(), MIME['.html']);
  }

  if (p === '/power' || p === '/power/') {
    return send(res, 200, renderPowerPage({
      accumulation: data.accumulation, powerDeps: data.powerDeps,
      substationById: data.substationById, siteById: data.siteById,
      fabById: data.fabById, plantById: data.plantById,
    }), MIME['.html']);
  }
  if (p === '/supply' || p === '/supply/') {
    return send(res, 200, renderSupplyPage({
      sites: data.sites, fabs: data.fabs,
      plantById: data.plantById, annByPlant: data.annByPlant,
    }), MIME['.html']);
  }
  if (p === '/footprints' || p === '/footprints/') {
    return send(res, 200, renderFootprintsPage({
      footprints: data.footprints, sites: data.sites, fabs: data.fabs,
      plantById: data.plantById, regions: data.operatorsPayload.regions,
    }), MIME['.html']);
  }

  // ---- /data : the registry's own change log, and the pipeline ------------
  // Read-only and open like every other page. Only the RUN endpoints below are
  // loopback-gated, because only they execute anything.
  if (p === '/data') {
    const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 1));
    const sinceDay = sinceDate(days);
    const sinceMs = Date.parse(sinceDay + 'T00:00:00');
    // src/ as well as data/: a change to dedupe.py's clustering radius or
    // fabs.py's power model reshapes the data more decisively than any single
    // ledger row, and a page about data changes that ignored the code that
    // produces the data would be reporting the output of a black box.
    const [dataC, srcC, pending] = await Promise.all([
      gitChanges(paths.root, sinceDay, 'data'),
      gitChanges(paths.root, sinceDay, 'src'),
      workingTree(paths.root, '.'),
    ]);
    const byHash = new Map();
    for (const c of [...dataC, ...srcC]) {
      const seen = byHash.get(c.hash);
      if (seen) { for (const f of c.files) if (!seen.files.some(x => x.path === f.path)) seen.files.push(f); }
      else byHash.set(c.hash, { ...c, files: [...c.files] });
    }
    const commits = [...byHash.values()].sort((a, b) => b.when.localeCompare(a.when));
    // The caches that actually exist, checked against the directory rather
    // than remembered: an earlier version of this list named a `wayback`
    // directory that has never existed, and silently reported nothing for it.
    // The paid ones are marked, because "7 files touched" in a metered cache
    // is a sentence about money.
    const raw = [];
    for (const [dir, label, paid] of [
      ['parcels_regrid_cache', 'Regrid parcel cache', true],
      ['parcels_precisely_cache', 'Precisely parcel cache', true],
      ['geocode_cache', 'Precisely geocode cache', true],
      ['poi_verify_cache', 'Precisely POI cache', true],
      ['parcels_wfs_cache', 'WFS parcel cache', false],
      ['plant_fp_cache', 'Plant footprint cache', false],
      ['runlogs', 'Pipeline run logs', false],
    ]) {
      const s = dirSummary(path.join(paths.data, 'raw', dir), sinceMs);
      if (s.total && s.recent) {
        raw.push({ label: label + (paid ? ' · metered' : ''),
                   detail: `${s.recent} of ${s.total} files touched`,
                   when: s.newest || '' });
      }
    }
    // Uploaded imagery: gitignored, and the only stamp is the file's own mtime
    // (the date in the NAME is the imagery's, not the upload's).
    for (const f of touchedFiles(path.join(paths.data, 'site_images'), sinceMs,
                                 { maxDepth: 2, limit: 40 })) {
      raw.push({ label: 'Uploaded imagery',
                 detail: path.relative(paths.data, f.path), when: f.mtime });
    }
    const st = runState();
    return send(res, 200, renderDataPage({
      days, sinceDay, commits, pending,
      ledgers: ledgerActivity(paths.root, sinceDay), raw,
      running: st.running, history: st.history, blindSpots: BLIND_SPOTS,
      freshness: stepFreshness(paths.root),
    }), MIME['.html']);
  }

  // Starting a process is the one thing on this server that is not a read or a
  // row append, so it is refused to anything but this machine. See the note at
  // the top of lib/pipeline.mjs: server.listen() binds every interface.
  if (req.method === 'POST' && p === '/api/data/run') {
    if (!isLocal(req)) {
      return send(res, 403, JSON.stringify({ error:
        'Pipeline runs are available only from the machine the server is on.' }),
        MIME['.json']);
    }
    let body;
    try { body = JSON.parse(await readBody(req, 4 * 1024)); }
    catch { return send(res, 400, '{"error":"expected JSON"}', MIME['.json']); }
    const step = stepByKey.get(String(body.key || ''));
    if (!step) return send(res, 400, '{"error":"unknown step"}', MIME['.json']);
    if (step.cost === 'paid' && body.confirm !== true) {
      return send(res, 409, JSON.stringify({ error: 'confirm required',
        paid: true, about: step.about || '' }), MIME['.json']);
    }
    try {
      const r = startRun(paths.root, step.key, path.join(paths.data, 'raw', 'runlogs'));
      return send(res, 200, JSON.stringify({ id: r.id, key: r.key }), MIME['.json']);
    } catch (e) {
      return send(res, 409, JSON.stringify({ error: e.message }), MIME['.json']);
    }
  }

  const rl = p.match(/^\/api\/data\/run\/(run-[a-z0-9]+)$/);
  if (rl) {
    if (!isLocal(req)) return send(res, 403, '{"error":"local only"}', MIME['.json']);
    if (req.method === 'POST') {                       // stop
      return send(res, 200, JSON.stringify({ stopped: stopRun(rl[1]) }), MIME['.json']);
    }
    const t = tailLog(rl[1]);
    if (!t) return send(res, 404, '{"error":"unknown run"}', MIME['.json']);
    return send(res, 200, JSON.stringify(t), MIME['.json']);
  }

  if (p === '/datacentres' || p === '/datacentres/' || p === '/datacenters') {
    return send(res, 200,
      renderDcPage(data.mapSites, data.operatorsPayload.regions, data.operatorsPayload.operators, data.outlined),
      MIME['.html']);
  }

  // A page per dot for the layers that never had one. Ids are the ingest's own
  // and regex-gated: e<eia>, g<gem project>, f<nnn>.
  // ---- simulated events ---------------------------------------------------
  const evFile = path.join(paths.data, 'events.json');
  const writeEvents = () => {
    const all = [...data.eventById.values()].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(evFile, JSON.stringify(all, null, 1) + '\n');
  };

  if (req.method === 'POST' && p === '/api/event') {
    let body;
    try { body = JSON.parse(await readBody(req, 16 * 1024)); }
    catch { return send(res, 400, '{"error":"expected JSON"}', MIME['.json']); }
    const id = 'ev-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    const rec = {
      id, lat: +(+body.lat).toFixed(6), lon: +(+body.lon).toFixed(6),
      kind: EVENT_KINDS[body.kind] ? body.kind : 'outage',
      radius_km: Math.min(MAX_RADIUS_KM, Math.max(0.5, +body.radius_km || DEFAULT_RADIUS_KM)),
      name: typeof body.name === 'string' ? body.name.slice(0, 120) : '',
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : '',
      created: new Date().toISOString().slice(0, 19) + 'Z',
    };
    const bad = eventErrors(rec);
    if (bad.length) return send(res, 400, JSON.stringify({ error: bad.join('; ') }), MIME['.json']);
    data.eventById.set(id, rec);
    writeEvents();
    serialiseRoutes();
    return send(res, 200, JSON.stringify({ id, href: '/event/' + id }), MIME['.json']);
  }

  const ee = req.method === 'POST' && p.match(/^\/api\/event\/(ev-[\w-]{1,44})$/);
  if (ee) {
    const ev = data.eventById.get(ee[1]);
    if (!ev) return send(res, 404, '{"error":"unknown event"}', MIME['.json']);
    let body;
    try { body = JSON.parse(await readBody(req, 16 * 1024)); }
    catch { return send(res, 400, '{"error":"expected JSON"}', MIME['.json']); }
    if (body.delete) {
      data.eventById.delete(ev.id);
      writeEvents();
      serialiseRoutes();
      return send(res, 200, '{"deleted":1}', MIME['.json']);
    }
    const next = { ...ev };
    if (body.kind != null) {
      if (!EVENT_KINDS[body.kind]) return send(res, 400, '{"error":"unknown kind"}', MIME['.json']);
      next.kind = body.kind;
    }
    if (body.radius_km != null) {
      next.radius_km = Math.min(MAX_RADIUS_KM, Math.max(0.5, +body.radius_km || DEFAULT_RADIUS_KM));
    }
    for (const k of ['lat', 'lon']) {
      if (body[k] != null && Number.isFinite(+body[k])) next[k] = +(+body[k]).toFixed(6);
    }
    if (typeof body.name === 'string') next.name = body.name.slice(0, 120);
    if (typeof body.note === 'string') next.note = body.note.slice(0, 500);
    const bad = eventErrors(next);
    if (bad.length) return send(res, 400, JSON.stringify({ error: bad.join('; ') }), MIME['.json']);
    data.eventById.set(next.id, next);
    writeEvents();
    serialiseRoutes();
    return send(res, 200, '{"saved":1}', MIME['.json']);
  }

  const evg = p.match(/^\/event\/(ev-[\w-]{1,44})$/);
  if (evg) {
    const ev = data.eventById.get(evg[1]);
    if (!ev) return send(res, 404, 'unknown event', 'text/plain');
    return send(res, 200, renderEventPage({
      ev, accumulation: data.accumulation, kmBetween: data.kmBetween,
      nameOf: assetNameOf,
    }), MIME['.html']);
  }

  // ---- dropped points -----------------------------------------------------
  // Their own file, written whole rather than appended: a point is a DRAFT and
  // gets edited over and over, so an append-only ledger would be mostly
  // superseded rows. The audit trail that matters is the promotion, which
  // lands in a source file that IS append-only.
  const ptFile = path.join(paths.data, 'draft_points.json');
  const writePoints = () => {
    const all = [...data.pointById.values()].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(ptFile, JSON.stringify(all, null, 1) + '\n');
  };

  if (req.method === 'POST' && p === '/api/point') {
    let body;
    try { body = JSON.parse(await readBody(req, 16 * 1024)); }
    catch { return send(res, 400, '{"error":"expected JSON"}', MIME['.json']); }
    const lat = +body.lat, lon = +body.lon;
    // A short random id, not a counter: two people dropping pins in the same
    // second must not collide, and the id is never a ranking.
    const id = 'pt-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    const rec = { id, lat: +lat.toFixed(6), lon: +lon.toFixed(6), kind: '', fields: {},
                  note: '', created: new Date().toISOString().slice(0, 19) + 'Z' };
    const bad = pointErrors(rec);
    if (bad.length) return send(res, 400, JSON.stringify({ error: bad.join('; ') }), MIME['.json']);
    data.pointById.set(id, rec);
    writePoints();
    serialiseRoutes();
    return send(res, 200, JSON.stringify({ id, href: '/point/' + id }), MIME['.json']);
  }

  const pe = req.method === 'POST' && p.match(/^\/api\/point\/(pt-[\w-]{1,44})$/);
  if (pe) {
    const pt = data.pointById.get(pe[1]);
    if (!pt) return send(res, 404, '{"error":"unknown point"}', MIME['.json']);
    let body;
    try { body = JSON.parse(await readBody(req, 64 * 1024)); }
    catch { return send(res, 400, '{"error":"expected JSON"}', MIME['.json']); }
    if (body.delete) {
      data.pointById.delete(pt.id);
      writePoints();
      serialiseRoutes();
      return send(res, 200, '{"deleted":1}', MIME['.json']);
    }
    const next = { ...pt };
    if (typeof body.kind === 'string') {
      if (body.kind && !POINT_KINDS[body.kind]) {
        return send(res, 400, '{"error":"unknown kind"}', MIME['.json']);
      }
      // Changing kind drops fields the new kind has no column for, rather
      // than carrying orphans nothing will ever render.
      if (body.kind !== pt.kind) {
        const keep = (POINT_KINDS[body.kind] || {}).fields || {};
        const f = {};
        for (const [k, v] of Object.entries(next.fields || {})) if (keep[k]) f[k] = v;
        next.fields = f;
      }
      next.kind = body.kind;
    }
    if (body.fields && typeof body.fields === 'object') {
      const f = { ...(next.fields || {}) };
      for (const [k, v] of Object.entries(body.fields)) {
        const bad = fieldError(next.kind, k, v);
        if (bad) return send(res, 400, JSON.stringify({ error: k + ': ' + bad }), MIME['.json']);
        if (String(v).trim()) f[k] = String(v).trim(); else delete f[k];
      }
      next.fields = f;
    }
    for (const k of ['lat', 'lon']) {
      if (body[k] != null && Number.isFinite(+body[k])) next[k] = +(+body[k]).toFixed(6);
    }
    if (typeof body.note === 'string') next.note = body.note.slice(0, 500);
    next.edited = new Date().toISOString().slice(0, 19) + 'Z';
    const bad = pointErrors(next);
    if (bad.length) return send(res, 400, JSON.stringify({ error: bad.join('; ') }), MIME['.json']);
    data.pointById.set(next.id, next);
    writePoints();
    serialiseRoutes();
    return send(res, 200, JSON.stringify({ saved: 1 }), MIME['.json']);
  }

  const pg = p.match(/^\/point\/(pt-[\w-]{1,44})$/);
  if (pg) {
    const pt = data.pointById.get(pg[1]);
    if (!pt) return send(res, 404, 'unknown point', 'text/plain');
    return send(res, 200, renderPointPage({ pt, wayback }), MIME['.html']);
  }

  // The accumulation rows copy each dependency point's coordinate at load, and
  // the map layer is built by filtering THOSE for a non-null one. Placing a
  // substation therefore has to reach the copy as well, or the ledger gains a
  // coordinate the map never shows.
  const rebuildAccumulationGeo = () => {
    for (const a of data.accumulation) {
      const node = data.substationById.get(a.id);
      if (!node) continue;
      a.lat = node.lat != null ? node.lat : null;
      a.lon = node.lon != null ? node.lon : null;
    }
  };

  // POST /api/substation/<id>/place - give an UNLOCATED substation a coordinate.
  //
  // Narrow on purpose. This is not "edit the dot": a substation OSM has
  // located is refused outright, because its coordinate tracks a source and a
  // hand value here would silently disagree with it. What it is for is the
  // hundred substations that have a name from a filing and no place at all,
  // three of which carry 3.2 GW that the map cannot show for want of two
  // numbers. See dcmap/lib/placements.mjs.
  const sp = req.method === 'POST'
    && p.match(/^\/api\/substation\/(sub-[\w.-]{1,60})\/place$/);
  if (sp) {
    const sub = data.substationById.get(sp[1]);
    if (!sub) return send(res, 404, '{"error":"unknown substation"}', MIME['.json']);
    if (sub.located && sub.osm) {
      return send(res, 409, JSON.stringify({
        error: 'This substation is already placed from OpenStreetMap. A hand '
             + 'coordinate would disagree with the source it tracks — correct it '
             + 'in OSM, or in the filing extract, instead.',
      }), MIME['.json']);
    }
    let body;
    try { body = JSON.parse(await readBody(req, 8 * 1024)); }
    catch { return send(res, 400, '{"error":"expected JSON"}', MIME['.json']); }
    const row = {
      sub_id: sub.id,
      name: sub.name,
      lat: Number.isFinite(+body.lat) ? (+body.lat).toFixed(6) : '',
      lon: Number.isFinite(+body.lon) ? (+body.lon).toFixed(6) : '',
      basis: String(body.basis || '').slice(0, 40),
      note: String(body.note || '').trim().slice(0, 500),
      edited: new Date().toISOString().slice(0, 19) + 'Z',
    };
    const bad = placementErrors(row);
    if (bad.length) {
      return send(res, 400, JSON.stringify({ error: bad.join('; ') }), MIME['.json']);
    }
    const f = path.join(paths.data, 'substation_placements.csv');
    if (!fs.existsSync(f)) fs.writeFileSync(f, PLACEMENT_COLUMNS.join(',') + '\n');
    fs.appendFileSync(f, placementRow(row) + '\n');
    // Re-apply from the file rather than mutating the record here, so what the
    // app shows is what the ledger says - the two cannot drift apart if only
    // one of them is ever the source.
    applyPlacements(data.substationById, readPlacements(paths.data));
    rebuildAccumulationGeo();
    serialiseRoutes();
    return send(res, 200, JSON.stringify({ saved: 1, lat: +row.lat, lon: +row.lon }),
                MIME['.json']);
  }

  // A page per substation. Substations are named by filings and placed from
  // OSM, not curated here - the one exception is placing a substation OSM
  // never found, which fills a void rather than overriding a source.
  const sb = p.match(/^\/substation\/(sub-[\w.-]{1,60})$/);
  if (sb) {
    const sub = data.substationById.get(sb[1]);
    if (!sub) return send(res, 404, 'unknown substation', 'text/plain');
    return send(res, 200, renderSubstationPage({
      sub, deps: data.depsByDep.get(sub.id) || [],
      accumulation: data.accumulation, depsByDep: data.depsByDep,
      nameOf: assetNameOf, wayback, countyCentre: data.countyCentre,
    }), MIME['.html']);
  }

  const pl = p.match(/^\/plant\/([eg][A-Za-z0-9]+)$/);
  if (pl) {
    const plant = data.plantById.get(pl[1]);
    if (!plant) return send(res, 404, 'unknown plant', 'text/plain');
    return send(res, 200, renderPlantPage({
      plant, sites: data.mapSites, fabs: data.fabs,
      linked: data.sitesByPlant.get(plant.id) || [],
      linkedAnn: data.annByPlant.get(plant.id) || [],
      linkedFabs: data.fabsByPlant.get(plant.id) || [],
      geo: makeGeo(data.operatorsPayload.regions), kmBetween: data.kmBetween,
      depsByAsset: data.depsByAsset, depsByDep: data.depsByDep,
      accumulation: data.accumulation, nameOf: assetNameOf,
    }), MIME['.html']);
  }
  const fb = p.match(/^\/fab\/(f\d+)$/);
  if (fb) {
    const fab = data.fabs.find(f => f.id === fb[1]);
    if (!fab) return send(res, 404, 'unknown fab', 'text/plain');
    return send(res, 200, renderFabPage({
      fab, sites: data.mapSites, plants: data.plants,
      linkedPlant: fab.link_plant_id ? data.plantById.get(fab.link_plant_id) || null : null,
      geo: makeGeo(data.operatorsPayload.regions), kmBetween: data.kmBetween,
      depsByAsset: data.depsByAsset, depsByDep: data.depsByDep,
      accumulation: data.accumulation, nameOf: assetNameOf,
    }), MIME['.html']);
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

  if (JSON_ROUTES[p]) {
    const r = JSON_ROUTES[p];
    // Vary matters even though every browser sends gzip: without it a proxy
    // can hand the compressed bytes to a client that did not ask for them.
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      return send(res, 200, r.gz, MIME['.json'],
        { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    }
    return send(res, 200, r.raw, MIME['.json'], { Vary: 'Accept-Encoding' });
  }

  // Per-event ShakeMap detail, loaded when an epicentre is clicked. The id is
  // regex-gated and basename'd: it becomes a filesystem path.
  const ev = p.match(/^\/data\/quake\/([a-z0-9]{6,24})$/);
  if (ev) {
    const f = path.join(paths.data, 'quake_events', `${ev[1]}.json`);
    if (!fs.existsSync(f)) return send(res, 404, 'no detail for that event', 'text/plain');
    return send(res, 200, fs.readFileSync(f), MIME['.json']);
  }
  // The vector basemap, served by range. GET and HEAD only: the client probes
  // with a 16-byte range before it registers the protocol, so that a clone
  // without the archive degrades to the map it had before rather than filling
  // the console with failed tile reads.
  if (p === '/basemap.pmtiles') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'GET or HEAD', 'text/plain');
    }
    return sendRange(req, res, TILES, MIME['.pmtiles']);
  }

  // Transmission corridors as tiles, built by src/tiles.py. Same range route
  // as the basemap and the same graceful absence: the client probes with a
  // 7-byte range first and falls back to /data/power_lines.json if the
  // archive is not here, so a clone that has not run tiles.py keeps the layer.
  // Both derived archives from src/tiles.py, by the same range route.
  const arch = p.match(/^\/(transmission|water)\.pmtiles$/);
  if (arch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'GET or HEAD', 'text/plain');
    }
    return sendRange(req, res, path.join(paths.data, 'raw', `${arch[1]}.pmtiles`),
                     MIME['.pmtiles']);
  }

  // Signed-distance-field glyph ranges. The fontstack is a directory name with
  // spaces in it ("Noto Sans Regular"), so it arrives percent-encoded and has
  // to be decoded before it will match - and decoding is exactly what lets a
  // %2e%2e through, hence the containment check on the joined path rather than
  // on what the client sent.
  const gy = p.match(/^\/glyphs\/([^/]+)\/(\d{1,5}-\d{1,5})\.pbf$/);
  if (gy) {
    let stack;
    try {
      stack = decodeURIComponent(gy[1]);
    } catch {
      return send(res, 400, 'bad fontstack', 'text/plain');
    }
    const f = path.join(GLYPHS, stack, `${gy[2]}.pbf`);
    if (!f.startsWith(GLYPHS + path.sep) || !fs.existsSync(f)) {
      return send(res, 404, 'no such glyph range', 'text/plain');
    }
    // A year. These are font data: they change when the font does, which is
    // never, and re-fetching them on every pan is the one thing that would
    // make self-hosted labels feel slower than the demo server they replace.
    return send(res, 200, fs.readFileSync(f), MIME['.pbf'],
                { 'Cache-Control': 'public, max-age=31536000, immutable' });
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
