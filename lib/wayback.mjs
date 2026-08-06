// ArcGIS Wayback — dated snapshots of the same World Imagery the map already
// draws. 195 releases between 2014-02-20 and 2026-06-30, 12-19 a year.
//
// WHY THIS AND NOT ANOTHER TILE SOURCE
// The site page already had a land-change section, and it ran on screenshots
// somebody remembered to take. Wayback is the same picture from the same
// sensor programme at every date, which is the difference between "here are
// some images of this place" and a series you can actually read a build-out
// off. A data centre that appears between two frames is a construction date
// the registry has no other way to observe.
//
// WHAT IT COSTS
// The imagery is World Imagery, so it carries the same Esri Master License
// Agreement the basemap panel already declares. Using Wayback does not make
// that question worse and does not escape it either.
//
// THE ONE NON-OBVIOUS PART
// A release is a snapshot of the WHOLE WORLD, but almost none of the world
// changes between two of them. Ask for a tile from all 195 releases and you
// get the same handful of pictures over and over - at Quincy, 195 releases
// are 14 actual captures. So the releases are sieved before they reach the
// UI, using the service's own tilemap endpoint:
//
//   .../tilemap/{release}/{z}/{y}/{x}/1/1
//   -> { data: [1], select: [10], ... }
//
// `select` names the release the tile is really served FROM. Present means
// this release inherited the tile and has nothing new to show; absent means
// this release is where that picture entered the archive. Keep the second
// kind and a 195-step slider becomes a 14-step one, every step a new photo.

const CONFIG_URL =
  'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const TILEMAP =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/world_imagery/wmts' +
  '/1.0.0/default028mm/MapServer/tilemap';

// Tiles are loaded straight from Esri by the browser in plain <img> tags, so
// they need no CORS and no proxy. Exported for the page to build its own URLs.
export const TILE_BASE =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS' +
  '/1.0.0/default028mm/MapServer/tile';

// 17 is ~1.2 m/px at the equator: a data centre hall is tens of pixels across
// and a new building between two frames is unmistakable. Going finer would
// narrow the frame past the campus and start finding dates where the archive
// has none.
export const ZOOM = 17;

// Enough upstream requests are in flight to keep the scan under a few seconds,
// few enough not to look like an attack. The scan is 195 requests either way.
const WORKERS = 12;

export function tileXY(lat, lon, z = ZOOM) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
    z,
  };
}

let releasesPromise = null;

// [{ release, date }] oldest first. Fetched once per process: the archive
// gains a release every few weeks, so a long-lived cache is not staleness, it
// is the correct shape of the data.
function releases() {
  if (releasesPromise) return releasesPromise;
  releasesPromise = (async () => {
    const r = await fetch(CONFIG_URL);
    if (!r.ok) throw new Error(`waybackconfig ${r.status}`);
    const cfg = await r.json();
    const out = [];
    for (const item of Object.values(cfg)) {
      const date = (item.itemTitle || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
      const release = (item.itemURL || '').match(/\/tile\/(\d+)\//)?.[1];
      if (date && release) out.push({ release: +release, date });
    }
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!out.length) throw new Error('waybackconfig parsed to nothing');
    return out;
  })().catch((err) => {
    // Do not cache a failure: a transient network error at startup would
    // otherwise disable the feature for the life of the process.
    releasesPromise = null;
    throw err;
  });
  return releasesPromise;
}

async function pool(items, worker, limit = WORKERS) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

const cache = new Map();   // `${z}/${x}/${y}` -> [{ release, date }]

// The distinct captures over one tile, oldest first. In-memory only: 195
// upstream requests take a couple of seconds, which is worth doing once per
// tile per process but not once per page view. Sites in the same building
// share a tile and therefore share the scan.
export async function captures(lat, lon, z = ZOOM) {
  const { x, y } = tileXY(lat, lon, z);
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);

  const rels = await releases();
  const probed = await pool(rels, async (rel) => {
    try {
      const r = await fetch(`${TILEMAP}/${rel.release}/${z}/${y}/${x}/1/1`);
      if (!r.ok) return null;
      const j = await r.json();
      if (!j.data?.[0]) return null;               // no imagery here at all
      // Absent `select` means this release is the source of the tile.
      return { ...rel, from: j.select?.[0] ?? rel.release };
    } catch {
      return null;
    }
  });

  const seen = new Set();
  const out = [];
  for (const p of probed) {
    if (!p || seen.has(p.from)) continue;
    seen.add(p.from);
    out.push({ release: p.release, date: p.date });
  }
  cache.set(key, out);
  return out;
}
