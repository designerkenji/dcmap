// Load every dataset the app serves, once, at startup.
//
// Dots on the map are the DEDUPED SITES (facilities_sites.csv), not raw source
// rows: each dot needs a stable site_id to give it a unique, shareable URL.
// The zone layers are imported from the exact TypeScript configs worldmonitor
// ships, so this app and worldmonitor can never disagree about a zone.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCSVObjects } from './csv.mjs';
import { readOverrides, indexOverrides, applyOverrides, reattach,
         readFootprintOverrides } from './overrides.mjs';

// The app can run two ways: inside the monorepo, where src/*.py owns the data
// and there is one copy of it, or as a copied-out dcmap/ folder carrying its
// own bundle (see bundle.mjs).
//
// RESOLUTION IS REPO-FIRST, DELIBERATELY. If the repo's data/ is present it
// wins and the bundle is ignored entirely, so nobody developing here can be
// reading a stale copy without noticing. The bundle is consulted only when the
// repo is absent - which is exactly the deployed case, and the only case where
// a second copy is not a liability.
const DCMAP = import.meta.dirname ? path.resolve(import.meta.dirname, '..') : process.cwd();
const ROOT = path.resolve(DCMAP, '..');
const BUNDLE = path.join(DCMAP, 'data');

const repoData = path.join(ROOT, 'data');
const bundled = !fs.existsSync(path.join(repoData, 'facilities_sites.csv'))
  && fs.existsSync(path.join(BUNDLE, 'facilities_sites.csv'));

const DATA = bundled ? BUNDLE : repoData;
const EPOCH_DIR = bundled ? path.join(BUNDLE, 'epoch') : path.join(ROOT, 'data_centers_from_EPOCH_AI');

// The zone layers come from worldmonitor, which is a SEPARATE GIT REPO that
// happens to sit next to this one. Nothing in it is tracked here, so a clone
// of this repo does not have it - hence the vendored JSON in data/wm/, written
// by vendor-wm.mjs and committed.
//
// Same polarity as the bundle: the live checkout WINS when it is there, so
// anyone with worldmonitor is reading worldmonitor and the two cannot quietly
// disagree. The vendored copy is only read when it is absent.
const WM_LIVE = path.join(ROOT, 'worldmonitor', 'src', 'config');
const wmLive = !bundled && fs.existsSync(path.join(WM_LIVE, 'pjm-zones.ts'));
const WM_CFG = wmLive ? WM_LIVE : path.join(DATA, 'wm');

// server.mjs serves quake detail and stores uploads; both must land in the
// same tree the rest of the data came from, or a bundled deploy writes
// uploads into a directory nothing reads.
export const paths = { data: DATA, bundled };

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function readCSV(p) {
  return parseCSVObjects(fs.readFileSync(p, 'utf8'));
}

// The worldmonitor layer configs are generated TypeScript: an import line, one
// type annotation, then a plain array literal. Stripping those two things
// leaves valid JavaScript, so we can import the very file worldmonitor bundles
// instead of maintaining a second copy of the data.
async function importWorldmonitorConfig(file, exportName) {
  // Off the live checkout these are already JSON, so there is no TypeScript to
  // strip and no dependency on worldmonitor's file format at all.
  if (!wmLive) {
    return JSON.parse(fs.readFileSync(path.join(WM_CFG, file.replace(/\.ts$/, '.json')), 'utf8'));
  }
  let src = fs.readFileSync(path.join(WM_CFG, file), 'utf8');
  src = src.replace(/^import[^\n]*\n/mg, '');
  // Strip the type annotation whether it is an array (`Zone[]`) or a plain
  // object (`QuakeShakeMap`); matching only the array form left the object
  // configs as `const X: T = {...}`, which is not valid JavaScript.
  src = src.replace(new RegExp(`export const ${exportName}\\s*:[^=]+=`), `export const ${exportName} =`);
  const tmp = path.join(os.tmpdir(), `dcmap-${exportName}-${process.pid}.mjs`);
  fs.writeFileSync(tmp, src);
  try {
    const mod = await import(pathToFileURL(tmp).href);
    return mod[exportName];
  } finally {
    fs.unlinkSync(tmp);
  }
}

