// Turning a vendor parcel record into something a person can read.
//
// Regrid returns ~160 machine-named fields per parcel. Until now this app kept
// FOUR of them - ref, owner, locality, acres - and threw the rest away at fetch
// time, in both the Python puller and the in-app one. That was expensive in a
// way that is easy to miss: Regrid bills per parcel RETURNED and a cached
// parcel is never re-asked, so every discarded field was one already paid for
// and only re-obtainable by paying again.
//
// So the rule now is: STORE EVERYTHING, DISPLAY A CURATED SUBSET. Storage is
// free and a field nobody displays today is a field somebody can display
// tomorrow without spending anything.
//
// The labels below come from Regrid's published schema, not from guesswork.
// Anything not in the table still renders, under a prettified version of its
// own key - a field this file has not heard of is more useful shown than
// silently dropped, which is the mistake that created this file.

// Ordered. A parcel reads top-down: what it is, where it is, who owns it,
// what is on it, what it is worth.
export const GROUPS = [
  { key: 'identity', label: 'Parcel', fields: [
    ['parcelnumb', 'Parcel number'],
    ['alt_parcelnumb1', 'Alternate parcel no.'],
    ['state_parcelnumb', 'State parcel no.'],
    ['account_number', 'Assessor account'],
    ['tax_id', 'Tax ID'],
    ['ll_uuid', 'Regrid UUID'],
    ['path', 'Regrid path'],
    // The French cadastre's identifiers, from IGN's API Carto. idu is the
    // national parcel id; section and numero are its human-readable halves.
    ['idu', 'Parcel ID (IDU)'],
    ['section', 'Section'],
    ['numero', 'Parcel no.'],
    ['ref', 'Parcel number'],
  ] },
  { key: 'address', label: 'Address', fields: [
    ['address', 'Street address'],
    ['scity', 'City'],
    ['state2', 'State'],
    ['szip', 'ZIP'],
    ['szip5', 'ZIP'],
    ['county', 'County'],
    ['nom_com', 'Commune'],
    ['code_dep', 'Département'],
    ['code_insee', 'INSEE code'],
    ['locality', 'County'],
  ] },
  { key: 'owner', label: 'Owner', fields: [
    ['owner', 'Owner'],
    ['owner2', 'Owner (second)'],
    ['mailadd', 'Mailing address'],
    ['mail_city', 'Mailing city'],
    ['mail_state2', 'Mailing state'],
    ['mail_zip', 'Mailing ZIP'],
  ] },
  { key: 'land', label: 'Land and use', fields: [
    ['ll_gisacre', 'Area'],
    ['gisacre', 'Area'],
    ['ll_gissqft', 'Area'],
    ['acres', 'Area'],
    ['contenance', 'Area (cadastre)'],
    ['usedesc', 'Use'],
    ['usecode', 'Use code'],
    ['zoning', 'Zoning'],
    ['zoning_type', 'Zoning type'],
    ['zoning_description', 'Zoning description'],
    ['lbcs_activity_desc', 'Land-use activity'],
    ['lbcs_function_desc', 'Land-use function'],
    ['fema_flood_zone', 'FEMA flood zone'],
  ] },
  { key: 'built', label: 'Buildings', fields: [
    ['ll_bldg_count', 'Buildings'],
    ['structno', 'Structures (county)'],
    ['ll_bldg_footprint_sqft', 'Building footprint'],
    ['area_building', 'Building area'],
    ['recrdareano', 'Recorded building area'],
    ['yearbuilt', 'Year built'],
    ['year_built_effective_date', 'Effective year built'],
    ['numstories', 'Storeys'],
    ['structstyle', 'Structure type'],
    ['ll_address_count', 'Addresses on parcel'],
  ] },
  { key: 'value', label: 'Assessment', fields: [
    ['parval', 'Total assessed value'],
    ['landval', 'Land value'],
    ['improvval', 'Improvement value'],
    ['agval', 'Agricultural value'],
    ['taxamt', 'Annual tax bill'],
    ['taxyear', 'Tax year'],
    ['parvaltype', 'Valuation method'],
    ['saleprice', 'Sale price'],
    ['saledate', 'Sale date'],
  ] },
];

