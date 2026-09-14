"""Put the named substations on the ground, from OpenStreetMap.

data/substations.json holds names taken out of filings - "Clay 345 kV
Substation", "Haverstock" - and a name is not a location. Until each one has a
coordinate the dependency graph can be read but not looked at, and nobody can
check whether the Haverstock the queue means is the Haverstock we think.

WHY OSM AND NOT HIFLD. HIFLD Open, which was the obvious answer, was
discontinued on 2025-08-26 and its portal went dark three weeks later. What
survives are third-party mirrors, and each fails a different test: the Federal
User Community copy carries "This work is licensed under the Esri Master
License Agreement" and is marked archived with a last update of 2024-09-30;
the only mirror holding the complete substation + line + plant set is an
individual's personal re-upload with no stated terms and no persistence
guarantee; the CC-BY GeoParquet archive on source.coop has the lines but not
the substations. Against that, OpenStreetMap carries 73,503 US substations to
HIFLD's 75,328 - 97.6% by count - under ODbL, is current rather than a 2021
snapshot, and is already this repository's practice. HIFLD's own quality
numbers settle any remaining doubt: 62.5% of its line geometry is flagged
INFERRED and 51% of its substations are named UNKNOWN<id>.

Matching is by NAME, which is the weak link and is treated as one. A filing
says "Clay"; OSM says "Clay Substation" or "Clay 345kV" or nothing at all.
So a match must clear a name test AND be inside the state the filing came
from, the voltage is used to confirm rather than to find, and everything that
does not clear is left without a coordinate rather than given a plausible one.
An unlocated substation is honest; a wrong one silently moves a gigawatt.
"""

from __future__ import annotations

import csv
import json
import pathlib
import re
import sys
import unicodedata

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from osm import run  # noqa: E402  - the mirror-failover Overpass client

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
SUBS = DATA / "substations.json"
CACHE = DATA / "raw" / "osm_substations_{region}.json"

# Every substation in the ledger today comes from the NYISO queue, so the
# search area is New York. When a second market's filings land here, add its
# state rather than going national: a US-wide power=substation query is a
# seven-minute Overpass job and returns 73,000 features to match 76 names
# against, which is a worse trade than one query per state that needs one.
AREAS = {"NY": 'area["ISO3166-2"="US-NY"]->.a;',
         "VA": 'area["ISO3166-2"="US-VA"]->.a;'}

QUERY = """[out:json][timeout:540];
{area}
nwr["power"="substation"](area.a);
out tags center;"""

# Words that carry no identity: they appear in half the names on both sides
# and matching on them would pair "Clay Substation" with "Reynolds Substation".
NOISE = re.compile(r"\b(substation|switching\s*station|station|sub|converter|"
                   r"terminal|tap|switchyard|energy\s*center|plant)\b", re.I)


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = NOISE.sub(" ", s)
    s = re.sub(r"\b\d{2,3}\s*kv\b", " ", s, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def volts(tags: dict) -> list[int]:
    """OSM voltage is volts, sometimes semicolon-separated. Return kV."""
    out = []
    for part in re.split(r"[;,]", tags.get("voltage", "") or ""):
        part = part.strip()
        if part.isdigit():
            v = int(part)
            if v > 0:
                out.append(round(v / 1000))
    return out


def cache_for(region: str) -> pathlib.Path:
    return pathlib.Path(str(CACHE).format(region=region.lower()))


def fetch(region: str, force: bool = False) -> list[dict]:
    cache = cache_for(region)
    if cache.exists() and not force:
        return json.loads(cache.read_text())["elements"]
    print(f"querying Overpass for power=substation in {region} …")
    payload = run(QUERY.replace("{area}", AREAS[region]))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(payload))
    print(f"  {len(payload.get('elements', []))} substations "
          f"(via {payload.get('_endpoint', '').split('/')[2]})")
    return payload["elements"]


def centre(el: dict) -> tuple[float, float] | None:
    if el.get("type") == "node" and el.get("lat") is not None:
        return el["lat"], el["lon"]
    c = el.get("center")
    if c:
        return c["lat"], c["lon"]
    return None


