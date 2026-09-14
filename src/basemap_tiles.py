"""Fetch the self-hosted vector basemap: a PMTiles archive and its glyphs.

WHY THIS EXISTS. The 2D map had no city names, no state lines and no country
borders. It could not have had any: the style carried zero symbol layers, and
its only geometry was Natural Earth admin-0 - 177 country polygons, coastline
and nothing inside it. basemap.py builds a sharper 10m version that is
deliberately unused, because 3.6 MB / 189k vertices handed to MapLibre as one
GeoJSON blows the worker's structured clone ("can't serialize object of
unregistered class"). Its own docstring names the fix as pre-built tiles rather
than client-side tiling of one huge file. This is that fix.

WHY PROTOMAPS. It is the only OpenStreetMap basemap distributed as a single
addressable file, which is what lets this stay a folder you can copy. A hosted
vector tile provider would work and would need an API key, an account and a
network the app currently does not require of anyone. Google publishes no
vector tiles to third-party renderers at all; server.mjs already records that
their terms forbid re-serving what they do publish.

WHY ZOOM 9. The planet is 137 GB at z15 and each level down roughly halves it.
Measured against the real archive with `pmtiles extract --dry-run`:

    z0-z7   187 MB      z0-z9   1.5 GB
    z0-z8   551 MB      z0-z10  3.7 GB

Boundaries are complete at every level - they are drawn from z0 - so the zoom
ceiling only buys LABEL DENSITY and line detail. z8 carries cities; z9 reaches
the towns that most of this registry actually sits next to, which is the whole
point, since a data centre is rarely in the city it is named after. z10 nearly
triples the file to add village names nobody is looking for. Past the ceiling
MapLibre overzooms, and that costs nothing for labels: a point renders at the
style's size whatever zoom its tile came from. Only boundary lines soften, over
satellite imagery that is already carrying the detail.

WHY THE GLYPHS ARE HERE. Text needs signed-distance-field glyph ranges, and the
style asked demotiles.maplibre.org for them - MapLibre's DEMO server, which
nothing should depend on and which this app was never actually using, having no
symbol layers to spend them on. Self-hosting a basemap while sourcing its
lettering from someone's demo host would be a strange place to stop.

One font per stack, deliberately. MapLibre concatenates a multi-font text-font
into a single "A,B" request that only a server able to COMPOSE ranges can
answer; a static file server 404s it and the labels vanish. Two separate
single-font stacks give the same weight range with no server to write.

Neither output is tracked - both are large and both are exactly what this
script exists to reproduce. `pmtiles extract` streams from the remote archive
over range requests, so this costs the extract's size, not the planet's.
"""

from __future__ import annotations

import concurrent.futures
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
TILES = RAW / "basemap.pmtiles"
GLYPHS = RAW / "glyphs"

BUILDS = "https://build-metadata.protomaps.dev/builds.json"
BUILD_BASE = "https://build.protomaps.com/"
FONT_BASE = "https://protomaps.github.io/basemaps-assets/fonts"

MAXZOOM = 9
FONTSTACKS = ("Noto Sans Regular", "Noto Sans Medium")
RANGES = [(i * 256, i * 256 + 255) for i in range(256)]
UA = {"User-Agent": "reinsurance_dc-research/1.0"}


def latest_build() -> str:
    """Newest daily build key, e.g. 20260818.pmtiles."""
    req = urllib.request.Request(BUILDS, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        builds = json.load(r)
    # The list is oldest-first, but sort rather than trust that: a wrong pick
    # here is a silently stale planet, which looks exactly like a correct one.
    return max(builds, key=lambda b: b["uploaded"])["key"]


def fetch_tiles() -> None:
    if TILES.exists():
        print(f"{TILES.relative_to(ROOT)} exists ({TILES.stat().st_size / 1e9:.1f} GB), skipping")
        return
    if not shutil.which("pmtiles"):
        sys.exit("pmtiles CLI not found - `brew install pmtiles` "
                 "(or grab a release from github.com/protomaps/go-pmtiles)")
    key = latest_build()
    print(f"extracting z0-z{MAXZOOM} from {key} ...")
    # Straight to the destination. An interrupted extract leaves a file with no
    # header, which `pmtiles show` rejects loudly - better than a half archive
    # that reads as whole.
    subprocess.run(["pmtiles", "extract", BUILD_BASE + key, str(TILES),
                    f"--maxzoom={MAXZOOM}", "--download-threads=8"], check=True)
    print(f"wrote {TILES.relative_to(ROOT)}  ({TILES.stat().st_size / 1e9:.1f} GB)")


def fetch_glyph(stack: str, lo: int, hi: int) -> int:
    out = GLYPHS / stack / f"{lo}-{hi}.pbf"
    if out.exists():
        return out.stat().st_size
    url = f"{FONT_BASE}/{urllib.parse.quote(stack)}/{lo}-{hi}.pbf"
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r:
            blob = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return 0
        raise
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    return len(blob)


def fetch_glyphs() -> None:
    # Empty ranges are kept, not skipped. They come back as ~29-byte stubs, and
    # a stub answers the request MapLibre makes for any character outside the
    # font; a 404 in its place is a console error on every pan.
    for stack in FONTSTACKS:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            sizes = list(pool.map(lambda r: fetch_glyph(stack, *r), RANGES))
        got = [s for s in sizes if s]
        print(f"  {stack}: {len(got)}/{len(RANGES)} ranges, {sum(got) / 1e6:.1f} MB")


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    fetch_glyphs()
    fetch_tiles()


if __name__ == "__main__":
    main()
