// What changed in the data, when, and on whose say-so.
//
// This registry keeps its data in three quite different places, and a page
// that tracks changes has to read all three or it will confidently show you a
// quiet day that was not quiet:
//
//   1. GIT, for the ~200 files under data/ that are committed. This is the
//      only record that also says WHY: the commit message is the reasoning,
//      and for a derived file that is the difference between "footprints.geojson
//      changed" and "footprints.geojson changed because the Epoch release
//      landed and the whole chain was re-run".
//
//   2. PER-RECORD TIMESTAMPS, inside the hand ledgers. The app writes these
//      live - a placement, a dropped point, an override - and they can sit
//      uncommitted for days. Git would show one dirty file; the ledger's own
//      `edited` column shows the seven separate decisions inside it.
//
//   3. MODIFICATION TIMES, for everything gitignored - the vendor parcel
//      caches and the raw upstream downloads under data/raw/. No history, no
//      per-record stamp, so mtime is all there is. It is the weakest evidence
//      here and is labelled as such rather than being mixed in with the rest.
//
// The three overlap on purpose. A change that shows up in two of them is the
// same change seen twice, and the page says so rather than counting it twice.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const run = (cmd, args, cwd) => new Promise((resolve) => {
  // Never a shell string: every argument here is fixed or a date this module
  // formatted itself, and it stays that way by construction.
  execFile(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
    resolve(err && !stdout ? '' : String(stdout || ''));
  });
});

export const isoDay = (d) => d.toISOString().slice(0, 10);

// Local midnight N days ago, as a git-friendly date. Local, not UTC: "today"
// means the day the person at the keyboard is having.
export function sinceDate(days = 1) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---- 1. committed history -------------------------------------------------
// One record per (commit, file), because that is the grain the page reports
// at: a commit touching nine files is nine data changes that happen to share
// a reason.
export async function gitChanges(root, since, subdir = 'data') {
  const out = await run('git', [
    'log', `--since=${since} 00:00:00`, '--numstat', '--no-merges',
    '--pretty=format:%H%aI%an%s',
    '--', subdir,
  ], root);

  const commits = [];
  for (const block of out.split('')) {
    if (!block.trim()) continue;
    const [head, ...rest] = block.split('\n');
    const [hash, when, who, subject] = head.split('');
    const files = [];
    for (const line of rest) {
      if (!line.trim()) continue;
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      files.push({
        path: m[3],
        added: m[1] === '-' ? null : +m[1],     // '-' means binary
        removed: m[2] === '-' ? null : +m[2],
        binary: m[1] === '-',
      });
    }
    if (files.length) {
      commits.push({ hash, short: (hash || '').slice(0, 7), when, who, subject, files });
    }
  }
  return commits;
}

// ---- 2. uncommitted work --------------------------------------------------
// Changes made but not yet reasoned about in a commit message. Worth its own
// section: for this repo an uncommitted derived file usually means a pipeline
// was run and the result has not been looked at yet.
export async function workingTree(root, subdir = 'data') {
  const out = await run('git', ['status', '--porcelain=v1', '--', subdir], root);
  const rows = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const p = line.slice(3).trim().replace(/^"|"$/g, '');
    rows.push({
      path: p,
      code: code.trim(),
      state: code.includes('?') ? 'untracked'
           : code.includes('D') ? 'deleted'
           : code.includes('A') ? 'added'
           : 'modified',
    });
  }
  return rows;
}

// Line counts for an uncommitted file, so the page can say how big the pending
// change is rather than only that one exists.
export async function pendingSize(root, file) {
  const out = await run('git', ['diff', '--numstat', '--', file], root);
  const m = /^(\d+|-)\t(\d+|-)\t/.exec(out.trim());
  if (!m) return null;
  return { added: m[1] === '-' ? null : +m[1], removed: m[2] === '-' ? null : +m[2] };
}

