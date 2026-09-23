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
         readFootprintOverrides, readAssetOverrides,
         applyAssetOverrides } from './overrides.mjs';
import { depErrors, describeDep, isRegistryId } from './powerdep.mjs';
import { pointErrors } from './points.mjs';
import { eventErrors } from './events.mjs';
import { readPlacements, applyPlacements } from './placements.mjs';

// dcmap/ IS the project. Everything the app reads or writes lives under this
// folder: data/ (the derived files and the hand ledgers), src/ (the Python
// pipeline that regenerates the derived files), the Epoch download, the IM3
// release. There is exactly one copy of each, and no path here reaches above
// this directory.
//
// It used to be otherwise - the app sat inside a monorepo and read ../data,
// with a copied-out "bundle" mode for deploying the folder alone, which meant
// two copies of the data and a resolution rule to decide which one won. Both
// are gone: the tree moved in, and with it the reason for the rule.
const DCMAP = import.meta.dirname ? path.resolve(import.meta.dirname, '..') : process.cwd();
const ROOT = DCMAP;
const DATA = path.join(DCMAP, 'data');
const EPOCH_DIR = path.join(DCMAP, 'data_centers_from_EPOCH_AI');

// The zone and quake layer configs. src/*_zones.py, quakes.py and
// country_layer.py write them here as TypeScript - the same files worldmonitor
// (a separate project, github.com/koala73/worldmonitor) ships - and the
// vendored .json beside them is the fallback for a config nobody has
// regenerated locally. A regenerated .ts WINS over a vendored .json: the
// script's output is the source of truth, the copy is not. Exporting to a
// worldmonitor checkout, if one wants these, is a cp of data/wm/*.ts; nothing
// here reads or writes outside dcmap/.
const WM_CFG = path.join(DATA, 'wm');

// THE ONE THING OUTSIDE THIS FOLDER, AND WHY IT IS ALLOWED TO BE.
// The pipeline that produces data/ is not part of the web app, so it lives
// beside dcmap/, not inside it. The app runs without it entirely. The single
// feature that needs it - /data's "run this step" button - looks for it at
// $DCMAP_PIPELINE, else ../src, and when it is not there the page says the
// pipeline is not available on this server instead of shelling out into
// nothing. `pipelineRaw` is that pipeline's bulk source pulls (../raw), which
// /data can summarise when present; the app never reads them.
const pipelineDir = process.env.DCMAP_PIPELINE
  ? path.resolve(process.env.DCMAP_PIPELINE)
  : path.resolve(DCMAP, '..', 'src');
const pipeline = fs.existsSync(path.join(pipelineDir, 'paths.py')) ? pipelineDir : null;
const pipelineRaw = pipeline ? path.resolve(pipeline, '..', 'raw') : null;

// `root` is where git runs - this folder, inside the repository.
export const paths = { data: DATA, root: ROOT, pipeline, pipelineRaw };

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
  // The generated .ts if a script has produced one here, else the vendored
  // .json. See the note at WM_CFG for why the polarity is this way round.
  const ts = path.join(WM_CFG, file);
  if (!fs.existsSync(ts)) {
    return JSON.parse(fs.readFileSync(path.join(WM_CFG, file.replace(/\.ts$/, '.json')), 'utf8'));
  }
  let src = fs.readFileSync(ts, 'utf8');
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

// A site OSM mapped without addr:* tags has no street address of its own;
// the parcel under its dot carries the county's situs address, and that is
// a fact about the same ground. A fallback only: a hand override or a source
// record's own address (the operator's published one, suite and all) wins
// over it, and it is marked so the page can say where it came from. Exported
// because the in-app parcel button re-reads the layer without a full reload
// and must run this again, or the site header stays address-less until the
// next restart.
export function applyParcelAddresses(regrid, siteById, rowsBySite) {
  let n = 0;
  for (const f of (regrid && regrid.features) || []) {
    const p = f.properties || {};
    const s = p.for_site && siteById.get(p.for_site);
    if (!s || !p.address || s.address) continue;
    if ((rowsBySite.get(s.site_id) || []).some(r => (r.address || '').trim())) continue;
    s.address = p.address;
    s.address_src = 'regrid';
    n++;
  }
  return n;
}

