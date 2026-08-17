// Server-rendered summary of the fab layer: /fabs.
//
// The map answers "where", and for 78 dots spread over 13 countries that is
// not enough - the interesting questions about fabs are comparative. Who runs
// how many, where is capacity concentrated, and how much of it is actually
// measurable rather than modelled. Those are table questions, not map ones.
//
// EVERY POWER FIGURE ON THIS PAGE IS AN ESTIMATE and the page says so four
// times: in the lede, on the summary tile, in the column header, and once per
// row. That is not over-caution. No fab on earth publishes its electricity
// demand, the model is good to about a factor of two, and a clean-looking
// table is exactly the surface where a modelled number gets quoted as a fact.

import { esc, n0, makeGeo } from './summary.mjs';

// Thirteen countries, so the grouping is written down rather than derived.
// Ordered by how much leading-edge capacity sits in each, which is also
// roughly the order anyone asking about fabs cares about.
const REGION = {
  TW: 'East Asia', CN: 'East Asia', JP: 'East Asia', KR: 'East Asia',
  US: 'North America',
  DE: 'Europe', FR: 'Europe', IT: 'Europe', AT: 'Europe', IE: 'Europe',
  SG: 'Southeast Asia', MY: 'Southeast Asia',
  IL: 'Middle East',
};
const COUNTRY = {
  TW: 'Taiwan', CN: 'China', JP: 'Japan', KR: 'South Korea', US: 'United States',
  DE: 'Germany', FR: 'France', IT: 'Italy', AT: 'Austria', IE: 'Ireland',
  SG: 'Singapore', MY: 'Malaysia', IL: 'Israel',
};
const STATUS = { operating: 'Operating', construction: 'Building',
                 announced: 'Announced', closed: 'Closed' };

// Roll a set of fabs into the numbers every grouping needs, so the region
// table and the company table cannot drift apart.
function roll(list) {
  const est = list.filter(f => f.mw);
  const nodes = list.map(f => f.nm).filter(Boolean);
  const opNodes = list.filter(f => f.k === 'operating').map(f => f.nm).filter(Boolean);
  return {
    n: list.length,
    operating: list.filter(f => f.k === 'operating').length,
    building: list.filter(f => f.k === 'construction').length,
    mw: est.reduce((a, f) => a + f.mw, 0),
    // The denominator travels with the total, always. "1,903 MW" alone reads
    // as the capacity of 78 fabs; it is the capacity of the 14 that could be
    // modelled, and the difference is most of the layer.
    estOf: `${est.length} of ${list.length}`,
    // Finest node is TWO facts and conflating them overstates the industry.
    // The minimum across every record includes fabs that do not exist yet:
    // taking it whole reported 1.4 nm "in production" when 1.4 nm is Terafab's
    // 2027 announcement and the finest node actually running is Intel's 1.8.
    finest: opNodes.length ? Math.min(...opNodes) : null,
    finestAny: nodes.length ? Math.min(...nodes) : null,
  };
}

const tile = (label, value, sub = '') =>
  `<div class="fabtile"><span class="fk">${esc(label)}</span>` +
  `<span class="fabtile-v">${value}</span>` +
  (sub ? `<span class="fabtile-s">${esc(sub)}</span>` : '') + '</div>';

