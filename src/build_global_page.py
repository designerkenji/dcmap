"""Generate docs/global.html — the whole registry, not just Virginia.

Companion to providers.html and deliberately on the same visual system.

Charts are inline SVG built here rather than a client-side library: the page
must work with no network (a strict CSP blocks CDNs) and the datasets are small
enough that server-side layout is simpler than shipping a plotting runtime.

The ranked-bar and ramp charts only cover the 74 AI sites, because those are
the only ones with dated observations. Build year does not exist for the other
6,188 — the page says so rather than implying a global timeline.
"""

from __future__ import annotations

import collections
import csv
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITES = ROOT / "data" / "facilities_sites.csv"
TRAJ = ROOT / "data" / "ai_site_trajectories.csv"
COUNTRIES = ROOT / "data" / "country_summary.csv"
TIMELINES = ROOT / "data_centers_from_EPOCH_AI" / "data_center_timelines.csv"

# Epoch observes sites irregularly, so a year value is the last observation
# at or before that year - step-forward, never interpolated, because a site
# holds its capacity until the next observation says otherwise.
YEAR_FROM, YEAR_TO = 2021, 2030
TODAY_YEAR = 2026
OUT = ROOT / "docs" / "global.html"

E = html.escape


def num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def year_matrix() -> tuple[list[str], dict]:
    """Per-site facility load for each year in range, stepped forward."""
    obs: dict[str, list] = collections.defaultdict(list)
    for r in csv.DictReader(TIMELINES.open(encoding="utf-8-sig")):
        d = (r.get("Date") or "")[:10]
        if d:
            obs[" ".join((r.get("Data center") or "").split())].append((d, num(r.get("Power (MW)"))))
    years = [str(y) for y in range(YEAR_FROM, YEAR_TO + 1)]
    out = {}
    for site, series in obs.items():
        series.sort()
        row, last = [], 0.0
        for y in years:
            for d, mw in series:
                if d[:4] <= y:
                    last = mw
            row.append(round(last, 1))
        if any(row):
            out[site] = row
    return years, out


def bar_chart(rows: list[dict], width: int = 720, row_h: int = 22) -> str:
    """Ranked horizontal bars: energised load solid, projected growth hatched."""
    if not rows:
        return ""
    peak = max(num(r["power_mw_total_peak"]) or num(r["power_mw_total_current"]) for r in rows)
    label_w, pad = 210, 8
    plot_w = width - label_w - 60
    h = len(rows) * row_h + 34
    out = [f'<svg viewBox="0 0 {width} {h}" role="img" '
           f'aria-label="AI data centres ranked by facility power" class="chart">']
    # axis
    for frac in (0, 0.25, 0.5, 0.75, 1.0):
        x = label_w + plot_w * frac
        out.append(f'<line x1="{x:.0f}" y1="22" x2="{x:.0f}" y2="{h - 12}" class="grid"/>')
        out.append(f'<text x="{x:.0f}" y="14" class="tick" text-anchor="middle">'
                   f'{peak * frac / 1000:.1f}k</text>' if peak >= 1000 else
                   f'<text x="{x:.0f}" y="14" class="tick" text-anchor="middle">{peak * frac:.0f}</text>')
    out.append(f'<text x="{label_w + plot_w / 2:.0f}" y="{h - 1}" class="axis" '
               f'text-anchor="middle">facility load, MW</text>')
    for i, r in enumerate(rows):
        y = 22 + i * row_h
        cur, pk = num(r["power_mw_total_current"]), num(r["power_mw_total_peak"])
        wc = plot_w * (cur / peak) if peak else 0
        wp = plot_w * (max(pk - cur, 0) / peak) if peak else 0
        name = r["site"][:32]
        out.append(f'<text x="{label_w - pad}" y="{y + 13}" class="lbl" text-anchor="end">{E(name)}</text>')
        out.append(f'<rect x="{label_w}" y="{y + 3}" width="{wc:.1f}" height="{row_h - 8}" class="b-now"/>')
        if wp > 0.5:
            out.append(f'<rect x="{label_w + wc:.1f}" y="{y + 3}" width="{wp:.1f}" '
                       f'height="{row_h - 8}" class="b-peak"/>')
        total = pk if pk > cur else cur
        out.append(f'<text x="{label_w + wc + wp + 6:.1f}" y="{y + 13}" class="val">'
                   f'{total:,.0f}</text>')
    out.append("</svg>")
    return "".join(out)


