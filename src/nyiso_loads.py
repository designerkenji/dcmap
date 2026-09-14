"""NYISO's load interconnection queue: the one public list that names the
substation a mega-load attaches to.

Every other US market publishes aggregates. ERCOT reports MW by load zone and
says outright that anything with fewer than five customers is bucketed "to
protect Customer data"; PJM has no load queue at all, because load interconnects
through the transmission owner under state jurisdiction; ISO-NE and CAISO
publish forecasts. New York is the exception: the monthly interconnection
queue workbook carries a "Load Projects" sheet with a Points of Interconnection
column, and that column names real substations and real line segments.

That single column is what makes a dependency graph possible rather than
imaginary. Two campuses naming the same substation share a transformer bank and
a bus - a correlated outage, not a coincidence of geography. Proximity cannot
establish that and neither can a balancing authority; a filed interconnection
request can.

What the sheet does NOT support:
  - Completeness. NYISO's load procedures bite at >10 MW on 115 kV and above,
    or 80 MW below it (Gold Book note 9). Smaller loads interconnect through
    the utility and never appear. An absence here is not evidence of absence.
  - Certainty of delivery. A queue position is a request. Projects withdraw,
    and the sheet has a separate Withdrawn tab to prove it.
  - Clean values. The POI column mixes substations with line segments and
    free text ("There is a 135kv line abutting our propert..."), and county
    spellings are dirty ("niagara falls", "St; Lawrence", "Nassu").

So this script extracts and normalises, flags what it could not parse, and
leaves the judgement to the dependency merger in src/power_deps.py.

The End-Use codes (DAT, DAT-AI, DAT-CM, M-CH...) are NOT defined in the
workbook's own notes block. Their reading here - data centre, AI data centre,
crypto mining, chemical manufacturing - is inference corroborated by the
project names, and is recorded as inference rather than as the file's meaning.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import pathlib
import re
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

LANDING = "https://www.nyiso.com/interconnections"
BASE = "https://www.nyiso.com"
UA = {"User-Agent": "reinsurance-dc/1.0 (registry build; contact via repo)"}

# The workbook name carries its own date and changes monthly, so the link has
# to be discovered rather than constructed - the same lesson src/teac.py
# learned from PJM's deck filenames.
RE_QUEUE = re.compile(r"/documents/[\w/]+/NYISO-Interconnection-Queue-(\d{8})\.xlsx", re.I)

# End-use codes, read from the project names. See the docstring: this mapping
# is our inference, not NYISO's published legend.
END_USE = {
    "DAT": ("data centre", "datacentre"),
    "DAT-AI": ("AI data centre", "datacentre"),
    "DAT-CM": ("crypto mining", "datacentre"),
    "M-CH": ("chemical manufacturing", "industrial"),
    "M-IN": ("industrial", "industrial"),
    "M-CG": ("co-generation / manufacturing", "industrial"),
    "RD": ("research and development", "other"),
    "O": ("other", "other"),
}

# A POI cell is only usable when it NAMES a thing. Rather than one clever
# regex, the cell is stripped down: pull the voltage out, drop the circuit
# designators utilities append (MRG-1, line 78, #13, HW1 & HW2), then split
# what is left on the separators that mean "between these two ends".
#
# Two traps learned from the real column:
#   - "to" as a separator must be \bto\b. Without the word boundary it fires
#     inside "Havers|to|ck" and invents two substations from one.
#   - a hyphen is genuinely ambiguous. "Moses-Reynolds MRG-1" is one circuit
#     between two substations, so splitting it is RIGHT; a hyphenated single
#     name would split wrongly. The column has no counter-example, and a
#     wrong split makes an over-connected graph rather than a false one -
#     both ends are checked against the substation registry downstream.
#   - a SLASH is not a separator, on the evidence of every slash the column
#     actually contains (two cells, 2026-07 workbook): "Kintigh/Niagara -
#     New Rochester 345kV" joins alternate names of ONE end (research vouched
#     2026-09-07 - the split minted a phantom sub-niagara and a second feed
#     the filing never claimed), and "69 kV / 13.8 kV substation" separates
#     two voltages of one LIPA station. Both readings are "one thing with
#     two labels", never "between these two ends"; the joined name resolves
#     through power_deps.py's ALIASES ("kintigh-niagara" -> "kintigh").
RE_KV = re.compile(r"(\d{2,3})\s*kV", re.I)
RE_STATION_WORD = re.compile(r"\bsub[- ]?station\b|\bstation\b", re.I)
# Circuit and line designators: noise once the ends are known.
RE_DESIG = re.compile(
    r"\blines?\s*(?:no\.?\s*)?\d+(?:\s*(?:and|&|,)\s*\d+)*|"
    r"#\s*\d+|"
    r"\b[A-Z]{2,4}\s*-?\s*\d+(?:\s*(?:and|&)\s*[A-Z]{0,4}\s*-?\s*\d+)*\b|"
    r"\bcircuits?\b|\bat\b\s*$",
    re.I)
# Owners that prefix a name without being part of it.
RE_OWNER = re.compile(
    r"^(?:NYPA'?s?|National\s+Grid|NYSEG|New\s+York\s+State\s+Electric\s*&?\s*Gas"
    r"(?:\s*\(NYSEG\))?|Con\s*Ed(?:ison)?|RG&E|NGRID)\b[\s\-–:]*", re.I)
# Prose, not a name. These cells describe a plan; reading them would invent
# substations that do not exist.
RE_PROSE = re.compile(r"\b(we|our|there\s+is|currently|will\s+be|abutting|same\s+poi)\b", re.I)
SEPARATORS = re.compile(r"\s+to\s+|\s*[-–—]\s*|\s+and\s+", re.I)
# Fragments that survive the cleaners but name nothing. Splitting a cell like
# "138kV Line 703 between Corporate Drive and Harings Corner" leaves "between
# Corporate Drive"; other cells leave bare "Transmission", "Station", "Tap on
# the NYSEG". Minting substations from these puts fictional nodes in the
# graph, so they are refused by name.
RE_JUNK = re.compile(
    r"^(?:between\b|tap\b|line\b|feeder\b|existing\b|proposed\b|new\b|the\b)|"
    r"^(?:transmission|station|substation|switchyard|terminal|ramp|gulf|"
    r"interconnection|distribution|system|grid|network|point|poi)$|"
    # A possessive fragment is the tail of an owner clause the splitter cut
    # in half ("National Grid's lines: Clay"), not a name.
    r"^'s\b|^s\s+lines\b|\blines?:\s*$|"
    # Circuit shorthand and stray identifiers that name no station.
    r"^(?:ckts?|circuits?)\b|\bckts?$|"
    r"^[A-Z]{2,}\s+(?:existing|feeder)\b",
    re.I)


def fetch(url: str, dest: pathlib.Path, force: bool = False) -> pathlib.Path:
    if dest.exists() and not force:
        return dest
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        dest.write_bytes(r.read())
    return dest


def discover() -> tuple[str, str]:
    """Return (absolute url, yyyymmdd stamp) for the current queue workbook."""
    req = urllib.request.Request(LANDING, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    hits = RE_QUEUE.findall(html)
    paths = RE_QUEUE.finditer(html)
    first = next(paths, None)
    if not first:
        raise RuntimeError("no interconnection-queue xlsx link on " + LANDING)
    # The stamp is MMDDYYYY in the filename; keep it as the cache key so a new
    # month lands in a new file and the old one stays auditable.
    return BASE + first.group(0), first.group(1)


# ---- a small xlsx reader ---------------------------------------------------
# openpyxl is not a dependency of this repo and one sheet does not justify
# making it one. This is the same zipfile+regex approach src/pjm_load.py uses,
# generalised to find a sheet by name and to handle inline strings.

def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    try:
        blob = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
    except KeyError:
        return []
    out = []
    for si in re.findall(r"<si>(.*?)</si>", blob, re.S):
        out.append("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))
    return [_unescape(s) for s in out]


def _unescape(s: str) -> str:
    return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
             .replace("&quot;", '"').replace("&apos;", "'").replace("&#10;", " "))


def _sheet_path(z: zipfile.ZipFile, want: str) -> str:
    wb = z.read("xl/workbook.xml").decode("utf-8", "replace")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8", "replace")
    rid_to_target = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
    for m in re.finditer(r'<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wb):
        name, rid = _unescape(m.group(1)), m.group(2)
        if name.strip().lower() == want.strip().lower():
            t = rid_to_target[rid]
            return ("xl/" + t.lstrip("/")) if not t.startswith("xl/") else t
    names = re.findall(r'<sheet[^>]*name="([^"]+)"', wb)
    raise KeyError(f"no sheet named {want!r}; found: {names}")


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_sheet(path: pathlib.Path, sheet: str) -> list[list[str]]:
    z = zipfile.ZipFile(path)
    ss = _shared_strings(z)
    xml = z.read(_sheet_path(z, sheet)).decode("utf-8", "replace")
    rows: list[list[str]] = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells: dict[int, str] = {}
        # A self-closing empty cell (<c r="N67" s="85"/>) has no </c>, and a
        # pattern that insists on one runs on to the NEXT cell's close and
        # swallows its value - a blank ATO column ate the Project Status
        # beside it in 55 of 74 rows, which is how "withdrawn" went unseen.
        for ref, attrs, body in re.findall(
                r'<c r="([A-Z]+\d+)"([^>]*?)(?:/>|>(.*?)</c>)', row, re.S):
            typ = re.search(r't="(\w+)"', attrs)
            typ = typ.group(1) if typ else "n"
            if typ == "inlineStr":
                val = "".join(re.findall(r"<t[^>]*>(.*?)</t>", body, re.S))
            else:
                v = re.search(r"<v>(.*?)</v>", body, re.S)
                val = v.group(1) if v else ""
                if typ == "s" and val.isdigit():
                    val = ss[int(val)] if int(val) < len(ss) else ""
            cells[_col(ref)] = _unescape(val).strip()
        if not cells:
            continue
        width = max(cells) + 1
        rows.append([cells.get(i, "") for i in range(width)])
    return rows


def excel_date(v: str) -> str:
    """Excel serial -> ISO date. Non-numbers pass through untouched."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return v
    if n < 20000 or n > 80000:          # not a plausible modern date serial
        return v
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(n))).isoformat()