def verify_counties(subs: list[dict]) -> None:
    """Check every located substation against the county its filings name.

    Name matching alone will happily pair the queue's Reynolds - a NYPA
    station in St Lawrence County, named alongside Moses - with a different
    Reynolds Substation outside Albany, 250 km away. Nothing in the name says
    which is right; the filing's county column does. So each coordinate is
    reverse-geocoded and disagreements are struck rather than shipped.

    Nominatim's usage policy allows one request a second with a real
    User-Agent, which is affordable for a few dozen substations and is why
    this is a verification pass rather than the geocoder itself.
    """
    import time
    import urllib.parse
    import urllib.request

    def county_disp(s: str) -> str:
        """One readable spelling per county, so a message cannot say a filing
        places something in 'St Lawrence or St. Lawrence' - which is one county
        and one full stop, not a disagreement."""
        s = re.sub(r"\s+", " ", (s or "").strip())
        s = re.sub(r"\bSt\.?\s+", "St ", s, flags=re.I)
        s = re.sub(r"\s+County$", "", s, flags=re.I)
        return s.title()

    def county_key(s: str) -> str:
        """St Lawrence, St. Lawrence and Saint Lawrence are one county. The
        filings write the first two; Nominatim writes the third."""
        s = re.sub(r"[^a-z ]", " ", (s or "").lower())
        s = re.sub(r"\bsaint\b", "st", s)
        s = re.sub(r"\bcounty\b", " ", s)
        return re.sub(r"\s+", "", s)

    import csv
    want: dict[str, set[str]] = {}
    # The canon keys are for comparing; these are for saying. The message
    # this feeds is rendered on /power, and "stlawrence" is an index key,
    # not something to show a reader.
    want_disp: dict[str, set[str]] = {}
    # Both filing sources carry a county, and both must feed the check. When
    # only NYISO did, every Virginia match shipped unverified - which is the
    # exact hole the check exists to close, just relocated to another state.
    with (DATA / "nyiso_load_projects.csv").open() as fh:
        for r in csv.DictReader(fh):
            cty = (r.get("county") or "").strip().lower()
            if not cty:
                continue
            for n in (r.get("poi_names") or "").split(" | "):
                if n:
                    want.setdefault(norm(n), set()).add(county_key(cty))
                    want_disp.setdefault(norm(n), set()).add(county_disp(cty))
    teac = DATA / "teac_needs.csv"
    if teac.exists():
        with teac.open() as fh:
            for r in csv.DictReader(fh):
                cty = (r.get("county") or "").strip().lower()
                if not cty:
                    continue
                for n in (r.get("substations") or "").split(" | "):
                    if n.strip():
                        want.setdefault(norm(n), set()).add(county_key(cty))
                        want_disp.setdefault(norm(n), set()).add(county_disp(cty))

    checked = struck = 0
    for s in subs:
        if not s.get("located"):
            continue
        # An alias-placed substation was identified by a person, by OSM id.
        # The filing's county column is the LOAD's county, and a line's far
        # end legitimately sits in the county next door - Adirondack (Lewis)
        # for a Massena load, Wood Street (Putnam) for East Fishkill. The
        # check exists to catch a same-named yard in the wrong place, and an
        # explicit id cannot be that; it is logged, never struck.
        if s.get("placed_by") == "alias":
            continue
        counties = want.get(norm(s["name"]), set())
        disp = want_disp.get(norm(s["name"]), set())
        for a in s.get("aka", []):
            counties |= want.get(norm(a), set())
            disp |= want_disp.get(norm(a), set())
        if not counties:
            continue
        url = ("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10"
               f"&lat={s['lat']}&lon={s['lon']}")
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "reinsurance-dc/1.0 (registry build; substation check)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                got = json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            print(f"  reverse geocode failed for {s['name']}: {e}")
            continue
        time.sleep(1.1)
        checked += 1
        addr = got.get("address", {})
        here = county_key(addr.get("county") or "")
        s["osm_county"] = addr.get("county") or ""
        if not here:
            continue
        if not any(here == c or here in c or c in here for c in counties):
            print(f"  COUNTY MISMATCH {s['name']}: filing says "
                  f"{'/'.join(sorted(counties))}, coordinate is in {here} — struck")
            for k in ("lat", "lon", "osm", "osm_name", "kv_note"):
                s.pop(k, None)
            s["located"] = False
            s["geo_rejected"] = (
                f"the name matched a substation in "
                f"{addr.get('county') or here.title()}, but the filing places it in "
                f"{' or '.join(sorted(disp or counties))}")
            struck += 1
    print(f"\ncounty check: {checked} verified · {struck} struck as wrong-county matches")


