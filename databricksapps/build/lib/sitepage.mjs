// Server-rendered detail page for one site: /maps/site/<site_id>.
//
// The URL is the share unit, so everything the registry knows about the site
// is rendered here — the deduped summary, the Virginia county records where
// they exist, every source row behind the cluster, and the Epoch observation
// series for AI sites.

import { FIELDS, KINDS, kindOf, LINK_STRUCTURE } from './overrides.mjs';
import { wayback } from './dotpage.mjs';
import { renderDependencyCard } from './powerpage.mjs';

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

// Equirectangular, same as lib/data.mjs. Over the tens of kilometres a supply
// link spans the error against a great circle is centimetres.
const kmApart = (latA, lonA, latB, lonB) => {
  const dx = (lonA - lonB) * 111.32 * Math.cos(((latA + latB) / 2) * Math.PI / 180);
  return Math.hypot(dx, (latA - latB) * 111.32);
};

const decDate = (d) => {
  const y = +d.slice(0, 4);
  return y + (Date.UTC(y, +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(y, 0, 1))
    / (365.25 * 86400000);
};

export function renderSitePage(ctx) {
  const { site, rows, va, traj, timeline, epoch, images = [],
          link = null, operator = null, opKey = '', mates = [],
          parent = null, children = [], plant = null, footprints = [],
          poi, depsByAsset, depsByDep, accumulation, nameOf, water = null } = ctx;
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
  const address = site.address || rows.map(r => r.address).find(Boolean) || '';
  // Where the address is the parcel's rather than the source record's, say
  // so: it is the county's situs address for the ground under the dot.
  const addressTag = address && site.address_src === 'regrid'
    ? ' <span class="dim" title="Situs address of the Regrid parcel under the dot, as the county records it">parcel record</span>' : '';
  const tenancyBasis = rows.map(r => r.tenancy_basis).find(Boolean) || '';
  const osmRow = rows.find(r => r.osm_id);
  const osm = osmRow ? osmUrl(osmRow.osm_id) : null;

  // Coordinates live in the HEADER beside the address now, not mid-card:
  // "where exactly is this building" is the first question a site page
  // answers, and one click on the pin opens the roof itself - the Maps URL
  // is the documented api=1 form, centred and in satellite, rather than an
  // undocumented path format that could rot. The OSM provenance link rides
  // along, since the coordinates fact it lived in is gone.
  const coordHead = site.lat == null || site.lat === '' ? '' :
    `<span class="coord mono">${esc(site.lat)}, ${esc(site.lon)}</span>` +
    `<a class="coord-map" target="_blank" rel="noopener noreferrer"` +
    ` title="Satellite view on Google Maps" aria-label="Satellite view on Google Maps"` +
    ` href="https://www.google.com/maps/@?api=1&amp;map_action=map` +
    `&amp;center=${encodeURIComponent(site.lat)}%2C${encodeURIComponent(site.lon)}` +
    `&amp;zoom=18&amp;basemap=satellite">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="M12 21s-6.6-5.4-6.6-10.2a6.6 6.6 0 1 1 13.2 0C18.6 15.6 12 21 12 21Z"/>` +
    `<circle cx="12" cy="10.6" r="2.4"/></svg></a>` +
    (osm ? ` · <a href="${osm}" target="_blank" rel="noopener noreferrer">OSM</a>` : '');

  const facts = [
    fact('Operator', site.operator
      ? (opKey ? `<a href="/operator/${encodeURIComponent(opKey)}">${esc(site.operator)}</a>`
               : esc(site.operator))
      : '<span class="dim">unresolved</span>'),

    fact('Facility code', esc(site.ref || '')),
    fact('Serving utility', esc(site.utility || '')),
    // The water counterparty, observed: EPA's service-area boundary says which
    // community system this point sits in, and SDWIS says how big it is. The
    // size is the fact that matters - a campus is a marginal industrial load on
    // a system serving 1,300 people or on one serving 8 million, and those are
    // different risks. Nothing here estimates the site's own draw.
    water ? fact('Water utility',
      `<strong>${esc(water.pws_name)}</strong>`
      + (water.population_served ? ` — serving ${fmt(water.population_served)} people` : '')
      + (water.service_connections ? `, ${fmt(water.service_connections)} connections` : '')
      + ` <span class="dim">(${esc(water.boundary_method || 'boundary')}${
          +water.overlapping_systems > 1 ? `; ${water.overlapping_systems} systems overlap here` : ''
        })</span>`
      + (water.echo_url ? ` · <a href="${esc(water.echo_url)}" target="_blank" rel="noopener noreferrer">ECHO</a>` : '')
      + ` <span class="dim mono">${esc(water.pwsid)}</span>`) : '',
    fact('Tenancy basis', esc(tenancyBasis)),
    nets ? fact('Networks present', `${nets} <span class="dim">(PeeringDB)</span>`) : '',

    users ? fact('Users / workloads', esc(users)) : '',
    site.needs_review
      ? fact('Verification', 'Unverified — every source row for this site is a '
          + 'PeeringDB listing with no networks, IXs or carriers. A sample of '
          + 'such rows found most were not data centres.')
      : '',
    // Identity evidence, not geometry: what the commercial registry says
    // operates AT this coordinate. Strong means the business NAME confirms
    // the specific claim (a facility name, or the operator this registry
    // already names); weak means only the SIC class matches, which lumps
    // hyperscale campuses with two-person data-entry bureaus, so it is shown
    // with that caveat and only on unverified sites - where any signal
    // matters. An asked-and-empty answer likewise shows only there:
    // "nothing is registered here" is itself the finding. Sites never asked
    // (poi undefined) show nothing rather than a false negative.
    poi && poi.name && poi.tier === 'strong'
      ? fact('Business registry', `<strong>${esc(poi.name)}</strong> — `
          + `${esc(poi.cls)}, registered at this coordinate`
          + (poi.parent && poi.parent !== poi.name
              ? `; ultimate parent ${esc(poi.parent)}` : '')
          + ' <span class="dim">(Precisely poi_world)</span>')
      : poi && poi.name && site.needs_review
        ? fact('Business registry', `A business classified “${esc(poi.cls)}” `
            + `(${esc(poi.name)}) is registered within ~130 m — a weak signal: `
            + 'this class also covers small IT firms '
            + '<span class="dim">(Precisely poi_world)</span>')
        : poi !== undefined && !(poi && poi.name) && site.needs_review
          ? fact('Business registry', 'No data-centre-classified business is '
              + 'registered within ~130 m of this coordinate '
              + '<span class="dim">(Precisely poi_world)</span>')
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

  // WHERE THE POWER COMES FROM, when anyone has established that it is a
  // question with an answer. For a grid-connected site it is not: the grid is
  // fungible, a utility bills for it, and no plant is "the" supplier. So this
  // section is empty until someone links one by hand, and it says why.
  const st = LINK_STRUCTURE[site.link_structure] || null;
  const supply = `
  <section class="panel card" id="supply">
    <h2>Power supply</h2>
    ${plant && st ? `
      <div class="facts">
        ${fact('Plant', `<a href="/maps/plant/${esc(site.linked_plant_id)}"><strong>${esc(plant.n)}</strong></a>`)}
        ${fact('Arrangement', esc(st.label))}
        ${fact('Capacity', plant.mw ? `${fmt(plant.mw)} MW operating` :
          plant.pmw ? `${fmt(plant.pmw)} MW planned` : `${fmt(plant.rmw || 0)} MW, retired`)}
        ${fact('Fuel', esc(plant.tech || plant.f || ''))}
        ${fact('Owner', esc(plant.own || ''))}
        ${fact('Where', esc([plant.cnty, plant.st, plant.cyn || plant.cy].filter(Boolean).join(' · ')))}
        ${site.lat && plant.lat ? fact('Distance',
          `${kmApart(+site.lat, +site.lon, plant.lat, plant.lon).toFixed(1)} km`) : ''}
      </div>
      <p class="note">${esc(st.blurb)}</p>
      ${site.link_note ? `<p class="note"><b>Basis:</b> ${esc(site.link_note)}${site.link_src
        ? ` <a href="${esc(site.link_src)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</p>` : ''}
      ${site.link_structure === 'ppa' ? `<p class="note">A contract is not a wire.
        This site draws from the grid like any other load; the plant sells into
        the same grid. Nothing here says those are the same electrons.</p>` : ''}
    ` : !plant && site.link_plant_name && st ? `
      <div class="facts">
        ${fact('Generation', `<strong>${esc(site.link_plant_name)}</strong>
          <span class="dim">— not yet in the EIA/GEM plant inventory</span>`)}
        ${fact('Arrangement', esc(st.label))}
      </div>
      <p class="note">${esc(st.blurb)}</p>
      ${site.link_note ? `<p class="note"><b>Basis:</b> ${esc(site.link_note)}${site.link_src
        ? ` <a href="${esc(site.link_src)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</p>` : ''}
    ` : `
      <p class="note">Not established. For a grid-connected site there is no
      such thing as "the" plant supplying it — the grid is a pool, the utility
      bills for it, and proximity is not supply. This is recorded only where
      somebody has read the filing: a behind-the-meter arrangement, a
      net-metered pairing, or a named contract.</p>
    `}
    <div class="pl-pick">
      <button type="button" class="tb-btn" id="pl-open">${plant ? 'Change' : 'Link a plant'}</button>
      ${plant ? '<button type="button" class="tb-btn" id="pl-clear">Unlink</button>' : ''}
      <span class="note" id="pl-msg"></span>
    </div>
    <div id="pl-panel" hidden>
      <label class="pl-lbl">Arrangement
        <select id="pl-struct">
          ${Object.entries(LINK_STRUCTURE).map(([k, v]) =>
            `<option value="${k}"${site.link_structure === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
        </select>
      </label>
      <p class="note">Nearest plants first. ${site.lat == null
        ? 'This site has no coordinate, so there is nothing to search from.'
        : 'Within 50 km.'}</p>
      <ol class="pl-list" id="pl-list"></ol>
    </div>
  </section>`;

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

  // Land change: the SAME viewer the plant, fab, substation and point pages
  // use - one implementation, five page kinds, so the layer panel, per-layer
  // pencils, tabs and archive behave identically everywhere. The site's link
  // to its plant rides in so the frame can point at the supply, exactly as
  // the fab pages do in the other direction.
  const wbLinks = plant && plant.lat != null && site.lat != null
    ? [{ lat: +plant.lat, lon: +plant.lon, label: plant.n || '',
         km: +kmApart(+site.lat, +site.lon, plant.lat, plant.lon).toFixed(1),
         href: '/maps/plant/' + site.linked_plant_id }] : [];
  const waybackHtml = site.lat == null ? ''
    : wayback(+site.lat, +site.lon, 16, wbLinks, site.site_id);

  // Land change: user-supplied dated screenshots, oldest first.
  const imagery = `
  <section class="panel card" id="imagery">
    <h2>Land change over time <span class="dim">${images.length}</span></h2>
    <p class="note">Anything the archive above cannot show — ground photos, Sentinel,
    a planning portal. Drop in dated screenshots and they line up chronologically.
    Stored locally under <span class="mono">data/site_images/${esc(site.site_id)}/</span>.</p>
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

  // WHAT THE OUTLINE ROUND THIS DOT IS CALLED.
  //
  // Registry names come from whichever source won the dedupe, and for a
  // self-built campus that is routinely the operator's bare name - this page
  // is titled "Meta" while the polygon drawn round it says "Meta Eagle
  // Mountain Data Center". The better name was already in the building
  // footprint; nothing had ever offered it.
  //
  // Offered, never applied. A footprint name can be worse than the registry's
  // (OSM has plenty of bare "Data Center"), so this fills the box and leaves
  // the Save to a person - the same rule the rest of this form follows.
  const nameSuggestions = [...new Map(footprints
    .filter(f => f.name && f.name.trim() && f.name.trim() !== (site.name || '').trim())
    .map(f => [f.name.trim(), f])).values()];

  const suggestFor = (field) => {
    if (field !== 'name' || !nameSuggestions.length) return '';
    return `<span class="fpsuggest">from the footprint: ${nameSuggestions.map(f =>
      `<button type="button" class="fpsug" data-name="${esc(f.name.trim())}"
        title="${esc(f.kind)} outline from ${esc(f.src === 'im3' ? 'the IM3 atlas'
          : f.src === 'osm' ? 'OpenStreetMap' : 'a hand-drawn shape')}">${
        esc(f.name.trim())}</button>`).join('')}</span>`;
  };

  // The edit form is generated from the same FIELDS table the server validates
  // against, so the two cannot drift into disagreeing about what is editable.
  const editRows = Object.entries(FIELDS).filter(([, spec]) => !spec.hidden).map(([f, spec]) => {
    const v = site[f] == null ? '' : String(site[f]);
    // suggest fields get a datalist: empty here, filled from
    // /data/edit_options.json the first time the form opens. Free text is
    // still allowed - the list is a nudge toward existing spellings, not
    // a fence around them.
    const input = spec.options
      ? `<select name="${f}">${spec.options.map(o =>
          `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${o ? esc(o) : '—'}</option>`).join('')}</select>`
      : `<input type="text" name="${f}" value="${esc(v)}" maxlength="300"${
          spec.suggest ? ` list="dl-${f}" autocomplete="off"` : ''}${
          spec.hint ? ` placeholder="${esc(spec.hint)}"` : ''}>${
          spec.suggest ? `<datalist id="dl-${f}"></datalist>` : ''}`;
    return `<label><span>${esc(spec.label)}</span>${input}${suggestFor(f)}</label>`;
  }).join('');

  const edited = Object.entries(site.edited || {})
    .filter(([f]) => FIELDS[f])
    .map(([f, rec]) => ({ f, was: rec.was || '' }));

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
    name: 'matched on the metro this site is named for',
    city: 'matched on city — the only campus they publish there',
    country: 'matched on country — the only campus they publish there',
    manual: 'added by hand — this page cannot be reached by any scraper',
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
<script>const SITE_ID = ${JSON.stringify(site.site_id)};
const SITE_PARENT = ${JSON.stringify(site.parent_site_id || '')};
const SITE_KIND = ${JSON.stringify(kindOf(site))};
const SITE_NAME = ${JSON.stringify(site.name || '')};
const SITE_CHILDREN = ${children.length};
const SITE_LAT = ${site.lat == null ? 'null' : JSON.stringify(+site.lat)};
const SITE_LON = ${site.lon == null ? 'null' : JSON.stringify(+site.lon)};
</script>
<header class="topbar">
  <a class="brand" href="/">◀ Data Centre Registry</a>
  <span class="spacer"></span>
  <!-- Search lives on the map, which owns the index; from here it is a link
       that opens the map with the palette already up. -->
  <a class="themebtn searchbtn" href="/maps?search=1" aria-label="Search the registry"
     title="Search the registry"></a>
  <button id="themeBtn" class="themebtn" aria-label="Toggle day / night view"></button>
</header>
<main class="wrap">
  <header class="sitehead">
    <nav class="crumbs"><a href="/">Map</a> <span>›</span>
      <a href="/datacentres">Data centres</a> <span>›</span> <b>${esc(title)}</b></nav>
    ${updated ? `<p class="updated"><i></i> Updated ${esc(updated)}</p>` : ''}
    <h1>${esc(title)}<button type="button" class="icobtn edit-pen" id="edit-open"
      title="Correct these details" aria-label="Correct these details">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button></h1>
    ${address || site.city || coordHead ? `<p class="subhead">${
      [address ? esc(address) + addressTag : '',
       site.city || site.country ? esc([site.city, site.country].filter(Boolean).join(', ')) : '',
       coordHead].filter(Boolean).join(' · ')}</p>` : ''}
    <div class="badges">${badges}</div>
    <p class="note">Assembled from ${esc(site.sources)} · ${rows.length} source record${rows.length === 1 ? '' : 's'} ·
    ${site.lat ? `<a href="/maps?site=${encodeURIComponent(site.site_id)}">show on map</a> · ` : ''}
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
      <a href="/maps/site/${encodeURIComponent(m.site_id)}">${esc(m.name || m.epoch_name || 'Unnamed facility')}</a>
      ${m.operator ? `<span class="dim">${esc(m.operator)}</span>` : ''}
    </li>`).join('')}</ul>
  </section>` : ''}
  ${opBlock}
  <section class="panel card" id="sitecard">
    <div class="card-head">
      <h2>Site</h2>
      <span class="wb-kindline"><span>This dot is</span>
      <span class="seg" id="wb-kindseg">${KINDS.map(k =>
        `<button type="button" data-k="${k}" aria-pressed="${k === kindOf(site)}">${k}</button>`).join('')}</span></span>
    </div>
    <div class="facts">${facts}</div>
    ${parent || children.length ? `<div class="note edited-note">
      ${parent ? `Part of <a href="/maps/site/${esc(parent.site_id)}">${esc(
          parent.name || parent.epoch_name || 'a campus')}</a>
        <span class="kinbadge k-campus">campus</span>` : ''}
      ${children.length ? `<b>${children.length}</b> building${children.length === 1 ? '' : 's'}
        on this campus:<ul class="tree">${children.map(c =>
          `<li><a href="/maps/site/${esc(c.site_id)}">${esc(c.name || c.epoch_name || c.site_id)}</a>
            ${c.city ? `<span class="dim">${esc(c.city)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    </div>` : ''}
    ${edited.length ? `<p class="note edited-note">Corrected by hand:
      ${edited.map(e => `<b>${esc(FIELDS[e.f].label)}</b> <span class="dim">was
        ${e.was ? esc(e.was) : '(blank)'}</span>`).join(' · ')}.
      Recorded in <span class="mono">data/site_overrides.csv</span>, which the
      pipeline never overwrites.</p>` : ''}
    <form class="editform" id="editform" hidden>
      <p class="note">These go to <span class="mono">data/site_overrides.csv</span> as a
      source in their own right, so they survive every rebuild. Only what you change is
      written. Coordinates take decimal degrees. If you know the building but not the
      numbers, “Fix the dot’s position” on the imagery viewer below sets them
      by clicking the roof instead.</p>
      <div class="editgrid">${editRows}</div>
      <label class="editnote">Note <span class="dim">— how you know, optional</span>
        <input type="text" id="ed-note" maxlength="300" placeholder="operator's own site, planning filing, site visit…"></label>
      <div class="editbar">
        <button type="submit" class="tb-btn">Save</button>
        <button type="button" class="tb-btn" id="edit-cancel">Cancel</button>
        <span id="ed-msg" class="note"></span>
      </div>
    </form>
  </section>
  ${specs}
  ${power}
  ${supply}
  ${renderDependencyCard({ id: site.site_id, depsByAsset, depsByDep, accumulation, nameOf })}
  ${buildout}
  ${waybackHtml}
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
// ---- the viewer ------------------------------------------------------------
// Gone: this page's own archive scrubber and live map - some two thousand
// lines - replaced by the shared component every dot page uses (lib/dotpage's
// wayback() + public/wayback-lite.js). One implementation means the layer
// panel, the per-layer pencils, the vendor pulls and the imagery archive
// cannot drift between a data centre, a fab and a power station. The one
// site-specific control it carried, "This dot is", moved to the Site card.

// ---- what this dot is ------------------------------------------------------
// Classifying the dot is a hand override like any other: one field, one row
// in site_overrides.csv, and the server owns validation.
(() => {
  const seg = document.getElementById('wb-kindseg');
  if (!seg) return;
  const msg = document.getElementById('ed-msg');
  seg.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    if (msg) msg.textContent = 'saving\u2026';
    try {
      const r = await fetch('/api/site/' + encodeURIComponent(SITE_ID), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { site_kind: b.dataset.k } }),
      });
      const out = await r.json();
      if (!r.ok) { if (msg) msg.textContent = out.error || ('failed: ' + r.status); return; }
      location.reload();
    } catch (err) { if (msg) msg.textContent = 'failed: ' + err.message; }
  });
})();

// ---- correcting the site ---------------------------------------------------
// Posts only the fields that differ; the server decides what is editable and
// what is valid, and this form is generated from the same table it checks
// against, so the two cannot drift apart.
(() => {
  const form = document.getElementById('editform');
  const open = document.getElementById('edit-open');
  if (!form || !open) return;
  const msg = document.getElementById('ed-msg');
  const toggle = (on) => {
    form.hidden = !on;
    open.setAttribute('aria-pressed', String(on));
    open.title = on ? 'Close the edit form' : 'Correct these details';
  };
  // Existing registry values as type-ahead suggestions, fetched on the pen's
  // first click - most page views never open the form, and the operator list
  // alone runs to a few thousand entries. Options are built through the DOM,
  // not markup: these are CSV-sourced strings, and createElement needs no
  // escaping to be safe.
  let optsWired = false;
  let refreshCityList = null;   // set once loadOptions resolves
  const fillList = (id, values) => {
    const dl = document.getElementById(id);
    if (!dl || !values) return;
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v;
      dl.appendChild(o);
    }
  };
  async function loadOptions() {
    if (optsWired) return;
    optsWired = true;
    let opt;
    try { opt = await (await fetch('/data/edit_options.json')).json(); }
    catch (err) { optsWired = false; return; }  // a convenience failed; the
                                                // next pen click retries
    fillList('dl-operator', opt.operator);
    fillList('dl-utility', opt.utility);
    const dc = document.getElementById('dl-country');
    if (dc) {
      for (const c of opt.country || []) {
        const o = document.createElement('option');
        o.value = c[0];    // the two-letter code is what saves
        o.label = c[1];    // the English name is what a person recognises
        dc.appendChild(o);
      }
    }
    // The city list follows the country box: a Springfield suggestion should
    // mean Springfield in THIS country. No recognised country, every city.
    const cityDl = document.getElementById('dl-city');
    const ctry = form.querySelector('[name="country"]');
    const byCc = opt.city || {};
    let all = null, lastKey = null;
    const refreshCities = () => {
      if (!cityDl) return;
      const cc = ctry ? ctry.value.trim().toUpperCase() : '';
      const key = byCc[cc] ? cc : '*';
      if (key === lastKey) return;   // retyping the same country: keep the DOM
      lastKey = key;
      let list = byCc[cc];
      if (!list) {
        if (!all) {
          const seen = new Set();
          for (const k in byCc) for (const c of byCc[k]) seen.add(c);
          all = Array.from(seen).sort((a, b) => a.localeCompare(b));
        }
        list = all;
      }
      cityDl.textContent = '';
      for (const c of list) {
        const o = document.createElement('option');
        o.value = c;
        cityDl.appendChild(o);
      }
    };
    refreshCities();
    if (ctry) ctry.addEventListener('input', refreshCities);
    refreshCityList = refreshCities;
  }
  open.addEventListener('click', () => {
    if (form.hidden) {
      loadOptions();
      // Reopening after a Cancel: form.reset() put the country back without
      // firing 'input', so the city list may still be the old country's.
      if (refreshCityList) refreshCityList();
    }
    toggle(form.hidden);
  });
  document.getElementById('edit-cancel').addEventListener('click', () => {
    form.reset(); msg.textContent = ''; toggle(false);
    if (refreshCityList) refreshCityList();
  });

  // A footprint name fills the box; it does not save. The rest of this form
  // waits for a person to press Save and so does this - it is a suggestion
  // from a source that is often right, not a source that is always right.
  for (const b of form.querySelectorAll('.fpsug')) {
    b.addEventListener('click', () => {
      const input = form.querySelector('[name="name"]');
      if (!input) return;
      input.value = b.dataset.name;
      input.focus();
      msg.textContent = 'Name filled in from the footprint — press Save to keep it.';
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {};
    for (const el of form.querySelectorAll('[name]')) fields[el.name] = el.value.trim();
    msg.textContent = 'saving…';
    try {
      const r = await fetch('/api/site/' + encodeURIComponent(SITE_ID), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fields, note: document.getElementById('ed-note').value }),
      });
      const out = await r.json();
      if (!r.ok) { msg.textContent = out.error || ('failed: ' + r.status); return; }
      if (!out.saved) { msg.textContent = 'nothing changed'; return; }
      msg.textContent = 'saved — reloading';
      location.reload();
    } catch (err) { msg.textContent = 'failed: ' + err.message; }
  });
})();

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

// ---- linking a plant --------------------------------------------------------
// The picker is a list of NEARBY plants rather than a search box, for the same
// reason the campus picker is: an id typed from memory is a wrong id, and the
// only plants worth linking are ones you can see are next door. Distance is
// shown but is not evidence - a plant 800 m away is not the supplier either,
// until the arrangement says so.
(function () {
  var open = document.getElementById('pl-open');
  if (!open) return;
  var panel = document.getElementById('pl-panel');
  var list = document.getElementById('pl-list');
  var struct = document.getElementById('pl-struct');
  var pmsg = document.getElementById('pl-msg');
  var clear = document.getElementById('pl-clear');
  var loaded = false;

  async function save(fields) {
    pmsg.textContent = 'saving…';
    try {
      var r = await fetch('/api/site/' + encodeURIComponent(SITE_ID), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fields }),
      });
      var out = await r.json();
      if (!r.ok) { pmsg.textContent = out.error || ('failed: ' + r.status); return; }
      location.reload();
    } catch (err) { pmsg.textContent = 'failed: ' + err.message; }
  }

  open.addEventListener('click', async function () {
    panel.hidden = !panel.hidden;
    open.setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden || loaded) return;
    if (SITE_LAT == null) { list.innerHTML = '<li class="hint">No coordinate.</li>'; return; }
    list.innerHTML = '<li class="hint">Looking…</li>';
    try {
      var r = await fetch('/api/nearby-plants/' + encodeURIComponent(SITE_ID) + '?km=50');
      var j = await r.json();
      var near = j.near || [];
      if (!near.length) { list.innerHTML = '<li class="hint">No plant within 50 km.</li>'; return; }
      list.innerHTML = near.map(function (p) {
        // Operating capacity where there is any, otherwise say which kind of
        // zero it is. A planned plant reading "0 MW" would look broken.
        var cap = p.mw ? p.mw.toLocaleString() + ' MW'
                : p.pmw ? p.pmw.toLocaleString() + ' MW planned'
                : (p.rmw || 0).toLocaleString() + ' MW, retired';
        return '<li><button type="button" class="pl-row" data-id="' + p.id + '">'
          + '<span class="pl-n">' + esc(p.n) + '</span>'
          + '<span class="pl-d">' + p.km.toFixed(1) + ' km · ' + esc(p.tech || p.f)
          + ' · ' + cap + (p.ax ? ' · approximate location' : '') + '</span>'
          + '</button></li>';
      }).join('');
    } catch (err) { list.innerHTML = '<li class="hint">failed: ' + err.message + '</li>'; }
    loaded = true;
  });

  list.addEventListener('click', function (e) {
    var b = e.target.closest('[data-id]');
    if (!b) return;
    // Both halves together, always. The server refuses one without the other,
    // and sending them separately would just surface that as an error.
    save({ linked_plant_id: b.dataset.id, link_structure: struct.value });
  });

  if (clear) {
    clear.addEventListener('click', function () {
      save({ linked_plant_id: '', link_structure: '' });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}());
</script>
</body></html>`;
}
