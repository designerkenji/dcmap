// Hand-placed substations: data/substation_placements.csv.
//
// The substation page deliberately has no "fix the dot" control, and that is
// still right: a located substation's coordinate comes from OpenStreetMap
// through a county-checked match, and a hand-typed override would quietly
// disagree with the source it exists to track. Correcting THAT belongs in OSM.
//
// This is the other case. A hundred substations in the ledger have a name from
// a filing and no coordinate at all - either OSM has never held them (most of
// Virginia's are proposed, and a substation that is not built yet legitimately
// has no place) or the name matched nothing the county check would accept.
// There is no source to disagree with, and three of them - Haverstock,
// Kintigh, Milliken - carry 3.2 GW of filed load that is invisible on the map
// purely because nobody has said where they are.
//
// So a hand placement fills a void; it never overrides a match. Two rules keep
// that honest and both are enforced rather than documented:
//
//   - Only an unlocated substation can be placed. The endpoint refuses one
//     that OSM already found.
//   - A placement is its own evidence class, `hand`, and says so everywhere it
//     is rendered. It is not laundered into looking like an OSM match, because
//     "someone recognised the switchyard on imagery" and "OSM holds this
//     substation under this name in this county" are different claims and only
//     one of them is checkable by a reader.
//
// Append-only, like every other hand ledger here: a correction is a new row,
// and the last row for an id wins. What the file is FOR is the audit trail -
// who placed a gigawatt of load where, and on what basis - so superseding a
// row by rewriting it in place would destroy the only thing it records.

import fs from 'node:fs';
import path from 'node:path';

export const PLACEMENT_COLUMNS =
  ['sub_id', 'name', 'lat', 'lon', 'basis', 'note', 'edited'];

// How the placer says they know. Ranked the way the rest of the registry ranks
// evidence: what a document states beats what a person recognised on imagery.
export const PLACEMENT_BASIS = {
  imagery: {
    label: 'Recognised on imagery',
    hint: 'A switchyard is visible at this point and the filing puts one here.',
  },
  filing: {
    label: 'Stated in a filing',
    hint: 'A document gives an address, a parcel or a coordinate for it.',
  },
  operator: {
    label: 'Operator or utility page',
    hint: 'The utility publishes the location.',
  },
  parcel: {
    label: 'Parcel record',
    hint: 'A pulled parcel names the utility as owner.',
  },
};

const q = (s) => {
  const v = String(s == null ? '' : s);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
};

export const placementRow = (r) =>
  PLACEMENT_COLUMNS.map((k) => q(r[k])).join(',');

// Minimal RFC4180 reader - the same shape the other ledgers use.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows.shift();
  return rows
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function readPlacements(dataDir) {
  const f = path.join(dataDir, 'substation_placements.csv');
  if (!fs.existsSync(f)) return [];
  try {
    return parseCsv(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.warn('[placements] unreadable: ' + e.message);
    return [];
  }
}

export function placementErrors(r) {
  const bad = [];
  const lat = +r.lat, lon = +r.lon;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) bad.push('latitude out of range');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) bad.push('longitude out of range');
  if (!lat && !lon) bad.push('0,0 is not a placement');
  if (r.basis && !PLACEMENT_BASIS[r.basis]) bad.push(`unknown basis ${JSON.stringify(r.basis)}`);
  if (!String(r.note || '').trim()) {
    // The note is the whole point. A coordinate with no statement of how it
    // was arrived at is exactly the unsourced pin this layer refuses to hold.
    bad.push('a note saying how the place was established is required');
  }
  return bad;
}

// Apply the ledger to substation records. Last row per id wins; a row for a
// substation OSM has since located is kept in the file but NOT applied, and is
// returned as a conflict for the caller to report - the point of the file is
// to fill gaps, and a gap that closed is worth a human look rather than a
// silent preference either way.
export function applyPlacements(substationById, rows) {
  const last = new Map();
  for (const r of rows) if (r.sub_id) last.set(r.sub_id, r);

  let applied = 0;
  const conflicts = [], orphans = [];
  for (const [id, r] of last) {
    const sub = substationById.get(id);
    if (!sub) { orphans.push(id); continue; }
    if (sub.located && sub.osm) { conflicts.push({ id, name: sub.name }); continue; }
    const bad = placementErrors(r);
    if (bad.length) { console.warn(`[placements] ${id}: ${bad.join('; ')}`); continue; }
    sub.lat = +(+r.lat).toFixed(6);
    sub.lon = +(+r.lon).toFixed(6);
    sub.located = true;
    sub.placed_by_hand = true;
    sub.placed_basis = r.basis || '';
    sub.placed_note = r.note || '';
    sub.placed_on = r.edited || '';
    // A hand placement answers the "why is there no dot" question, so the
    // rejection message it supersedes would otherwise contradict the dot
    // sitting next to it. Kept under another key: why OSM could not do it is
    // still the reason this row had to exist.
    if (sub.geo_rejected) {
      sub.geo_rejected_was = sub.geo_rejected;
      delete sub.geo_rejected;
    }
    applied++;
  }
  return { applied, conflicts, orphans };
}
