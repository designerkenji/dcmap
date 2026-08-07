// Corrections a person made by hand, and how they survive the pipeline.
//
// Everything the map draws is DERIVED: osm.py -> epoch.py -> manual.py ->
// peeringdb.py -> dedupe.py rebuilds facilities_sites.csv from scratch. So a
// value typed into that file lasts exactly until the next run, which is the
// same reason manual.py exists for whole sites. This is the same idea applied
// one level down, to a field.
//
// data/site_overrides.csv is therefore a SOURCE. Nothing generates it, nothing
// rewrites it wholesale, and every row in it is something a human asserted
// that no upstream source knew.
//
// ONE ROW PER FIELD, NOT PER SITE
// Partial knowledge is the normal case - you recognise the operator of a site
// whose capacity you have no idea about - and a row per field says exactly
// that. A row per site would need a sentinel for "not asserted" and would make
// every correction look like a claim about all twelve columns.
//
// KEYED ON site_id, ANCHORED ON COORDINATES
// site_id comes out of dedupe and is meant to be stable, but "meant to" is not
// a guarantee: merge two sites and one id goes away. Each row therefore also
// carries the lat/lon as they stood when the edit was made, so a correction
// whose id has vanished can still be found again by where it was rather than
// silently disappearing. reattach() reports those rather than fixing them
// quietly - moving somebody's assertion onto a different site is not a thing
// to do without asking.

import fs from 'node:fs';
import path from 'node:path';
import { parseCSVObjects } from './csv.mjs';

// The fields a person can actually know better than the pipeline does.
//
// Deliberately NOT here: site_id, rows, sources, building, building_n, which
// are dedupe's own bookkeeping and mean nothing typed in by hand; epoch_name,
// which is a join key into Epoch's data and would break the join; and lat/lon,
// because moving a dot is a different and riskier act than naming one - it
// changes which country a site counts under and which building it claims to
// be. That deserves its own affordance, not a text box among ten others.
export const FIELDS = {
  name:                   { label: 'Name' },
  operator:               { label: 'Operator' },
  city:                   { label: 'City' },
  country:                { label: 'Country', hint: 'ISO 3166-1 alpha-2, e.g. US' },
  facility_type:          { label: 'Type', options: ['', 'traditional', 'ai'] },
  tenancy:                { label: 'Tenancy', options: ['', 'single', 'multi'] },
  status:                 { label: 'Status',
                            options: ['', 'operational', 'under_construction', 'proposed'] },
  utility:                { label: 'Serving utility' },
  ref:                    { label: 'Facility code' },
  power_mw_total_current: { label: 'Power, MW', hint: 'number' },

  // What the dot IS, which is a different question from what the facility
  // does. facility_type says AI or traditional; this says whether the
  // coordinate stands for one building, a whole campus of them, or a spot
  // nobody has looked at yet.
  //
  // Named site_kind rather than the obvious `type` precisely because
  // facility_type already exists: two columns called something_type meaning
  // unrelated things is how a future reader gets it wrong.
  //
  // `point` is the honest default and the reason the field is worth having.
  // Every one of the 6,249 sites is a point until somebody says otherwise, and
  // "we have not looked" needs to be sayable - otherwise the first person to
  // mark a campus makes every unmarked dot look like a building by implication.
  site_kind: { label: 'This dot is',
               options: ['point', 'building', 'campus'],
               hint: 'point = not yet determined' },

  // The campus a building belongs to. Hidden from the general grid: it is a
  // site id, and typing one in from memory is not a thing anyone should do -
  // it is set by picking a neighbour off the imagery.
  parent_site_id: { label: 'Part of campus', hidden: true },
};

export const KINDS = FIELDS.site_kind.options;
export const kindOf = (site) => (site.site_kind || 'point');

const COLUMNS = ['site_id', 'field', 'value', 'lat', 'lon', 'note', 'edited'];
const MAX_VALUE = 300;

const csvCell = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

export function overridesPath(dataDir) {
  return path.join(dataDir, 'site_overrides.csv');
}

export function readOverrides(dataDir) {
  const f = overridesPath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    return parseCSVObjects(fs.readFileSync(f, 'utf8'))
      .filter(r => r.site_id && FIELDS[r.field]);
  } catch (err) {
    // A corrupt overrides file must not take the whole registry down with it.
    console.warn('[overrides] unreadable, ignoring:', err.message);
    return [];
  }
}