# ---- the POI column --------------------------------------------------------

def parse_poi(cell: str) -> list[dict]:
    """Pull named substations / line ends out of one Points of Interconnection
    cell. Returns [] when the cell is prose we should not pretend to read."""
    if not cell:
        return []
    txt = re.sub(r"\s+", " ", cell).strip()
    # A sentence is not a name. Better to record "unparsed" and let a person
    # read it than to mint a substation called "tting our property".
    if len(txt) > 160 or len(txt.split()) > 14 or RE_PROSE.search(txt):
        return []

    kv_hits = RE_KV.findall(txt)
    kv = kv_hits[0] if kv_hits else ""
    # A cell that says "substation" is naming one; a cell naming a line is
    # naming its ends. Both give substation nodes, and the shape records
    # which reading produced them.
    shape = "substation" if RE_STATION_WORD.search(txt) else "line_end"

    body = RE_KV.sub(" ", txt)
    body = RE_STATION_WORD.sub(" ", body)
    body = RE_DESIG.sub(" ", body)
    body = RE_OWNER.sub("", body.strip())
    body = re.sub(r"\((?:[^)]*)\)", " ", body)          # parenthetical asides
    body = re.sub(r"\s+", " ", body).strip(" -–,;.:&")
    # "Station 251" loses its only word to the station-word strip. When the
    # cleaners have eaten every letter, the raw cell was the name.
    if not re.search(r"[A-Za-z]{3}", body):
        body = re.sub(r"\s+", " ", RE_KV.sub(" ", txt)).strip(" -–,;.:&")

    out: list[dict] = []
    seen: set[str] = set()
    for part in SEPARATORS.split(body):
        name = RE_OWNER.sub("", part).strip(" -–,;.:&#")
        name = re.sub(r"^\d+\s*", "", name).strip()      # "115 kv STAMP" -> "STAMP"
        name = re.sub(r"\s+\d+$", "", name).strip()      # "Beck Packard 76" -> "Beck Packard"
        name = re.sub(r"^lines?\s+|\s+lines?$", "", name, flags=re.I).strip()
        name = re.sub(r"\s+", " ", name)
        # A real name has a letter, some length, and is not a bare designator.
        if len(name) < 3 or not re.search(r"[A-Za-z]{3}", name):
            continue
        if re.fullmatch(r"(?:line|lines|the|and|at|kv|no)\b.*", name, re.I):
            continue
        if RE_JUNK.search(name):
            continue
        k = name.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append({"name": name, "kv": kv, "shape": shape})
    # Splitting produced more than a pair: the cell was a list, not a circuit,
    # and we do not know which end the load sits behind. Keep them - they are
    # all real names - but say the reading is a list.
    if len(out) > 2:
        for o in out:
            o["shape"] = "listed"
    return out