def ramp_chart(byyear: dict, width: int = 720, height: int = 210) -> str:
    """Cumulative projected facility load, stepped by the year each site peaks."""
    years = sorted(byyear)
    if not years:
        return ""
    cum, series = 0.0, []
    for y in years:
        cum += byyear[y]
        series.append((int(y), cum))
    top = series[-1][1]
    l, r, t, b = 54, 14, 16, 30
    pw, ph = width - l - r, height - t - b
    x0, x1 = series[0][0], series[-1][0]
    def px(yr): return l + pw * ((yr - x0) / max(1, x1 - x0))
    def py(v): return t + ph * (1 - v / top)
    pts = [(px(y), py(v)) for y, v in series]
    step = []
    for i, (x, y) in enumerate(pts):
        step.append(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}")
        if i + 1 < len(pts):
            step.append(f"L{pts[i + 1][0]:.1f},{y:.1f}")
    area = "".join(step) + f"L{pts[-1][0]:.1f},{t + ph:.1f}L{pts[0][0]:.1f},{t + ph:.1f}Z"
    out = [f'<svg viewBox="0 0 {width} {height}" role="img" '
           f'aria-label="Cumulative projected AI facility load by year" class="chart">']
    for f in (0, 0.5, 1.0):
        yy = py(top * f)
        out.append(f'<line x1="{l}" y1="{yy:.1f}" x2="{width - r}" y2="{yy:.1f}" class="grid"/>')
        out.append(f'<text x="{l - 8}" y="{yy + 4:.1f}" class="tick" text-anchor="end">'
                   f'{top * f / 1000:.0f}k</text>')
    out.append(f'<path d="{area}" class="area"/>')
    out.append(f'<path d="{"".join(step)}" class="line"/>')
    for (yr, v), (x, y) in zip(series, pts):
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" class="dot"/>')
        out.append(f'<text x="{x:.1f}" y="{height - 10}" class="tick" text-anchor="middle">{yr}</text>')
    out.append(f'<text x="{l}" y="{height - 10}" class="axis" text-anchor="start"></text>')
    out.append("</svg>")
    return "".join(out)


