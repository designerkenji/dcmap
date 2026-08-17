// A page per dot for the two layers that did not have one: /plant/<id> and
// /fab/<id>.
//
// Data centres have had /site/<id> since the beginning, because a shareable URL
// per site is the whole point of the registry. Plants and fabs arrived as map
// layers and so had no way to be linked to, cited, or sent to somebody - which
// meant the interesting record (a coal plant closing in 2028 with a data centre
// campus being built on it) could be seen and not referenced.
//
// Both pages carry their SOURCE, prominently. The fab layer is hand-assembled
// and every record's provenance is the only reason to believe it; the plant
// layer is two public inventories with different licences and the CC BY one
// requires credit wherever it appears, not only on the map.

import { esc, n0, page } from './summary.mjs';

const fact = (label, value, cls = '') => (value === '' || value == null ? ''
  : `<div class="fact"><span class="fk">${esc(label)}</span>` +
    `<span class="fv ${cls}">${value}</span></div>`);


// Earthquake exposure reaches every layer, not only the registry. A fab that
// took MMI 7 is a fact about that fab and belongs on its page, not only in a
// panel you reach by clicking the right epicentre.
const shaken = (x) => (x.mmi == null ? '' : `<p class="note"><b>Recent shaking:</b>
  MMI ${(+x.mmi).toFixed(1)}${x.mmiEv ? ` from ${esc(x.mmiEv)}` : ''}. MMI is
  observed intensity — VI is where non-structural damage begins, VIII is heavy
  damage to ordinary structures. Computed by sampling the USGS ShakeMap grid at
  this coordinate, over the trailing 90 days.</p>`);

const FUEL = {
  nuclear: 'Nuclear', gas: 'Gas', coal: 'Coal', oil: 'Oil', hydro: 'Hydro',
  wind: 'Wind', solar: 'Solar', storage: 'Storage', other: 'Other',
};
const BA_ISO = { PJM: 'PJM', ERCO: 'ERCOT', MISO: 'MISO', ISNE: 'ISO-NE',
                 NYIS: 'NYISO', CISO: 'CAISO', SWPP: 'SPP' };
const PSTATUS = { op: 'Operating', plan: 'Planned', ret: 'Retired' };
const FSTATUS = { operating: 'Operating', construction: 'Under construction',
                  announced: 'Announced', closed: 'Closed' };

