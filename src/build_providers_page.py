"""Regenerate docs/providers.html from data/registry.csv.

Kept as a script because the page embeds the data: publishing it once and
editing the CSV afterwards silently leaves a stale artifact. The first version
was built by hand and drifted - it displayed SPV shell names ("NOVA BUILDING 2
LLC") in the operator column, which the pipeline had since learned to mark
unresolved.
"""

import csv, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "registry.csv"

KNOWN = ("matched", "osm_tag", "matched_osm_differs")


def num(v):
    try:
        return int(float(v or 0))
    except (TypeError, ValueError):
        return 0


rows = []
for r in csv.DictReader(SRC.open()):
    known = r["operator_confidence"] in KNOWN
    rows.append({
        "n": r["name"] or "\u2014",
        # Only show an operator we actually resolved. The raw title-holder is
        # usually a single-purpose LLC and reads as a real company if shown.
        "o": r["operator"] if known else "",
        "oc": r["operator_confidence"],
        "raw": r["operator_raw"],
        "oo": r.get("operator_osm", ""),
        "l": r["locality"].replace(" County", "").replace(" City", ""),
        "u": r["utility"], "s": r["status"],
        "sf": num(r["sq_ft"]),
        "b": num(r["utility_boundary_m"]) if r.get("utility_boundary_m") else -1,
        "f": 1 if "near_boundary" in r["utility_confidence"] else 0,
        "g": 1 if r["self_generation"] else 0,
        "ref": r.get("osm_ref", ""),
        "lat": r["lat"], "lon": r["lon"],
    })
data = json.dumps(rows, separators=(",", ":"))