// Build year for traditional facilities, from the raw Overpass caches: OSM
// carries start_date (and three rarer synonyms) on ~200 of our elements, and
// none of that survived into the CSVs. Keyed type-prefixed ("w688791288")
// because way and node ids collide.
function osmBuiltYears() {
  const out = new Map();
  for (const f of ['osm_world', 'osm_us_va', 'osm_us_tx']) {
    const fp = path.join(DATA, 'raw', `${f}.json`);
    if (!fs.existsSync(fp)) continue;
    for (const e of JSON.parse(fs.readFileSync(fp, 'utf8')).elements || []) {
      const t = e.tags || {};
      const v = t.start_date || t.opening_date || t['building:year_built'] || t.year_of_construction;
      const m = v && String(v).match(/^(1[89]\d\d|20\d\d)/);
      if (m) out.set(e.type[0] + e.id, +m[1]);
    }
  }
  return out;
}

const kmBetween = (lonA, latA, lonB, latB) => {
  const dx = (lonA - lonB) * 111.32 * Math.cos(((latA + latB) / 2) * Math.PI / 180);
  const dy = (latA - latB) * 111.32;
  return Math.hypot(dx, dy);
};

export async function loadAll() {
  const sites = readCSV(path.join(DATA, 'facilities_sites.csv'));
  const rows = readCSV(path.join(DATA, 'facilities_global.csv'));
  const registry = readCSV(path.join(DATA, 'registry.csv'));
  const traj = readCSV(path.join(DATA, 'ai_site_trajectories.csv'));
  const timelines = readCSV(path.join(EPOCH_DIR, 'data_center_timelines.csv'));
  // Per-site Epoch attributes the detail page needs: owner, users, chips,
  // and the curated source list, which is markdown bullets of [label](url).
  const epochMeta = new Map();
  for (const r of readCSV(path.join(EPOCH_DIR, 'data_centers.csv'))) {
    const k = (r.Name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (k) epochMeta.set(k, r);
  }

  const siteById = new Map(sites.map(s => [s.site_id, s]));

  // Hand corrections, applied over the derived values. Done here rather than
  // in any one consumer so the map, the search index, the operator pages and
  // the site page all see the same corrected site - a name fixed on the detail
  // page that still reads the old one in search would be worse than no edit.
  const overrideRows = readOverrides(DATA);
  const overridesById = indexOverrides(overrideRows);
  const overridden = applyOverrides(sites, overridesById);
  const orphaned = reattach(overrideRows, siteById);
  if (overridden || orphaned.length) {
    console.log(`overrides: ${overridden} field(s) applied` +
      (orphaned.length
        ? `, ${orphaned.length} for site ids that no longer exist - see ` +
          `data/site_overrides.csv (their lat/lon is recorded, so they can be re-homed by hand)`
        : ''));
  }

  // Campus -> its buildings. Built after the overrides land, because the link
  // is itself a hand assertion and does not exist before they are applied.
  const childrenBySite = new Map();
  for (const s of sites) {
    if (!s.parent_site_id) continue;
    if (!siteById.has(s.parent_site_id)) continue;   // dangling, reported above
    if (!childrenBySite.has(s.parent_site_id)) childrenBySite.set(s.parent_site_id, []);
    childrenBySite.get(s.parent_site_id).push(s);
  }

  const rowsBySite = new Map();
  for (const r of rows) {
    if (!r.site_id) continue;
    if (!rowsBySite.has(r.site_id)) rowsBySite.set(r.site_id, []);
    rowsBySite.get(r.site_id).push(r);
  }

  // Virginia county enrichment: registry.csv is a separate pipeline with its
  // own coordinates, so join by proximity (300 m), Virginia bounding box only.
  const vaRegistry = registry.filter(r => r.lat && r.lon);
  const vaBySite = new Map();
  for (const s of sites) {
    if (!s.lat) continue;
    const lat = +s.lat, lon = +s.lon;
    if (lon < -83.7 || lon > -75.2 || lat < 36.5 || lat > 39.5) continue;
    const near = vaRegistry.filter(r => kmBetween(lon, lat, +r.lon, +r.lat) < 0.3);
    if (near.length) vaBySite.set(s.site_id, near);
  }

  const trajByName = new Map(traj.map(t => [t.site.toLowerCase(), t]));
  const timelineByName = new Map();
  for (const t of timelines) {
    const k = (t['Data center'] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!k) continue;
    if (!timelineByName.has(k)) timelineByName.set(k, []);
    timelineByName.get(k).push(t);
  }
  for (const list of timelineByName.values()) list.sort((a, b) => (a.Date || '').localeCompare(b.Date || ''));

  // TWO dates per site, because the sources mean different things by "date"
  // and conflating them was wrong: OSM's start_date is when a facility OPENED,
  // while Epoch's first observation is usually when LAND CLEARING BEGAN. So:
  //   cs = construction start   (Epoch first observation; OSM has no equivalent)
  //   by = operational / opened (Epoch's first "operational" milestone; OSM start_date)
  // A site with cs but no by is still under construction. Median Epoch
  // construction duration is 2.1 years, so the two differ materially.
  // Decimal year now, for "is it operational yet" / "still building".
  const nowY = (() => {
    const d = new Date();
    return d.getUTCFullYear()
      + (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
         - Date.UTC(d.getUTCFullYear(), 0, 1)) / (365.25 * 86400000);
  })();

  const builtByOsm = osmBuiltYears();
  const normName = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const dec = (d) => +d.slice(0, 4) + (+d.slice(5, 7) - 1) / 12;
  const builtBySite = new Map();
  const startBySite = new Map();
  const growEndBySite = new Map();
  for (const r of rows) {
    if (!r.site_id || !r.osm_id) continue;
    for (const p of ['w', 'n', 'r']) {
      const y = builtByOsm.get(p + r.osm_id);
      if (y) {
        const prev = builtBySite.get(r.site_id);
        if (!prev || y < prev) builtBySite.set(r.site_id, y);
        break;
      }
    }
  }
  for (const s of sites) {
    const tl = s.epoch_name && timelineByName.get(normName(s.epoch_name));
    if (!tl || !tl.length) continue;
    startBySite.set(s.site_id, dec(tl[0].Date.slice(0, 10)));
    // Build-out end: the last date capacity actually increases. A campus is
    // routinely operational AND still building - 32 of Epoch's sites have an
    // expansion phase running past their first operational milestone - so
    // "has it been switched on yet" cannot answer "is it still being built".
    let peak = 0, ge = null;
    for (const o of tl) {
      const v = num(o['H100 equivalents']);
      if (v > peak * 1.001) { peak = v; ge = dec(o.Date.slice(0, 10)); }
    }
    if (ge != null) growEndBySite.set(s.site_id, ge);
    const op = tl.find(o => /operational/i.test(o['Construction status'] || ''));
    // Epoch is authoritative for its own sites: an AI site with no operational
    // milestone is under construction, so drop any OSM-derived opening year.
    if (op) builtBySite.set(s.site_id, dec(op.Date.slice(0, 10)));
    else builtBySite.delete(s.site_id);
  }

  // ONE earthquake layer, not one per event: 519 M5+ events in 90 days.
  // Per-event ShakeMap detail lives in data/quake_events/<id>.json and is
  // fetched on click, so the layer payload stays at ~126 KB.
  const quakes = await importWorldmonitorConfig('quakes-recent.ts', 'QUAKES_RECENT');
  // Which sites the shaking reached, so a dot can be highlighted without the
  // browser re-sampling a grid it does not have.
  // Worst shaking any recent event delivered to each site, so a dot can carry
  // its own exposure without the browser opening 51 detail files.
  const mmiBySite = new Map();
  const evDir = path.join(DATA, 'quake_events');
  // Only events still IN the layer count. quakes.py writes a detail file per
  // event and never deletes one, so after a refresh the directory holds
  // exposures from earthquakes that have aged out of the 90-day window - 5 of
  // 57 files on the 2026-08-14 pull. Reading those makes a dot advertise
  // "worst recent shaking" from a quake the map no longer shows, and the badge
  // only ever ratchets upward as the leftovers accumulate. Filtering here
  // rather than deleting keeps it correct even when the files linger.
  const liveIds = new Set(quakes.map(q => q.id));
  if (fs.existsSync(evDir)) {
    for (const f of fs.readdirSync(evDir)) {
      if (!f.endsWith('.json') || !liveIds.has(f.slice(0, -5))) continue;
      const det = JSON.parse(fs.readFileSync(path.join(evDir, f), 'utf8'));
      for (const e of det.exposed || []) {
        const prev = mmiBySite.get(e.site_id);
        if (!prev || e.mmi > prev.mmi) mmiBySite.set(e.site_id, { mmi: e.mmi, ev: det.title });
      }
    }
  }

  const statusOf = (id) => {
    const cs = startBySite.get(id), ge = growEndBySite.get(id), by = builtBySite.get(id);
    // Building beats operational: a live campus putting up its next phase is
    // both, and "still building" is the answer people are asking for.
    if (cs != null && cs < nowY && ge != null && ge >= nowY) return 'uc';
    if (by != null && by < nowY) return 'op';
    if (cs != null && cs < nowY) return 'uc';
    return '';
  };

  // Compact payload for the map and the search palette. Un-geocoded sites are
  // included with null coordinates: they cannot be drawn, but they must be
  // findable in search, which links to their page instead of flying.
  // Operator directory. src/operators.py owns the collapsing of the 2,796
  // operator spellings into 2,613 companies; this side only looks the answer
  // up, so the two never drift apart into disagreeing about who Equinix is.
  const opDir = JSON.parse(fs.readFileSync(path.join(DATA, 'operators.json'), 'utf8'));
  const rawToKey = opDir.rawToKey || {};

  const mapSites = sites.map(s => ({
    id: s.site_id,
    n: s.name || '',
    en: s.epoch_name || '',
    o: s.operator || '',
    ok: rawToKey[(s.operator || '').trim()] || '',
    // Continent, so "show me everything in Europe" is the same one-property
    // filter the rest of the map already uses rather than a second mechanism.
    rg: opDir.regions[s.country]?.c || 'Unattributed',
    c: s.country || '',
    ci: s.city || '',
    ft: s.facility_type,
    gp: s.geo_precision || 'exact',
    rv: s.needs_review || '',
    mmi: mmiBySite.get(s.site_id)?.mmi ?? null,
    mmiEv: mmiBySite.get(s.site_id)?.ev ?? '',
    t: s.tenancy || '',
    ref: s.ref || '',
    // facilities_sites.csv carries power_mw_total_current and dedupe never
    // fills it - it is empty for all 6,263 rows. The figures exist, for the 58
    // AI sites Epoch publishes, in ai_site_trajectories.csv, joined on the same
    // epoch_name the detail page already uses. Without this the Power column
    // and anything aggregating it are zero everywhere, which is not "no power"
    // but "we never looked it up".
    // Floor area, from the Virginia county records the site page already shows.
    // Only Loudoun, Prince William and the counties around them publish parcel
    // and permit data, so this reaches ~101 of 6,263 sites and nowhere else.
    //
    // MAX of the matched records, not the sum. Three sources overlap in that
    // pipeline - pec, pw_building and loudoun_existing - so the same building
    // is often recorded more than once within the 300 m join, and adding them
    // up would report a campus twice its size. The largest single record is the
    // one claim that is definitely true of the place.
    ft2: Math.round(Math.max(0, ...(vaBySite.get(s.site_id) || []).map(r => num(r.sq_ft)))) || 0,
    mw: Math.round(num(s.power_mw_total_current)
      || num(trajByName.get((s.epoch_name || '').replace(/\s+/g, ' ').trim()
                            .toLowerCase())?.power_mw_total_current)) || 0,
    u: s.utility || '',
    lat: s.lat ? +s.lat : null, lon: s.lon ? +s.lon : null,
    by: builtBySite.get(s.site_id) ?? null,
    cs: startBySite.get(s.site_id) ?? null,
    ge: growEndBySite.get(s.site_id) ?? null,
    // Lifecycle status, derived from the dates we have rather than a column
    // we do not: facilities_sites.csv carries a `status` field that is blank
    // on all 6,263 rows, because OSM and PeeringDB do not record one.
    //   op  operational  - has an opening or first-operational date, past
    //   uc  building     - ground broken and capacity still rising
    //   ''  unknown      - no date at all, which is 97% of the registry
    // The blank is the honest answer and the UI says so rather than
    // defaulting everything to "operational".
    st: statusOf(s.site_id),
  }));

  // Timeline: per-quarter H100-equivalent compute for the AI sites, stepped
  // forward from irregular Epoch observations (a site keeps its capacity until
  // the next observation says otherwise). Quarters run Q1 2019 - Q1 2030,
  // matching the observation range.
  const Q0 = 2019, Q1 = 2030;
  const quarters = [];
  for (let t = Q0; t <= Q1 + 1e-9; t += 0.25) quarters.push(Math.round(t * 4) / 4);
  const timeline = [];
  for (const s of mapSites) {
    if (!s.en) continue;
    const obs = timelineByName.get(normName(s.en));
    if (!obs || !obs.length) continue;
    // An empty H100e cell means the observation did not restate compute -
    // dropping it to 0 would erase a quarter that really had capacity
    // (Colossus 1's 2025-03-06 row does exactly this). Skip blanks.
    const pts = obs
      .filter(o => o.Date && String(o['H100 equivalents'] ?? '').trim() !== '')
      .map(o => ({
        t: +o.Date.slice(0, 4) + (+o.Date.slice(5, 7) - 1) / 12,
        v: num(o['H100 equivalents']),
      }));
    // Value at a stop is the last restatement within or before that quarter.
    const series = quarters.map(q => {
      let last = 0;
      for (const pt of pts) if (pt.t < q + 0.25) last = pt.v;
      return Math.round(last);
    });
    if (series.some(v => v > 0)) {
      const users = (rowsBySite.get(s.id) || []).map(r => r.users).find(Boolean) || '';
      timeline.push({
        id: s.id, n: s.n || s.en, o: s.o, c: s.c,
        pu: users.split(',')[0].trim(), series,
        // Raw restatements at their true dates, for the timeline (record)
        // chart - the quarterly grid above is too coarse for it.
        obs: pts.map(pt => [Math.round(pt.t * 1000) / 1000, Math.round(pt.v)]),
      });
    }
  }

  const timelinePayload = { quarters, sites: timeline };

  // Curated per-operator detail: logo file, profile prose, official location
  // list. Optional by design - the directory is built from the registry and
  // works with none of this, so a missing or partial file degrades to a
  // monogram tile and no write-up rather than an empty page.
  let profiles = {};
  const profPath = path.join(DATA, 'operator_profiles.json');
  if (fs.existsSync(profPath)) profiles = JSON.parse(fs.readFileSync(profPath, 'utf8'));

  // The operator's own page for THIS building, where match_site_links.py could
  // prove which one it is. Sparse by design - it emits nothing for a site it
  // cannot disambiguate - so the site page falls back to the operator's
  // location index rather than linking to the wrong campus.
  // Sites that share a street address: suites in one carrier hotel. dedupe.py
  // groups rather than merges them, so the count of FACILITIES stays honest
  // while a reader can still see that six of them are one structure.
  const byBuilding = new Map();
  for (const s of sites) {
    if (!s.building) continue;
    if (!byBuilding.has(s.building)) byBuilding.set(s.building, []);
    byBuilding.get(s.building).push(s);
  }

  let siteLinks = {};
  const linkPath = path.join(DATA, 'site_links.json');
  if (fs.existsSync(linkPath)) siteLinks = JSON.parse(fs.readFileSync(linkPath, 'utf8'));

  const operatorsPayload = {
    regions: opDir.regions,
    // rawToKey is deliberately NOT shipped: every site already carries its
    // resolved `ok`, so sending the 2,796-entry lookup too would be 90 KB the
    // client can never use.
    operators: (opDir.operators || []).map(o => {
      const p = profiles[o.key];
      return p ? { ...o, name: p.displayName || o.name, ...p } : o;
    }),
  };

  const [ercot, pjm, nyiso, countries] = await Promise.all([
    importWorldmonitorConfig('ercot-load-zones.ts', 'ERCOT_LOAD_ZONES'),
    importWorldmonitorConfig('pjm-zones.ts', 'PJM_ZONES'),
    importWorldmonitorConfig('nyiso-zones.ts', 'NYISO_LOAD_ZONES'),
    importWorldmonitorConfig('datacenter-countries.ts', 'DATACENTER_COUNTRIES'),
  ]);

  // Natural Earth 110m. src/basemap.py builds a far sharper 10m version and
  // it is NOT used here: handing MapLibre 3.6 MB / 189k vertices of GeoJSON
  // makes its worker fail with "can't serialize object of unregistered class",
  // which takes the site-dot source down with it - a map with an accurate
  // coastline and no data centres on it. Shipping 10m needs pre-built tiles
  // (PMTiles), not client-side tiling of one huge GeoJSON.
  const basemap = JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'ne_countries.geojson'), 'utf8'));

  // Power plants at or above 100 MW: EIA-860M for the US, Global Energy
  // Monitor for the rest, both via src/plants.py. Not a worldmonitor config, so
  // it is read straight from data/ rather than through the vendoring path the
  // zone layers use.
  const plants = JSON.parse(fs.readFileSync(path.join(DATA, 'power_plants.json'), 'utf8'));
  const plantById = new Map(plants.map(p => [p.id, p]));

  // Semiconductor fabs, hand-sourced by src/fabs.py. Small and slow-moving:
  // 78 records that change when a fab opens, not on a feed.
  const fabs = JSON.parse(fs.readFileSync(path.join(DATA, 'fabs.json'), 'utf8'));

  // Building footprints and campus boundaries, built by src/footprints.py from
  // OSM + the IM3 atlas. Optional: the map is dots-first and works without
  // them. Hand-drawn and hand-corrected shapes are laid over the derived ones
  // here, for the same reason applyOverrides runs here - every consumer must
  // see the same corrected shape.
  const footprintById = new Map();
  const fpPath = path.join(DATA, 'footprints.geojson');
  if (fs.existsSync(fpPath)) {
    for (const f of JSON.parse(fs.readFileSync(fpPath, 'utf8')).features || []) {
      if (f && f.geometry && f.properties && f.properties.id) {
        footprintById.set(f.properties.id, f);
      }
    }
  }
  // In file order, so the last assertion about an id wins - including a shape
  // deleted and then drawn again, which is why a tombstone is a set-to-nothing
  // rather than a filter.
  let fpEdits = 0;
  for (const f of readFootprintOverrides(DATA)) {
    if (f.properties.deleted) footprintById.delete(f.properties.id);
    else footprintById.set(f.properties.id, f);
    fpEdits++;
  }
  const footprints = { type: 'FeatureCollection', features: [...footprintById.values()] };

  // Shaking reaches all three layers, so mmiBySite is keyed on asset id and
  // holds plants and fabs alongside data centres. Attached here rather than in
  // quakes.py because it is a join between two files that are refreshed on
  // different schedules - a plant that drops below the 100 MW floor should
  // stop carrying a badge without needing the quake ingest re-run.
  for (const r of plants) {
    const m = mmiBySite.get(r.id);
    if (m) { r.mmi = m.mmi; r.mmiEv = m.ev; }
  }
  for (const r of fabs) {
    const m = mmiBySite.get(r.id);
    if (m) { r.mmi = m.mmi; r.mmiEv = m.ev; }
  }

  // A hand-asserted supply link is only as good as the plant it names, and the
  // plant file is rebuilt from two upstreams that renumber nothing but can drop
  // a record below the 100 MW floor. Say so loudly rather than rendering a
  // site as "supplied by" nothing.
  const danglingLinks = sites.filter(s => s.linked_plant_id && !plantById.has(s.linked_plant_id));
  if (danglingLinks.length) {
    console.warn(`[overrides] ${danglingLinks.length} site(s) link to a plant id that is `
      + `no longer in power_plants.json: `
      + danglingLinks.map(s => `${s.site_id}->${s.linked_plant_id}`).join(', '));
  }

  // GENERATION WITHIN REACH OF EACH SITE
  // The one number that relates the two layers, and it has to be derived
  // because neither source carries it. A site's own `mw` is DEMAND - what the
  // building draws - and a plant's is nameplate SUPPLY; they are opposite
  // sides of the meter and must never share a scale. This is the quantity that
  // actually answers "is there generation here", and unlike `mw` (57 sites) or
  // `ft2` (101) it is populated for most of the registry.
  //
  // 25 km is a locality, not a fence line. True behind-the-meter co-location is
  // measured in hundreds of metres, but at that radius the answer is almost
  // always zero and the map says nothing; 25 km asks the useful question, which
  // is whether a site sits in a place where generation already exists.
  //
  // Operating only. Planned capacity is a promise and retired capacity is gone,
  // and adding either would report megawatts that cannot be bought today.
  const GEN_KM = 25;
  const genGrid = new Map();
  for (const p of plants) {
    if (p.k !== 'op' || !p.mw) continue;
    const key = `${Math.round(p.lon)},${Math.round(p.lat)}`;
    if (!genGrid.has(key)) genGrid.set(key, []);
    genGrid.get(key).push(p);
  }
  let withGen = 0;
  for (const s of mapSites) {
    if (s.lat == null) continue;
    let mw = 0;
    // One degree of longitude is 111 km at the equator and less towards the
    // poles, so a single ring of cells always covers 25 km.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = genGrid.get(`${Math.round(s.lon) + dx},${Math.round(s.lat) + dy}`);
        if (!cell) continue;
        for (const p of cell) {
          if (kmBetween(s.lon, s.lat, p.lon, p.lat) <= GEN_KM) mw += p.mw;
        }
      }
    }
    if (mw) { s.gen = Math.round(mw); withGen++; }
  }

  const mapped = mapSites.filter(s => s.lat != null).length;
  console.log(`data: ${sites.length} sites (${mapped} mapped, ${sites.length - mapped} search-only), ` +
    `${rows.length} rows, ` +
    `${vaBySite.size} VA-enriched, ${ercot.length} ERCOT + ${pjm.length} PJM + ` +
    `${nyiso.length} NYISO zones, ` +
    `${countries.length} countries, ${plants.length} power plants, ${fabs.length} fabs ` +
    `(${withGen} sites with generation within ${GEN_KM} km), ` +
    `${footprintById.size} footprints (${fpEdits} hand edits)`);

  return {
    sites, siteById, rowsBySite, vaBySite, trajByName, timelineByName, epochMeta,
    mapSites, ercot, pjm, nyiso, countries, basemap, timelinePayload, quakes, plants,
    operatorsPayload, siteLinks, operatorProfiles: profiles, rawToKey, byBuilding,
    overridesById, childrenBySite, kmBetween, plantById, fabs, footprints, footprintById,
  };
}
