// Dropped points: the registry's drafting table.
//
// Everything else here arrives from a pipeline - OSM, PeeringDB, Epoch,
// EIA-860M, GEM, a filed interconnection queue. That is the right default and
// it has one gap: somebody looking at imagery who KNOWS there is a data centre
// at a coordinate has had nowhere to put that knowledge except a CSV edited by
// hand and a full rebuild.
//
// So a point is a claim before it is a record. Drop the marker, get an id and
// a page, pull the parcel, trace the outline, and say what the thing IS. Until
// a kind is chosen it is a pin with a coordinate and no opinion; once chosen,
// the page renders as that kind and the point is ready to be folded into the
// source its kind belongs to.
//
// WHY POINTS ARE NOT WRITTEN STRAIGHT INTO THE REAL FILES. facilities_sites.csv
// is generated - a row typed into it survives until the next dedupe run and no
// longer. The hand-authored equivalent is data/manual_sites.csv, which is a
// SOURCE the pipeline folds in (see src/manual.py). A point promotes into that
// file, not into the derived one, and it keeps its own page until a build has
// actually given it a site_id. Anything else would show a dot that vanishes on
// the next run.

export const POINT_ID_RE = /^pt-[a-z0-9][\w-]{0,40}$/;

// What a dropped point can turn out to be, and the few things worth typing for
// each. Deliberately short lists: this is the moment of capture, not a full
// record, and every one of these fields is editable later on the real page.
export const POINT_KINDS = {
  datacentre: {
    label: 'Data centre',
    blurb: 'Promotes into data/manual_sites.csv, which src/manual.py folds into '
         + 'the dedupe chain — so it gets a stable site_id and a /site page.',
    fields: {
      name:      { label: 'Name' },
      operator:  { label: 'Operator', suggest: 'operator' },
      address:   { label: 'Address' },
      city:      { label: 'City', suggest: 'city' },
      country:   { label: 'Country', suggest: 'country', hint: 'ISO 3166-1 alpha-2, e.g. US' },
      facility_type: { label: 'Type', options: ['', 'traditional', 'ai'] },
      status:    { label: 'Status', options: ['', 'operational', 'under_construction', 'proposed'] },
      power_mw:  { label: 'Power, MW', hint: 'number' },
    },
  },
  fab: {
    label: 'Semiconductor fab',
    blurb: 'The fab layer is hand-assembled already (src/fabs.py); a promoted '
         + 'point joins it with its source recorded.',
    fields: {
      name:     { label: 'Name' },
      operator: { label: 'Operator', suggest: 'fab_op' },
      place:    { label: 'Place' },
      country:  { label: 'Country', suggest: 'country', hint: 'ISO 3166-1 alpha-2' },
      nm:       { label: 'Process node, nm', hint: 'number' },
      power_mw: { label: 'Power, MW', hint: 'number' },
    },
  },
  plant: {
    label: 'Power plant',
    blurb: 'The plant layer is EIA-860M and GEM. A hand-added plant is one '
         + 'neither carries yet — a permit filed, a turbine on the pad — so it '
         + 'says so on its face rather than pretending to be an inventory row.',
    fields: {
      name:     { label: 'Name' },
      owner:    { label: 'Owner' },
      fuel:     { label: 'Fuel', options: ['', 'gas', 'coal', 'nuclear', 'hydro',
                                           'wind', 'solar', 'oil', 'geothermal',
                                           'biomass', 'storage', 'other'] },
      mw:       { label: 'Capacity, MW', hint: 'number' },
      status:   { label: 'Status', options: ['', 'op', 'pl', 'ret'] },
    },
  },
  substation: {
    label: 'Substation',
    blurb: 'Substations are otherwise named by filings and placed from '
         + 'OpenStreetMap. A hand-placed one is how the 27 that OSM does not '
         + 'carry by name get onto the map at all.',
    fields: {
      name:     { label: 'Name' },
      operator: { label: 'Operator' },
      kv:       { label: 'Highest voltage, kV', hint: 'number' },
    },
  },
};

export const kindLabel = (k) => (POINT_KINDS[k] ? POINT_KINDS[k].label : '');

const NUMERIC = new Set(['power_mw', 'mw', 'kv', 'nm']);

// One complaint list, same contract as the other ledgers here: a bad point
// must never cost the registry the good ones.
export function pointErrors(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['not an object'];
  if (!POINT_ID_RE.test(p.id || '')) bad.push(`id ${JSON.stringify(p.id)} is not a point id`);
  for (const k of ['lat', 'lon']) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) { bad.push(`${k} must be a number`); continue; }
    if (k === 'lat' && (v < -90 || v > 90)) bad.push('latitude out of range');
    if (k === 'lon' && (v < -180 || v > 180)) bad.push('longitude out of range');
  }
  if (p.kind && !POINT_KINDS[p.kind]) bad.push(`kind ${JSON.stringify(p.kind)}`);
  if (p.fields && typeof p.fields !== 'object') bad.push('fields must be an object');
  return bad;
}

// Validate one typed value against the kind's own table. Unknown fields are
// rejected rather than stored, so the ledger cannot accumulate keys nothing
// reads.
export function fieldError(kind, field, value) {
  const spec = (POINT_KINDS[kind] || {}).fields || {};
  const f = spec[field];
  if (!f) return 'not a field for this kind';
  if (typeof value !== 'string') return 'value must be a string';
  if (value.length > 300) return 'value over 300 characters';
  if (f.options && !f.options.includes(value)) {
    return `must be one of: ${f.options.filter(Boolean).join(', ')}`;
  }
  if (field === 'country' && value && !/^[A-Za-z]{2}$/.test(value)) {
    return 'country must be a two-letter ISO code';
  }
  if (NUMERIC.has(field) && value && !/^\d+(\.\d+)?$/.test(value)) {
    return 'must be a number';
  }
  return null;
}

// What the point still needs before it is worth promoting. Shown on the page
// so "ready" is a statement about the record and not a feeling.
export function readiness(p) {
  const missing = [];
  if (!p.kind) return { ready: false, missing: ['what this is'] };
  const f = p.fields || {};
  if (!(f.name || '').trim()) missing.push('a name');
  if (p.kind === 'datacentre' && !(f.country || '').trim()) missing.push('a country');
  if (p.kind === 'fab' && !(f.country || '').trim()) missing.push('a country');
  if (p.kind === 'plant' && !(f.mw || '').trim()) missing.push('a capacity');
  return { ready: missing.length === 0, missing };
}
