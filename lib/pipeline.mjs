// Running the data pipeline from the admin page.
//
// SAFETY, BECAUSE THIS IS THE ONE PART OF THE APP THAT EXECUTES ANYTHING
//
// The server calls server.listen(PORT) with no host, so Node binds every
// interface - this app is reachable from the local network, not just from the
// machine it runs on. An endpoint that starts processes therefore has to
// assume a stranger can reach it, and three rules follow:
//
//   - ALLOWLIST ONLY. A request names a KEY in the table below, never a path,
//     never an argument. Nothing a caller sends is ever concatenated into a
//     command. execFile with an argv array, no shell, so there is no string
//     for a caller to break out of even if the allowlist were bypassed.
//   - LOOPBACK ONLY. isLocal() below; the routes refuse anything else. The
//     read-only map staying visible on the LAN is a feature, and it is not one
//     that should have arrived carrying remote code execution.
//   - PAID RUNS NEED SAYING TWICE. Regrid and Precisely bill per record
//     returned. Those entries carry cost:'paid' and the endpoint refuses them
//     without an explicit confirm, so a mis-click cannot spend money.
//
// One run at a time, globally. These scripts write the same derived files and
// two of them at once would interleave writes into data/facilities_sites.csv
// and leave a file that never existed as anybody's output.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Only loopback may run anything. IPv6-mapped IPv4 (::ffff:127.0.0.1) is what
// Node actually reports on a dual-stack listener, so it has to be matched too
// or the check refuses the very machine it is meant to allow.
export function isLocal(req) {
  const a = req.socket && req.socket.remoteAddress;
  if (!a) return false;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
      || a.startsWith('127.');
}