COLS = ["queue", "developer", "project", "submitted", "mw", "end_use",
        "end_use_reading", "asset_class", "type_fuel", "county", "state",
        "zone", "poi_raw", "poi_names", "poi_kv", "poi_shape", "utility",
        "ato", "status", "in_service"]


def build(rows: list[list[str]]) -> list[dict]:
    if not rows:
        return []
    # The header is the first row carrying "Queue" and "Points of".
    hi = 0
    for i, r in enumerate(rows[:15]):
        joined = " ".join(r).lower()
        if "queue" in joined and "point" in joined:
            hi = i
            break
    head = [h.strip() for h in rows[hi]]

    def find(*needles: str) -> int:
        for i, h in enumerate(head):
            hl = h.lower()
            if all(n in hl for n in needles):
                return i
        return -1

    ix = {
        "queue": find("queue"), "developer": find("developer"),
        "project": find("project", "name"), "submitted": find("submission"),
        "mw": find("peak", "mw"), "end_use": find("end", "use"),
        "type_fuel": find("type"), "county": find("county"),
        "state": find("state"), "zone": find("zone"),
        "poi": find("point", "interconnection"), "utility": find("utility"),
        "ato": find("affected", "owner"), "status": find("status"),
        "in_service": find("backfeed"),
    }
    if ix["poi"] < 0:
        raise RuntimeError(f"no Points of Interconnection column; header={head}")

    def cell(r: list[str], key: str) -> str:
        i = ix.get(key, -1)
        return r[i].strip() if 0 <= i < len(r) else ""

    out = []
    for r in rows[hi + 1:]:
        q = cell(r, "queue")
        proj = cell(r, "project")
        if not q and not proj:
            continue
        poi_raw = cell(r, "poi")
        names = parse_poi(poi_raw)
        eu = cell(r, "end_use").upper().strip()
        reading, klass = END_USE.get(eu, ("", ""))
        out.append({
            "queue": q, "developer": cell(r, "developer"), "project": proj,
            "submitted": excel_date(cell(r, "submitted")),
            "mw": cell(r, "mw"), "end_use": eu,
            "end_use_reading": reading, "asset_class": klass,
            "type_fuel": cell(r, "type_fuel"), "county": cell(r, "county"),
            "state": cell(r, "state"), "zone": cell(r, "zone"),
            "poi_raw": poi_raw,
            "poi_names": " | ".join(n["name"] for n in names),
            "poi_kv": " | ".join(n["kv"] for n in names),
            "poi_shape": names[0]["shape"] if names else "",
            "utility": cell(r, "utility"), "ato": cell(r, "ato"),
            "status": cell(r, "status"), "in_service": excel_date(cell(r, "in_service")),
        })
    return out


