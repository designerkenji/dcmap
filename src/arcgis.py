"""Minimal paginated ArcGIS REST client.

Every county source in this project is an ArcGIS REST endpoint, so one
well-tested pager covers all of them. Handles the two things that bite:
maxRecordCount truncation (silent) and servers that ignore resultOffset.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (reinsurance_dc research)"


def _get(url: str, params: dict, timeout: int = 90, retries: int = 3) -> dict:
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001 - surface the last error after retries
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries}: {full[:200]}") from last


def count(layer: str, where: str = "1=1") -> int:
    return _get(layer + "/query", {"where": where, "returnCountOnly": "true", "f": "json"})["count"]


def fields(layer: str) -> list[str]:
    return [f["name"] for f in _get(layer, {"f": "pjson"}).get("fields", [])]


def query(layer: str, where: str = "1=1", out_fields: str = "*", page: int = 1000,
          geometry: bool = False) -> list[dict]:
    """Page through a layer and return attribute dicts.

    Pagination is verified by checking that each page returns new OBJECTIDs;
    some servers ignore resultOffset and would otherwise loop forever on page 1.
    """
    rows: list[dict] = []
    seen: set = set()
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": out_fields,
            "returnGeometry": "true" if geometry else "false",
            "resultOffset": offset,
            "resultRecordCount": page,
            "f": "json",
        }
        if geometry:
            # Layers are natively Virginia State Plane; without outSR the
            # returned coordinates will not match any lat/lon lookup.
            params["outSR"] = "4326"
        d = _get(layer + "/query", params)
        feats = d.get("features", [])
        if not feats:
            break
        new = 0
        for ft in feats:
            a = dict(ft["attributes"])
            if geometry and ft.get("geometry"):
                a["_geometry"] = ft["geometry"]
            key = a.get("OBJECTID") or a.get("OBJECTID_1") or a.get("FID") or json.dumps(a, default=str, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            rows.append(a)
            new += 1
        if new == 0:
            break  # server ignoring resultOffset
        if not d.get("exceededTransferLimit") and len(feats) < page:
            break
        offset += len(feats)
    return rows


def num(v) -> float:
    """Coerce the messy numeric strings these layers return ('1,700,000', '$3.9M', '')."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").replace("$", "").strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def coalesce(row: dict, *keys) -> float:
    """First positive value across candidate fields. PW GFA needs this."""
    for k in keys:
        v = num(row.get(k))
        if v > 0:
            return v
    return 0.0


def scrub(v):
    """Collapse whitespace in a value destined for CSV.

    County free-text fields (names, owners, addresses) contain literal newlines
    and tabs. csv writes them correctly as quoted multi-line fields, but that
    makes `wc -l`, awk, split-on-newline and many spreadsheet importers
    disagree with the real record count - registry.csv read as 837 lines for
    832 records. Normalising on write keeps one record per line.
    """
    if v is None:
        return ""
    if not isinstance(v, str):
        return v
    return " ".join(v.split())
