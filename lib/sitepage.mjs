// Server-rendered detail page for one site: /site/<site_id>.
//
// The URL is the share unit, so everything the registry knows about the site
// is rendered here — the deduped summary, the Virginia county records where
// they exist, every source row behind the cluster, and the Epoch observation
// series for AI sites.

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (v) => num(v) ? Math.round(num(v)).toLocaleString('en-US') : '';

function fact(label, value, cls = '') {
  if (value === '' || value == null) return '';
  return `<div class="fact"><span class="fk">${esc(label)}</span>` +
         `<span class="fv ${cls}">${value}</span></div>`;
}

function osmUrl(osmId) {
  const m = /^dcf-([wnr])(\d+)$/.exec(osmId || '') ||
            /^([wnr])(\d+)$/.exec(osmId || '');
  if (!m) return null;
  const kind = { w: 'way', n: 'node', r: 'relation' }[m[1]];
  return `https://www.openstreetmap.org/${kind}/${m[2]}`;
}


// Epoch's "Selected Sources" is markdown bullets of [label](url), and the
// per-observation prose has inline links too. Render only that one construct,
// after escaping everything - never pass source text through as HTML.
function mdLinks(text) {
  return esc(text).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
}

// "SpaceXAI #confident" -> "SpaceXAI"; the tag is Epoch's own confidence mark.
const untag = (v) => String(v || '').split(',')
  .map(x => x.replace(/#\w+/g, '').trim()).filter(Boolean).join(', ');

function sparkline(series, cutT = Infinity, w = 560, h = 190) {
  const pts = series.filter(p => p.v > 0 || true);
  if (pts.length < 2) return '';
  const top = Math.max(...pts.map(p => p.v)) * 1.1 || 1;
  const x0 = pts[0].t, x1 = pts[pts.length - 1].t;
  const L = 54, B = 26, T = 10, R = 10;
  const px = t => L + (w - L - R) * ((t - x0) / Math.max(1e-9, x1 - x0));
  const py = v => T + (h - T - B) * (1 - v / top);
  // Step, not slope: capacity arrives when a building energises, and drawing
  // a ramp between observations would invent a build-out that did not happen.
  // Two paths, split at today: a projection must not look like a measurement.
  let d = `M${px(pts[0].t).toFixed(1)},${py(pts[0].v).toFixed(1)}`, dF = '';
  for (let i = 1; i < pts.length; i++) {
    const seg = `L${px(pts[i].t).toFixed(1)},${py(pts[i - 1].v).toFixed(1)}`
              + `L${px(pts[i].t).toFixed(1)},${py(pts[i].v).toFixed(1)}`;
    if (pts[i].t <= cutT) d += seg;
    else {
      if (!dF) dF = `M${px(pts[i - 1].t).toFixed(1)},${py(pts[i - 1].v).toFixed(1)}`;
      dF += seg;
    }
  }
  const grid = [0, 0.5, 1].map(f => {
    const y = py(top * f);
    return `<line class="bo-grid" x1="${L}" y1="${y.toFixed(1)}" x2="${w - R}" y2="${y.toFixed(1)}"/>` +
      `<text class="bo-ax" x="${L - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end">${fmtCompact(top * f)}</text>`;
  }).join('');
  const dots = pts.map(p =>
    `<circle class="bo-dot" cx="${px(p.t).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="3.5"><title>${esc(p.label)}</title></circle>`).join('');
  const years = [];
  for (let y = Math.ceil(x0); y <= x1; y++) {
    years.push(`<text class="bo-ax" x="${px(y).toFixed(1)}" y="${h - 8}" text-anchor="middle">${y}</text>`);
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="bo-chart" role="img" aria-label="Build-out over time">` +
    grid + `<path class="bo-line" d="${d}"/>` +
    (dF ? `<path class="bo-line bo-line-future" d="${dF}"/>` : '') +
    dots + years.join('') + '</svg>';
}

const fmtCompact = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
  : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v));

const decDate = (d) => {
  const y = +d.slice(0, 4);
  return y + (Date.UTC(y, +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(y, 0, 1))
    / (365.25 * 86400000);
};

export function renderSitePage(ctx) {
  const { site, rows, va, traj, timeline, epoch, images = [],
          link = null, operator = null, opKey = '', mates = [] } = ctx;
  const title = site.name || site.epoch_name ||
    (site.city ? `Data centre, ${site.city}` : 'Data centre');
  const isAI = site.facility_type === 'ai';

  const badges = [
    `<span class="badge ${isAI ? 'b-ai' : 'b-trad'}">${isAI ? 'AI' : 'traditional'}</span>`,
    site.tenancy ? `<span class="badge">${esc(site.tenancy)}-tenant</span>` : '',
    site.status ? `<span class="badge b-status">${esc(site.status.replace(/_/g, ' '))}</span>` : '',
  ].join('');

  const nets = Math.max(0, ...rows.map(r => num(r.networks_present)));
  const users = rows.map(r => r.users).find(Boolean) || '';
  const chips = rows.map(r => r.chip_types).find(Boolean) || '';
  const energy = rows.map(r => r.energy_companies).find(Boolean) || '';
  const address = rows.map(r => r.address).find(Boolean) || '';
  const tenancyBasis = rows.map(r => r.tenancy_basis).find(Boolean) || '';
  const osmRow = rows.find(r => r.osm_id);
  const osm = osmRow ? osmUrl(osmRow.osm_id) : null;

  const facts = [
    fact('Operator', site.operator
      ? (opKey ? `<a href="/operator/${encodeURIComponent(opKey)}">${esc(site.operator)}</a>`
               : esc(site.operator))
      : '<span class="dim">unresolved</span>'),
    fact('Location', esc([site.city, site.country].filter(Boolean).join(', '))),
    site.lat ? fact('Coordinates', `<span class="mono">${esc(site.lat)}, ${esc(site.lon)}</span>` +
      (osm ? ` · <a href="${osm}" target="_blank" rel="noopener noreferrer">OSM</a>` : '')) : '',
    fact('Facility code', esc(site.ref || '')),
    fact('Serving utility', esc(site.utility || '')),
    fact('Tenancy basis', esc(tenancyBasis)),
    nets ? fact('Networks present', `${nets} <span class="dim">(PeeringDB)</span>`) : '',
    address ? fact('Address', esc(address)) : '',
    users ? fact('Users / workloads', esc(users)) : '',
    site.needs_review
      ? fact('Verification', 'Unverified — every source row for this site is a '
          + 'PeeringDB listing with no networks, IXs or carriers. A sample of '
          + 'such rows found most were not data centres.')
      : '',
    chips ? fact('Chip types', esc(chips)) : '',
    energy ? fact('Energy companies', esc(energy)) : '',
  ].join('');

  let power = '';
  if (isAI && traj) {
    power = `
    <section class="panel card">
      <h2>Power</h2>
      <div class="facts">
        ${fact('Facility load today', `<strong>${fmt(traj.power_mw_total_current)}</strong> MW`)}
        ${fact('IT load today', `${fmt(traj.power_mw_it_current)} MW`)}
        ${fact('Projected facility peak', `<strong>${fmt(traj.power_mw_total_peak)}</strong> MW` +
          (traj.peak_date ? ` <span class="dim">by ${esc(traj.peak_date)}</span>` : ''))}
        ${fact('PUE', esc(traj.pue || ''))}
        ${fact('Buildings operational', esc(traj.buildings_operational || ''))}
        ${fact('Peak capital cost', traj.capex_peak_usd_bn ? `$${esc(traj.capex_peak_usd_bn)}B <span class="dim">(2025 USD)</span>` : '')}
        ${fact('Water use', traj.water_mgd ? `${esc(traj.water_mgd)} MGD` : '')}
      </div>
      <p class="note">Facility load is what the utility delivers; IT load runs 20&ndash;40% lower.
      Values past mid-2026 are Epoch AI projections, not observations.</p>
    </section>`;
  }

  let vaBlock = '';
  if (va && va.length) {
    const trs = va.map(r => `<tr>
      <td>${esc(r.name || '—')}</td>
      <td>${esc(r.status || '')}</td>
      <td class="num">${fmt(r.sq_ft)}</td>
      <td>${esc(r.utility || '')}${r.utility_boundary_m ? ` <span class="dim">(${esc(r.utility_boundary_m)} m to boundary)</span>` : ''}</td>
      <td>${esc(r.self_generation ? r.self_generation_source || 'yes' : '')}</td>
      <td class="mono dim">${esc(r.zoning_case || r.parcel_id || '')}</td>
    </tr>`).join('');
    vaBlock = `
    <section class="panel card">
      <h2>Virginia county records <span class="dim">(within 300 m)</span></h2>
      <div class="tablewrap"><table>
        <thead><tr><th>Record</th><th>Status</th><th class="num">Sq ft</th>
        <th>Utility</th><th>On-site generation</th><th>Case / parcel</th></tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
    </section>`;
  }

  const srcTrs = rows.map(r => {
    const link = osmUrl(r.osm_id);
    return `<tr>
      <td class="mono">${esc(r.source)}</td>
      <td>${esc(r.name || r.epoch_name || '—')}</td>
      <td>${esc(r.operator || r.pdb_org || '')}</td>
      <td class="num">${r.networks_present ? esc(r.networks_present) : ''}</td>
      <td>${esc(r.city || '')}</td>
      <td>${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer">OSM</a>` : ''}${
        r.pdb_id ? ` <a href="https://www.peeringdb.com/fac/${esc(r.pdb_id)}" target="_blank" rel="noopener noreferrer">PeeringDB</a>` : ''}</td>
    </tr>`;
  }).join('');

  let epochBlock = '';
  if (timeline && timeline.length) {
    const trs = timeline.map(t => `<tr>
      <td class="mono">${esc((t.Date || '').slice(0, 10))}</td>
      <td class="num">${fmt(t['IT power (MW)'])}</td>
      <td class="num">${fmt(t['Power (MW)'])}</td>
      <td class="num">${fmt(t['Buildings operational'])}</td>
      <td class="num">${t['Total capital cost (2025 USD billions)'] ? '$' + num(t['Total capital cost (2025 USD billions)']).toFixed(1) + 'B' : ''}</td>
      <td class="obs">${esc((t['Construction status'] || '').slice(0, 220))}</td>
    </tr>`).join('');
    epochBlock = `
    <section class="panel card">
      <h2>Epoch AI observation series <span class="dim">${timeline.length} observations</span></h2>
      <div class="tablewrap"><table>
        <thead><tr><th>Date</th><th class="num">IT MW</th><th class="num">Facility MW</th>
        <th class="num">Buildings</th><th class="num">Capex</th><th>Observed</th></tr></thead>
        <tbody>${trs}</tbody>
      </table></div>
      <p class="note">Source: Epoch AI, 'AI Data Centers' (CC-BY). Dates after mid-2026 are projections.</p>
    </section>`;
  }

  // ---- Epoch-style blocks -------------------------------------------------
  const obs = (timeline || []).filter(o => o.Date).map(o => ({
    date: o.Date.slice(0, 10),
    t: decDate(o.Date.slice(0, 10)),
    status: o['Construction status'] || '',
    h100: num(o['H100 equivalents']),
    itmw: num(o['IT power (MW)']),
    cost: num(o['Total capital cost (2025 USD billions)']),
    blds: num(o['Buildings operational']),
  }));
  // Epoch's timeline runs PAST TODAY: the rows after the present are their
  // projections, and the final one for Madison Mega Site reasons forward from
  // a June 2026 satellite image to March 2028. Taking obs[last] as "current"
  // therefore reported a projection as fact - 514K H100e and $25.9B against an
  // observed 214K and $10.8B, overstating the site 2.4x - and dated the page
  // "Updated 2028-03-15", two years in the future. Split them.
  const todayISO = new Date().toISOString().slice(0, 10);
  const seen = obs.filter(o => o.date <= todayISO);
  const ahead = obs.filter(o => o.date > todayISO);
  // If every observation is in the future the site is pre-construction; fall
  // back to the first row so the page still renders, and it will be labelled
  // as projected because `seen` is empty.
  const last = seen.length ? seen[seen.length - 1] : (obs[0] || null);
  const proj = ahead.length ? ahead[ahead.length - 1] : null;
  const peak = obs.reduce((a, o) => Math.max(a, o.h100), 0);

  const owner = untag(epoch?.Owner) || site.operator || '';
  const userList = untag(epoch?.Users) || untag(rows.map(r => r.users).find(Boolean));
  const chipList = untag(epoch?.['Current chip types'] || chips);
  // Only ever an observed date. A projection is not a revision, and dating
  // the page in the future is how this bug announced itself.
  const updated = seen.length ? last.date : '';

  // A plain-English summary, assembled only from fields we actually hold. The
  // observed figures carry their as-of date, and any projection is a separate
  // sentence in the future tense - never folded into "it holds".
  const summary = isAI && last ? [
    `${esc(title)} is ${site.status ? esc(site.status.replace(/_/g, ' ')) : 'an'} AI data centre`,
    owner ? ` owned by ${esc(owner)}` : '',
    userList ? ` and used by ${esc(userList)}` : '',
    seen.length
      ? `. As of ${esc(last.date)} it held an estimated ${fmtCompact(last.h100)} H100-equivalents of compute`
      : `. It is not yet observed to hold compute`,
    seen.length && last.itmw ? `, supported by ${Math.round(last.itmw)} MW of IT power` : '',
    seen.length && last.cost ? ` at a capital cost of $${last.cost.toFixed(1)}B` : '',
    '.',
    proj ? ` Epoch project ${fmtCompact(proj.h100)} H100-equivalents`
           + (proj.itmw ? ` and ${Math.round(proj.itmw)} MW` : '')
           + ` by ${esc(proj.date)}.` : '',
    chipList ? ` Chips: ${esc(chipList)}.` : '',
  ].join('') : '';

  const specs = isAI && last ? `
  <section class="panel card">
    <h2>Scale &amp; specifications</h2>
    <div class="spec-hero">
      <span class="fk">Observed compute <span class="dim">as of ${esc(last.date)}</span></span>
      <div class="spec-big">${fmtCompact(last.h100)} <span class="dim">H100-eq</span></div>
      <!-- The bar is scaled against the PROJECTED peak, so a half-full bar
           reads as "half of what this site is expected to become". -->
      <div class="spec-bar"><i style="width:${peak ? (last.h100 / peak * 100).toFixed(1) : 0}%"></i></div>
      ${proj ? `<p class="spec-proj">Projected <b>${fmtCompact(proj.h100)}</b> H100-eq by ${esc(proj.date)}</p>` : ''}
    </div>
    <div class="facts">
      ${fact('IT power (observed)', last.itmw ? `<b>${Math.round(last.itmw)}</b> MW` : '')}
      ${fact('IT power (projected peak)', traj?.power_mw_it_current ? `<b>${fmt(traj.power_mw_it_current)}</b> MW` : '')}
      ${fact('Cost (observed)', last.cost ? `<b>$${last.cost.toFixed(1)}</b> B` : '')}
      ${fact('Cost (projected peak)', traj?.capex_peak_usd_bn ? `<b>$${num(traj.capex_peak_usd_bn).toFixed(1)}</b> B` : '')}
      ${fact('Buildings operational', last.blds ? String(Math.round(last.blds)) : '')}
      ${fact('Hardware', esc(chipList))}
    </div>
  </section>` : '';

  const buildout = obs.length > 1 ? `
  <section class="panel card">
    <h2>Buildout</h2>
    <p class="note">Compute in H100-equivalents, stepped between Epoch observations —
    capacity arrives when a building energises, so the line steps rather than ramps.</p>
    <div class="bo-body">
      ${sparkline(obs.map(o => ({ t: o.t, v: o.h100, label: `${o.date} · ${fmtCompact(o.h100)} H100e` })), decDate(todayISO))}
      <ol class="bo-time">
        ${obs.map(o => `<li${o.date > todayISO ? ' class="bo-future"' : ''}><span class="bo-date">${esc(o.date)}${o.date > todayISO ? ' <i>projected</i>' : ''}</span>
          <span class="bo-what">${mdLinks(o.status)}</span>
          <span class="bo-nums mono">${fmtCompact(o.h100)} H100e${o.itmw ? ` · ${Math.round(o.itmw)} MW` : ''}${o.cost ? ` · $${o.cost.toFixed(1)}B` : ''}</span></li>`).join('')}
      </ol>
    </div>
  </section>` : '';

  // Land change: user-supplied dated screenshots, oldest first.
  const imagery = `
  <section class="panel card" id="imagery">
    <h2>Land change over time <span class="dim">${images.length}</span></h2>
    <p class="note">Drop in dated screenshots — Google Maps, Sentinel, anything — and they
    line up chronologically so the site can be compared against itself. Stored locally
    under <span class="mono">data/site_images/${esc(site.site_id)}/</span>.</p>
    ${images.length ? `<div class="imgstrip">${images.map((im, i) => `
      <figure class="imgshot"><img loading="lazy" src="/site-image/${esc(site.site_id)}/${esc(im.file)}"
        alt="Site imagery dated ${esc(im.date)}"><figcaption>${esc(im.date)}</figcaption></figure>`).join('')}</div>`
      : '<p class="note dim">No imagery yet.</p>'}
    <form id="upform" class="upform">
      <label>Date <input type="date" id="upDate" required></label>
      <label>Image <input type="file" id="upFile" accept="image/png,image/jpeg,image/webp" required></label>
      <button type="submit" class="tb-btn">Upload</button>
      <span id="upMsg" class="note"></span>
    </form>
  </section>`;

  const srcText = epoch?.['Selected Sources'] || '';
  const sources = srcText ? `
  <section class="panel card">
    <h2>Sources</h2>
    <ol class="srclist">${srcText.split(/\n+/).map(l => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean).map(l => `<li>${mdLinks(l)}</li>`).join('')}</ol>
  </section>` : '';

  // What the operator says about this building, in their words. Three rungs,
  // and which rung we are on is stated rather than hidden: an exact campus
  // page, or their locations index, or nothing. Quietly showing the index and
  // letting it look like a per-site link would be the worst of the three.
  const VIA = {
    code: 'matched on the operator’s own facility code',
    ordinal: 'matched on city and campus number',
    city: 'matched on city — the only campus they publish there',
    country: 'matched on country — the only campus they publish there',
  };
  const opName = operator?.displayName || site.operator || 'the operator';
  // "Vantage Data Centers's site" - names ending in s take the bare apostrophe.
  const opPoss = esc(opName) + (/s$/i.test(opName) ? '&rsquo;' : '&rsquo;s');
  let opBlock = '';
  if (link) {
    opBlock = `
  <section class="panel card oplink">
    ${operator?.logo ? `<span class="ops-logo ops-logo-lg"><img src="/logos/${esc(operator.logo)}" alt=""></span>` : ''}
    <div>
      <h2>On ${opPoss} site</h2>
      <p><a class="oplink-a" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.name)}</a></p>
      <p class="dim oplink-why">${VIA[link.via] || esc(link.via)}</p>
    </div>
  </section>`;
  } else if (operator?.officialLocationList && operator.officialLocationList !== 'none found') {
    opBlock = `
  <section class="panel card oplink">
    ${operator.logo ? `<span class="ops-logo ops-logo-lg"><img src="/logos/${esc(operator.logo)}" alt=""></span>` : ''}
    <div>
      <h2>On ${opPoss} site</h2>
      <p><a class="oplink-a" href="${esc(operator.officialLocationList)}" target="_blank" rel="noopener noreferrer">All ${esc(opName)} locations</a></p>
      <p class="dim oplink-why">No page could be matched to this specific building,
        so this is their full list rather than a guess.</p>
    </div>
  </section>`;
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Data Centre Registry</title>
<link rel="stylesheet" href="/app.css">
</head><body>
<script>const SITE_ID = ${JSON.stringify(site.site_id)};</script>
<header class="topbar">
  <a class="brand" href="/">◀ Data Centre Registry</a>
  <span class="spacer"></span>
  <!-- Search lives on the map, which owns the index; from here it is a link
       that opens the map with the palette already up. -->
  <a class="themebtn searchbtn" href="/?search=1" aria-label="Search the registry"
     title="Search the registry"></a>
  <button id="themeBtn" class="themebtn" aria-label="Toggle day / night view"></button>
</header>
<main class="wrap">
  <header class="sitehead">
    <nav class="crumbs"><a href="/">Data Centres</a> <span>›</span>
      <a href="/?search=1">Directory</a> <span>›</span> <b>${esc(title)}</b></nav>
    ${updated ? `<p class="updated"><i></i> Updated ${esc(updated)}</p>` : ''}
    <h1>${esc(title)}</h1>
    ${address || site.city ? `<p class="subhead">${esc(address || [site.city, site.country].filter(Boolean).join(', '))}</p>` : ''}
    <div class="badges">${badges}</div>
    <p class="note">Assembled from ${esc(site.sources)} · ${rows.length} source record${rows.length === 1 ? '' : 's'} ·
    ${site.lat ? `<a href="/?site=${encodeURIComponent(site.site_id)}">show on map</a> · ` : ''}
    this URL is stable and shareable.</p>
  </header>
  ${summary ? `<p class="lede">${summary}</p>` : ''}
  ${mates.length ? `
  <section class="panel card">
    <h2>Same building <span class="dim">${mates.length + 1} facilities</span></h2>
    <p class="note">These share a street address, so they are separate colocation
      facilities inside one structure — a carrier hotel. The registry counts them
      individually because they are individually operated, but anything that
      reaches this address reaches all of them.</p>
    <ul class="mates">${mates.map(m => `<li>
      <a href="/site/${encodeURIComponent(m.site_id)}">${esc(m.name || m.epoch_name || 'Unnamed facility')}</a>
      ${m.operator ? `<span class="dim">${esc(m.operator)}</span>` : ''}
    </li>`).join('')}</ul>
  </section>` : ''}
  ${opBlock}
  <section class="panel card"><h2>Site</h2><div class="facts">${facts}</div></section>
  ${specs}
  ${power}
  ${buildout}
  ${imagery}
  ${sources}
  ${vaBlock}
  <section class="panel card">
    <h2>Source records <span class="dim">${rows.length}</span></h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Source</th><th>Name</th><th>Operator / org</th>
      <th class="num">Networks</th><th>City</th><th>Links</th></tr></thead>
      <tbody>${srcTrs}</tbody>
    </table></div>
  </section>
  ${epochBlock}
</main>
<script src="/theme.js"></script>
<script>
// Upload posts the raw bytes with the date in the query string, so there is no
// multipart parser on the server and no user-supplied filename anywhere near
// the filesystem - the extension is derived from the content type.
document.getElementById('upform')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = document.getElementById('upFile').files[0];
  const d = document.getElementById('upDate').value;
  const msg = document.getElementById('upMsg');
  if (!f || !d) return;
  msg.textContent = 'uploading…';
  try {
    // Plain concatenation, not a template literal: this script is itself
    // inside one, so inner interpolation would be consumed at render time.
    const url = '/upload?site=' + encodeURIComponent(SITE_ID) + '&date=' + encodeURIComponent(d);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
    if (!r.ok) { msg.textContent = 'failed: ' + (await r.text()); return; }
    msg.textContent = 'saved — reloading';
    location.reload();
  } catch (err) { msg.textContent = 'failed: ' + err.message; }
});
</script>
</body></html>`;
}