// site_id -> { field: {value, note, edited} }, latest write per field wins.
export function indexOverrides(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.site_id)) by.set(r.site_id, {});
    by.get(r.site_id)[r.field] = { value: r.value, note: r.note, edited: r.edited };
  }
  return by;
}

// Applied in place, and each site keeps a record of what was changed. The page
// needs that to say which facts are asserted rather than sourced - a registry
// that shows a hand-typed operator identically to one three sources agree on
// is lying by omission.
export function applyOverrides(sites, byId) {
  let n = 0;
  for (const s of sites) {
    const ov = byId.get(s.site_id);
    if (!ov) continue;
    const edited = {};
    for (const [field, rec] of Object.entries(ov)) {
      edited[field] = { was: s[field] ?? '', ...rec };
      s[field] = rec.value;
      n++;
    }
    s.edited = edited;
  }
  return n;
}

// Overrides whose site_id no longer exists. Reported, never auto-rehomed.
export function reattach(rows, siteById) {
  return rows.filter(r => !siteById.has(r.site_id));
}

export function validate(field, value) {
  const spec = FIELDS[field];
  if (!spec) return 'not an editable field';
  if (typeof value !== 'string') return 'value must be a string';
  if (value.length > MAX_VALUE) return `value over ${MAX_VALUE} characters`;
  if (spec.options && !spec.options.includes(value)) {
    return `must be one of: ${spec.options.filter(Boolean).join(', ')}`;
  }
  if (field === 'country' && value && !/^[A-Za-z]{2}$/.test(value)) {
    return 'country must be a two-letter ISO code';
  }
  if (field === 'power_mw_total_current' && value && !/^\d+(\.\d+)?$/.test(value)) {
    return 'power must be a number';
  }
  // Shape only. Whether that id exists, is a campus, and does not close a loop
  // are questions about OTHER sites, so they are the server's to answer where
  // the whole registry is in scope - see linkError().
  if (field === 'parent_site_id' && value && !/^site-[a-z0-9-]+$/.test(value)) {
    return 'not a site id';
  }
  return null;
}

// The relational half of validating a parent link. Separate from validate()
// because it needs every other site, and returns a sentence rather than a code
// so the UI has nothing to translate.
//
// Each rule is here because the alternative is a registry that quietly lies:
// a self-parent renders as a site inside itself, a cycle hangs any walk up the
// tree, a non-campus parent makes "part of campus" false on its face, and
// allowing a campus to be adopted gives you grandchildren that no view here
// draws.
export function linkError(site, parentId, siteById) {
  if (!parentId) return null;                       // clearing the link
  if (parentId === site.site_id) return 'A site cannot be its own campus.';
  const parent = siteById.get(parentId);
  if (!parent) return 'No site with that id.';
  if (kindOf(parent) !== 'campus') {
    return 'That site is not marked as a campus yet — mark it a campus first.';
  }
  for (const s of siteById.values()) {
    if (s.parent_site_id === site.site_id) {
      return 'This site already has buildings of its own, so it cannot also be '
           + 'part of a campus.';
    }
  }
  const seen = new Set([site.site_id]);
  let up = parent;
  while (up) {
    if (seen.has(up.site_id)) return 'That would make a loop.';
    seen.add(up.site_id);
    up = up.parent_site_id ? siteById.get(up.parent_site_id) : null;
  }
  return null;
}

// Demoting a campus that has buildings hanging off it would orphan them.
export function kindError(site, kind, siteById) {
  if (kind === 'campus') return null;
  for (const s of siteById.values()) {
    if (s.parent_site_id === site.site_id) {
      return 'Buildings are linked to this campus — unlink them before '
           + 'changing what it is.';
    }
  }
  return null;
}

// Appended, not rewritten: the file is an append-only log of assertions, so
// the history of a field is recoverable and a crash mid-write cannot lose the
// rows that were already there. indexOverrides() takes the last one.
export function appendOverrides(dataDir, siteId, site, edits, note, now) {
  const f = overridesPath(dataDir);
  const fresh = !fs.existsSync(f);
  const lines = [];
  if (fresh) lines.push(COLUMNS.join(','));
  for (const [field, value] of Object.entries(edits)) {
    lines.push([siteId, field, value, site.lat ?? '', site.lon ?? '', note || '', now]
      .map(v => csvCell(String(v))).join(','));
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(f, lines.join('\n') + '\n');
}