// ---- 3. gitignored files --------------------------------------------------
// mtime only. Reported separately and labelled, because "the file was touched"
// is a much weaker claim than "this commit changed these 40 lines for this
// reason", and mixing the two would let the weaker one borrow the authority
// of the stronger.
export function touchedFiles(dir, sinceMs, { maxDepth = 2, limit = 400 } = {}) {
  const hits = [];
  const walk = (d, depth) => {
    if (depth > maxDepth || hits.length >= limit) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (hits.length >= limit) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.mtimeMs >= sinceMs) {
        hits.push({ path: full, mtime: new Date(st.mtimeMs).toISOString(), bytes: st.size });
      }
    }
  };
  walk(dir, 0);
  hits.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return hits;
}

// ---- the hand ledgers -----------------------------------------------------
// Every one of these stamps its rows, and NO TWO AGREE on what to call the
// column: edited, added, created, reviewed, and one buried in a GeoJSON
// feature's properties. That is a wart, but it is a wart in append-only source
// files that the pipelines must never rewrite, so it is cheaper to read all
// five names here than to migrate five ledgers and every writer that appends
// to them. The list is the map of it.
//
// `stamp: null` is not an oversight - it records a ledger that genuinely
// cannot say when a row was added. Those changes are only ever visible in git,
// and the page has to say so rather than silently showing them as "no changes".
export const LEDGERS = [
  { file: 'data/site_overrides.csv', fmt: 'csv', stamp: 'edited', idKey: 'site_id',
    label: 'Site corrections' },
  // idKey is site_id, NOT asset_id: this ledger shares its column layout with
  // site_overrides.csv (one COLUMNS constant in overrides.mjs serves both), so
  // a plant or fab id arrives in a column called site_id. Reading asset_id
  // here returned undefined and every plant correction rendered with a blank
  // identifier.
  { file: 'data/asset_overrides.csv', fmt: 'csv', stamp: 'edited', idKey: 'site_id',
    label: 'Plant and fab corrections' },
  { file: 'data/substation_placements.csv', fmt: 'csv', stamp: 'edited', idKey: 'sub_id',
    label: 'Substation placements' },
  { file: 'data/manual_sites.csv', fmt: 'csv', stamp: 'added', idKey: 'site_id',
    label: 'Hand-added sites' },
  { file: 'data/manual_links.csv', fmt: 'csv', stamp: 'added', idKey: 'site_id',
    label: 'Hand-added supply links' },
  { file: 'data/name_reviews.csv', fmt: 'csv', stamp: 'reviewed', idKey: 'site_id',
    label: 'Name reviews' },
  { file: 'data/footprint_overrides.geojsonl', fmt: 'geojsonl', stamp: 'edited', idKey: 'id',
    label: 'Footprint edits' },
  { file: 'data/draft_points.json', fmt: 'json', stamp: 'created', idKey: 'id',
    label: 'Dropped points', alsoStamp: 'edited' },
  { file: 'data/events.json', fmt: 'json', stamp: 'created', idKey: 'id',
    label: 'Simulated events', alsoStamp: 'edited' },
  { file: 'data/dc_plant_links.json', fmt: 'json', stamp: null, idKey: 'site_id',
    label: 'Researched supply links' },
  { file: 'data/fabs_sourced.json', fmt: 'json', stamp: null, idKey: 'id',
    label: 'Fab sourcing' },
  { file: 'data/fabs_rejected.json', fmt: 'json', stamp: null, idKey: 'company',
    label: 'Fabs ruled out' },
  { file: 'data/plant_values.json', fmt: 'json', stamp: null, idKey: 'id',
    label: 'Plant capex research' },
  { file: 'data/operator_profiles_raw.json', fmt: 'json', stamp: null, idKey: 'key',
    label: 'Operator profiles' },
];