def main() -> None:
    sites = list(csv.DictReader(SITES.open()))
    traj = list(csv.DictReader(TRAJ.open()))
    countries = list(csv.DictReader(COUNTRIES.open()))

    ai = [t for t in traj if num(t["power_mw_total_current"]) or num(t["power_mw_total_peak"])]
    ranked = sorted(ai, key=lambda t: -num(t["power_mw_total_current"]))[:20]
    byyear: dict[str, float] = collections.defaultdict(float)
    for t in traj:
        if t["peak_date"]:
            byyear[t["peak_date"][:4]] += num(t["power_mw_total_peak"])

    ten = collections.Counter(s["tenancy"] or "unknown" for s in sites)
    ops = collections.Counter(s["operator"] for s in sites if s["operator"])
    cur_mw = sum(num(t["power_mw_total_current"]) for t in traj)
    peak_mw = sum(num(t["power_mw_total_peak"]) for t in traj)
    status = collections.Counter(s["status"] for s in sites if s["status"])

    # (label, value, sub, filter-kind, filter-value). A blank kind means the
    # tile is a statistic with no row-level list behind it.
    tiles = [
        ("Sites", f"{len(sites):,}", f"{len(countries)} countries", "all", ""),
        ("Operator known", f"{sum(1 for s in sites if s['operator']):,}",
         f"{sum(1 for s in sites if s['operator']) / len(sites):.0%} of sites", "hasop", ""),
        ("Multi-tenant", f"{ten['multi']:,}", f"vs {ten['single']:,} single-tenant",
         "tenancy", "multi"),
        ("AI sites", f"{len([t for t in traj]):,}", "with power data", "ft", "ai"),
        ("AI load today", f"{cur_mw:,.0f}", "MW facility load", "", ""),
        ("Projected peak", f"{peak_mw:,.0f}", f"MW by {max(byyear) if byyear else '—'}", "", ""),
    ]

    rows_json = json.dumps([{
        "n": s["name"], "en": s.get("epoch_name", ""), "ci": s["city"], "o": s["operator"], "c": s["country"],
        "t": s["tenancy"], "ft": s["facility_type"],
        "mw": int(num(s["power_mw_total_current"])),
        "u": s["utility"], "ref": s["ref"], "src": s["sources"],
    } for s in sites], separators=(",", ":"))

    def crow(c: dict) -> str:
        ai_n = int(c["ai_sites"])
        ai_mw = int(c["ai_mw_current"])
        ai_cell = f'<td class="num">{ai_n:,}</td>' if ai_n else '<td class="num dim">—</td>'
        mw_cell = f'<td class="num">{ai_mw:,}</td>' if ai_mw else '<td class="num dim">—</td>'
        return (f'<tr class="drillrow" data-kind="country" data-val="{E(c["country"])}" tabindex="0">'
                f'<td class="cc">{E(c["country"])}</td>'
                f'<td class="num">{int(c["sites"]):,}</td>'
                f'<td class="num">{int(c["multi_tenant"]):,}</td>'
                f'{ai_cell}{mw_cell}</tr>')

    country_rows = "".join(crow(c) for c in countries[:25])

    op_rows = "".join(
        f'<tr class="drillrow" data-kind="operator" data-val="{E(k)}" tabindex="0">'
        f'<td>{E(k)}</td><td class="num">{v:,}</td></tr>' for k, v in ops.most_common(20))

    st_rows = "".join(
        f'<tr><td>{E(k.replace("_", " "))}</td><td class="num">{v}</td></tr>'
        for k, v in status.most_common())

    years, matrix = year_matrix()
    print(f"  year matrix: {len(matrix)} sites x {len(years)} years")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    page = PAGE.format(
        tiles="".join(
            (f'<button type="button" class="panel tile drillable" data-kind="{fk}" data-val="{E(fv)}">'
             if fk else '<div class="panel tile">')
            + f'<span class="k">{E(k)}</span><span class="v">{E(v)}</span>'
              f'<span class="m">{E(m)}</span>'
            + ('</button>' if fk else '</div>')
            for k, v, m, fk, fv in tiles),
        bars=bar_chart(ranked),
        ramp=ramp_chart(byyear),
        n_ai=len(traj), today=TODAY_YEAR,
        country_rows=country_rows, op_rows=op_rows, st_rows=st_rows,
        n_sites=f"{len(sites):,}", n_countries=len(countries),
        data=rows_json)
    page = page.replace("__SCRIPT__", SLIDER_JS)
    page = page.replace("__MATRIX__", json.dumps(
        {"years": years, "today": str(TODAY_YEAR),
         "sites": [{"n": k, "v": v} for k, v in sorted(matrix.items())]},
        separators=(",", ":")))
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(ROOT)}  ({len(sites):,} sites, {OUT.stat().st_size / 1024:.0f} KB)")