export function renderFabsPage(fabs, regions) {
  // Regions from the operator directory's 240-entry table rather than the
  // 13-country map this file used to carry: three summary pages sharing one
  // source is the only way they agree about where a country is.
  const geo = makeGeo(regions);
  const all = roll(fabs);
  const countries = new Set(fabs.map(f => f.cy));

  // ---- by region -----------------------------------------------------------
  const byRegion = new Map();
  for (const f of fabs) {
    const r = geo.region(f.cy);
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push(f);
  }
  const regionRows = [...byRegion.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, list]) => {
      const s = roll(list);
      const cys = [...new Set(list.map(f => f.cy))]
        .sort((a, b) => list.filter(f => f.cy === b).length - list.filter(f => f.cy === a).length);
      return `<tr>
        <td><b>${esc(name)}</b></td>
        <td class="num">${s.n}</td>
        <td class="num">${s.operating}</td>
        <td class="num">${s.building || ''}</td>
        <td class="num">${s.finest ? s.finest + ' nm'
          : s.finestAny ? `<span class="dim">${s.finestAny} nm*</span>` : ''}</td>
        <td class="num">${s.mw ? '~' + n0(s.mw) : ''}<span class="dim"> ${esc(s.estOf)}</span></td>
        <td class="dim">${cys.map(c => esc(geo.country(c))
          + ' ' + list.filter(f => f.cy === c).length).join(' · ')}</td>
      </tr>`;
    }).join('');

  // ---- by company ----------------------------------------------------------
  // Keyed on the PARENT, not the legal operator. TSMC runs Kumamoto through
  // JASM, Dresden through ESMC and Arizona through TSMC Arizona Corporation;
  // grouped on the legal name that is four companies with one fab each, and
  // "who runs the most fabs" comes out wrong. src/fabs.py derives `grp`.
  const byCo = new Map();
  for (const f of fabs) {
    const k = f.grp || f.op || 'Unknown';
    if (!byCo.has(k)) byCo.set(k, []);
    byCo.get(k).push(f);
  }
  const coRows = [...byCo.entries()]
    .sort((a, b) => b[1].length - a[1].length || (roll(b[1]).mw - roll(a[1]).mw))
    .map(([name, list]) => {
      const s = roll(list);
      const cys = [...new Set(list.map(f => f.cy))].sort();
      // Where the parent operates through a differently-named entity, say so -
      // the grouping is a convenience and should not hide the legal operator.
      // Shorten FIRST, then dedupe. Deduping the legal names left three
      // spellings of "Intel Corporation" that all collapse to one once the
      // trailing clause is cut, and printed the parent's own name back at it.
      const via = [...new Set(list.map(f => (f.op || '').split(/[,(]/)[0].trim()))]
        .filter(o => o && o.toLowerCase() !== name.toLowerCase()
                  && !o.toLowerCase().startsWith(name.toLowerCase()));
      return `<tr>
        <td><b>${esc(name)}</b>${via.length && via.length < 4
          ? `<div class="dim fabvia">via ${esc(via.join(', '))}</div>` : ''}</td>
        <td class="num">${s.n}</td>
        <td class="num">${s.finest ? s.finest + ' nm'
          : s.finestAny ? `<span class="dim">${s.finestAny} nm*</span>` : ''}</td>
        <td class="num">${s.mw ? '~' + n0(s.mw) : ''}<span class="dim"> ${esc(s.estOf)}</span></td>
        <td class="dim">${cys.map(c => esc(geo.country(c))).join(' · ')}</td>
      </tr>`;
    }).join('');

  // ---- every fab -----------------------------------------------------------
  const fabRows = fabs.map(f => `<tr>
    <td><a href="/fab/${esc(f.id)}"><b>${esc(f.n)}</b></a>${[f.nt, f.pn].filter(Boolean)
      .map(t => `<div class="dim fabvia">${esc(t)}</div>`).join('')}</td>
    <td>${esc(f.grp || f.op)}</td>
    <td class="dim">${esc([f.pl, geo.country(f.cy)].filter(Boolean).join(', '))}</td>
    <td><span class="badge b-${esc(f.k)}">${esc(STATUS[f.k] || f.k)}</span></td>
    <td class="num">${f.nm ? f.nm + ' nm' : ''}</td>
    <td class="num">${f.wf ? f.wf + ' mm' : ''}</td>
    <td class="num">${f.ws ? n0(f.ws) : ''}</td>
    <td class="num">${f.mw ? '~' + n0(f.mw)
      : f.pn ? '<span class="dim">see note</span>' : '<span class="dim">—</span>'}</td>
    <td>${(f.src || []).slice(0, 1).map(u =>
      `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">source ↗</a>`).join('')}</td>
  </tr>`).join('');

  const noEst = all.n - fabs.filter(f => f.mw).length;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Semiconductor fabs · Data Centre Registry</title>
<link rel="stylesheet" href="/app.css">
</head><body>
<header class="topbar">
  <a class="brand" href="/">◀ Data Centre Registry</a>
  <span class="spacer"></span>
  <!-- This page predates summary.mjs and still builds its own header, which is
       exactly the drift that module's own note warns about: adding /quakes to
       the shared page() left this one a link short. Kept in step by hand until
       the header moves too. -->
  <a class="sumnav" href="/datacentres">Data centres</a>
  <a class="sumnav" href="/plants">Power plants</a>
  <a class="sumnav" href="/fabs">Fabs</a>
  <a class="sumnav" href="/quakes">Earthquakes</a>
  <button id="themeBtn" class="themebtn" aria-label="Toggle day / night view"></button>
</header>
<main class="wrap">
  <header class="sitehead">
    <nav class="crumbs"><a href="/">Map</a> <span>›</span> <b>Semiconductor fabs</b></nav>
    <h1>Semiconductor fabs</h1>
    <p class="lede">The ${all.n} fabs on the map, which are here for the same reason
    the power plants are: a leading-edge fab draws hundreds of megawatts and
    competes with data centres for the same interconnection queue. Every
    megawatt figure below is <b>modelled, not measured</b> — no fab publishes
    its electricity demand.</p>
    <p class="note"><a href="/?fabs=1">Show them on the map</a></p>
  </header>

  <section class="panel card">
    <div class="fabtiles">
      ${tile('Fabs', all.n, `${countries.size} countries`)}
      ${tile('Operating', all.operating, all.building ? `${all.building} building` : '')}
      ${tile('Finest node', all.finest ? all.finest + ' nm' : '—',
             all.finestAny < all.finest ? `in production · ${all.finestAny} nm announced`
                                        : 'in production')}
      ${tile('Estimated load', '~' + n0(all.mw) + ' MW', all.estOf + ' fabs')}
    </div>
    <p class="note">The estimate covers ${all.estOf} fabs because the other
    ${noEst} do not publish both a wafer capacity and a process node, and
    guessing the node would dominate every other error in the model — it spans
    more than an order of magnitude across the node range. Where a figure is
    shown it is derived from published wafer starts and node, anchored on
    TSMC's fleet-wide energy disclosure and the one per-fab figure that exists
    anywhere (TSMC Arizona, ~200 MW). Treat it as good to a factor of two.</p>
  </section>

  <section class="panel card">
    <h2>By region</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Region</th><th class="num">Fabs</th><th class="num">Operating</th>
        <th class="num">Building</th><th class="num">Finest</th>
        <th class="num">Est. MW</th><th>Countries</th></tr></thead>
      <tbody>${regionRows}</tbody>
    </table></div>
    <p class="note"><b>Finest</b> is the smallest process node in production. A dimmed figure marked * is not running yet — it is the finest node announced or under construction, shown only where nothing is in production to report.</p>
  </section>

  <section class="panel card">
    <h2>By company <span class="dim">${byCo.size}</span></h2>
    <p class="note">Current owner, not original builder — the fab at Mie counts
    as UMC's and East Fishkill as onsemi's.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Company</th><th class="num">Fabs</th><th class="num">Finest</th>
        <th class="num">Est. MW</th><th>Where</th></tr></thead>
      <tbody>${coRows}</tbody>
    </table></div>
    <p class="note"><b>Finest</b> is the smallest process node in production. A dimmed figure marked * is not running yet — it is the finest node announced or under construction, shown only where nothing is in production to report.</p>
  </section>

  <section class="panel card">
    <h2>Every fab <span class="dim">${all.n}</span></h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Fab</th><th>Operator</th><th>Where</th><th>Status</th>
        <th class="num">Node</th><th class="num">Wafer</th><th class="num">Wafers/mo</th>
        <th class="num">Est. MW</th><th>Source</th></tr></thead>
      <tbody>${fabRows}</tbody>
    </table></div>
    <p class="note">Sourced per fab from company disclosures, CHIPS Act filings
    and official plant pages; the worklist of names came from a public index but
    no value was carried across from it. Built by <span class="mono">src/fabs.py</span>.</p>
  </section>
</main>
<script src="/theme.js"></script>
</body></html>`;
}
