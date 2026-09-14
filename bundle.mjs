// Make dcmap/ runnable on its own: `node bundle.mjs`
//
// The app reads 6 MB of data from three directories OUTSIDE this folder - the
// repo's data/, the Epoch download, and worldmonitor's TypeScript configs. That
// is correct inside the monorepo, where src/*.py owns those files and there is
// exactly one copy of each. It also means copying dcmap/ somewhere else gives
// you an app that cannot start.
//
// This copies what the app reads into dcmap/data/, so the folder is portable.
//
// THE DRIFT PROBLEM, AND WHY THE FALLBACK POINTS THE WAY IT DOES
// Two copies of a dataset is how a project starts disagreeing with itself. The
// resolution order in lib/data.mjs is therefore REPO-FIRST: if ../data exists
// the app reads it and this bundle is ignored entirely, so nobody developing
// in the monorepo can be looking at a stale copy. The bundle is only consulted
// when the repo is not there - which is exactly the deployed case.
//
// So: re-run this before shipping. In development it does nothing at all.
//
// worldmonitor's five layer configs are not handled here at all: vendor-wm.mjs
// converts them to JSON in data/wm/, which is tracked, so by the time this runs
// they are ordinary data files and get copied like any other.

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'data');

// [source, destination-within-dcmap/data, required]
const FILES = [
  ['data/facilities_sites.csv', 'facilities_sites.csv', true],
  ['data/facilities_global.csv', 'facilities_global.csv', true],
  ['data/registry.csv', 'registry.csv', true],
  ['data/ai_site_trajectories.csv', 'ai_site_trajectories.csv', true],
  ['data/operators.json', 'operators.json', true],
  // Read unconditionally by lib/data.mjs, so a bundle without them is a deploy
  // that dies at startup - they were missing from this list when the layers
  // were added, which the repo-first resolution hid from everyone developing
  // here. plant_values.json is the hand-researched project-value join and is
  // optional the way the other hand files are.
  ['data/power_plants.json', 'power_plants.json', true],
  ['data/fabs.json', 'fabs.json', true],
  ['data/plant_values.json', 'plant_values.json', false],
  ['data/operator_profiles.json', 'operator_profiles.json', false],
  ['data/site_links.json', 'site_links.json', false],
  ['data/raw/ne_countries.geojson', 'raw/ne_countries.geojson', true],
  // Only ~200 elements carry a build year, but that is what the timeline
  // slider runs on for traditional facilities.
  ['data/raw/osm_world.json', 'raw/osm_world.json', false],
  ['data/raw/osm_us_va.json', 'raw/osm_us_va.json', false],
  ['data/raw/osm_us_tx.json', 'raw/osm_us_tx.json', false],
  // Footprint polygons and the hand-drawn corrections laid over them. The
  // overrides file is a SOURCE (see lib/overrides.mjs): if it exists it must
  // travel, or a deployed copy silently loses someone's hand work.
  ['data/footprints.geojson', 'footprints.geojson', false],
  ['data/footprints_overture.geojson', 'footprints_overture.geojson', false],
  ['data/footprints_overture_fabs.geojson', 'footprints_overture_fabs.geojson', false],
  ['data/footprints_plants.geojson', 'footprints_plants.geojson', false],
  // Transmission corridors. Optional (false) because the layer is off by
  // default and a deploy without it simply draws nothing - but omitting it
  // entirely gave the standalone copy the layer and none of its data.
  ['data/transmission_lines.geojson', 'transmission_lines.geojson', false],
  ['data/footprint_overrides.geojsonl', 'footprint_overrides.geojsonl', false],
  ['data/wm/quakes-recent.json', 'wm/quakes-recent.json', true],
  ['data/wm/ercot-load-zones.json', 'wm/ercot-load-zones.json', true],
  ['data/wm/pjm-zones.json', 'wm/pjm-zones.json', true],
  ['data/wm/nyiso-zones.json', 'wm/nyiso-zones.json', true],
  ['data/wm/datacenter-countries.json', 'wm/datacenter-countries.json', true],
  ['data_centers_from_EPOCH_AI/data_centers.csv', 'epoch/data_centers.csv', true],
  ['data_centers_from_EPOCH_AI/data_center_timelines.csv', 'epoch/data_center_timelines.csv', true],
];