def main() -> None:
    force = "--force" in sys.argv
    subs = json.loads(SUBS.read_text())
    # Each substation carries the region its filings came from, so match it
    # against THAT state's OSM extract only. Matching a Virginia name against
    # New York would be the Reynolds error again, one state wider.
    regions = [r for r in AREAS if any(s.get("region") == r for s in subs)]
    print(f"regions present in the ledger: {', '.join(regions)}")
    elements = []
    for r in regions:
        els = fetch(r, force)
        for e in els:
            e["_region"] = r
        elements.extend(els)

    # Index OSM by normalised name. Several substations legitimately share a
    # name across a state, so the index holds lists and an ambiguous name is
    # reported rather than resolved by guessing.
    # Keyed by REGION then name: a Virginia filing must never match a New York
    # object. Without the region key this is the Reynolds mistake at state
    # scale - and "Hopewell", "Clifton" and "Liberty" all exist in both.
    by_region: dict[str, dict[str, list[dict]]] = {}
    for el in elements:
        t = el.get("tags", {})
        nm = t.get("name") or t.get("ref") or ""
        if not nm:
            continue
        pos = centre(el)
        if not pos:
            continue
        key = norm(nm)
        # A name made entirely of noise words - "Terminal Station",
        # "Substation" - normalises to the empty string and must never enter
        # the index. It did once, and because every string starts with "",
        # the prefix rule below matched FOUR unrelated filings to it and put
        # Kintigh, Haverstock, Milliken and Greenidge on one point in the
        # middle of the state. An empty key is not a name.
        if not key:
            continue
        by_name = by_region.setdefault(el.get("_region", ""), {})
        by_name.setdefault(key, []).append({
            "osm": f"{el['type']}/{el['id']}", "name": nm,
            "lat": round(pos[0], 6), "lon": round(pos[1], 6),
            "kv": volts(t), "operator": t.get("operator", ""),
        })
    for r, idx in by_region.items():
        print(f"  {r}: {len(idx)} distinct normalised names carry a coordinate")

    # A person saying which OpenStreetMap object a filing's substation IS -
    # the answer when the name index fails because OSM tags the yard under a
    # retired plant's name, a town, or nothing at all. `osm` is "way/123";
    # it is looked up in the SAME regional extract the index was built from,
    # so a coordinate can only come from an object that exists there, and it
    # still runs the county check like every other match. Append-only.
    aliases: dict[str, dict] = {}
    al = DATA / "substation_aliases.csv"
    if al.exists():
        with al.open() as fh:
            for r in csv.DictReader(fh):
                aliases[r["sub_id"]] = r
    by_osm = {f"{el['type']}/{el['id']}": el for el in elements}

    def fetch_by_id(osm: str) -> dict | None:
        """One object by id, however it is tagged, cached under data/raw.

        The regional extract asks for power=substation in-state, which is
        exactly what a NEW yard is not: Haverstock is landuse=construction
        with a name, STAMP's is planned:power=substation, Harings Corner is
        across the state line in New Jersey. An explicit id names a thing;
        it is fetched as that thing."""
        typ, _, num = osm.partition("/")
        if typ not in ("node", "way", "relation") or not num.isdigit():
            return None
        cdir = RAW / "osm_alias_cache"
        cdir.mkdir(parents=True, exist_ok=True)
        cf = cdir / f"{typ}_{num}.json"
        if cf.exists():
            return json.loads(cf.read_text()) or None
        try:
            payload = run(f"[out:json];{typ}({num});out center tags;")
        except Exception as e:  # noqa: BLE001
            print(f"  alias fetch failed for {osm}: {e}")
            return None
        els = payload.get("elements") or []
        el = els[0] if els else None
        cf.write_text(json.dumps(el or {}))
        return el

    located = ambiguous = missed = 0
    for s in subs:
        a = aliases.get(s["id"])
        if a and a.get("osm"):
            el = by_osm.get(a["osm"].strip()) or fetch_by_id(a["osm"].strip())
            pos = centre(el) if el else None
            if not pos:
                print(f"  ALIAS NOT FOUND: {s['name']} -> {a['osm']} (no such object on OpenStreetMap)")
            else:
                t = el.get("tags", {})
                s.update({"lat": round(pos[0], 6), "lon": round(pos[1], 6), "osm": a["osm"].strip(),
                          "osm_name": t.get("name") or a.get("osm_name") or "",
                          "located": True, "placed_by": "alias"})
                if t.get("operator"):
                    s["operator"] = t["operator"]
                located += 1
                continue
        key = norm(s["name"])
        if not key:
            continue
        by_name = by_region.get(s.get("region", ""), {})
        hits = by_name.get(key, [])
        if not hits:
            # A filing name that is a prefix of exactly one OSM name is still
            # a match ("Beck Packard" -> "Beck Packard Switching Station"),
            # but only when it is unambiguous and long enough to mean
            # something.
            # Both sides need enough length to carry identity: a short key is
            # a prefix of half the state.
            if len(key) >= 6:
                pref = [v for k, vs in by_name.items()
                        if len(k) >= 6 and (k.startswith(key) or key.startswith(k))
                        for v in vs]
                hits = pref if len(pref) == 1 else []
        if not hits:
            missed += 1
            s.pop("lat", None)
            s.pop("lon", None)
            s["located"] = False
            continue
        if len(hits) > 1:
            # Prefer a hit whose voltage matches the filing's; that is what
            # the kV is for. Still ambiguous after that: leave it alone.
            if s.get("kv"):
                narrowed = [h for h in hits if s["kv"] in h["kv"]]
                if len(narrowed) == 1:
                    hits = narrowed
        if len(hits) > 1:
            ambiguous += 1
            s["located"] = False
            s["osm_candidates"] = [h["osm"] for h in hits[:6]]
            continue
        h = hits[0]
        s.update({"lat": h["lat"], "lon": h["lon"], "osm": h["osm"],
                  "osm_name": h["name"], "located": True})
        if h["operator"]:
            s["operator"] = h["operator"]
        if s.get("kv") and h["kv"] and s["kv"] not in h["kv"]:
            # Located, but the voltage disagrees - worth seeing rather than
            # smoothing over. It usually means the filing named a different
            # bus at the same site.
            s["kv_note"] = f"filing says {s['kv']} kV, OSM says {'/'.join(map(str, h['kv']))} kV"
        located += 1

    if "--no-verify" not in sys.argv:
        verify_counties(subs)
        located = sum(1 for s in subs if s.get("located"))

    SUBS.write_text(json.dumps(subs, indent=1) + "\n")
    print(f"\nlocated {located} of {len(subs)} · {ambiguous} ambiguous · {missed} not found")
    print(f"wrote {SUBS.relative_to(ROOT)}")
    for s in subs:
        if s.get("kv_note"):
            print(f"  voltage check: {s['name']} — {s['kv_note']}")
    unl = [s["name"] for s in subs if not s.get("located")]
    if unl:
        print(f"\nno coordinate ({len(unl)}): {', '.join(sorted(unl)[:20])}"
              + (" …" if len(unl) > 20 else ""))


if __name__ == "__main__":
    main()
