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
import zlib from 'node:zlib';
import { loadAll, paths } from './lib/data.mjs';
import { renderSitePage } from './lib/sitepage.mjs';
import { renderOperatorPage } from './lib/operatorpage.mjs';
import { renderFabsPage } from './lib/fabspage.mjs';
import { renderPlantsPage } from './lib/plantspage.mjs';
import { renderDcPage } from './lib/dcpage.mjs';
import { renderPlantPage, renderFabPage } from './lib/dotpage.mjs';
import { renderQuakesPage, renderQuakePage } from './lib/quakepage.mjs';
import { makeGeo } from './lib/summary.mjs';
import { FIELDS, validate, appendOverrides, linkError, kindError,
         plantLinkError, footprintError, footprintProps,
         appendFootprintOverride, readNameReviews,
         appendNameReview } from './lib/overrides.mjs';
import { renderReviewPage } from './lib/reviewpage.mjs';

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
    '/data/plants.json': JSON.stringify(data.plants),
    '/data/fabs.json': JSON.stringify(data.fabs),
    '/data/operators.json': JSON.stringify(data.operatorsPayload),
    // NOT the footprints: see /api/footprints above. 19,367 of them is more
    // than MapLibre's worker survives in one source, and more than any one
    // view needs.
  };
  JSON_ROUTES = {};
  for (const [p, body] of Object.entries(routes)) {
    JSON_ROUTES[p] = { raw: body, gz: zlib.gzipSync(body, { level: 9 }) };
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
  const nb = p.match(/^\/api\/nearby\/(site-[a-z0-9-]+)$/);
  if (nb) {
    const site = data.siteById.get(nb[1]);
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

  // Draw, correct or hide a footprint. Writes one Feature line to
  // data/footprint_overrides.geojsonl - a SOURCE with the same contract as
  // site_overrides.csv - then reloads, so the shape is live without a restart.
  if (req.method === 'POST' && p === '/api/footprint') {
    let body;
    try {
      body = JSON.parse(await readBody(req, 512 * 1024));
    } catch {
      return send(res, 400, '{"error":"expected JSON"}', MIME['.json']);
    }
    const bad = footprintError(body, data.siteById, data.footprintById);
    if (bad) return send(res, 400, JSON.stringify({ error: bad }), MIME['.json']);
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
    return send(res, 200, renderFabsPage(data.fabs, data.operatorsPayload.regions), MIME['.html']);
  }
  if (p === '/plants' || p === '/plants/') {
    return send(res, 200, renderPlantsPage(data.plants, data.operatorsPayload.regions), MIME['.html']);
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

  if (p === '/datacentres' || p === '/datacentres/' || p === '/datacenters') {
    return send(res, 200,
      renderDcPage(data.mapSites, data.operatorsPayload.regions, data.operatorsPayload.operators),
      MIME['.html']);
  }

  // A page per dot for the layers that never had one. Ids are the ingest's own
  // and regex-gated: e<eia>, g<gem project>, f<nnn>.
  const pl = p.match(/^\/plant\/([eg][A-Za-z0-9]+)$/);
  if (pl) {
    const plant = data.plantById.get(pl[1]);
    if (!plant) return send(res, 404, 'unknown plant', 'text/plain');
    return send(res, 200, renderPlantPage({
      plant, sites: data.mapSites, fabs: data.fabs,
      geo: makeGeo(data.operatorsPayload.regions), kmBetween: data.kmBetween,
    }), MIME['.html']);
  }
  const fb = p.match(/^\/fab\/(f\d+)$/);
  if (fb) {
    const fab = data.fabs.find(f => f.id === fb[1]);
    if (!fab) return send(res, 404, 'unknown fab', 'text/plain');
    return send(res, 200, renderFabPage({
      fab, sites: data.mapSites, plants: data.plants,
      geo: makeGeo(data.operatorsPayload.regions), kmBetween: data.kmBetween,
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
