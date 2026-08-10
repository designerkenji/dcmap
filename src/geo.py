"""Point-in-polygon without a geo stack.

Only shapely-shaped thing this project needs is "which utility territory
contains this point", so a bbox prefilter plus ray casting beats adding
geopandas as a dependency.
"""

from __future__ import annotations

import math


def _rings(geom: dict) -> list[list]:
    """Flatten a polygon to a list of rings, in either GeoJSON or Esri JSON.

    Esri REST with f=json returns {"rings": [...]} and {"x":..,"y":..} rather
    than GeoJSON type/coordinates. Handling only GeoJSON here silently yields
    no geometry for every county layer, so both shapes are supported.
    """
    if not geom:
        return []
    if "rings" in geom:  # Esri polygon
        return list(geom["rings"] or [])
    if "paths" in geom:  # Esri polyline
        return list(geom["paths"] or [])
    t = geom.get("type")
    coords = geom.get("coordinates") or []
    if t == "Polygon":
        return list(coords)
    if t == "MultiPolygon":
        return [r for poly in coords for r in poly]
    return []


def _bbox(rings: list[list]) -> tuple[float, float, float, float]:
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return (min(xs), min(ys), max(xs), max(ys)) if xs else (0.0, 0.0, -1.0, -1.0)


def _in_ring(x: float, y: float, ring: list) -> bool:
    """Standard even-odd ray cast."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y):
            denom = yj - yi
            if denom and x < (xj - xi) * (y - yi) / denom + xi:
                inside = not inside
        j = i
    return inside


class PolygonIndex:
    """Bbox-prefiltered containment lookup over a GeoJSON FeatureCollection."""

    def __init__(self, geojson: dict, name_field: str):
        self.entries = []
        for ft in geojson.get("features", []):
            rings = _rings(ft.get("geometry"))
            if not rings:
                continue
            self.entries.append({
                "name": (ft.get("properties") or {}).get(name_field),
                "props": ft.get("properties") or {},
                "rings": rings,
                "bbox": _bbox(rings),
            })

    def find_all(self, lon: float, lat: float) -> list[dict]:
        """Every entry containing the point.

        Returning all matches is deliberate: retail service territory polygons
        overlap heavily (~42% of Virginia data center sites sit in more than
        one, almost all NOVEC/Dominion in Northern Virginia). Returning only
        the first would make assignment depend on feature order in the file,
        which silently produces a confident and wrong answer.
        """
        out = []
        for e in self.entries:
            x0, y0, x1, y1 = e["bbox"]
            if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                continue
            if sum(1 for r in e["rings"] if _in_ring(lon, lat, r)) % 2 == 1:
                out.append(e)
        return out

    def find(self, lon: float, lat: float) -> dict | None:
        """First containing entry. Only safe where territories do not overlap."""
        hits = self.find_all(lon, lat)
        return hits[0] if hits else None


M_PER_DEG_LAT = 111320.0


def _m_per_deg_lon(lat: float) -> float:
    return 111320.0 * math.cos(math.radians(lat))


def _seg_dist_m(px, py, x0, y0, x1, y1, mlon):
    """Point-to-segment distance in metres, local flat approximation."""
    dx, dy = (x1 - x0) * mlon, (y1 - y0) * M_PER_DEG_LAT
    wx, wy = (px - x0) * mlon, (py - y0) * M_PER_DEG_LAT
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, (wx * dx + wy * dy) / l2))
    return math.hypot(wx - t * dx, wy - t * dy)


class BoundaryIndex:
    """Distance from a point to the nearest polygon boundary in a layer.

    Used to flag sites where a point-in-polygon utility assignment is fragile:
    parcel centroids carry tens of metres of error, and under NOVEC v. VEPCO
    (Va. 2003) a customer straddling a territory line may choose its utility.
    Both failure modes concentrate near boundaries.
    """

    def __init__(self, geojson: dict):
        self.rings = []
        for ft in geojson.get("features", []):
            for r in _rings(ft.get("geometry")):
                if len(r) < 2:
                    continue
                xs = [p[0] for p in r]
                ys = [p[1] for p in r]
                self.rings.append((r, min(xs), min(ys), max(xs), max(ys)))

    def distance_m(self, lon: float, lat: float, pad: float = 0.02) -> float:
        mlon = _m_per_deg_lon(lat)
        best = float("inf")
        for ring, x0, y0, x1, y1 in self.rings:
            if lon < x0 - pad or lon > x1 + pad or lat < y0 - pad or lat > y1 + pad:
                continue
            for i in range(len(ring) - 1):
                d = _seg_dist_m(lon, lat, ring[i][0], ring[i][1],
                                ring[i + 1][0], ring[i + 1][1], mlon)
                if d < best:
                    best = d
        return best


def _ring_area(ring: list) -> float:
    """Signed shoelace area."""
    return 0.5 * sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
                     for i in range(len(ring) - 1))


def centroid(geom: dict) -> tuple[float, float] | None:
    """Area-weighted centroid of the largest ring.

    A ring-vertex mean is NOT adequate here: vertices bunch along detailed
    boundaries and pull the point toward them. Measured against the true area
    centroid on Loudoun's data center parcels the mean was off by a median of
    60 m, p90 131 m, max 328 m - the same order as the 150 m clustering
    threshold and enough to flip a site across a utility boundary.

    The largest ring is used rather than the first, because a MultiPolygon
    parcel with a detached sliver would otherwise be represented by the sliver.
    """
    if not geom:
        return None
    if geom.get("x") is not None and geom.get("y") is not None:  # Esri point
        return (geom["x"], geom["y"])
    if geom.get("type") == "Point":
        c = geom.get("coordinates")
        return (c[0], c[1]) if c else None
    rings = [r for r in _rings(geom) if r and len(r) >= 4]
    if not rings:
        # Degenerate ring (a line or single point): fall back to a vertex mean.
        pts = next((r for r in _rings(geom) if r), None)
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    ring = max(rings, key=lambda r: abs(_ring_area(r)))
    a = _ring_area(ring)
    if a == 0:  # zero-area ring, e.g. a closed line
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    cx = sum((ring[i][0] + ring[i + 1][0]) *
             (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1])
             for i in range(len(ring) - 1))
    cy = sum((ring[i][1] + ring[i + 1][1]) *
             (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1])
             for i in range(len(ring) - 1))
    return (cx / (6 * a), cy / (6 * a))