function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(to).size;
}

let bytes = 0, copied = 0, skipped = [];
const missing = [];

for (const [src, dst, required] of FILES) {
  const from = path.join(ROOT, src);
  if (!fs.existsSync(from)) {
    (required ? missing : skipped).push(src);
    continue;
  }
  bytes += copy(from, path.join(OUT, dst));
  copied++;
}

// Per-event ShakeMap detail, loaded on click.
const evSrc = path.join(ROOT, 'data', 'quake_events');
let events = 0;
if (fs.existsSync(evSrc)) {
  for (const f of fs.readdirSync(evSrc).filter(f => f.endsWith('.json'))) {
    bytes += copy(path.join(evSrc, f), path.join(OUT, 'quake_events', f));
    events++;
  }
}


// The vector basemap: glyph ranges (~10 MB, 512 small files) and the tile
// archive. Directory-copied like the quake events rather than listed file by
// file, because src/basemap_tiles.py decides how many ranges there are.
//
// The archive is 1.6 GB and is reported on its own line below, deliberately:
// folding it into the same total as the 6 MB of registry data would make the
// bundle look like it had grown 250x for reasons nobody could see. Both are
// OPTIONAL, on the same terms as everything else here - a deploy without them
// is the map this app had before it had labels, which still works.
const glyphSrc = path.join(ROOT, 'data', 'raw', 'glyphs');
let glyphs = 0;
if (fs.existsSync(glyphSrc)) {
  for (const stack of fs.readdirSync(glyphSrc)) {
    const dir = path.join(glyphSrc, stack);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.pbf'))) {
      bytes += copy(path.join(dir, f), path.join(OUT, 'raw', 'glyphs', stack, f));
      glyphs++;
    }
  }
}

const tileSrc = path.join(ROOT, 'data', 'raw', 'basemap.pmtiles');
let tileBytes = 0;
if (fs.existsSync(tileSrc)) {
  tileBytes = copy(tileSrc, path.join(OUT, 'raw', 'basemap.pmtiles'));
}

// Uploads land here at runtime. It must be the BUNDLE's data dir, not the
// repo's - server.mjs resolves IMG_ROOT from wherever the data came from, so
// creating it next to the repo would leave a deployed copy writing uploads
// into a directory that does not exist.
fs.mkdirSync(path.join(OUT, 'site_images'), { recursive: true });

fs.writeFileSync(path.join(OUT, 'BUNDLE.md'),
  `# dcmap data bundle

Generated by \`node bundle.mjs\`. Do not edit by hand - \`src/*.py\` in the
parent repo owns every file here, and this is a copy.

${copied} files, ${events} quake events and ${glyphs} glyph ranges. ${(bytes / 1048576).toFixed(1)} MB${tileBytes ? `, plus a ${(tileBytes / 1e9).toFixed(1)} GB basemap archive` : ''}.

lib/data.mjs prefers the repo's own data/ when it is present, so inside the
monorepo this bundle is ignored and cannot go stale unnoticed. It is read only
when ../data is absent, i.e. when this folder has been copied out on its own.
`);

console.log(`bundled ${copied} files + ${events} quake events + ${glyphs} glyph ranges`);
console.log(`  ${(bytes / 1048576).toFixed(1)} MB into ${path.relative(ROOT, OUT)}/`);
if (tileBytes) console.log(`  + ${(tileBytes / 1e9).toFixed(1)} GB basemap.pmtiles`);
else console.log('  no basemap.pmtiles - deployed copy will have no labels or borders');
if (skipped.length) console.log(`  optional, absent: ${skipped.join(', ')}`);
if (missing.length) {
  console.log(`\n  MISSING AND REQUIRED:\n    ${missing.join('\n    ')}`);
  console.log('  the bundled folder will NOT start without these.');
  process.exitCode = 1;
}
