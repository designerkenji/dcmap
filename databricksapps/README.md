# dcmap as a Databricks App

Phase 0 of [`../docs/databricks-apps-architecture.md`](../docs/databricks-apps-architecture.md):
the map runs behind workspace SSO, reading a Unity Catalog volume, with editing
switched off.

**Nothing in `../dcmap` is modified.** Not a line. That is the constraint this
folder is built around, and it is why the layer here sits *in front of* dcmap
rather than inside it.

## The design, and why it is this one

Three things have to change to run on Databricks Apps:

| what | why |
|---|---|
| the port | only `DATABRICKS_APP_PORT` is routed |
| the tiles | `basemap.pmtiles` is 1.6 GB; the container has no such file |
| the writes | the container's disk is discarded on restart |

None of those require editing dcmap:

- **The port** is already an environment variable dcmap reads (`PORT`), so
  `boot.mjs` sets it and dcmap listens where it is told.
- **The tiles and the writes** are things you can handle *before a request
  reaches dcmap at all*. `dbx/proxy.mjs` serves the PMTiles archives and glyph
  ranges from the volume, refuses non-GET requests, and passes everything else
  straight through.
- **The data** is staged onto local disk before dcmap starts, into exactly the
  directory it already reads. dcmap's data layer is ~60 synchronous
  `readFileSync` calls across a dozen modules; making those async would be a
  larger change than this entire app. Mirroring the volume once at boot means
  none of them change.

So dcmap is **vendored, never forked**. `build.mjs` copies it; updating to a
newer dcmap is re-running that script, not re-applying a patch to a diverged
copy.

```
       ┌──────────── build/ ─────────────────────────────┐
  →    │ boot.mjs        stage volume → start dcmap      │
:8080  │   dbx/proxy.mjs  tiles · read-only · pass-through│
       │   dbx/volume.mjs Files API                      │
       │        │ 127.0.0.1:8799                         │
       │        ▼                                        │
       │ server.mjs + lib/ + public/   ← dcmap, verbatim │
       │ data/                         ← staged at boot  │
       └─────────────────────────────────────────────────┘
```

The inner port is not routed by the platform — only `DATABRICKS_APP_PORT` is —
so it is an implementation detail of the container, not a second way in.

## Layout

```
app.yaml            start command, volume paths, read-only switch
boot.mjs            entry point: stage, start dcmap, serve the front layer
dbx/volume.mjs      Files API — OAuth, listing, staging mirror, range proxy
dbx/proxy.mjs       the front layer
build.mjs           assembles build/ from ../dcmap + this folder
.databricksignore   keeps data/ out of the upload
build/              disposable; gitignored
```

## Build

```bash
cd databricksapps && node build.mjs
```

`build/` is what gets deployed: dcmap's `server.mjs`, `lib/` and `public/`
copied verbatim, this folder's layer beside them, and an empty `data/` for the
volume to be staged into.

## Deploy

### 1. Put the data on a volume

```bash
databricks volumes create dcmap app MANAGED
```

```bash
cd dcmap && V=dbfs:/Volumes/dcmap/app
# Everything under data/ except raw/ — the derived files, data/wm, site_images,
# quake_events, review, export_underwriting. About 65 MB.
for f in data/*; do
  [ "$f" = "data/raw" ] && continue
  databricks fs cp -r --overwrite "$f" "$V/$f"
done
```

```bash
cd dcmap && V=dbfs:/Volumes/dcmap/app
# The eight files under data/raw/ the app actually reads. The rest of raw/ is
# the pipeline's own source pulls and caches — parcels_regrid_cache alone is
# 1,562 entries — and the app has never read any of it.
for f in osm_world.json osm_us_va.json osm_us_tx.json poi_evidence.json \
         ne_countries.geojson parcels_regrid.geojson \
         parcels_precisely.geojson parcels_cadastre.geojson; do
  [ -f "data/raw/$f" ] && databricks fs cp --overwrite "data/raw/$f" "$V/data/raw/$f"
done
```

```bash
cd dcmap && V=dbfs:/Volumes/dcmap/app
# The archives and glyphs — read in place by dbx/proxy.mjs, never staged.
for a in basemap water transmission; do
  [ -f "data/raw/$a.pmtiles" ] && \
    databricks fs cp --overwrite "data/raw/$a.pmtiles" "$V/data/raw/$a.pmtiles"
done
databricks fs cp -r --overwrite data/raw/glyphs "$V/data/raw/glyphs"
databricks fs cp -r --overwrite data_centers_from_EPOCH_AI "$V/epoch"
```

The basemap is 1.6 GB and takes a while. Skip it on a first deploy if you like:
every tile route 404s politely without it and the map falls back, the same way
a fresh clone behaves before `src/basemap_tiles.py` has run.

### 2. Create the app and give it the volume

Under **App resources**:

- **+ Add resource → Unity Catalog volume** → `dcmap.app` → *Read volume*.
  Without this the service principal has the path and no privilege on it, and
  staging fails at boot with a 403.
- **+ Add resource → Secret** with the resource key `google-maps-key`, if you
  want Google satellite imagery. If not, delete the last two lines of
  `app.yaml` — an unresolvable `valueFrom` fails the start.

### 3. Deploy

```bash
databricks sync --watch databricksapps/build /Workspace/Users/you@example.com/dcmap
```

A healthy start says what it staged:

```
[dbx] staged 91 file(s), 64.3 MB from /Volumes/dcmap/app/data in 4812 ms
dcmap listening on http://localhost:8799
[dbx] dcmap on :8799; serving on :8080 (volume-backed, tiles proxied)
```

## Run it locally

```bash
cd databricksapps && node build.mjs --dev
```

`--dev` symlinks `build/data`, `build/data_centers_from_EPOCH_AI` and
`build/node_modules` at dcmap's own, so the assembled app runs against real
files with no install and no 1.5 GB copy:

```bash
cd databricksapps/build && DCMAP_READONLY=1 npm start
```

With `DCMAP_VOLUME` unset the proxy is a pass-through and dcmap serves the
archives off its own disk — which is the point: a local run exercises this
folder's code rather than a different path through it.

## What Phase 0 deliberately does not do

**Editing is off.** `DCMAP_READONLY=1` makes every non-GET request return 403.
dcmap's eleven write routes all end in a file under `data/`, and here that file
is a staged copy on a disk that is discarded at the next restart — a correction
would look like it saved and be gone by morning. It lifts in Phase 1, when the
ledger moves to Lakebase Postgres.

**The edit affordances are still drawn.** The pens and the drop-a-point control
come from dcmap's own pages, and hiding them would mean modifying it. Clicking
save gets the 403 instead of nothing: honest, but not polite. It is the one
piece of Phase 0 still outstanding, and the reason it is outstanding is the
constraint at the top of this file.

**The pipeline is not here.** `/data`'s "run this step" button needs `../src`,
which is not deployed. The page reports the pipeline as unavailable, which is
already what it does anywhere the scripts are absent.

## Where the later phases go

`dbx/` is the app's own layer, and everything in Phases 1–4 belongs to it
rather than to dcmap: the Lakebase ledger, the SQL routes behind the H3 and
viewport queries, and the Genie chat endpoint with the map-action contract.
They are new routes in `dbx/proxy.mjs`, handled before the pass-through — which
is the same shape as the tile routes already there.