PAGE = """<title>Global Data Centre Registry</title>
<style>
:root{{
  --bg:#F3F5F7; --panel:#FFFFFF; --line:#D8DEE4; --line-soft:#E7ECF0;
  --ink:#161C22; --ink-2:#4A5763; --ink-3:#77848F;
  --accent:#2C6E8F; --accent-soft:#E3EDF2; --now:#2C6E8F; --peak:#B5761E;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}}
@media (prefers-color-scheme:dark){{
  :root{{ --bg:#11151A; --panel:#171D24; --line:#2A333D; --line-soft:#222A33;
    --ink:#E7ECF1; --ink-2:#A3B0BC; --ink-3:#79868F;
    --accent:#6FB4D6; --accent-soft:#1B2A34; --now:#6FB4D6; --peak:#E0A75C; }}
}}
:root[data-theme="dark"]{{ --bg:#11151A; --panel:#171D24; --line:#2A333D; --line-soft:#222A33;
  --ink:#E7ECF1; --ink-2:#A3B0BC; --ink-3:#79868F;
  --accent:#6FB4D6; --accent-soft:#1B2A34; --now:#6FB4D6; --peak:#E0A75C; }}
:root[data-theme="light"]{{ --bg:#F3F5F7; --panel:#FFFFFF; --line:#D8DEE4; --line-soft:#E7ECF0;
  --ink:#161C22; --ink-2:#4A5763; --ink-3:#77848F;
  --accent:#2C6E8F; --accent-soft:#E3EDF2; --now:#2C6E8F; --peak:#B5761E; }}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}}
.wrap{{max-width:1180px;margin:0 auto;padding:28px 20px 64px;display:flex;flex-direction:column;gap:22px}}
h1{{margin:0;font-size:23px;letter-spacing:-.02em;font-weight:640;text-wrap:balance}}
h2{{margin:0 0 4px;font-size:15px;letter-spacing:-.01em;font-weight:620}}
.sub{{color:var(--ink-2);max-width:70ch}}
.note{{font-size:12.5px;color:var(--ink-3);max-width:78ch}}
.panel{{background:var(--panel);border:1px solid var(--line);border-radius:9px}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:10px}}
.tile{{padding:13px 14px;display:flex;flex-direction:column;gap:5px}}
.tile .k{{font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}}
.tile .v{{font-family:var(--mono);font-size:24px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}}
.tile .m{{font-size:12px;color:var(--ink-2)}}
.card{{padding:16px 18px;display:flex;flex-direction:column;gap:10px}}
.chartwrap{{overflow-x:auto}}
.chart{{width:100%;min-width:640px;height:auto;display:block}}
.chart .grid{{stroke:var(--line-soft);stroke-width:1}}
.chart .tick{{fill:var(--ink-3);font-family:var(--mono);font-size:9.5px}}
.chart .axis{{fill:var(--ink-3);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase}}
.chart .lbl{{fill:var(--ink);font-size:11.5px}}
.chart .val{{fill:var(--ink-2);font-family:var(--mono);font-size:10.5px}}
.chart .b-now{{fill:var(--now);opacity:.9}}
.chart .b-peak{{fill:var(--peak);opacity:.55}}
.chart .area{{fill:var(--accent);opacity:.14}}
.chart .line{{fill:none;stroke:var(--accent);stroke-width:2}}
.chart .dot{{fill:var(--accent)}}
.yrtag{{font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:500;letter-spacing:0}}
.slider{{display:flex;align-items:center;gap:12px}}
.slider input[type=range]{{flex:1;accent-color:var(--accent);height:22px}}
.play{{width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:var(--panel);
  color:var(--accent);cursor:pointer;font-size:11px;line-height:1;flex:none}}
.play:hover{{background:var(--accent-soft)}}
.play[aria-pressed=true]{{background:var(--accent);color:var(--panel);border-color:var(--accent)}}
.yrout{{font-family:var(--mono);font-size:15px;font-variant-numeric:tabular-nums;min-width:46px;text-align:right}}
.tot{{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink-2);font-variant-numeric:tabular-nums}}
.drillable{{cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .12s}}
.drillable:hover{{border-color:var(--accent)}}
.drillable:focus-visible,.drillrow:focus-visible{{outline:2px solid var(--accent);outline-offset:1px}}
.drillrow{{cursor:pointer}}
.drillrow:hover td{{background:var(--accent-soft)}}
dialog#drill{{width:min(980px,calc(100vw - 32px));max-height:min(84vh,860px);padding:0;
  border:1px solid var(--line);border-radius:11px;background:var(--panel);color:var(--ink);
  box-shadow:0 18px 50px rgb(0 0 0 / 28%);overflow:hidden}}
dialog#drill::backdrop{{background:rgb(8 12 16 / 55%);backdrop-filter:blur(2px)}}
dialog#drill[open]{{display:flex;flex-direction:column}}
.drillhead{{display:flex;align-items:center;gap:10px;padding:14px 16px;
  border-bottom:1px solid var(--line);background:var(--panel);flex:none}}
.drillhead h2{{margin:0;flex:none}}
.drillhead input{{flex:1;font-family:var(--sans);font-size:13px;color:var(--ink);
  background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:6px 9px}}
.xbtn{{border:1px solid var(--line);background:var(--bg);color:var(--ink-2);border-radius:6px;
  width:28px;height:28px;cursor:pointer;font-size:16px;line-height:1;flex:none}}
.xbtn:hover{{border-color:var(--accent);color:var(--accent)}}
.tablewrap{{overflow:auto;flex:1;min-height:0;padding:0 16px}}
.tablewrap table{{min-width:720px}}
.tablewrap th{{position:sticky;top:0;background:var(--panel);z-index:1}}
.more{{width:calc(100% - 32px);margin:0 16px 14px;flex:none;padding:9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;
  color:var(--accent);font-family:var(--sans);font-size:13px;cursor:pointer}}
.more:hover{{background:var(--accent-soft)}}
.hint{{font-size:11.5px;color:var(--ink-3)}}
.legend{{display:flex;gap:16px;font-size:12px;color:var(--ink-2);align-items:center}}
.sw{{display:inline-block;width:11px;height:11px;border-radius:2px;vertical-align:-1px;margin-right:5px}}
.cols{{display:grid;grid-template-columns:1.35fr 1fr;gap:14px}}
@media (max-width:820px){{ .cols{{grid-template-columns:1fr}}
  .drillhead{{flex-wrap:wrap}} .drillhead h2{{width:100%}} }}
table{{border-collapse:collapse;width:100%}}
th{{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);padding:7px 8px;border-bottom:1px solid var(--line)}}
td{{padding:6px 8px;border-bottom:1px solid var(--line-soft)}}
.num{{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}}
.dim{{color:var(--ink-3)}}
.cc{{font-family:var(--mono);font-weight:600}}
</style>
<div class="wrap">
<header>
  <h1>Global data centre registry</h1>
  <p class="sub">{n_sites} distinct sites across {n_countries} countries, assembled from OpenStreetMap,
  PeeringDB and Epoch AI. Counts are deduplicated to sites rather than source rows.</p>
</header>

<div class="tiles">{tiles}</div>
<p class="hint">Click any figure, country or operator to list the sites behind it.</p>

<div class="panel card">
  <h2>AI data centres ranked by facility load <span id="yrTag" class="yrtag"></span></h2>
  <p class="note">Drag the year to re-rank. <strong>Facility</strong> load — what the utility
  delivers — not IT load, which runs 20&ndash;40% lower. Values are Epoch AI observations stepped
  forward from the last reading; years past {today} are its projections, not history.</p>
  <div class="chartwrap"><svg id="bars" class="chart" role="img"
       aria-label="AI data centres ranked by facility load for the selected year"></svg></div>
  <div class="slider">
    <button id="play" class="play" aria-label="Play through years">&#9654;</button>
    <input id="yr" type="range" min="0" max="0" step="1" value="0" aria-label="Year">
    <span id="yrOut" class="yrout"></span>
  </div>
  <div class="legend">
    <span><i class="sw" style="background:var(--now)"></i>observed</span>
    <span><i class="sw" style="background:var(--peak);opacity:.6"></i>projected</span>
    <span id="totOut" class="tot"></span>
  </div>
</div>

<div class="panel card">
  <h2>Cumulative projected AI facility load</h2>
  <p class="note">Stepped by the year each site is projected to reach peak capacity.</p>
  <div class="chartwrap">{ramp}</div>
</div>

<div class="cols">
  <div class="panel card">
    <h2>Sites by country</h2>
    <table>
      <thead><tr><th>Country</th><th class="num">Sites</th><th class="num">Multi-tenant</th>
      <th class="num">AI</th><th class="num">AI MW</th></tr></thead>
      <tbody>{country_rows}</tbody>
    </table>
  </div>
  <div class="panel card">
    <h2>Largest operators</h2>
    <table>
      <thead><tr><th>Operator</th><th class="num">Sites</th></tr></thead>
      <tbody>{op_rows}</tbody>
    </table>
    <h2 style="margin-top:10px">AI site status</h2>
    <table>
      <thead><tr><th>Status</th><th class="num">Sites</th></tr></thead>
      <tbody>{st_rows}</tbody>
    </table>
  </div>
</div>

<dialog id="drill" aria-labelledby="drillTitle">
  <div class="drillhead">
    <h2 id="drillTitle">Sites</h2>
    <input id="drillQ" type="search" placeholder="Filter by name, city, operator, utility&hellip;" aria-label="Filter results">
    <button type="button" id="drillClose" class="xbtn" aria-label="Close">&times;</button>
  </div>
  <div class="tablewrap">
    <table>
      <thead><tr><th>Site</th><th>Operator</th><th>Country</th><th>Tenancy</th>
      <th class="num">MW</th><th>Serving utility</th><th>Source</th></tr></thead>
      <tbody id="drillBody"></tbody>
    </table>
  </div>
  <button type="button" id="drillMore" class="more" hidden></button>
</dialog>

<p class="note"><strong>On build year.</strong> Only the {n_ai} AI sites carry dated observations,
which is why the charts above cover them alone. The other sites have no construction date in any
public source we found, so there is no global timeline to draw — showing one would be invention.
<strong>On completeness.</strong> These counts are a floor, not a census: coverage skews to
facilities that are well mapped or network-connected, and Singapore resolving to single digits
against a much larger real estate is the clearest evidence of what is still missing.</p>
</div>
<script>
const SITES = {data};
const M = __MATRIX__;
__SCRIPT__
</script>
"""