HEAD = """<title>Virginia Data Center Power Providers</title>
<style>
:root{
  --bg:#F3F5F7; --panel:#FFFFFF; --line:#D8DEE4; --line-soft:#E7ECF0;
  --ink:#161C22; --ink-2:#4A5763; --ink-3:#77848F;
  --accent:#2C6E8F; --accent-soft:#E3EDF2;
  --warn:#B5761E; --warn-soft:#F7EBD8;
  --dom:#2F5D8C; --novec:#3E7C55; --rec:#7A4E93; --muni:#9A6A2C; --other:#6B7783;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#11151A; --panel:#171D24; --line:#2A333D; --line-soft:#222A33;
    --ink:#E7ECF1; --ink-2:#A3B0BC; --ink-3:#79868F;
    --accent:#6FB4D6; --accent-soft:#1B2A34;
    --warn:#E0A martingale; --warn-soft:#2E2519;
    --dom:#7BA6D4; --novec:#6FB98A; --rec:#B08FC9; --muni:#D0A363; --other:#8B98A4;
  }
}
:root[data-theme="dark"]{
  --bg:#11151A; --panel:#171D24; --line:#2A333D; --line-soft:#222A33;
  --ink:#E7ECF1; --ink-2:#A3B0BC; --ink-3:#79868F;
  --accent:#6FB4D6; --accent-soft:#1B2A34;
  --warn:#E0A75C; --warn-soft:#2E2519;
  --dom:#7BA6D4; --novec:#6FB98A; --rec:#B08FC9; --muni:#D0A363; --other:#8B98A4;
}
:root[data-theme="light"]{
  --bg:#F3F5F7; --panel:#FFFFFF; --line:#D8DEE4; --line-soft:#E7ECF0;
  --ink:#161C22; --ink-2:#4A5763; --ink-3:#77848F;
  --accent:#2C6E8F; --accent-soft:#E3EDF2;
  --warn:#B5761E; --warn-soft:#F7EBD8;
  --dom:#2F5D8C; --novec:#3E7C55; --rec:#7A4E93; --muni:#9A6A2C; --other:#6B7783;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
  font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1240px;margin:0 auto;padding:28px 20px 64px;display:flex;flex-direction:column;gap:22px}
header{display:flex;flex-direction:column;gap:6px}
h1{margin:0;font-size:23px;letter-spacing:-0.02em;font-weight:640;text-wrap:balance}
.sub{color:var(--ink-2);max-width:66ch}
.note{font-size:12.5px;color:var(--ink-3);max-width:74ch}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:9px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:10px}
.tile{padding:13px 14px;display:flex;flex-direction:column;gap:7px}
.tile .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-3)}
.tile .v{font-family:var(--mono);font-size:25px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.tile .m{font-size:12px;color:var(--ink-2)}
.bar{height:4px;border-radius:2px;background:var(--line-soft);overflow:hidden}
.bar i{display:block;height:100%}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 13px}
select,input[type=search]{font-family:var(--sans);font-size:13px;color:var(--ink);
  background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:7px 9px}
input[type=search]{min-width:210px;flex:1}
select:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.toggle{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-2);
  border:1px solid var(--line);border-radius:6px;padding:7px 10px;cursor:pointer;background:var(--bg)}
.toggle[aria-pressed=true]{border-color:var(--warn);background:var(--warn-soft);color:var(--warn)}
.count{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:940px}
th{position:sticky;top:0;z-index:2;background:var(--panel);text-align:left;font-family:var(--mono);
  font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);
  padding:10px 10px;border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap;user-select:none}
th:hover{color:var(--ink)}
th[aria-sort] .ar{color:var(--accent)}
.ar{font-size:9px;opacity:.85}
td{padding:9px 10px;border-bottom:1px solid var(--line-soft);vertical-align:top}
tbody tr:hover{background:var(--accent-soft)}
tbody tr.flag td:first-child{box-shadow:inset 3px 0 0 var(--warn)}
.nm{font-weight:560;letter-spacing:-.005em}
.rf{font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-left:6px}
.op{color:var(--ink-2)}
.op.none{color:var(--ink-3);font-style:italic}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;white-space:nowrap}
.dot{width:7px;height:7px;border-radius:50%;flex:none}
.pill{display:inline-block;font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;
  text-transform:uppercase;padding:2.5px 7px;border-radius:999px;border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
.pill.built{border-color:color-mix(in srgb,var(--novec) 45%,transparent);color:var(--novec)}
.pill.pipe{border-color:var(--line);color:var(--ink-3)}
.bdist{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;color:var(--ink-3)}
.bdist.risk{color:var(--warn);font-weight:600}
.gen{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.empty{padding:34px;text-align:center;color:var(--ink-3)}
.more{display:block;width:100%;padding:11px;background:var(--panel);border:1px solid var(--line);
  border-radius:7px;color:var(--accent);font-family:var(--sans);font-size:13px;cursor:pointer}
.more:hover{background:var(--accent-soft)}
.legend{display:flex;flex-wrap:wrap;gap:14px;padding:11px 13px;font-size:12.5px;color:var(--ink-2)}
@media (max-width:640px){ .wrap{padding:18px 12px 48px} h1{font-size:20px} }
</style>"""

