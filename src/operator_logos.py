"""Cache operator logos locally and emit the directory's profile file.

    python3 operator_logos.py

Reads data/operator_profiles_raw.json (researched: domain, logo candidates,
profile prose) and writes:

    dcmap/public/logos/<key>.<ext>      the cached mark
    data/operator_profiles.json         what the map actually loads

WHY CACHE RATHER THAN HOTLINK
Hotlinking a company's favicon means the directory breaks when they redesign,
leaks a request to them for every page view, and puts a third-party fetch in
the render path. These are a few KB each; storing them is cheaper in every
sense. The marks are used to identify the companies they belong to, which is
what a directory is for.

Every candidate is fetched and the LARGEST usable one wins - not the first
that works, which handed four operators a 16x16 favicon while a 180px
touch-icon sat further down their list.

Candidates are validated by CONTENT, not by the URL or the declared type:
plenty of sites return an HTML error page with `Content-Type: image/png`, and
writing that to logos/aws.png would produce a broken image with no error
anywhere. An operator with no usable candidate simply has no logo, and the map
falls back to a monogram tile.
"""

from __future__ import annotations

import json
import pathlib
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "operator_profiles_raw.json"
OUT = ROOT / "data" / "operator_profiles.json"
LOGOS = ROOT / "dcmap" / "public" / "logos"

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}
MAX_BYTES = 900_000
MIN_BYTES = 60

# Fields the map is allowed to see. Everything else in the raw file is
# research trail (source URLs, notes) and does not belong in a page payload.
KEEP = ("displayName", "domain", "kind", "parent", "hqCountry",
        "profile", "officialLocationList", "publishedFacilities")


def sniff(buf: bytes) -> str | None:
    """Return an extension if these bytes really are an image we can serve."""
    if buf[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if buf[:2] == b"\xff\xd8":
        return ".jpg"
    if buf[:4] == b"RIFF" and buf[8:12] == b"WEBP":
        return ".webp"
    if buf[:4] == b"\x00\x00\x01\x00":
        return ".ico"
    if buf[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    head = buf[:400].lstrip()
    if head[:5] == b"<?xml" or head[:4] == b"<svg":
        # An SVG that is really an HTML error page starts <!DOCTYPE html>, so
        # require the tag itself to appear somewhere near the top.
        return ".svg" if b"<svg" in buf[:2000] else None
    return None


def dimension(buf: bytes, ext: str) -> int:
    """Longest side in pixels, for picking between candidates. 0 if unreadable.

    Vector art is given a large sentinel because it is scale-free: an SVG
    always beats a 16x16 favicon, which is the whole point of preferring it.
    """
    try:
        if ext == ".svg":
            return 4096
        if ext == ".png":                       # IHDR is always the first chunk
            return max(int.from_bytes(buf[16:20], "big"), int.from_bytes(buf[20:24], "big"))
        if ext == ".gif":
            return max(int.from_bytes(buf[6:8], "little"), int.from_bytes(buf[8:10], "little"))
        if ext == ".ico":
            # Directory of entries; a 0 byte means 256. Take the biggest.
            n = int.from_bytes(buf[4:6], "little")
            best = 0
            for i in range(n):
                e = 6 + i * 16
                w, h = buf[e] or 256, buf[e + 1] or 256
                best = max(best, w, h)
            return best
        if ext == ".webp":
            tag = buf[12:16]
            if tag == b"VP8X":
                return max(int.from_bytes(buf[24:27], "little") + 1,
                           int.from_bytes(buf[27:30], "little") + 1)
            if tag == b"VP8 ":
                return max(int.from_bytes(buf[26:28], "little") & 0x3FFF,
                           int.from_bytes(buf[28:30], "little") & 0x3FFF)
            if tag == b"VP8L":
                b = int.from_bytes(buf[21:25], "little")
                return max((b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1)
        if ext == ".jpg":
            i = 2
            while i < len(buf) - 9:
                if buf[i] != 0xFF:
                    i += 1
                    continue
                m = buf[i + 1]
                if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                    return max(int.from_bytes(buf[i + 5:i + 7], "big"),
                               int.from_bytes(buf[i + 7:i + 9], "big"))
                i += 2 + int.from_bytes(buf[i + 2:i + 4], "big")
    except (IndexError, ValueError):
        return 0
    return 0


def fetch(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(MAX_BYTES + 1)
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"{RAW.relative_to(ROOT)} missing - the research step writes it")
    records = json.loads(RAW.read_text())
    LOGOS.mkdir(parents=True, exist_ok=True)

    out, got, failed, small = {}, 0, [], []
    for rec in records:
        key = rec.get("key")
        if not key:
            continue
        entry = {k: rec[k] for k in KEEP if rec.get(k)}

        candidates = list(rec.get("logoCandidates") or [])
        # Always worth a try even when the researcher found nothing: /favicon.ico
        # is a spec-mandated path and is right more often than not.
        dom = rec.get("domain")
        if dom:
            candidates.append(f"https://{dom}/favicon.ico")

        # Try every candidate and keep the BIGGEST, not the first that works.
        # First-that-works gave four operators a 16x16 favicon while a 180px
        # touch-icon sat further down the list, and a 16px mark upscaled into a
        # 34px tile looks like a mistake rather than a logo.
        best = None
        for url in candidates:
            buf = fetch(url)
            if not buf or len(buf) < MIN_BYTES or len(buf) > MAX_BYTES:
                continue
            ext = sniff(buf)
            if not ext:
                continue
            px = dimension(buf, ext)
            if best is None or px > best[0]:
                best = (px, ext, buf, url)

        if best:
            px, ext, buf, url = best
            # .ico renders in every current browser via <img>, so there is no
            # conversion step and therefore no image dependency in this repo.
            name = f"{key.replace(' ', '-')}{ext}"
            (LOGOS / name).write_bytes(buf)
            entry["logo"] = name
            entry["logoSource"] = url
            entry["logoPx"] = px
            got += 1
            if px < 48:
                small.append(f"{key} ({px}px)")
        elif candidates:
            failed.append(key)

        out[key] = entry

    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False, sort_keys=True))
    print(f"operators {len(out)}   logos cached {got}   no usable candidate {len(failed)}")
    if failed:
        print("  no logo:", ", ".join(sorted(failed)))
    if small:
        print("  under 48px, will look soft in the tile:", ", ".join(sorted(small)))
    total = sum(f.stat().st_size for f in LOGOS.glob("*") if f.is_file())
    print(f"wrote {OUT.relative_to(ROOT)} and {LOGOS.relative_to(ROOT)}/ ({total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