def main() -> None:
    url, stamp = discover()
    dest = RAW / f"nyiso_queue_{stamp}.xlsx"
    print(f"queue: {url}")
    fetch(url, dest)
    print(f"  cached {dest.relative_to(ROOT)}  ({dest.stat().st_size:,} bytes)")

    rows = read_sheet(dest, "Load Projects")
    recs = build(rows)
    named = [r for r in recs if r["poi_names"]]
    dc = [r for r in recs if r["asset_class"] == "datacentre"]
    print(f"  {len(recs)} load projects · {len(named)} with a parsed POI name "
          f"· {len(dc)} data-centre class")

    out = ROOT / "data" / "nyiso_load_projects.csv"
    with out.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=COLS)
        w.writeheader()
        w.writerows(recs)
    print(f"wrote {out.relative_to(ROOT)}")

    meta = {"source": url, "stamp": stamp, "fetched": dt.date.today().isoformat(),
            "projects": len(recs), "with_poi": len(named)}
    (RAW / "nyiso_queue_meta.json").write_text(json.dumps(meta, indent=1) + "\n")

    # The headline the graph exists for: substations named by more than one
    # project. Printed here so a build shows it without opening the map.
    by_sub: dict[str, list[dict]] = {}
    for r in recs:
        for n in r["poi_names"].split(" | "):
            if n:
                by_sub.setdefault(n, []).append(r)
    shared = {k: v for k, v in by_sub.items() if len(v) > 1}
    if shared:
        print(f"\nsubstations named by more than one load project ({len(shared)}):")
        for k, v in sorted(shared.items(), key=lambda kv: -len(kv[1])):
            mw = sum(float(x["mw"]) for x in v if x["mw"].replace(".", "").isdigit())
            print(f"  {k:<32} {len(v)} projects  {mw:>8,.0f} MW")


if __name__ == "__main__":
    main()