// Everything within `km`, from a list that already has lat/lon. Cheap enough at
// these sizes to do per request rather than precompute.
function near(lat, lon, list, km, kmBetween) {
  const out = [];
  for (const x of list) {
    if (x.lat == null || x.lon == null) continue;
    const d = kmBetween(lon, lat, +x.lon, +x.lat);
    if (d <= km) out.push({ x, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

function nearbyBlock(title, rows, empty) {
  return `<section class="panel card">
    <h2>${esc(title)}</h2>
    ${rows.length ? `<div class="tablewrap"><table><tbody>${rows.join('')}</tbody></table></div>`
                  : `<p class="note">${esc(empty)}</p>`}
  </section>`;
}

// ---- power plant -----------------------------------------------------------

export function renderPlantPage({ plant: p, sites, fabs, geo, kmBetween }) {
  const iso = BA_ISO[p.ba] || p.ba;
  const where = [p.st, iso, geo.country(p.cy)].filter(Boolean).join(' · ');

  const nearSites = near(p.lat, p.lon, sites, 25, kmBetween).slice(0, 15);
  const nearFabs = near(p.lat, p.lon, fabs, 50, kmBetween).slice(0, 8);

  const siteRows = nearSites.map(({ x, d }) => `<tr>
    <td><a href="/site/${esc(x.id)}"><b>${esc(x.n || x.o || 'Data centre')}</b></a></td>
    <td class="dim">${esc(x.o || '')}</td>
    <td>${x.ft === 'ai' ? '<i class="ops-ai">AI</i>' : ''}</td>
    <td class="num">${x.mw ? n0(x.mw) + ' MW' : ''}</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);
  const fabRows = nearFabs.map(({ x, d }) => `<tr>
    <td><a href="/fab/${esc(x.id)}"><b>${esc(x.n)}</b></a></td>
    <td class="dim">${esc(x.grp || x.op)}</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);

  const body = `
  <section class="panel card">
    <h2>Plant</h2>
    <div class="facts">
      ${fact('Status', esc(PSTATUS[p.k] || p.k))}
      ${fact('Fuel', esc([FUEL[p.f], p.tech !== FUEL[p.f] ? p.tech : ''].filter(Boolean).join(' · ')))}
      ${fact('Operating', p.mw ? `<strong>${n0(p.mw)}</strong> MW${p.u > 1 ? ` · ${p.u} units` : ''}` : '')}
      ${fact('Planned', p.pmw ? `${n0(p.pmw)} MW` : '')}
      ${fact('Retired', p.rmw ? `${n0(p.rmw)} MW${p.k === 'ret' && p.ry ? ` in ${p.ry}` : ''}` : '')}
      ${fact('Announced to close', p.xmw ? `<strong>${n0(p.xmw)}</strong> MW from ${p.ry}` : '')}
      ${fact('First operating', p.y || '')}
      ${fact('Owner', esc(p.own || ''))}
      ${fact('Where', esc(where))}
      ${fact('Coordinates', `<span class="mono">${p.lat}, ${p.lon}</span>` +
        (p.ax ? ' <span class="dim">— approximate</span>' : ''))}
    </div>
    ${p.k === 'ret' ? `<p class="note">Nothing generates here now. The reason a
      dead plant stays on the map is that its interconnection rights, switchyard,
      cooling water and permitting posture may be reusable — that is what was
      bought at Homer City, Cayuga and PORTS.</p>` : ''}
    ${p.xmw ? `<p class="note">Capacity with an announced retirement is the
      clearest signal in this layer that interconnection is about to free up.
      Note that ${n0(p.xmw)} MW is the units leaving, not the whole plant.</p>` : ''}
    ${shaken(p)}
    ${p.ax ? `<p class="note">Global Energy Monitor grades this coordinate as
      approximate — good for "there is a plant near this town", not for measuring
      a distance off the map. The nearby lists below inherit that uncertainty.</p>` : ''}
  </section>

  ${nearbyBlock(`Data centres within 25 km — ${nearSites.length}`,
     siteRows, 'No registry site within 25 km.')}
  ${nearbyBlock(`Fabs within 50 km — ${nearFabs.length}`, fabRows, 'No fab within 50 km.')}

  <section class="panel card">
    <h2>Source</h2>
    <p class="note">${p.src === 'gem'
      ? `<a href="https://globalenergymonitor.org/projects/global-integrated-power-tracker/" target="_blank" rel="noopener">Global Energy Monitor</a>,
         Global Integrated Power Tracker, August 2026, under
         <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.`
      : `<a href="https://www.eia.gov/electricity/data/eia860m/" target="_blank" rel="noopener">EIA-860M</a>,
         June 2026 — a US Government work in the public domain. Aggregated from
         generator-level rows to one record per plant by
         <span class="mono">src/plants.py</span>.`}</p>
  </section>`;

  return page({
    title: p.n,
    crumb: p.n,
    parent: { name: 'Power plants', href: '/plants' },
    lede: `${esc(FUEL[p.f] || p.f)} · ${esc(where)}`,
    note: `<a href="/plants">All power plants</a> · <a href="/?plant=${encodeURIComponent(p.id)}">Show on the map</a>`,
    body,
  });
}

// ---- fab -------------------------------------------------------------------

export function renderFabPage({ fab: f, sites, plants, geo, kmBetween }) {
  const nearSites = near(f.lat, f.lon, sites, 25, kmBetween).slice(0, 12);
  const nearPlants = near(f.lat, f.lon, plants, 25, kmBetween)
    .filter(({ x }) => x.k === 'op' && x.mw).slice(0, 12);
  const genMw = nearPlants.reduce((a, { x }) => a + x.mw, 0);

  const siteRows = nearSites.map(({ x, d }) => `<tr>
    <td><a href="/site/${esc(x.id)}"><b>${esc(x.n || x.o || 'Data centre')}</b></a></td>
    <td class="dim">${esc(x.o || '')}</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);
  const plantRows = nearPlants.map(({ x, d }) => `<tr>
    <td><a href="/plant/${esc(x.id)}"><b>${esc(x.n)}</b></a></td>
    <td class="dim">${esc(FUEL[x.f] || x.f)}</td>
    <td class="num">${n0(x.mw)} MW</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);

  const body = `
  <section class="panel card">
    <h2>Fab</h2>
    <div class="facts">
      ${fact('Status', esc(FSTATUS[f.k] || f.k))}
      ${fact('Operator', esc(f.op || ''))}
      ${fact('Parent', f.grp && f.grp !== f.op ? esc(f.grp) : '')}
      ${fact('Process node', f.nm ? `${f.nm} nm` : '')}
      ${fact('Wafer size', f.wf ? `${f.wf} mm` : '')}
      ${fact('Wafer starts', f.ws ? `${n0(f.ws)} per month` : '')}
      ${fact('First production', f.y || '')}
      ${fact('Where', esc([f.pl, geo.country(f.cy)].filter(Boolean).join(', ')))}
      ${fact('Coordinates', `<span class="mono">${f.lat}, ${f.lon}</span>`)}
      ${fact('Estimated load', f.mw
        ? `<strong>~${n0(f.mw)}</strong> MW <span class="dim">estimated</span>` : '')}
    </div>
    ${f.mw ? `<p class="note">That megawatt figure is <b>modelled, not
      measured</b>. No fab anywhere publishes its electricity demand, so it is
      derived from the published wafer capacity and process node above, anchored
      on TSMC's fleet-wide disclosure and the single per-fab figure that exists
      in public. Treat it as good to a factor of two.</p>`
      : `<p class="note">No load estimate: this fab does not publish both a
      wafer capacity and a process node, and guessing the node would dominate
      every other error in the model — it spans more than an order of magnitude
      across the node range.</p>`}
    ${shaken(f)}
    ${f.nt ? `<p class="note">${esc(f.nt)}</p>` : ''}
    ${f.pn ? `<p class="note">${esc(f.pn)}</p>` : ''}
  </section>

  ${nearbyBlock(`Operating generation within 25 km${genMw ? ` — ${n0(genMw)} MW` : ''}`,
     plantRows, 'No plant of 100 MW or more within 25 km.')}
  ${nearbyBlock(`Data centres within 25 km — ${nearSites.length}`, siteRows,
     'No registry site within 25 km.')}

  <section class="panel card">
    <h2>Source</h2>
    <p class="note">Hand-sourced. No open fab dataset exists that is global,
    geocoded and licensable at once — the authoritative one costs US$11,100 a
    year, and the free ones are missing either the coordinates or the coverage.
    So the names came from a public index and every value here was then
    established from the sources below.</p>
    ${(f.src || []).length ? `<ul class="fabsrc">${f.src.map(u =>
      `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ul>`
      : '<p class="note">No source URL recorded for this record.</p>'}
  </section>`;

  return page({
    title: f.n,
    crumb: f.n,
    parent: { name: 'Fabs', href: '/fabs' },
    lede: `${esc(f.grp || f.op)} · ${esc([f.pl, geo.country(f.cy)].filter(Boolean).join(', '))}`,
    note: `<a href="/fabs">All fabs</a> · <a href="/?fab=${encodeURIComponent(f.id)}">Show on the map</a>`,
    body,
  });
}