export async function loadAll() {
  // Which community water system each US site sits inside, from EPA's
  // service-area boundaries (src/water_service.py). Absent until the puller
  // has run; the page then simply has no water fact to show.
  const waterPath = path.join(DATA, 'water_service.csv');
  const waterByAsset = new Map(
    (fs.existsSync(waterPath) ? readCSV(waterPath) : []).map(r => [r.asset_id, r]));
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

  // ONE earthquake layer, not one per event: thousands of events in 90 days,
  // and the magnitude floor is whatever src/quakes.py was last run with.
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

  const mapSites = sites.map(s => {
    const tr = trajByName.get(normName(s.epoch_name));
    return {
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
    mw: Math.round(num(s.power_mw_total_current) || num(tr?.power_mw_total_current)) || 0,
    // Project value, US$ MILLIONS - the unit every layer's `inv` uses, because
    // the heatmap paints sites, plants and fabs on one shared ramp and a
    // billions column beside a millions column would be a silent 1000x lie.
    // For data centres it is Epoch's estimated capex at projected peak, so it
    // is an ESTIMATE and every surface showing it says so - same contract as
    // a fab's modelled MW.
    inv: Math.round(num(tr?.capex_peak_usd_bn) * 1000) || 0,
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
  }; });

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

  // Identity evidence from src/poi_precisely.py: what business the commercial
  // registry says sits at this coordinate. Three states per site, and the
  // page shows two of them - a hit is corroboration, an empty record ({}) is
  // "we asked and nothing is registered here", which on a needs_review site
  // is the more telling answer. Absent entirely means never asked.
  let poiEvidence = {};
  const poiPath = path.join(DATA, 'raw', 'poi_evidence.json');
  if (fs.existsSync(poiPath)) poiEvidence = JSON.parse(fs.readFileSync(poiPath, 'utf8'));

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

  // What the edit form's datalists offer: the values the registry already
  // holds, so a correction converges on an existing spelling instead of
  // minting a new one. Rebuilt on every loadAll(), which every save endpoint
  // triggers - a value typed fresh today is a suggestion tomorrow.
  //
  // Operators and utilities are ordered by how many sites carry the value:
  // when three spellings of one company match what was typed, the dominant
  // one lists first, and picking it is what retires the other two.
  const editOptions = (() => {
    const tally = (get) => {
      const m = new Map();
      for (const s of sites) {
        const v = (get(s) || '').trim();
        if (v) m.set(v, (m.get(v) || 0) + 1);
      }
      return [...m.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
        .map(([v]) => v);
    };
    // [code, English name] pairs; the name is a label for the picker, the
    // two-letter code is what saves (and what validate() insists on).
    let regionName = (cc) => cc;
    try {
      const dn = new Intl.DisplayNames(['en'], { type: 'region' });
      regionName = (cc) => { try { return dn.of(cc) || cc; } catch { return cc; } };
    } catch { /* no ICU: codes alone still work */ }
    const country = [...new Set(sites.map(s => (s.country || '').trim().toUpperCase())
      .filter(c => /^[A-Z]{2}$/.test(c)))]
      .map(cc => [cc, regionName(cc)])
      .sort((a, b) => a[1].localeCompare(b[1]));
    const city = {};
    for (const s of sites) {
      const ci = (s.city || '').trim(), cc = (s.country || '').trim().toUpperCase();
      if (!ci || !cc) continue;
      (city[cc] ??= new Set()).add(ci);
    }
    for (const cc of Object.keys(city)) {
      city[cc] = [...city[cc]].sort((a, b) => a.localeCompare(b));
    }
    return {
      operator: tally(s => s.operator),
      utility: tally(s => s.utility),
      country, city,
    };
  })();

  const [ercot, pjm, nyiso, countries] = await Promise.all([
    importWorldmonitorConfig('ercot-load-zones.ts', 'ERCOT_LOAD_ZONES'),
    importWorldmonitorConfig('pjm-zones.ts', 'PJM_ZONES'),
    importWorldmonitorConfig('nyiso-zones.ts', 'NYISO_LOAD_ZONES'),
    importWorldmonitorConfig('datacenter-countries.ts', 'DATACENTER_COUNTRIES'),
  ]);

  // Natural Earth 110m, and still 110m. src/basemap.py builds a far sharper
  // 10m version that is NOT used here: handing MapLibre 3.6 MB / 189k vertices
  // of GeoJSON makes its worker fail with "can't serialize object of
  // unregistered class", which takes the site-dot source down with it - a map
  // with an accurate coastline and no data centres on it.
  //
  // The fix that note called for - pre-built tiles rather than client-side
  // tiling of one huge GeoJSON - now exists, as the PMTiles archive
  // src/basemap_tiles.py builds. It carries the borders and the place names,
  // which is what could not be drawn any other way. This blob is left doing
  // the one job it was always adequate at: a flat land fill under everything,
  // at a vertex count the worker will accept.
  const basemap = JSON.parse(fs.readFileSync(path.join(DATA, 'raw', 'ne_countries.geojson'), 'utf8'));

  // Power plants at or above 100 MW: EIA-860M for the US, Global Energy
  // Monitor for the rest, both via src/plants.py. Not a worldmonitor config, so
  // it is read straight from data/ rather than through the vendoring path the
  // zone layers use.
  const plants = JSON.parse(fs.readFileSync(path.join(DATA, 'power_plants.json'), 'utf8'));
  const plantById = new Map(plants.map(p => [p.id, p]));
  // The release names the pages credit, written by plants.py with the data
  // so the credit cannot drift from what was actually read.
  const metaFile = path.join(DATA, 'power_plants_meta.json');
  const plantsMeta = fs.existsSync(metaFile)
    ? JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    : { eia: '', eia_annual: '', gem: '', census: '' };

  // Announced project value for the plants big enough to have made the news,
  // hand-researched from operator releases and press with the URL kept per
  // record. Joined here rather than in src/plants.py for the same reason the
  // quake exposure is: the plant file is rebuilt from two feeds and this file
  // is research on its own schedule, and neither rebuild should require the
  // other. Keyed on plant id, which both upstreams keep stable - they drop
  // records below the 100 MW floor but renumber nothing. `inv` is US$ MILLIONS,
  // the shared unit of every layer's project value.
  let plantsValued = 0;
  const pvPath = path.join(DATA, 'plant_values.json');
  if (fs.existsSync(pvPath)) {
    const vals = JSON.parse(fs.readFileSync(pvPath, 'utf8'));
    const gone = [];
    for (const v of vals) {
      const p = plantById.get(v.id);
      if (!p) { gone.push(`${v.id} (${v.n || '?'})`); continue; }
      p.inv = v.inv;
      if (v.note) p.invn = v.note;
      if (v.src && v.src.length) p.invsrc = v.src;
      plantsValued++;
    }
    if (gone.length) {
      console.warn(`[plant_values] ${gone.length} value(s) for plant ids no longer in ` +
        `power_plants.json: ${gone.join(', ')} - re-home them by name or drop them`);
    }
  }

  // Semiconductor fabs, hand-sourced by src/fabs.py. Small and slow-moving:
  // 78 records that change when a fab opens, not on a feed.
  const fabs = JSON.parse(fs.readFileSync(path.join(DATA, 'fabs.json'), 'utf8'));

  // Hand corrections for plants and fabs - the dot pages' version of
  // site_overrides.csv, applied here so every consumer downstream (link
  // distances, nearby lists, the map payloads) sees the corrected record.
  const assetOverrides = indexOverrides(readAssetOverrides(DATA));
  const assetEdits = applyAssetOverrides(plants, assetOverrides)
                   + applyAssetOverrides(fabs, assetOverrides);
  if (assetEdits) console.log(`asset overrides: ${assetEdits} field(s) applied`);
  const fabById = new Map(fabs.map(f => [f.id, f]));
  // Orphans reported, same contract as every other join here: a plant can
  // fall below src/plants.py's 100 MW floor and take a hand correction with
  // it. The rows keep their lat/lon anchors so they can be re-homed by hand.
  const assetOrphans = [...assetOverrides.keys()]
    .filter(id => !plantById.has(id) && !fabById.has(id));
  if (assetOrphans.length) {
    console.warn(`[asset overrides] ${assetOrphans.length} row(s) for ids no longer `
      + `in the data: ${assetOrphans.join(', ')} - re-home them by hand or drop them`);
  }

  // The fab operators join the edit form's suggestion lists - their own
  // universe (TSMC, UMC...), not the site operators'.
  editOptions.fab_op = [...new Set(fabs.map(f => (f.op || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  // Building footprints and campus boundaries, built by src/footprints.py from
  // OSM + the IM3 atlas. Optional: the map is dots-first and works without
  // them. Hand-drawn and hand-corrected shapes are laid over the derived ones
  // here, for the same reason applyOverrides runs here - every consumer must
  // see the same corrected shape.
  const footprintById = new Map();
  // Two derived files, then the hand edits. footprints.geojson is OSM + IM3;
  // footprints_overture.geojson is src/footprints_overture.py filling the 16%
  // of exactly-located sites those two never covered, from Overture Maps'
  // ML-derived buildings (ODbL). Same schema, separate file - one writer per
  // file - and Overture second so a shape OSM actually drew always wins over
  // a model's extraction of the same roof.
  for (const name of ['footprints.geojson', 'footprints_overture.geojson',
                      'footprints_overture_fabs.geojson', 'footprints_plants.geojson']) {
    const fpPath = path.join(DATA, name);
    if (!fs.existsSync(fpPath)) continue;
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

  // Every asset id with at least one shape attached - the one set behind
  // every "outlined n/m" column and every outlined/unmapped filter token on
  // the summary pages. Sites, fabs and plants share it; ids do not collide.
  const outlined = new Set();
  for (const f of footprints.features) {
    for (const id of f.properties.sites || []) outlined.add(String(id));
  }

  // Where the footprint layer HAS data, visible from orbit - the vendor
  // rings' rationale at the layer's own scale: /api/footprints only loads
  // shapes once the map is close in, so at world zoom the toggle shows
  // nothing and reads as broken. One locator point per footprint-bearing
  // asset (a multi-building campus collapses to its first shape's centre),
  // shipped as a bare [lon,lat] array because 14k of anything else is weight.
  const fpLocators = [];
  {
    const seen = new Set();
    for (const f of footprints.features) {
      // Not the plant perimeters: 8,400 of them would redraw the whole
      // plants layer in pink at world zoom and drown the registry's own
      // coverage. Their shapes still render when zoomed; the rings advertise
      // the buildings, campuses and parcels around registry subjects.
      if (f.properties.src === 'osm-plant') continue;
      const key = (f.properties.sites || [])[0] || f.properties.id;
      if (seen.has(key)) continue;
      seen.add(key);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const walk = (c) => {
        if (typeof c[0] === 'number') {
          if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
          if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
        } else c.forEach(walk);
      };
      walk(f.geometry.coordinates);
      if (!Number.isFinite(x0)) continue;
      fpLocators.push([+((x0 + x1) / 2).toFixed(4), +((y0 + y1) / 2).toFixed(4)]);
    }
  }

  // Regrid parcels ride as their OWN layer, deliberately not folded into the
  // footprints above: half of them were bought specifically to be VERIFIED
  // against the footprints, and a source cannot be checked against a layer it
  // has already been merged into. Optional file - built by
  // src/parcels_regrid.py, absent until someone runs it with a token.
  let regrid = { type: 'FeatureCollection', features: [] };
  const rgPath = path.join(DATA, 'raw', 'parcels_regrid.geojson');
  if (fs.existsSync(rgPath)) regrid = JSON.parse(fs.readFileSync(rgPath, 'utf8'));
  const parcelAddressed = applyParcelAddresses(regrid, siteById, rowsBySite);
  if (parcelAddressed) console.log(`addresses: ${parcelAddressed} site(s) take the Regrid parcel's situs address`);
  // Second vendor on the same trial, same reasoning, own layer and own file.
  let precisely = { type: 'FeatureCollection', features: [] };
  const pcPath = path.join(DATA, 'raw', 'parcels_precisely.geojson');
  if (fs.existsSync(pcPath)) precisely = JSON.parse(fs.readFileSync(pcPath, 'utf8'));
  // Third vendor, free one: the French cadastre through IGN's API Carto.
  // Own layer and own file for the same reason as the two above.
  let cadastre = { type: 'FeatureCollection', features: [] };
  const cdPath = path.join(DATA, 'raw', 'parcels_cadastre.geojson');
  if (fs.existsSync(cdPath)) cadastre = JSON.parse(fs.readFileSync(cdPath, 'utf8'));

  // When Regrid last refreshed each county, from src/regrid_verse.py. Used to
  // answer "could asking again return anything new?" without paying to find
  // out. Optional: absent until somebody runs the puller.
  let regridCounties = null;
  const rcPath = path.join(DATA, 'regrid_counties.json');
  if (fs.existsSync(rcPath)) {
    try { regridCounties = JSON.parse(fs.readFileSync(rcPath, 'utf8')); }
    catch (e) { console.warn('[regrid counties] unreadable: ' + e.message); }
  }

  // Transmission corridors from OpenStreetMap, written by src/power_lines.py.
  // Optional like the parcel files: absent until somebody runs the pull, and
  // the layer simply draws nothing rather than the map failing to build.
  let powerLines = { type: 'FeatureCollection', features: [] };
  const plPath = path.join(DATA, 'transmission_lines.geojson');
  if (fs.existsSync(plPath)) {
    try { powerLines = JSON.parse(fs.readFileSync(plPath, 'utf8')); }
    catch (e) { console.warn('[power lines] unreadable: ' + e.message); }
  }

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

  // Researched site<->plant pairings (data/dc_plant_links.json): announced
  // projects where a SPECIFIC plant is tied to a SPECIFIC campus, curated
  // with source URLs like plant_values.json. An override set by hand in the
  // app wins over the researched file - the person at the map read something
  // this file's author had not - so the join only fills empty links, but a
  // matching note/source rides along either way.
  const dplPath = path.join(DATA, 'dc_plant_links.json');
  // Verified pairings whose CAMPUS is not a registry dot yet (announced, under
  // construction): they carry their researched coordinate in `dc` and draw on
  // the map as hollow announced-campus markers, and list on the plant's page -
  // but they never become sites. When the campus lands in the registry's
  // sources, the entry gets its site_id and graduates.
  const annByPlant = new Map();
  // fabById is built where the fabs load, right after their overrides apply.
  if (fs.existsSync(dplPath)) {
    const links = JSON.parse(fs.readFileSync(dplPath, 'utf8'));
    let applied = 0;
    for (const l of links) {
      // Fab links ride in the same file: a fab is as much a load with a
      // named plant as a data centre is, and one ledger beats two.
      if (l.fab_id) {
        const f = fabById.get(l.fab_id);
        if (!f) { console.warn(`[dc_plant_links] fab ${l.fab_id} not in fabs.json`); continue; }
        if (!plantById.has(l.plant_id)) {
          console.warn(`[dc_plant_links] ${l.fab_id} links plant ${l.plant_id} that is not in power_plants.json`);
          continue;
        }
        f.link_plant_id = l.plant_id;
        f.link_structure = l.structure || 'announced';
        f.link_note = l.note || '';
        f.link_src = l.url || '';
        applied++;
        continue;
      }
      const s = siteById.get(l.site_id);
      if (!s) {
        // With a coordinate these draw on the map as announced campuses;
        // without one (corp: a corporate-wide offtake, no single load to
        // pin) they surface only as rows on the plant's page.
        if (!l.site_id && l.plant_id && plantById.has(l.plant_id)
            && l.dc && (l.dc.lat != null || l.dc.corp)) {
          if (!annByPlant.has(l.plant_id)) annByPlant.set(l.plant_id, []);
          annByPlant.get(l.plant_id).push(l);
        }
        continue;
      }
      if (l.plant_id) {
        if (!s.linked_plant_id) {
          s.linked_plant_id = l.plant_id;
          s.link_structure = l.structure || 'announced';
          applied++;
        }
        if (s.linked_plant_id === l.plant_id) {
          s.link_note = l.note || '';
          s.link_src = l.url || '';
        }
      } else if (!s.linked_plant_id) {
        // The plant is real but too new for EIA/GEM (permitted on-site
        // turbines, an SMR under construction). Name it so the page can say
        // what supplies the site, without inventing a plant record to point
        // at - the id link arrives when the inventory catches up.
        s.link_plant_name = l.plant_name || '';
        s.link_structure = s.link_structure || l.structure || 'announced';
        s.link_note = l.note || '';
        s.link_src = l.url || '';
        applied++;
      }
    }
    console.log(`[dc_plant_links] ${applied} researched link(s) applied of ${links.length}`);
    // Graduation watch: an announced campus is one the registry's sources had
    // not caught up with WHEN THE ENTRY WAS WRITTEN. The moment a registry
    // dot appears within 2 km of its researched coordinate, say so - filling
    // in the entry's site_id turns the hollow marker into a real link, and
    // that edit should not depend on anyone remembering to check.
    for (const ls of annByPlant.values()) {
      for (const l of ls) {
        if (l.dc.lat == null) continue;
        for (const s of sites) {
          if (s.lat == null || s.lat === '' || Math.abs(+s.lat - l.dc.lat) > 0.02) continue;
          if (kmBetween(+s.lon, +s.lat, l.dc.lon, l.dc.lat) > 2) continue;
          console.warn(`[dc_plant_links] "${l.dc.name}" (announced, plant ${l.plant_id}) `
            + `now has registry dot ${s.site_id} within 2 km - it may have graduated: `
            + `set the entry's site_id to link it properly`);
          break;
        }
      }
    }
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

  // The same links, read from the plant's side: /maps/plant/<id> shows which data
  // centres name it as their supply. Built after overrides AND the researched
  // file have both had their say, so the two directions can never disagree.
  const sitesByPlant = new Map();
  for (const s of sites) {
    if (!s.linked_plant_id || !plantById.has(s.linked_plant_id)) continue;
    if (!sitesByPlant.has(s.linked_plant_id)) sitesByPlant.set(s.linked_plant_id, []);
    sitesByPlant.get(s.linked_plant_id).push(s);
  }
  const fabsByPlant = new Map();
  for (const f of fabs) {
    if (!f.link_plant_id) continue;
    if (!fabsByPlant.has(f.link_plant_id)) fabsByPlant.set(f.link_plant_id, []);
    fabsByPlant.get(f.link_plant_id).push(f);
  }

  // The links as map geometry: one record per site<->plant pair where both
  // ends have a coordinate, for the Supply Links layer. Coordinates are read
  // AFTER overrides so a corrected dot carries its link with it.
  const supplyLinks = [];
  for (const [pid, ss] of sitesByPlant) {
    const pl = plantById.get(pid);
    if (pl.lat == null) continue;
    for (const s of ss) {
      if (s.lat == null || s.lat === '') continue;
      supplyLinks.push({
        sid: s.site_id, pid, st: s.link_structure || 'announced',
        sn: s.name || s.epoch_name || s.operator || 'Data centre', pn: pl.n,
        s: [+s.lon, +s.lat], p: [pl.lon, pl.lat],
      });
    }
  }
  // Fab threads: same geometry, the load end is a fab dot.
  for (const [pid, fs_] of fabsByPlant) {
    const pl = plantById.get(pid);
    if (pl.lat == null) continue;
    for (const f of fs_) {
      if (f.lat == null) continue;
      supplyLinks.push({
        fid: f.id, sid: '', pid, st: f.link_structure || 'announced',
        sn: f.n, pn: pl.n, s: [f.lon, f.lat], p: [pl.lon, pl.lat],
      });
    }
  }
  // The announced campuses: same thread, hollow endpoint, no site id - the
  // marker is the researched coordinate of a campus the registry cannot
  // list yet, flagged so the client draws it as an approximation.
  for (const [pid, ls] of annByPlant) {
    const pl = plantById.get(pid);
    if (pl.lat == null) continue;
    for (const l of ls) {
      if (l.dc.lat == null) continue;   // corporate offtakes have no pin
      supplyLinks.push({
        sid: '', ann: 1, pid, st: l.structure || 'announced',
        sn: l.dc.name, pn: pl.n,
        s: [+l.dc.lon, +l.dc.lat], p: [pl.lon, pl.lat],
      });
    }
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
    `${footprintById.size} footprints (${fpEdits} hand edits), ` +
    `project value on ${mapSites.filter(s => s.inv).length} sites / ${plantsValued} plants / ` +
    `${fabs.filter(f => f.inv).length} fabs`);

  // The outline flag rides in the map payloads - one key on the assets that
  // HAVE a shape, so the map can filter to the ones that do not. The absent
  // key is the worklist: every unflagged dot is a footprint nobody has
  // mapped, drawable from its own site page.
  for (const s of mapSites) if (outlined.has(s.id)) s.fp = 1;
  for (const p of plants) if (outlined.has(p.id)) p.fp = 1;
  for (const f of fabs) if (outlined.has(f.id)) f.fp = 1;

  // ---- the PowerDependency layer ------------------------------------------
  // Built by src/power_deps.py from filed interconnection requests and the
  // researched generator pairings. Loaded here, validated against the same
  // schema the pages render from, and indexed both ways: an asset needs to
  // list what it depends on, and a substation needs to list who is behind it
  // - the second direction is the accumulation question.
  const substationById = new Map();
  const subPath = path.join(DATA, 'substations.json');
  if (fs.existsSync(subPath)) {
    for (const s of JSON.parse(fs.readFileSync(subPath, 'utf8'))) {
      substationById.set(s.id, s);
    }
  }
  // Where each county the filings name sits, from src/county_centroids.py.
  // Used for ONE thing: deciding where the map opens when somebody is about to
  // place a substation that has a county and no coordinate. It is never a
  // substation's position, and nothing downstream may treat it as one.
  const countyCentre = new Map();
  const ccPath = path.join(DATA, 'county_centroids.json');
  if (fs.existsSync(ccPath)) {
    for (const c of JSON.parse(fs.readFileSync(ccPath, 'utf8'))) {
      countyCentre.set(`${c.region}|${c.county}`, c);
    }
  }

  // Hand placements land on top: substations.json is regenerated from the
  // filings, so a coordinate a person established has to be re-applied from
  // its own ledger every load or the next pipeline run erases it.
  const placementRows = readPlacements(DATA);
  if (placementRows.length) {
    const pl = applyPlacements(substationById, placementRows);
    console.log(`substation placements: ${pl.applied} hand-placed`);
    if (pl.conflicts.length) {
      console.warn(`[placements] ${pl.conflicts.length} substation(s) now located by `
        + `OpenStreetMap as well as by hand — the hand row is held, not applied: `
        + pl.conflicts.map(c => c.name).join(', '));
    }
    if (pl.orphans.length) {
      console.warn(`[placements] ${pl.orphans.length} row(s) for substation ids that are `
        + `no longer in the ledger: ${pl.orphans.join(', ')}`);
    }
  }
  const powerDeps = [];
  const depsByAsset = new Map();      // asset id -> edges it depends on
  const depsByDep = new Map();        // dependency id -> edges pointing at it
  const depPath = path.join(DATA, 'power_dependencies.json');
  if (fs.existsSync(depPath)) {
    let dropped = 0;
    for (const raw of JSON.parse(fs.readFileSync(depPath, 'utf8'))) {
      const errs = depErrors(raw);
      if (errs.length) {
        // One malformed edge must not cost the registry the other hundred.
        if (dropped < 5) console.warn(`[power deps] dropped ${raw.asset_id} -> `
          + `${raw.dependency_asset_id}: ${errs.join('; ')}`);
        dropped++;
        continue;
      }
      const e = describeDep(raw);
      // Resolve the far end to something nameable, so a page never has to.
      e.depNode = substationById.get(e.dependency_asset_id)
               || plantById.get(e.dependency_asset_id)
               || fabById.get(e.dependency_asset_id)
               || siteById.get(e.dependency_asset_id) || null;
      e.depName = e.depNode
        ? (e.depNode.name || e.depNode.n || e.depNode.id)
        : e.dependency_asset_id;
      powerDeps.push(e);
      if (!depsByAsset.has(e.asset_id)) depsByAsset.set(e.asset_id, []);
      depsByAsset.get(e.asset_id).push(e);
      if (!depsByDep.has(e.dependency_asset_id)) depsByDep.set(e.dependency_asset_id, []);
      depsByDep.get(e.dependency_asset_id).push(e);
    }
    if (dropped) console.warn(`[power deps] ${dropped} invalid edge(s) dropped`);
  }

  // Accumulation: per dependency, who is behind it and how much load. Only
  // PHYSICAL edges count - a front-of-meter contract shares no equipment, and
  // letting it inflate a concentration number would be the exact error this
  // layer exists to prevent.
  const accumulation = [];
  for (const [depId, edges] of depsByDep) {
    // Withdrawn filings are history, not exposure: still on the edge list,
    // never in a concentration number.
    const phys = edges.filter(e => e.physical && !e.withdrawn);
    if (!phys.length) continue;
    const assets = [...new Set(phys.map(e => e.asset_id))];
    const node = substationById.get(depId) || plantById.get(depId) || null;
    accumulation.push({
      id: depId,
      name: node ? (node.name || node.n || depId) : depId,
      kind: substationById.has(depId) ? 'substation'
          : plantById.has(depId) ? 'plant' : 'other',
      kv: node && node.kv != null ? node.kv : null,
      lat: node && node.lat != null ? node.lat : null,
      lon: node && node.lon != null ? node.lon : null,
      assets: assets.length,
      registry: assets.filter(a => isRegistryId(a)).length,
      mw: phys.reduce((t, e) => t + (e.mw || 0), 0),
      // The weakest evidence in the cluster governs how much it can be
      // leaned on; a chain is only as sourced as its worst link.
      minConfidence: phys.reduce((m, e) =>
        Math.min(m, e.confidence == null ? 1 : e.confidence), 1),
      edges: phys,
    });
  }
  accumulation.sort((a, b) => (b.assets - a.assets) || (b.mw - a.mw));
  if (powerDeps.length) {
    const multi = accumulation.filter(a => a.assets > 1).length;
    console.log(`power dependencies: ${powerDeps.length} edges over `
      + `${substationById.size} substations, ${accumulation.length} physical `
      + `dependency points (${multi} carrying more than one asset)`);
  }

  // Dropped points: hand-made claims waiting to become records. Their own
  // file, never the derived ones - see the note in lib/points.mjs.
  const pointById = new Map();
  const ptPath = path.join(DATA, 'draft_points.json');
  if (fs.existsSync(ptPath)) {
    let dropped = 0;
    for (const raw of JSON.parse(fs.readFileSync(ptPath, 'utf8'))) {
      const errs = pointErrors(raw);
      if (errs.length) {
        if (dropped < 5) console.warn(`[points] dropped ${raw && raw.id}: ${errs.join('; ')}`);
        dropped++;
        continue;
      }
      pointById.set(raw.id, raw);
    }
    if (pointById.size) {
      const named = [...pointById.values()].filter(p => p.kind).length;
      console.log(`dropped points: ${pointById.size} (${named} given a kind)`);
    }
  }

  // Simulated events. Same file discipline as the dropped points: hand-made,
  // never generated, never overwritten by a pipeline.
  const eventById = new Map();
  const evPath = path.join(DATA, 'events.json');
  if (fs.existsSync(evPath)) {
    for (const raw of JSON.parse(fs.readFileSync(evPath, 'utf8'))) {
      const errs = eventErrors(raw);
      if (errs.length) { console.warn(`[events] dropped ${raw && raw.id}: ${errs.join('; ')}`); continue; }
      eventById.set(raw.id, raw);
    }
    if (eventById.size) console.log(`simulated events: ${eventById.size}`);
  }

  return {
    substationById, powerDeps, depsByAsset, depsByDep, accumulation, countyCentre,
    powerLines, regridCounties,
    pointById, eventById,
    sites, siteById, rowsBySite, vaBySite, trajByName, timelineByName, epochMeta,
    mapSites, ercot, pjm, nyiso, countries, basemap, timelinePayload, quakes, plants, plantsMeta,
    operatorsPayload, siteLinks, operatorProfiles: profiles, rawToKey, byBuilding,
    overridesById, childrenBySite, kmBetween, plantById, fabs, footprints, footprintById,
    regrid, precisely, cadastre, waterByAsset, poiEvidence, sitesByPlant, supplyLinks, annByPlant, fabsByPlant,
    fpLocators, outlined, editOptions, fabById,
  };
}