// The pipeline, in the order the chain actually runs. `writes` is what the
// admin page shows you BEFORE you press it, because "what is this about to
// overwrite" is the question you want answered first.
export const STEPS = [
  { key: 'osm', script: 'osm.py', label: 'OpenStreetMap sites',
    group: 'Ingest', cost: 'free',
    writes: ['data/osm_datacenters.csv', 'data/osm_<region>.csv',
             'data/raw/osm_<region>.json'],
    about: 'Overpass query for data centres. Slow and rate-limited upstream. '
         + 'A failed fetch falls back to the cache rather than destroying it.' },
  { key: 'epoch', script: 'epoch.py', label: 'Epoch AI release',
    group: 'Ingest', cost: 'free',
    writes: ['data/facilities_osm_epoch.csv'],
    about: 'Reads the downloaded Epoch CSVs. CC BY 4.0 — attribution is required.' },
  { key: 'epoch_check', script: 'epoch_check.py', label: 'Epoch H100 cross-check',
    group: 'Sources', cost: 'free', writes: ['data/epoch_check.json'],
    about: 'Reconciles Epoch\'s headline compute against its own chip counts. '
         + 'Reports only - it never changes the registry.' },
  { key: 'manual', script: 'manual.py', label: 'Hand-added sites',
    group: 'Ingest', cost: 'free',
    writes: ['data/facilities_with_manual.csv'],
    about: 'Folds data/manual_sites.csv in. Never overwrites that ledger.' },
  { key: 'peeringdb', script: 'peeringdb.py', label: 'PeeringDB',
    group: 'Ingest', cost: 'free',
    writes: ['data/facilities_global.csv'] },
  { key: 'dedupe', script: 'dedupe.py', label: 'Deduplicate to sites',
    group: 'Ingest', cost: 'free',
    writes: ['data/facilities_sites.csv'],
    about: 'Mints site ids. Re-running can RE-KEY a site, which orphans any '
         + 'cache or ledger row filed under the old id.' },

  { key: 'plants', script: 'plants.py', label: 'Power plants',
    group: 'Sources', cost: 'free', writes: ['data/power_plants.json'],
    about: 'EIA-860M for the US, Global Energy Monitor for the rest.' },
  { key: 'quakes', script: 'quakes.py', label: 'Earthquakes',
    group: 'Sources', cost: 'free',
    // The layer config lands in data/wm/ - inside this repository, so /data's
    // git section sees it. It used to be written into a worldmonitor checkout
    // next door, which nothing here could see.
    writes: ['data/wm/quakes-recent.ts', 'raw/quake_*/'],
    about: 'USGS, rolling window — old events leave as new ones arrive.' },
  { key: 'fabs', script: 'fabs.py', label: 'Semiconductor fabs',
    group: 'Sources', cost: 'free', writes: ['data/fabs.json'] },
  { key: 'teac', script: 'teac.py', label: 'PJM TEAC filings',
    group: 'Sources', cost: 'free',
    writes: ['data/teac_projects.csv', 'data/teac_needs.csv'] },
  { key: 'nyiso_loads', script: 'nyiso_loads.py', label: 'NYISO load queue',
    group: 'Sources', cost: 'free', writes: ['data/nyiso_load_projects.csv'] },

  { key: 'power_deps', script: 'power_deps.py', label: 'Power dependency graph',
    group: 'Derive', cost: 'free',
    writes: ['data/power_dependencies.json', 'data/substations.json'],
    about: 'Carries forward geocoding and hand placements rather than blanking them.' },
  { key: 'substation_geo', script: 'substation_geo.py', label: 'Place substations (OSM)',
    group: 'Derive', cost: 'free', writes: ['data/substations.json'],
    about: 'Nominatim, one request a second — a full run takes a few minutes.' },
  { key: 'power_lines', script: 'power_lines.py', label: 'Transmission corridors (OSM)',
    group: 'Sources', cost: 'free',
    writes: ['data/transmission_lines.geojson', 'raw/power_lines_<region>.json'],
    about: 'OpenStreetMap power=line for the regions the dependency ledger covers. '
         + 'ODbL. Overpass is often busy — a region that fails is skipped and the '
         + 'previous data kept, so a partial run never destroys a good file.' },
  { key: 'tiles', script: 'tiles.py', label: 'Map tiles (transmission, water)',
    group: 'Derive', cost: 'free',
    writes: ['data/raw/transmission.pmtiles', 'data/raw/water.pmtiles'],
    about: 'tippecanoe -> PMTiles for the corridors and the water service areas, so '
         + 'the map fetches the viewport rather than whole layers. Needs tippecanoe.' },
  { key: 'water_service', script: 'water_service.py', label: 'Water utility per site (EPA)',
    group: 'Derive', cost: 'free', writes: ['data/water_service.csv'],
    about: 'Point-in-polygon of every US site against EPA\'s community water system '
         + 'service areas: the named utility, population served, connections. Needs the '
         + '570 MB EPA download extracted under data/raw/epa_sab/.' },
  { key: 'county_centroids', script: 'county_centroids.py', label: 'County centroids',
    group: 'Derive', cost: 'free', writes: ['data/county_centroids.json'] },
  { key: 'match_site_links', script: 'match_site_links.py', label: 'Site ⇄ plant links',
    group: 'Derive', cost: 'free', writes: ['data/site_links.json'] },
  { key: 'operators', script: 'operators.py', label: 'Operators',
    group: 'Derive', cost: 'free', writes: ['data/operators.json'] },
  { key: 'footprints', script: 'footprints.py', label: 'Footprints',
    group: 'Derive', cost: 'free', writes: ['data/footprints.geojson'],
    about: 'Merges every parcel and building source, hand edits last.' },
  { key: 'country_layer', script: 'country_layer.py', label: 'Country layer',
    group: 'Derive', cost: 'free', writes: ['data/country_summary.csv'] },

  { key: 'regrid_verse', script: 'regrid_verse.py', label: 'Regrid county refresh dates',
    group: 'Vendor', cost: 'free',
    writes: ['data/regrid_counties.json'],
    about: 'County metadata, not parcels — so it does not touch the parcel quota. '
         + 'Says when Regrid last pulled each county, which is how the app knows '
         + 'whether re-asking about a held parcel could return anything new.' },
  { key: 'parcels_regrid', script: 'parcels_regrid.py', label: 'Regrid parcels',
    group: 'Vendor', cost: 'paid',
    writes: ['data/raw/parcels_regrid.geojson'],
    about: 'Bills per parcel RETURNED. Empty answers are free, cached sites are '
         + 'never re-asked, and the trial token caps at 25 results a day.' },
  { key: 'parcels_precisely', script: 'parcels_precisely.py', label: 'Precisely parcels',
    group: 'Vendor', cost: 'paid',
    writes: ['data/raw/parcels_precisely.geojson'],
    about: 'Same billing shape as Regrid: per record returned, cached forever.' },
];