BODY = """
<div class="wrap">
<header>
  <h1>Virginia data center sites and their power providers</h1>
  <p class="sub">832 records from Loudoun County parcels, Prince William building permits, and the PEC statewide tracker. Serving utility is assigned by point-in-polygon against Virginia's certificated service territories.</p>
</header>

<div class="tiles" id="tiles"></div>

<div class="panel legend">
  <span><strong>Sources overlap.</strong> PEC, Loudoun and Prince William all cover the same Northern Virginia sites &mdash; these are records, not 832 distinct facilities. Deduplicated spatially the count is roughly 510.</span>
</div>

<div class="panel controls">
  <input type="search" id="q" placeholder="Search name, operator, title holder, facility ref&hellip;" aria-label="Search sites">
  <select id="fu" aria-label="Filter by provider"><option value="">All providers</option></select>
  <select id="fl" aria-label="Filter by locality"><option value="">All localities</option></select>
  <select id="fs" aria-label="Filter by status"><option value="">Any status</option><option value="built">Built / operating</option><option value="pipe">Pipeline</option></select>
  <button class="toggle" id="ff" aria-pressed="false">Boundary risk only</button>
  <span class="count" id="count"></span>
</div>

<div class="panel tablewrap">
  <table>
    <thead><tr>
      <th data-k="n">Site <span class="ar"></span></th>
      <th data-k="o">Operator <span class="ar"></span></th>
      <th data-k="oo">OSM operator <span class="ar"></span></th>
      <th data-k="u">Serving utility <span class="ar"></span></th>
      <th data-k="l">Locality <span class="ar"></span></th>
      <th data-k="s">Status <span class="ar"></span></th>
      <th data-k="sf" class="num">Sq ft <span class="ar"></span></th>
      <th data-k="b" class="num">To boundary <span class="ar"></span></th>
      <th data-k="g">On-site gen <span class="ar"></span></th>
    </tr></thead>
    <tbody id="tb"></tbody>
  </table>
  <div class="empty" id="empty" hidden>No sites match those filters.</div>
</div>
<button class="more" id="more" hidden></button>

<p class="note"><strong>Boundary distance</strong> is how far the site sits from the nearest utility territory line. Under <em>NOVEC v. Virginia Electric &amp; Power Co.</em> (Va. 2003) a customer whose facility straddles a boundary may choose its utility, and parcel centroids themselves carry tens of metres of error &mdash; so the 39 sites within 150 m are flagged as inferences worth confirming, not settled facts. Everything here is derived from public county, state and PJM records.</p>
</div>
"""

