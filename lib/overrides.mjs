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

  // WHICH PLANT SUPPLIES THIS SITE - a fact that has to be entered by hand,
  // because for a grid-connected load it does not exist to be derived. The
  // grid is fungible: a site draws from it, a utility bills for it, and no
  // electron carries a plant's name. Proximity is not supply, which is why
  // `gen` next door is called generation-within-25km and not generation-used.
  //
  // So this records the handful of arrangements where the link IS real, and
  // somebody has read the filing. Hidden like parent_site_id and for the same
  // reason: it is an id, set by picking a plant off the map, not typed.
  linked_plant_id: { label: 'Supplied by', hidden: true },

  // NOT A BOOLEAN, and that is the whole point. Talen-AWS at Susquehanna is
  // the most-cited co-location deal in the world and it MIGRATED - announced
  // behind-the-meter, restructured front-of-meter in June 2025 with the
  // generator selling into PJM and a utility doing delivery. A registry with a
  // "co-located: yes" column had it wrong from that day and had no way to say
  // so. The structure is the fact; the link on its own is barely one.
  link_structure: {
    label: 'Arrangement',
    options: ['', 'btm', 'netmeter', 'ppa', 'announced'],
    hint: 'btm = behind the meter · netmeter = net-metered co-location · '
        + 'ppa = front-of-meter contract · announced = reported, not yet built',
  },
};

// Rendered wherever the arrangement is shown. Kept beside the options so a new
// structure cannot be added without someone writing down what it means.
export const LINK_STRUCTURE = {
  btm: {
    label: 'Behind the meter',
    blurb: 'Load sits on the generator’s side of the point of interconnection.',
  },
  netmeter: {
    label: 'Net-metered co-location',
    blurb: 'Paired with the generator and settled net of its output, but still '
         + 'grid-connected and curtailable.',
  },
  ppa: {
    label: 'Front-of-meter contract',
    blurb: 'The plant sells to the grid and the site buys from it on paper. '
         + 'Contractual, not physical — the electrons do not follow.',
  },
  announced: {
    label: 'Announced only',
    blurb: 'Reported or filed, not operating. Structure may still change.',
  },
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
  // Plant ids are the ingest's own: e<EIA plant id>, g<GEM project id>. Shape
  // only, again - whether it names a real plant is plantLinkError()'s job.
  if (field === 'linked_plant_id' && value && !/^[eg][A-Za-z0-9]+$/.test(value)) {
    return 'not a plant id';
  }
  return null;
}

// The relational half of a plant link, for the same reason linkError exists:
// it needs the plant set, which validate() has no business knowing about.
//
// A structure without a plant is the one combination worth refusing outright.
// "Behind the meter" attached to nothing is a claim about a relationship with
// no other end - it would render as an arrangement and mean nothing.
export function plantLinkError(plantId, plantById) {
  if (!plantId) return null;                        // clearing the link
  if (!plantById.has(plantId)) return 'No plant with that id.';
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

// ---- name-conflict reviews ---------------------------------------------------
// A record that somebody LOOKED, which is different from a record of what the
// value is. Keeping the registry's own name writes no override - there is
// nothing to override - so without this the same pair returns to the queue on
// every run and "examined and kept" is indistinguishable from "never seen".
//
// Separate from site_overrides.csv on purpose: that file is a list of
// assertions about the world, and "I decided the existing name was right" is
// an assertion about the review, not about the site.
const REVIEW_COLUMNS = ['site_id', 'decision', 'chosen', 'note', 'reviewed'];

export function nameReviewsPath(dataDir) {
  return path.join(dataDir, 'name_reviews.csv');
}

export function readNameReviews(dataDir) {
  const f = nameReviewsPath(dataDir);
  if (!fs.existsSync(f)) return [];
  try {
    return parseCSVObjects(fs.readFileSync(f, 'utf8')).filter(r => r.site_id);
  } catch (err) {
    console.warn('[reviews] unreadable, ignoring:', err.message);
    return [];
  }
}

export function appendNameReview(dataDir, row) {
  const f = nameReviewsPath(dataDir);
  const fresh = !fs.existsSync(f);
  const line = REVIEW_COLUMNS.map(k => csvCell(String(row[k] ?? ''))).join(',');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(f, (fresh ? REVIEW_COLUMNS.join(',') + '\n' : '') + line + '\n');
}

// ---- footprints -------------------------------------------------------------
// Shapes a person drew or corrected on the map. Same contract as the field
// overrides above - a SOURCE nothing regenerates, append-only, the last
// assertion about an id wins - but the payload is geometry, so the format is
// one GeoJSON Feature per line (GeoJSONSeq) rather than CSV. A line is
// appendable the way a FeatureCollection is not, and GDAL/QGIS read the file
// directly, which matters for something a person may want to audit in a GIS.
//
// Three kinds of line, told apart by properties:
//   - a NEW shape: id is fp-man-<...>, drawn in the app
//   - an EDIT: id matches a derived footprint (fp-w..., fp-im3-...); the
//     feature replaces it wholesale, and src:'manual' records that a person,
//     not the source, now vouches for the shape
//   - a TOMBSTONE: {deleted: true}, hiding a shape without erasing history

export function footprintOverridesPath(dataDir) {
  return path.join(dataDir, 'footprint_overrides.geojsonl');
}

export function readFootprintOverrides(dataDir) {
  const f = footprintOverridesPath(dataDir);
  if (!fs.existsSync(f)) return [];
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ft = JSON.parse(line);
      if (ft && ft.properties && ft.properties.id) out.push(ft);
    } catch {
      // One mangled line must not take every hand-drawn shape down with it.
      console.warn('[overrides] skipping unreadable footprint line');
    }
  }
  return out;
}

