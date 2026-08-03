# dcmap

The map and per-site pages for the data centre registry.

## Run it

```
cd dcmap && npm install && npm start      # http://localhost:8787
```

That works from a fresh clone of this repo. Nothing else is required.

## Where the data comes from

`src/*.py` in the parent repo generates it; this app only renders it. There is
one copy, in `data/`, and the app reads it in place.

Two exceptions exist, both because a dependency lives outside this repo:

| what | why | refresh with |
|---|---|---|
| `data/wm/*.json` | the zone layers come from `worldmonitor`, a **separate git repo**. Nothing of it is tracked here, so its five configs are vendored as JSON. | `node dcmap/vendor-wm.mjs` |
| `dcmap/data/` | a copy of everything the app reads, so this folder runs when detached from the repo. Gitignored. | `node dcmap/bundle.mjs` |

Both resolve **live-source-first**: if the repo's `data/` is present it wins over
the bundle, and if `worldmonitor/` is checked out it wins over the vendored
JSON. So a copy is only ever read when the original is absent, and nobody
working in the monorepo can be looking at a stale one without noticing.

## Deploy it standalone

```
node dcmap/bundle.mjs
rsync -a --exclude node_modules dcmap/ user@host:/srv/dcmap/
ssh user@host 'cd /srv/dcmap && npm install --omit=dev && npm start'
```

Uploaded site imagery lands in whichever `data/` the app resolved, so a
standalone deploy keeps its uploads inside its own folder.
