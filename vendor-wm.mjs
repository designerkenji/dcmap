// Vendor worldmonitor's layer configs into this repo: `node vendor-wm.mjs`
//
// The map's zone layers come from five TypeScript configs inside
// worldmonitor/, which is a SEPARATE GIT REPO (github.com/koala73/worldmonitor)
// that happens to sit in this directory. Nothing in it is tracked here and
// nothing should be - adding files from another project's working tree is how
// you get a gitlink nobody can clone or a silent fork of someone else's data.
//
// So the five are converted to JSON and written into data/wm/, which IS
// tracked. 2.4 GB of dependency becomes 440 KB of data, and a fresh clone can
// start the app.
//
// DRIFT IS HANDLED THE SAME WAY THE BUNDLE HANDLES IT: lib/data.mjs prefers
// worldmonitor's live .ts when that checkout is present, and only falls back to
// this vendored copy when it is not. Anyone with worldmonitor checked out is
// reading worldmonitor, so the two cannot silently disagree for them. Re-run
// this when worldmonitor's configs change.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const WM = path.join(ROOT, 'worldmonitor', 'src', 'config');
const OUT = path.join(ROOT, 'data', 'wm');

export const WM_CONFIGS = [
  ['quakes-recent.ts', 'QUAKES_RECENT'],
  ['ercot-load-zones.ts', 'ERCOT_LOAD_ZONES'],
  ['pjm-zones.ts', 'PJM_ZONES'],
  ['nyiso-zones.ts', 'NYISO_LOAD_ZONES'],
  ['datacenter-countries.ts', 'DATACENTER_COUNTRIES'],
];

// The configs are generated TypeScript: an import line, one type annotation,
// then a plain literal. Strip those two and it is valid JavaScript.
export async function readTsConfig(dir, file, exportName) {
  let src = fs.readFileSync(path.join(dir, file), 'utf8');
  src = src.replace(/^import[^\n]*\n/mg, '');
  src = src.replace(new RegExp(`export const ${exportName}\\s*:[^=]+=`), `export const ${exportName} =`);
  const tmp = path.join(os.tmpdir(), `wm-${exportName}-${process.pid}.mjs`);
  fs.writeFileSync(tmp, src);
  try {
    return (await import(pathToFileURL(tmp).href))[exportName];
  } finally {
    fs.unlinkSync(tmp);
  }
}

if (import.meta.filename === process.argv[1]) {
  if (!fs.existsSync(WM)) {
    console.error(`worldmonitor not checked out at ${path.relative(ROOT, WM)} - nothing to vendor.`);
    console.error('The tracked copy in data/wm/ is what a clone uses; it is unchanged.');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  let bytes = 0;
  for (const [file, exportName] of WM_CONFIGS) {
    const data = await readTsConfig(WM, file, exportName);
    const dst = path.join(OUT, file.replace(/\.ts$/, '.json'));
    fs.writeFileSync(dst, JSON.stringify(data));
    const n = fs.statSync(dst).size;
    bytes += n;
    const count = Array.isArray(data) ? `${data.length} entries` : 'object';
    console.log(`  ${file.padEnd(26)} -> ${path.basename(dst).padEnd(28)} ${String(Math.round(n / 1024)).padStart(4)} KB  ${count}`);
  }
  console.log(`\nvendored ${WM_CONFIGS.length} configs, ${(bytes / 1024).toFixed(0)} KB into data/wm/`);
  console.log('These are TRACKED - commit them so a fresh clone can run the app.');
}
