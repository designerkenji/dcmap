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

const data = await loadAll();

// Pre-serialise the payloads once; they are immutable for the process lifetime.
const JSON_ROUTES = {
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
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
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
});

server.listen(PORT, () => console.log(`dcmap listening on http://localhost:${PORT}`));