SLIDER_JS = r"""

// ---- drill-down -----------------------------------------------------------
// SITES is the deduplicated site list already embedded for the page; filtering
// it client-side avoids a second copy of the data.
const drill = document.getElementById('drill');
const drillBody = document.getElementById('drillBody');
const drillTitle = document.getElementById('drillTitle');
const drillQ = document.getElementById('drillQ');
const drillMore = document.getElementById('drillMore');
const PAGE_N = 200;
let current = [], shown = PAGE_N;

const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function select(kind, val) {
  switch (kind) {
    case 'all':      return [SITES, 'All sites'];
    case 'hasop':    return [SITES.filter(s => s.o), 'Sites with a known operator'];
    case 'tenancy':  return [SITES.filter(s => s.t === val), val + '-tenant sites'];
    case 'ft':       return [SITES.filter(s => s.ft === val),
                             val === 'ai' ? 'AI data centres' : 'Traditional data centres'];
    case 'country':  return [SITES.filter(s => s.c === val), 'Sites in ' + val];
    case 'operator': return [SITES.filter(s => s.o === val), 'Sites operated by ' + val];
    // Bars are keyed on Epoch's name; the site list may hold the OSM one.
    case 'site':     return [SITES.filter(s => s.n === val || s.en === val), val];
    default:         return [[], ''];
  }
}

function renderDrill() {
  const q = drillQ.value.trim().toLowerCase();
  const rows = q
    ? current.filter(s => (s.n + ' ' + s.ci + ' ' + s.o + ' ' + s.c + ' ' + s.u + ' ' + s.ref).toLowerCase().includes(q))
    : current;
  drillBody.innerHTML = rows.slice(0, shown).map(s => `<tr>
      <td>${s.n ? esc(s.n) : (s.ci ? `<span class="dim">unnamed, </span>${esc(s.ci)}`
          : '<span class="dim">unnamed</span>')}${s.ref ? `<span class="rf"> ${esc(s.ref)}</span>` : ''}${
          s.n && s.ci ? `<span class="rf"> ${esc(s.ci)}</span>` : ''}</td>
      <td>${esc(s.o) || '<span class="dim">unresolved</span>'}</td>
      <td class="cc">${esc(s.c)}</td>
      <td>${esc(s.t) || '<span class="dim">unknown</span>'}</td>
      <td class="num">${s.mw ? s.mw.toLocaleString() : '<span class="dim">—</span>'}</td>
      <td>${esc(s.u) || '<span class="dim">—</span>'}</td>
      <td class="dim">${esc(s.src)}</td></tr>`).join('');
  if (rows.length > shown) {
    drillMore.hidden = false;
    drillMore.textContent = `Show ${Math.min(PAGE_N, rows.length - shown)} more · ${(rows.length - shown).toLocaleString()} hidden`;
  } else drillMore.hidden = true;
  drillTitle.dataset.count = rows.length;
}

let lastFocus = null;

function openDrill(kind, val) {
  const [rows, title] = select(kind, val);
  if (!rows.length) return;
  current = rows; shown = PAGE_N; drillQ.value = '';
  drillTitle.textContent = `${title} · ${rows.length.toLocaleString()}`;
  renderDrill();
  // Only remember a trigger from outside the dialog: opening one drill from
  // another would otherwise capture the dialog's own search box and return
  // focus into a closed element.
  const active = document.activeElement;
  if (!drill.contains(active)) lastFocus = active;
  // showModal gives focus trapping, an inert background and Esc for free.
  if (typeof drill.showModal === 'function') drill.showModal();
  else drill.setAttribute('open', '');
  drill.querySelector('.tablewrap').scrollTop = 0;
  drillQ.focus();
}

function closeDrill() {
  if (drill.open && typeof drill.close === 'function') drill.close();
  else drill.removeAttribute('open');
}

document.querySelectorAll('.drillable, .drillrow').forEach(node => {
  node.addEventListener('click', () => openDrill(node.dataset.kind, node.dataset.val));
  node.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); node.click(); }
  });
});
drillQ.addEventListener('input', () => { shown = PAGE_N; renderDrill(); });
drillMore.addEventListener('click', () => { shown += PAGE_N; renderDrill(); });
document.getElementById('drillClose').addEventListener('click', closeDrill);
// Click on the backdrop closes: the dialog element itself covers only its box,
// so a click whose target is the dialog is a click outside the content.
drill.addEventListener('click', (e) => { if (e.target === drill) closeDrill(); });
drill.addEventListener('close', () => { if (lastFocus && lastFocus.focus) lastFocus.focus(); });

const NS = 'http://www.w3.org/2000/svg';
const TOP = 20, ROW = 22, LABEL_W = 210, PAD_R = 60, W = 720;
const el = (t, a) => { const n = document.createElementNS(NS, t);
  for (const k in a) n.setAttribute(k, a[k]); return n; };

// Fixed across years so bars stay comparable as you scrub; rescaling per year
// would make every year look identically full and hide the growth entirely.
const GLOBAL_MAX = Math.max(...M.sites.flatMap(s => s.v));
const svg = document.getElementById('bars');
const yr = document.getElementById('yr');
const yrOut = document.getElementById('yrOut');
const yrTag = document.getElementById('yrTag');
const totOut = document.getElementById('totOut');
const playBtn = document.getElementById('play');
yr.max = String(M.years.length - 1);
yr.value = String(M.years.indexOf(M.today) >= 0 ? M.years.indexOf(M.today) : M.years.length - 1);

function draw(idx) {
  const year = M.years[idx];
  const projected = year > M.today;
  const rows = M.sites.map(s => ({ n: s.n, mw: s.v[idx] }))
    .filter(r => r.mw > 0).sort((a, b) => b.mw - a.mw).slice(0, TOP);
  const h = Math.max(rows.length, 1) * ROW + 34;
  const plotW = W - LABEL_W - PAD_R;
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const x = LABEL_W + plotW * f;
    svg.appendChild(el('line', { x1: x, y1: 22, x2: x, y2: h - 12, class: 'grid' }));
    const t = el('text', { x, y: 14, class: 'tick', 'text-anchor': 'middle' });
    t.textContent = (GLOBAL_MAX * f / 1000).toFixed(1) + 'k';
    svg.appendChild(t);
  }
  const ax = el('text', { x: LABEL_W + plotW / 2, y: h - 1, class: 'axis', 'text-anchor': 'middle' });
  ax.textContent = 'facility load, MW';
  svg.appendChild(ax);

  rows.forEach((r, i) => {
    const y = 22 + i * ROW, w = plotW * (r.mw / GLOBAL_MAX);
    const lab = el('text', { x: LABEL_W - 8, y: y + 13, class: 'lbl', 'text-anchor': 'end' });
    lab.textContent = r.n.length > 32 ? r.n.slice(0, 31) + '…' : r.n;
    svg.appendChild(lab);
    const bar = el('rect', { x: LABEL_W, y: y + 3, width: Math.max(w, 0),
      height: ROW - 8, class: projected ? 'b-peak' : 'b-now' });
    bar.style.cursor = 'pointer';
    bar.addEventListener('click', () => openDrill('site', r.n));
    svg.appendChild(bar);
    const v = el('text', { x: LABEL_W + w + 6, y: y + 13, class: 'val' });
    v.textContent = Math.round(r.mw).toLocaleString();
    svg.appendChild(v);
  });

  const total = M.sites.reduce((a, s) => a + s.v[idx], 0);
  yrOut.textContent = year;
  yrTag.textContent = projected ? '· ' + year + ' projected' : '· ' + year;
  totOut.textContent = rows.length + ' sites · ' + Math.round(total).toLocaleString() + ' MW total';
}

yr.addEventListener('input', () => draw(+yr.value));

let timer = null;
function stop() { clearInterval(timer); timer = null; playBtn.setAttribute('aria-pressed', 'false'); }
playBtn.addEventListener('click', () => {
  if (timer) return stop();
  playBtn.setAttribute('aria-pressed', 'true');
  if (+yr.value >= +yr.max) yr.value = '0';
  timer = setInterval(() => {
    if (+yr.value >= +yr.max) return stop();
    yr.value = String(+yr.value + 1); draw(+yr.value);
  }, 700);
});
yr.addEventListener('pointerdown', stop);
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) playBtn.hidden = true;

draw(+yr.value);

"""


if __name__ == "__main__":
    main()