// Writes that leave NO trace a change-tracking page could find. Listed because
// an empty section is a claim, and this page must not make a claim it cannot
// support: these are the places a change can happen and this page will not
// show it. Each one is a real gap, not a rounding error.
export const BLIND_SPOTS = [
  { what: 'Editing a simulated event',
    why: 'POST /api/event/<id> carries the original `created` through unchanged and '
       + 'stamps no `edited`, so an event edited today still reads as created whenever '
       + 'it was first placed.' },
  { what: 'Uploaded site imagery',
    why: 'POST /upload puts the date in the FILENAME, taken from the caller\'s ?date= '
       + 'parameter — that is the imagery\'s date, not the moment it was written.' },
  { what: 'Anything written into worldmonitor/',
    why: 'quakes.py, shakemap.py, country_layer.py, ercot_zones.py, nyiso_zones.py, '
       + 'pjm_zones.py and worldmonitor_layer.py all write into the worldmonitor '
       + 'checkout next door, which is a SEPARATE repository this one does not '
       + 'version. Running any of them changes real pipeline output that no git '
       + 'query here can see.' },
  { what: 'The bundled copy under dcmap/data/',
    why: 'bundle.mjs duplicates the registry for a standalone deploy, including the '
       + 'append-only footprint ledger. It is gitignored, so the copy can drift from '
       + 'the original with nothing reporting it.' },
  { what: 'Vendor parcel pulls',
    why: 'The Regrid and Precisely caches stamp nothing inside the record. Their file '
       + 'mtimes are load-bearing elsewhere — the Python quota counter reads them to '
       + 'enforce the daily cap — so they are reported under “Outside git” and must '
       + 'never be touched to tidy them up.' },
];

function parseCsvRows(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows.shift();
  return rows.filter(r => r.some(v => v !== ''))
    .map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function readRecords(root, led) {
  const full = path.join(root, led.file);
  if (!fs.existsSync(full)) return null;
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch { return null; }
  try {
    if (led.fmt === 'csv') return parseCsvRows(text);
    if (led.fmt === 'geojsonl') {
      return text.split('\n').filter(l => l.trim())
        .map(l => { try { return JSON.parse(l).properties || {}; } catch { return null; } })
        .filter(Boolean);
    }
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : (Array.isArray(j.features)
      ? j.features.map(f => f.properties || {}) : Object.values(j));
  } catch { return null; }
}

// Rows stamped on or after `sinceIso` (a YYYY-MM-DD day). Returns the ledger's
// own account of itself: total rows, how many are recent, and those rows.
export function ledgerActivity(root, sinceDay) {
  return LEDGERS.map((led) => {
    const recs = readRecords(root, led);
    if (recs == null) {
      return { ...led, missing: true, total: 0, recent: [] };
    }
    if (!led.stamp) {
      return { ...led, total: recs.length, recent: [], unstamped: true };
    }
    const recent = [];
    for (const r of recs) {
      const t = String(r[led.stamp] || (led.alsoStamp ? r[led.alsoStamp] : '') || '');
      if (!t) continue;
      // Stamps are ISO-ish; a plain string compare on the day prefix is enough
      // and avoids inventing a timezone the ledger never recorded.
      if (t.slice(0, 10) >= sinceDay) {
        recent.push({ id: r[led.idKey] || r.id || '', when: t,
                      note: r.note || r.reason || '' });
      }
    }
    recent.sort((a, b) => String(b.when).localeCompare(String(a.when)));
    return { ...led, total: recs.length, recent };
  });
}

// A directory summarised rather than listed: 1,559 cache files individually is
// noise, "1,559 files, 8 of them today" is the fact.
export function dirSummary(dir, sinceMs) {
  let total = 0, recent = 0, newest = 0;
  const walk = (d, depth) => {
    if (depth > 2) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      total++;
      if (st.mtimeMs >= sinceMs) recent++;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  };
  walk(dir, 0);
  return { total, recent, newest: newest ? new Date(newest).toISOString() : null };
}
