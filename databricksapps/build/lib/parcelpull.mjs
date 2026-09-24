// One parcel, on demand, from a vendor the user chose - the button form of
// src/parcels_regrid.py and src/parcels_precisely.py.
//
// The bulk scripts exist for sweeps; this exists because a trial quota of 25
// results a day is better spent on the exact site somebody is looking at than
// on the first 25 rows of a target list. Same caches, same output files, same
// schema - a parcel pulled from the button is indistinguishable from one the
// sweep fetched, the Python day-counter counts it (cache mtimes), and neither
// side ever re-asks what the other already asked. THE CACHE DIRS ARE THE
// SHARED LEDGER; keep both languages writing the same records.
//
// Tokens are read fresh on every pull rather than held: they live in
// data/raw/ (gitignored) and the user may add or rotate them while the
// server runs.

import fs from 'node:fs';
import path from 'node:path';

const UA = { 'User-Agent': 'reinsurance_dc-research/1.0' };

// Even-odd containment, the same rule every parcel source in this project
// uses: the parcel CONTAINING the dot or nothing.
function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}
function contains(geom, lon, lat) {
  let inside = 0;
  for (const ring of ringsOf(geom)) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
    if (c) inside++;
  }
  return inside % 2 === 1;
}

async function pullRegrid(rawDir, lon, lat) {
  const tokFile = path.join(rawDir, 'regrid_token.txt');
  if (!fs.existsSync(tokFile)) throw new Error('no Regrid token in data/raw/regrid_token.txt');
  const tok = fs.readFileSync(tokFile, 'utf8').trim();
  const u = new URL('https://app.regrid.com/api/v2/parcels/point');
  // return_matched_buildings is Regrid's default when the account carries the
  // buildings add-on, but it is spelled out because the answer matters: the
  // buildings arrive as a top-level FeatureCollection IN THE SAME BILLED
  // RESPONSE as the parcel. Discarding them was the parcelfields.mjs mistake
  // again - data already paid for, recoverable only by paying twice.
  u.search = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6),
                                   limit: '1', token: tok,
                                   return_matched_buildings: 'true' });
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(`Regrid answered HTTP ${r.status}`);
  const fc = await r.json();
  // Kept whole, matched to nothing: with limit 1 every building returned
  // belongs to the one parcel returned. Accounts without the add-on simply
  // have no `buildings` key, and the pull behaves exactly as before.
  const bldgs = ((fc.buildings || {}).features || [])
    .filter((b) => b && b.geometry)
    .map((b) => ({ geometry: b.geometry, attrs: b.properties || {} }));
  for (const f of (fc.parcels || fc).features || []) {
    if (!f.geometry || !contains(f.geometry, lon, lat)) continue;
    const props = f.properties || {};
    const fields = props.fields || props;
    // KEEP EVERY FIELD. This used to store four and discard the rest, which
    // was throwing away data already paid for: Regrid bills per parcel
    // returned and never re-asks about a cached one, so a dropped field could
    // only be recovered by buying the same parcel a second time. The four
    // short names stay on top because the rest of the app reads them by those
    // names; `fields` carries everything the county actually said.
    return { geometry: f.geometry, attrs: {
      ref: fields.parcelnumb || props.ll_uuid || '',
      owner: fields.owner || '',
      locality: [fields.county, fields.state2].filter(Boolean).join(', '),
      acres: fields.ll_gisacre || fields.gisacre || '',
      ...fields,
    }, buildings: bldgs.length ? bldgs : undefined };
  }
  return null;
}

// The French national cadastre, through IGN's API Carto - the one vendor here
// that is FREE and unauthenticated (Etalab Licence Ouverte 2.0). France only:
// outside it the service simply has no parcels, and the answer is empty.
// Same containment rule, same cache dirs, same output schema as the paid two,
// so a cadastre parcel is indistinguishable downstream from a bought one.
async function pullCadastre(lon, lat) {
  const u = new URL('https://apicarto.ign.fr/api/cadastre/parcelle');
  u.search = new URLSearchParams({ geom: JSON.stringify(
    { type: 'Point', coordinates: [+lon.toFixed(6), +lat.toFixed(6)] }) });
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(`IGN cadastre answered HTTP ${r.status}`);
  const fc = await r.json();
  for (const f of fc.features || []) {
    if (!f.geometry || !contains(f.geometry, lon, lat)) continue;
    const a = f.properties || {};
    return { geometry: f.geometry, attrs: {
      // idu is the national parcel identifier (dept + commune + section + no).
      ref: a.idu || [a.section, a.numero].filter(Boolean).join(' ') || '',
      owner: '',        // the cadastre publishes geometry, never ownership
      locality: [a.nom_com, 'FR'].filter(Boolean).join(', '),
      // contenance is m2; acres keeps the shared schema every reader expects.
      acres: a.contenance ? Math.round(a.contenance / 4046.8564 * 100) / 100 : '',
      ...a,
    } };
  }
  return null;
}