export const stepByKey = new Map(STEPS.map(s => [s.key, s]));

// When each step's output was last written, from the `writes` it already
// declares - no second table to drift. Patterns (<region>, *) expand against
// the directory; a step whose outputs are all absent reports age null, which
// renders as "never ran here" rather than pretending to a date.
// `data/...` outputs live under the app (root); `raw/...` are the pipeline's
// own pulls beside it, which may be absent - then those steps read as never
// having run here, which is the truth.
export function stepFreshness(root, pipelineRaw = null) {
  const out = [];
  for (const s of STEPS) {
    let newest = 0;
    for (const w0 of s.writes || []) {
      let base = root, w = w0;
      if (w.startsWith('raw/')) {
        if (!pipelineRaw) continue;
        base = path.dirname(pipelineRaw); // raw/ is relative to the pipeline's parent
      }
      const pat = w.replace(/<[^>]+>/g, '*').replace(/\/$/, '');
      const star = pat.indexOf('*');
      let files = [];
      if (star === -1) {
        files = [path.join(base, pat)];
      } else {
        const dir = path.join(base, pat.slice(0, pat.lastIndexOf('/')));
        const rx = new RegExp('^' + pat.slice(pat.lastIndexOf('/') + 1)
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        try {
          files = fs.readdirSync(dir).filter(f => rx.test(f)).map(f => path.join(dir, f));
        } catch { files = []; }
      }
      for (const f of files) {
        try { newest = Math.max(newest, fs.statSync(f).mtimeMs); } catch { /* absent */ }
      }
    }
    out.push({ key: s.key, label: s.label, group: s.group || '', cost: s.cost || '',
               newest: newest || null,
               ageDays: newest ? (Date.now() - newest) / 86400000 : null });
  }
  return out;
}

// ---- one run at a time ----------------------------------------------------
let current = null;          // { id, key, started, proc, log, done, code }
const history = [];          // finished runs, newest first, capped

export const runState = () => ({
  running: current ? {
    id: current.id, key: current.key, label: stepByKey.get(current.key).label,
    started: current.started,
  } : null,
  history: history.slice(0, 12),
});

export function tailLog(id, bytes = 8000) {
  const r = current && current.id === id ? current : history.find(h => h.id === id);
  if (!r) return null;
  let text = '';
  try {
    const st = fs.statSync(r.log);
    const fd = fs.openSync(r.log, 'r');
    const start = Math.max(0, st.size - bytes);
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { /* log not created yet */ }
  return {
    id: r.id, key: r.key, started: r.started, finished: r.finished || null,
    running: !r.done, code: r.done ? r.code : null, truncated: text.length >= bytes,
    text,
  };
}

export function startRun(pipeline, key, logDir) {
  const step = stepByKey.get(key);
  if (!step) throw new Error('unknown step');
  if (!pipeline) throw new Error('the pipeline is not available on this server');
  if (current && !current.done) throw new Error('a run is already in progress');

  fs.mkdirSync(logDir, { recursive: true });
  const id = 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const log = path.join(logDir, id + '.log');
  const out = fs.openSync(log, 'a');

  // execFile semantics: an argv array, no shell. `step.script` comes from the
  // table above and never from the request.
  // Scripts locate everything through src/paths.py from their own file
  // location, so cwd only has to be somewhere sensible - their parent.
  const proc = spawn('python3', [path.join(pipeline, step.script)], {
    cwd: path.dirname(pipeline), stdio: ['ignore', out, out],
  });

  const rec = { id, key, started: new Date().toISOString(), proc, log,
                done: false, code: null, finished: null };
  current = rec;
  proc.on('exit', (code, signal) => {
    rec.done = true;
    rec.code = code == null ? `signal ${signal}` : code;
    rec.finished = new Date().toISOString();
    try { fs.closeSync(out); } catch { /* already closed */ }
    history.unshift({ id, key, started: rec.started, finished: rec.finished,
                      code: rec.code, log, done: true });
    if (history.length > 40) history.length = 40;
    if (current === rec) current = null;
  });
  proc.on('error', (err) => {
    try { fs.appendFileSync(log, `\ncould not start: ${err.message}\n`); } catch { /* noop */ }
  });
  return { id, key, log };
}

export function stopRun(id) {
  if (!current || current.id !== id || current.done) return false;
  current.proc.kill('SIGTERM');
  return true;
}
