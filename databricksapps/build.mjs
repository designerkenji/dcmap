// Assemble the deployable app.
//
// build/ is what gets uploaded, and it is DISPOSABLE - delete it and run this
// again. It contains a verbatim copy of dcmap's code beside this folder's
// Databricks layer, which is the whole trick: dcmap is VENDORED, NEVER FORKED.
// Nothing here edits a line of it, so updating to a newer dcmap is re-running
// this script rather than re-applying a patch.
//
// The layout matters. dcmap resolves its own data directory from where
// server.mjs sits (lib/data.mjs: `path.resolve(import.meta.dirname, '..')`), so
// its files go at the ROOT of build/ and its data directory is build/data -
// which is exactly where boot.mjs stages the volume. Putting dcmap in a
// subdirectory instead would also put node_modules out of its reach and 404
// every /vendor/ route.
//
//   node build.mjs           assemble build/
//   node build.mjs --dev     ...and link build/data at dcmap's own data/, so
//                            the assembled app runs locally against real files

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const DCMAP = path.resolve(HERE, '..', 'dcmap');
const OUT = path.join(HERE, 'build');
const DEV = process.argv.includes('--dev');

if (!fs.existsSync(path.join(DCMAP, 'server.mjs'))) {
  console.error(`no dcmap at ${DCMAP} - this builds from the sibling folder`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// dcmap's code, verbatim. NOT data/ - it is 1.5 GB, one file of it is 25 MB,
// and a Databricks App refuses any file over 10 MB. Its home is the volume.
for (const item of ['server.mjs', 'lib', 'public']) {
  fs.cpSync(path.join(DCMAP, item), path.join(OUT, item), { recursive: true });
}

// This folder's layer.
for (const item of ['boot.mjs', 'dbx', 'app.yaml', '.databricksignore']) {
  fs.cpSync(path.join(HERE, item), path.join(OUT, item), { recursive: true });
}

// dcmap's dependencies, started through boot.mjs instead of server.mjs. A
// Databricks App runs `npm run start` by default; app.yaml states it anyway.
const pkg = JSON.parse(fs.readFileSync(path.join(DCMAP, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  ...pkg,
  name: 'dcmap-databricks',
  description: 'dcmap packaged as a Databricks App: unmodified, behind a volume-aware front layer.',
  scripts: { ...pkg.scripts, start: 'node boot.mjs' },
}, null, 2) + '\n');

// Where the volume is staged to. Created empty so the first read has somewhere
// to land even if staging is skipped.
const data = path.join(OUT, 'data');
const epoch = path.join(OUT, 'data_centers_from_EPOCH_AI');
if (DEV) {
  // Local runs read dcmap's real files. A symlink, not a copy: 1.5 GB copied
  // on every build to test a proxy change is not a build step, it is a wait.
  fs.symlinkSync(path.join(DCMAP, 'data'), data);
  fs.symlinkSync(path.join(DCMAP, 'data_centers_from_EPOCH_AI'), epoch);
  // And its node_modules, so a local build is ready to run without a second
  // copy of maplibre-gl on disk. The deployed build has none of this: the
  // container installs from package.json.
  const nm = path.join(DCMAP, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(OUT, 'node_modules'));
} else {
  fs.mkdirSync(data);
  fs.mkdirSync(epoch);
}

const count = (d) => fs.readdirSync(d, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).length;
console.log(`built ${OUT}`);
console.log(`  ${count(path.join(OUT, 'lib'))} lib + ${count(path.join(OUT, 'public'))} public `
  + `file(s) vendored from ${path.relative(path.resolve(HERE, '..'), DCMAP)}`);
console.log(DEV
  ? '  data/ linked at dcmap/data — run it with: cd build && npm install && npm start'
  : '  data/ empty — it is staged from DCMAP_VOLUME at startup');
