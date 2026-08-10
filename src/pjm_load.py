"""PJM Table B-9b: new large-load adjustments by zone, area (EDC) and year.

This is the one public bulk source that separates the Virginia distribution
utilities. PJM's load forecast report, Data Miner and the OATT all collapse
Virginia to a single DOM zone; only the load-forecast adjustment track breaks
out DOM / NVEC / ODEC / REC as distinct areas.

Reads xlsx directly from the zip - openpyxl is not needed for a flat sheet.
"""

from __future__ import annotations

import csv
import pathlib
import re
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

URL = ("https://www.pjm.com/-/media/DotCom/planning/res-adeq/load-forecast/"
       "total-load-adjustments-breakdown.xlsx")
DEST = RAW / "pjm_b9b.xlsx"

AREA_NAMES = {
    "DOM": "Dominion (DEV)", "NVEC": "NOVEC (co-op)", "REC": "REC (co-op)",
    "ODEC": "ODEC (co-op G&T)", "SMECO": "SMECO (co-op)", "PEPCO": "Pepco",
}
VA_AREAS = {"DOM", "NVEC", "REC", "ODEC"}


def _sheet_rows(path: pathlib.Path) -> list[dict]:
    z = zipfile.ZipFile(path)
    shared = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
    ss = ["".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))
          for si in re.findall(r"<si>(.*?)</si>", shared, re.S)]
    sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8", "replace")
    rows = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", sheet, re.S):
        d = {}
        for ref, attrs, body in re.findall(r'<c r="([A-Z]+)\d+"([^>]*)>(.*?)</c>', row, re.S):
            v = re.search(r"<v>(.*?)</v>", body)
            if not v:
                continue
            val = v.group(1)
            if 't="s"' in attrs:
                val = ss[int(val)]
            d[ref] = val
        if d:
            rows.append(d)
    return rows


def _col_letters(n: int) -> list[str]:
    """Spreadsheet column refs C.. onward, which is where the year columns start."""
    out, i = [], 2  # 0=A, 1=B, 2=C
    while len(out) < n:
        q, r = divmod(i, 26)
        out.append((chr(64 + q) if q else "") + chr(65 + r))
        i += 1
    return out


def main() -> None:
    if not DEST.exists():
        req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r:
            DEST.write_bytes(r.read())
    rows = _sheet_rows(DEST)

    # Sheet layout (verified against the live file):
    #   header  : C='AREANAME', D..='2026'..'2046'
    #   zone row: A=<zone>, B=<2026 total>, E..=2027.. (D is merged away)
    #   area row: A=<numeric group id>, C=<EDC code>, D..=2026..
    # So the EDC breakdown lives in column C, and each area row inherits the
    # zone from the most recent zone row above it.
    years = []
    for r in rows:
        if str(r.get("C", "")).strip().upper() == "AREANAME":
            for col, val in r.items():
                v = str(val).strip()
                if re.fullmatch(r"20\d\d", v):
                    years.append((col, int(v)))
            break
    if not years:
        raise SystemExit("year header row not found - sheet layout changed")
    years.sort(key=lambda cv: cv[1])

    def is_zone_row(r):
        a = str(r.get("A", "")).strip()
        return bool(a) and not a.isdigit() and a not in ("0", "\xa0")

    # A zone row carrying no AREANAME is a subtotal ONLY when area rows follow
    # it before the next zone. JCPL, METED and DLCO have no breakdown at all -
    # their single row IS the zone - and blanket-skipping the shape dropped
    # them entirely (245, 234 and 87 MW by 2046). Look ahead to tell the two
    # apart rather than guessing from the row alone.
    has_areas = {}
    for i, r in enumerate(rows):
        if not is_zone_row(r):
            continue
        found = False
        for nxt in rows[i + 1:]:
            if is_zone_row(nxt):
                break
            if str(nxt.get("C", "")).strip():
                found = True
                break
        has_areas[i] = found

    out = []
    zone = ""
    for i, r in enumerate(rows):
        a = str(r.get("A", "")).strip()
        area = str(r.get("C", "")).strip()
        if is_zone_row(r):
            zone = a
            # The RTO row is the grand total over every zone, never a zone.
            if zone.upper().startswith("PJM"):
                zone = ""
                continue
            if not area:
                if has_areas[i]:
                    continue          # genuine subtotal; its areas follow
                area = zone           # standalone zone, this row is the data
        if not area or area.upper() == "AREANAME":
            continue
        for col, yr in years:
            v = str(r.get(col, "")).strip()
            if not v:
                continue
            try:
                mw = float(v)
            except ValueError:
                continue
            out.append({
                "zone": zone, "area": area,
                "area_name": AREA_NAMES.get(area, area),
                "is_virginia_edc": "yes" if (zone == "DOM" and area in VA_AREAS) else "",
                "year": yr, "mw": round(mw, 1),
            })

    dest = ROOT / "data" / "pjm_large_load.csv"
    with dest.open("w", newline="") as fh:
        w = csv.DictWriter(fh, lineterminator="\n", fieldnames=["zone", "area", "area_name",
                                           "is_virginia_edc", "year", "mw"])
        w.writeheader()
        w.writerows(out)
    print(f"wrote {dest.relative_to(ROOT)}  ({len(out)} rows, "
          f"{len({r['area'] for r in out})} areas, "
          f"{min(y for _, y in years)}-{max(y for _, y in years)})")

    va = [r for r in out if r["is_virginia_edc"]]
    for yr in (2026, 2030, 2035, 2046):
        sel = {r["area"]: r["mw"] for r in va if r["year"] == yr}
        if not sel:
            continue
        tot = sum(sel.values())
        coop = sum(v for k, v in sel.items() if k != "DOM")
        parts = "  ".join(f"{k}={v:,.0f}" for k, v in sorted(sel.items()))
        print(f"  {yr}: {parts}   co-op share {coop / tot:.0%}" if tot else "")


if __name__ == "__main__":
    main()