let disToken = null;   // { tok, until } - Precisely bearers live an hour

async function pullPrecisely(rawDir, lon, lat) {
  const keyFile = path.join(rawDir, 'precisely_key.txt');
  if (!fs.existsSync(keyFile)) throw new Error('no Precisely key in data/raw/precisely_key.txt');
  if (!disToken || disToken.until < Date.now() + 60_000) {
    const cred = fs.readFileSync(keyFile, 'utf8').trim();
    const r = await fetch('https://api.cloud.precisely.com/auth/v2/token', {
      method: 'POST', body: 'grant_type=client_credentials&scope=default',
      headers: { ...UA, Authorization: 'Basic ' + Buffer.from(cred).toString('base64'),
                 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!r.ok) throw new Error(`Precisely token mint answered HTTP ${r.status}`);
    const out = await r.json();
    disToken = { tok: out.access_token, until: Date.now() + (out.expires_in || 3600) * 1000 };
  }
  const d = 0.0002;
  const u = new URL('https://api.cloud.precisely.com/v1/ogcapi/enrich'
                    + '/collections/properties/parcels/items');
  u.search = new URLSearchParams({
    bbox: `${lon - d},${lat - d},${lon + d},${lat + d}`, limit: '5' });
  const r = await fetch(u, { headers: { ...UA, Authorization: 'Bearer ' + disToken.tok } });
  if (!r.ok) throw new Error(`Precisely answered HTTP ${r.status}`);
  const fc = await r.json();
  for (const f of fc.features || []) {
    if (!f.geometry || !contains(f.geometry, lon, lat)) continue;
    const a = f.properties || {};
    return { geometry: f.geometry, attrs: {
      ref: a.parcel_apn || a.prclid || '',
      fips: a.fips || '',
      acres: a.area ? Math.round(a.area / 43560 * 100) / 100 : '',
    } };
  }
  return null;
}

// Rebuild the vendor's geojson from its cache dir - a byte-for-byte port of
// the Python write_out()s, because both write the same file and the schema
// must not fork by language.
// The parcel's situs address as the county has it - Regrid's `address` is
// the situs, not the owner's mailing address (`mailadd`). Same composition
// as situs() in src/parcels_regrid.py; the two writers must agree, which is
// why neither re-cases anything: "LBJ FWY" stays as the county wrote it.
function situs(a) {
  const street = String(a.address || '').trim();
  if (!street) return '';
  const tail = [a.state2, a.szip].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  return [street, String(a.scity || '').trim(), tail].filter(Boolean).join(', ');
}

function writeOut(vendor, rawDir) {
  const cacheDir = path.join(rawDir, `parcels_${vendor}_cache`);
  const feats = [];
  for (const name of fs.readdirSync(cacheDir).sort()) {
    if (!name.endsWith('.json')) continue;
    const hit = JSON.parse(fs.readFileSync(path.join(cacheDir, name), 'utf8'));
    if (!hit || !hit.geometry) continue;
    const sid = name.slice(0, -5);
    const a = hit.attrs || {};
    feats.push(vendor === 'regrid'
      ? { type: 'Feature', geometry: hit.geometry, properties: {
          id: `regrid-${a.ref || sid}`, src: 'regrid', grp: hit.grp || 'new',
          op: a.owner || '', ref: a.ref || '', locality: a.locality || 'US',
          acres: String(a.acres ?? ''), for_site: sid, address: situs(a) } }
      : vendor === 'cadastre'
      ? { type: 'Feature', geometry: hit.geometry, properties: {
          id: `cadastre-${a.ref || sid}`, src: 'cadastre', grp: hit.grp || 'new',
          op: '', ref: a.ref || '', locality: a.locality || 'FR',
          acres: String(a.acres ?? ''), for_site: sid } }
      : { type: 'Feature', geometry: hit.geometry, properties: {
          id: `precisely-${sid}`, src: 'precisely', grp: hit.grp || 'new',
          op: a.owner || '', ref: a.ref || '', locality: a.fips || 'US',
          acres: String(a.acres ?? ''), for_site: sid } });
  }
  const dest = path.join(rawDir, `parcels_${vendor}.geojson`);
  fs.writeFileSync(dest, JSON.stringify({ type: 'FeatureCollection', features: feats }));
  return dest;
}

// The one entry point. Returns { parcel: Feature|null, cached: boolean };
// regenerates the vendor file only when something new actually arrived.
// CACHE POLICY, AND WHY AN EMPTY ANSWER IS NOT WORTH KEEPING
//
// This used to return whatever was on disk, unconditionally, including a
// cached "{}". That made pressing the button a lookup of our own past
// behaviour rather than a question to the vendor - and it was protecting a
// budget that an empty answer never spends. Regrid bills per parcel RECORD
// RETURNED: no record, no charge. So caching an empty saved nothing and hid
// every parcel a county has added since.
//
//   empty on disk  -> always ask again. Free, and the only way to find new
//                     coverage. Colstrip sat on a cached "no parcel contains
//                     this point" while its county, Rosebud MT, had been
//                     refreshed and holds 11,125 parcels.
//   a parcel on disk -> serve it. Re-asking costs money and returns the same
//                     record unless the county has been refreshed since, so
//                     the caller is told the county's refresh date and can
//                     force it deliberately.
// `at` aims the question at a clicked spot instead of the site's dot. The
// cache still keys by site - the answer is THE PARCEL FOR THIS SITE - with
// two billing-honest rules: a spot inside the parcel already held is the same
// question, served from cache for free; and an aimed ask that comes back
// empty never erases a held parcel, because a mis-click on a road must not
// destroy a record already paid for.
export async function pullParcel(vendor, sid, lon, lat, rawDir, grp,
                                 { force = false, counties = null, at = null } = {}) {
  const cacheDir = path.join(rawDir, `parcels_${vendor}_cache`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${sid}.json`);
  const feature = (hit) => (hit && hit.geometry
    ? { type: 'Feature', geometry: hit.geometry,
        properties: { src: vendor, grp: hit.grp || grp, for_site: sid, ...(hit.attrs || {}) } }
    : null);

  let cached = null;
  if (fs.existsSync(cacheFile)) {
    try { cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cached = null; }
  }
  const hadParcel = !!(cached && Object.keys(cached).length && cached.geometry);

  const sameQuestion = !at
    || (hadParcel && contains(cached.geometry, at.lon, at.lat));
  if (hadParcel && !force && sameQuestion) {
    const county = countyOf(cached.attrs, counties);
    // Records written before `fetched` existed still know when they were
    // asked: that is exactly what the cache file's mtime means. Reading it is
    // safe - it is WRITING mtime that the Python day-counter depends on.
    let fetched = cached.fetched || null;
    if (!fetched) {
      try { fetched = fs.statSync(cacheFile).mtime.toISOString(); } catch { /* keep null */ }
    }
    return {
      parcel: feature(cached), cached: true,
      buildings: bFeatures(cached),
      fetched,
      county: county || null,
      // The one fact that says whether paying again could return anything
      // different. Null when the county cannot be identified from the record.
      stale: county && fetched
        ? county.last_refresh > fetched.slice(0, 10)
        : null,
    };
  }

  const qLon = at ? at.lon : lon, qLat = at ? at.lat : lat;
  const hit = vendor === 'regrid'
    ? await pullRegrid(rawDir, qLon, qLat)
    : vendor === 'cadastre'
    ? await pullCadastre(qLon, qLat)
    : await pullPrecisely(rawDir, qLon, qLat);
  if (hit) {
    hit.grp = grp;
    // Stamped inside the record, not taken from the file's mtime: the Python
    // day-counter in src/parcels_regrid.py reads mtimes to enforce the daily
    // quota, so mtime means "when we last asked" and must stay that.
    hit.fetched = new Date().toISOString().slice(0, 19) + 'Z';
  }
  if (hit || !hadParcel) fs.writeFileSync(cacheFile, JSON.stringify(hit || {}));
  if (hit) writeOut(vendor, rawDir);
  const county = hit ? countyOf(hit.attrs, counties) : null;
  return {
    parcel: feature(hit), cached: false, refetched: hadParcel || (cached !== null),
    buildings: bFeatures(hit),
    fetched: hit ? hit.fetched : null, county: county || null, stale: false,
  };
}

// The matched buildings a Regrid record carries, as plain Features - or
// undefined, which the JSON response simply omits. A record with none is most
// records: every parcel cached before buildings were kept, every account
// without the add-on, and both other vendors.
function bFeatures(rec) {
  if (!rec || !Array.isArray(rec.buildings) || !rec.buildings.length) return undefined;
  return rec.buildings.map((b) => (
    { type: 'Feature', geometry: b.geometry, properties: b.attrs || {} }));
}

// Match a parcel's own county/state against the verse table. County names are
// unique within a state, so name+state is a safe key and avoids needing a FIPS
// lookup for records that predate keeping the full field set.
function countyOf(attrs, counties) {
  if (!attrs || !counties) return null;
  let name = String(attrs.county || '').trim().toLowerCase();
  let st = String(attrs.state2 || '').trim().toUpperCase();
  // Records fetched before the full field set was kept have neither, only a
  // joined "dallas, TX" under `locality`. Splitting it back is what lets the
  // county-refresh check work on the parcels already on disk, which is most of
  // them.
  if ((!name || !st) && attrs.locality) {
    const parts = String(attrs.locality).split(',').map((x) => x.trim());
    if (parts.length >= 2) {
      name = name || parts[0].toLowerCase();
      st = st || parts[parts.length - 1].toUpperCase();
    }
  }
  if (!name || !st) return null;
  for (const [geoid, c] of Object.entries(counties)) {
    if (c.state === st && String(c.county || '').trim().toLowerCase() === name) {
      return { geoid, ...c };
    }
  }
  return null;
}