const FP_ID_RE = /^fp-[a-z0-9-]+$/;
const FP_MAX_VERTICES = 4000;
const FP_MAX_SITES = 200;

// Every ring a polygon or multipolygon holds, or null if the nesting is wrong.
function fpRings(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : null;
  if (!Array.isArray(polys) || !polys.length) return null;
  const rings = [];
  for (const poly of polys) {
    if (!Array.isArray(poly) || !poly.length) return null;
    for (const r of poly) rings.push(r);
  }
  return rings;
}

// Shape and sanity only. Like validate(), anything needing the rest of the
// registry (do these site ids exist?) takes the lookups as arguments.
export function footprintError(body, siteById, footprintById) {
  if (body.id != null && (typeof body.id !== 'string' || !FP_ID_RE.test(body.id))) {
    return 'not a footprint id';
  }
  if (body.delete) {
    if (!body.id) return 'deleting needs the footprint id';
    if (!footprintById.has(body.id)) return 'no footprint with that id';
    return null;
  }
  const g = body.geometry;
  if (!g || typeof g !== 'object') return 'a footprint needs a geometry';
  const rings = fpRings(g);
  if (!rings) return 'geometry must be a Polygon or MultiPolygon';
  let vertices = 0;
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < 4) return 'a ring needs at least 3 corners';
    for (const pt of r) {
      if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])
          || pt[0] < -180 || pt[0] > 180 || pt[1] < -90 || pt[1] > 90) {
        return 'coordinates must be [lon, lat] pairs on the planet';
      }
    }
    const a = r[0], b = r[r.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) return 'rings must close';
    vertices += r.length;
  }
  if (vertices > FP_MAX_VERTICES) return `over ${FP_MAX_VERTICES} vertices`;
  if (body.sites != null) {
    if (!Array.isArray(body.sites) || body.sites.length > FP_MAX_SITES) {
      return 'sites must be a short list of site ids';
    }
    for (const id of body.sites) {
      if (!siteById.has(id)) return `no site with id ${id}`;
    }
  }
  if (body.name != null && (typeof body.name !== 'string' || body.name.length > 120)) {
    return 'name must be a short string';
  }
  if (body.kind != null && !['building', 'campus'].includes(body.kind)) {
    return 'kind must be building or campus';
  }
  return null;
}

// bbox and ground area, stamped at write time so a stored shape carries the
// same derived properties footprints.py computes for the pipeline's own.
export function footprintProps(geom) {
  const rings = fpRings(geom) || [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, m2 = 0;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const r of rings) {
    for (const pt of r) {
      if (pt[0] < w) w = pt[0];
      if (pt[0] > e) e = pt[0];
      if (pt[1] < s) s = pt[1];
      if (pt[1] > n) n = pt[1];
    }
  }
  for (const poly of polys) {
    poly.forEach((r, i) => {
      let a = 0, lat = 0;
      for (let j = 0; j < r.length - 1; j++) {
        a += r[j][0] * r[j + 1][1] - r[j + 1][0] * r[j][1];
        lat += r[j][1];
      }
      lat /= Math.max(1, r.length - 1);
      const m = Math.abs(a / 2) * 111320 * 111320 * Math.cos(lat * Math.PI / 180);
      m2 += i === 0 ? m : -m;
    });
  }
  const rnd = (v) => Math.round(v * 1e6) / 1e6;
  return { bbox: [rnd(w), rnd(s), rnd(e), rnd(n)], m2: Math.round(Math.max(m2, 0)) };
}

export function appendFootprintOverride(dataDir, feature) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(footprintOverridesPath(dataDir), JSON.stringify(feature) + '\n');
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