SCRIPT = """
<script>
const D = __DATA__;
const UC = {'Dominion (VEPCO)':'var(--dom)','NOVEC (co-op)':'var(--novec)','REC (co-op)':'var(--rec)'};
const ucol = u => UC[u] || (/municipal/.test(u) ? 'var(--muni)' : 'var(--other)');
const BUILT = /BUILT|COMPLETED|EXISTING|UNDER CONSTRUCTION/i;
const isBuilt = s => BUILT.test(s || '');
const fmt = n => n > 0 ? n.toLocaleString() : '\\u2014';

const $ = id => document.getElementById(id);
let sortK = 'sf', sortD = -1, shown = 150;

// summary tiles
(function tiles(){
  const by = {};
  D.forEach(r => { const u = r.u || 'Unassigned'; by[u] = (by[u]||0)+1; });
  const top = Object.entries(by).sort((a,b) => b[1]-a[1]);
  const main = top.slice(0,3);
  const rest = top.slice(3).reduce((s,x) => s+x[1], 0);
  const flagged = D.filter(r => r.f).length;
  const cards = main.map(([u,c]) => ({k:u.replace(' (co-op)',' \\u00b7 co-op').replace(' (VEPCO)',''),
      v:c, m:(c/D.length*100).toFixed(0)+'% of records', col:ucol(u)}));
  cards.push({k:'All other providers', v:rest, m:'14 utilities', col:'var(--other)'});
  cards.push({k:'Boundary risk', v:flagged, m:'within 150 m of a line', col:'var(--warn)'});
  $('tiles').innerHTML = cards.map(c => `<div class="panel tile">
      <span class="k">${c.k}</span><span class="v">${c.v.toLocaleString()}</span>
      <div class="bar"><i style="width:${Math.max(2,c.v/D.length*100)}%;background:${c.col}"></i></div>
      <span class="m">${c.m}</span></div>`).join('');
})();

// filter options
(function opts(){
  const uniq = k => [...new Set(D.map(r => r[k]).filter(Boolean))].sort();
  uniq('u').forEach(u => $('fu').insertAdjacentHTML('beforeend', `<option>${u}</option>`));
  uniq('l').forEach(l => $('fl').insertAdjacentHTML('beforeend', `<option>${l}</option>`));
})();

function current(){
  const q = $('q').value.trim().toLowerCase(), u = $('fu').value, l = $('fl').value,
        s = $('fs').value, f = $('ff').getAttribute('aria-pressed') === 'true';
  return D.filter(r => {
    if (u && r.u !== u) return false;
    if (l && r.l !== l) return false;
    if (f && !r.f) return false;
    if (s === 'built' && !isBuilt(r.s)) return false;
    if (s === 'pipe' && isBuilt(r.s)) return false;
    if (q && !((r.n+' '+r.o+' '+r.oo+' '+r.raw+' '+r.ref+' '+r.l).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => {
    let x = a[sortK], y = b[sortK];
    if (typeof x === 'string') {
      // Blank strings sink regardless of direction.
      if (!x !== !y) return x ? -1 : 1;
      return x.localeCompare(y) * sortD;
    }
    // -1 marks "not measured"; 0 sq ft means unknown. Neither is a real value,
    // so keep them at the bottom instead of letting them lead an ascending sort
    // and read as the closest to a boundary or the smallest site.
    const mx = x < 0 || (sortK === 'sf' && x === 0), my = y < 0 || (sortK === 'sf' && y === 0);
    if (mx !== my) return mx ? 1 : -1;
    return (x - y) * sortD;
  });
}

function render(){
  const rows = current();
  $('count').textContent = rows.length.toLocaleString() + ' of ' + D.length.toLocaleString() + ' records';
  $('empty').hidden = rows.length > 0;
  const slice = rows.slice(0, shown);
  $('tb').innerHTML = slice.map(r => `<tr class="${r.f?'flag':''}">
    <td><span class="nm">${r.n}</span>${r.ref?`<span class="rf">${r.ref}</span>`:''}</td>
    <td class="op ${r.o?'':'none'}">${r.o || 'unresolved'}${r.o && r.oc==='osm_tag'?'<span class="rf">osm</span>':''}</td>
    <td class="op ${r.oo?'':'none'}">${r.oo || ''}</td>
    <td><span class="chip"><span class="dot" style="background:${ucol(r.u)}"></span>${r.u || '\\u2014'}</span></td>
    <td>${r.l}</td>
    <td><span class="pill ${isBuilt(r.s)?'built':'pipe'}">${r.s || '\\u2014'}</span></td>
    <td class="num">${fmt(r.sf)}</td>
    <td class="bdist ${r.f?'risk':''}">${r.b >= 0 ? r.b.toLocaleString()+' m' : '\\u2014'}</td>
    <td class="gen">${r.g ? 'air permit' : ''}</td></tr>`).join('');
  const more = $('more');
  if (rows.length > shown){ more.hidden = false; more.textContent = `Show ${Math.min(300, rows.length-shown)} more \\u00b7 ${(rows.length-shown).toLocaleString()} hidden`; }
  else more.hidden = true;
}

['q','fu','fl','fs'].forEach(id => $(id).addEventListener('input', () => { shown = 150; render(); }));
$('ff').addEventListener('click', e => {
  const t = e.currentTarget, on = t.getAttribute('aria-pressed') === 'true';
  t.setAttribute('aria-pressed', String(!on)); shown = 150; render();
});
$('more').addEventListener('click', () => { shown += 300; render(); });
document.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k;
  if (sortK === k) sortD = -sortD; else { sortK = k; sortD = (k === 'sf' || k === 'b') ? -1 : 1; }
  document.querySelectorAll('th[data-k]').forEach(o => { o.removeAttribute('aria-sort'); o.querySelector('.ar').textContent=''; });
  th.setAttribute('aria-sort', sortD === 1 ? 'ascending' : 'descending');
  th.querySelector('.ar').textContent = sortD === 1 ? '\\u25B2' : '\\u25BC';
  shown = 150; render();
}));
render();
</script>
"""

html = HEAD + BODY + SCRIPT.replace('__DATA__', data)
out = ROOT / 'docs' / 'providers.html'
out.write_text(html)
print(f'wrote {out.relative_to(ROOT)}  ({len(rows)} rows, {len(html)/1024:.0f} KB)')