// Fields the app already stores under its own short names, plus the ones that
// would only ever repeat something shown elsewhere on the page.
const SKIP = new Set(['owner_short', 'geometry', 'fetched', 'gid',
                      'feuille', 'com_abs', 'code_arr', 'code_com',
                      'fields', 'ogc_fid', 'll_stable_id', 'll_stack_uuid',
                      'lat', 'lon', 'll_last_refresh', 'v', 'src', 'grp',
                      'for_site', 'id', 'op']);

const MONEY = new Set(['parval', 'landval', 'improvval', 'agval', 'taxamt', 'saleprice']);
const ACRES = new Set(['ll_gisacre', 'gisacre', 'acres']);
const SQFT = new Set(['ll_gissqft', 'll_bldg_footprint_sqft', 'area_building', 'recrdareano']);
const SQM = new Set(['contenance']);   // the cadastre measures in m\u00b2

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const n0 = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

// Values arrive as strings, as numbers, and occasionally as a number wearing a
// dollar sign. Formatting is applied by FIELD, not by sniffing the value: a
// year is four digits and so is a small dollar amount, and only the field name
// knows which it is.
export function formatValue(key, raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === 'null' || s === '0' && MONEY.has(key)) return '';
  const n = num(s);
  if (MONEY.has(key) && n != null) return '$' + n0(n);
  if (ACRES.has(key) && n != null) {
    return n < 10 ? n.toFixed(2) + ' acres' : n0(n) + ' acres';
  }
  if (SQFT.has(key) && n != null) return n0(n) + ' sq ft';
  if (SQM.has(key) && n != null) return n0(n) + ' m\u00b2';
  if (key === 'saledate' || key === 'year_built_effective_date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  }
  // ALL-CAPS county data is shouting; title-case the prose fields but leave
  // identifiers, codes and anything with a digit exactly as the county wrote
  // it, because a parcel number is not prose.
  if (/^[A-Z0-9 .,'&/()-]+$/.test(s) && /[A-Z]{3}/.test(s)
      && !/^\d/.test(s) && !['parcelnumb', 'alt_parcelnumb1', 'state_parcelnumb',
                             'account_number', 'tax_id', 'usecode', 'zoning',
                             'll_uuid', 'path'].includes(key)) {
    return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return s;
}

// "ll_bldg_footprint_sqft" -> "Ll bldg footprint sqft". Not pretty, but a
// field shown under an ugly label beats a field silently dropped.
const prettify = (k) => k.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// attrs -> [{ label, rows: [{ label, value }] }], curated groups first and
// everything else the record happens to carry under "Other".
export function describeParcel(attrs = {}) {
  const seen = new Set();
  const out = [];
  for (const g of GROUPS) {
    const rows = [];
    for (const [key, label] of g.fields) {
      if (seen.has(key)) continue;
      const v = formatValue(key, attrs[key]);
      if (!v) continue;
      // Two field names can carry the same fact (ll_gisacre and gisacre are
      // both "Area"); show the first that has a value, not both.
      if (rows.some((r) => r.label === label)) { seen.add(key); continue; }
      rows.push({ label, value: v });
      seen.add(key);
    }
    if (rows.length) out.push({ label: g.label, rows });
  }

  const rest = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (seen.has(k) || SKIP.has(k)) continue;
    const val = formatValue(k, v);
    if (!val) continue;
    rest.push({ label: prettify(k), value: val });
  }
  rest.sort((a, b) => a.label.localeCompare(b.label));
  if (rest.length) out.push({ label: 'Other', rows: rest });
  return out;
}

// How many facts a record actually carries — used to tell a reader that an old
// four-field record is thin because it was fetched before this app kept the
// rest, not because the county has nothing.
export const factCount = (attrs = {}) =>
  Object.entries(attrs).filter(([k, v]) => !SKIP.has(k) && formatValue(k, v)).length;
