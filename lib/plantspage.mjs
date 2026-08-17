// /plants — the generation layer as tables.
//
// 28,152 dots is past the point where a map answers anything comparative. The
// questions this page exists for are where capacity sits, what it burns, and
// how much of it is leaving - and the last one is the reason the layer was
// built, because a retiring plant's interconnection is what a data centre
// actually wants.
//
// STATUS IS THREE MUTUALLY EXCLUSIVE CAPACITIES, NOT ONE NUMBER
// A plant can be operating with units retiring and new units planned on the
// same pad. So every total here is split: mw is running now, xmw is running
// but announced to close, pmw is proposed, rmw is already gone. Summing them
// into "capacity" would add a 1970s boiler to a 2030 proposal.

import { esc, n0, ofN, tile, table, page, makeGeo, countryList } from './summary.mjs';

const FUEL = {
  nuclear: 'Nuclear', gas: 'Gas', coal: 'Coal', oil: 'Oil', hydro: 'Hydro',
  wind: 'Wind', solar: 'Solar', storage: 'Storage', other: 'Other',
};
// Ordered by how plausible a co-location host the class is, matching the map's
// legend, rather than by how many there are - which would lead with solar.
const FUEL_ORDER = ['nuclear', 'gas', 'coal', 'hydro', 'oil', 'wind', 'solar', 'storage', 'other'];

const BA_ISO = { PJM: 'PJM', ERCO: 'ERCOT', MISO: 'MISO', ISNE: 'ISO-NE',
                 NYIS: 'NYISO', CISO: 'CAISO', SWPP: 'SPP' };

function roll(list) {
  const op = list.filter(p => p.k === 'op');
  const leaving = list.filter(p => p.xmw);
  return {
    n: list.length,
    op: op.length,
    plan: list.filter(p => p.k === 'plan').length,
    ret: list.filter(p => p.k === 'ret').length,
    mw: op.reduce((a, p) => a + (p.mw || 0), 0),
    pmw: list.reduce((a, p) => a + (p.pmw || 0), 0),
    // Retired capacity AT SITES THAT ARE FULLY DARK, so the megawatts and the
    // plant count in the same tile are about the same plants. Summing rmw over
    // everything double-counts: an operating station with closed units carries
    // rmw too, and pairing that total with the fully-dark COUNT reported
    // 892,887 MW over 814 plants when those 814 hold 454,255 MW.
    rmw: list.filter(p => p.k === 'ret').reduce((a, p) => a + (p.rmw || 0), 0),
    // The other reading, kept because it is also true and also wanted: every
    // megawatt that has been retired anywhere, including at sites still running.
    rmwAny: list.reduce((a, p) => a + (p.rmw || 0), 0),
    xmw: leaving.reduce((a, p) => a + p.xmw, 0),
    xn: leaving.length,
    approx: list.filter(p => p.ax).length,
  };
}

export function renderPlantsPage(plants, regions) {
  const geo = makeGeo(regions);
  const all = roll(plants);
  const cys = new Set(plants.map(p => p.cy));

  // ---- by region -----------------------------------------------------------
  const byReg = new Map();
  for (const p of plants) {
    const r = geo.region(p.cy);
    if (!byReg.has(r)) byReg.set(r, []);
    byReg.get(r).push(p);
  }
  const regionRows = [...byReg.entries()]
    .sort((a, b) => roll(b[1]).mw - roll(a[1]).mw)
    .map(([name, list]) => {
      const s = roll(list);
      return `<tr>
        <td><b>${esc(name)}</b></td>
        <td class="num">${n0(s.n)}</td>
        <td class="num">${n0(s.mw)}</td>
        <td class="num">${s.xmw ? n0(s.xmw) : ''}<span class="dim">${s.xn ? ' ' + s.xn : ''}</span></td>
        <td class="num">${s.pmw ? n0(s.pmw) : ''}</td>
        <td class="num">${s.rmw ? n0(s.rmw) : ''}</td>
        <td class="dim">${countryList(list, p => p.cy, geo, 5)}</td>
      </tr>`;
    }).join('');

  // ---- by category ---------------------------------------------------------
  const byFuel = FUEL_ORDER.map(f => [f, plants.filter(p => p.f === f)]).filter(x => x[1].length);
  const fuelRows = byFuel.map(([f, list]) => {
    const s = roll(list);
    const topRegion = [...byReg.keys()]
      .map(r => [r, list.filter(p => geo.region(p.cy) === r).length])
      .sort((a, b) => b[1] - a[1])[0];
    return `<tr>
      <td><b><i class="fkey" style="background:${FUELC[f]}"></i>${esc(FUEL[f])}</b></td>
      <td class="num">${n0(s.n)}</td>
      <td class="num">${n0(s.op)}</td>
      <td class="num">${n0(s.mw)}</td>
      <td class="num">${s.xmw ? n0(s.xmw) : ''}</td>
      <td class="num">${s.rmw ? n0(s.rmw) : ''}</td>
      <td class="dim">${topRegion ? esc(topRegion[0]) + ' ' + topRegion[1] : ''}</td>
    </tr>`;
  }).join('');

  // ---- the co-location table, which is the point of the layer --------------
  const leaving = plants.filter(p => p.xmw && p.ry)
    .sort((a, b) => a.ry - b.ry || b.xmw - a.xmw).slice(0, 40);
  const leavingRows = leaving.map(p => `<tr>
    <td><a href="/plant/${esc(p.id)}"><b>${esc(p.n)}</b></a></td>
    <td>${esc(FUEL[p.f] || p.f)}</td>
    <td class="dim">${esc([p.st, BA_ISO[p.ba] || p.ba, geo.country(p.cy)].filter(Boolean).join(' · '))}</td>
    <td class="num">${p.ry}</td>
    <td class="num">${n0(p.xmw)}</td>
    <td class="num">${n0(p.mw)}</td>
  </tr>`).join('');

  const dark = plants.filter(p => p.k === 'ret' && p.rmw)
    .sort((a, b) => b.rmw - a.rmw).slice(0, 25);
  const darkRows = dark.map(p => `<tr>
    <td><a href="/plant/${esc(p.id)}"><b>${esc(p.n)}</b></a></td>
    <td>${esc(FUEL[p.f] || p.f)}</td>
    <td class="dim">${esc([p.st, BA_ISO[p.ba] || p.ba, geo.country(p.cy)].filter(Boolean).join(' · '))}</td>
    <td class="num">${p.ry || ''}</td>
    <td class="num">${n0(p.rmw)}</td>
  </tr>`).join('');

  const body = `
  <section class="panel card">
    <div class="fabtiles">
      ${tile('Plants', n0(all.n), `${cys.size} countries, 100 MW and up`)}
      ${tile('Operating now', n0(all.mw) + ' MW', `${n0(all.op)} plants`)}
      ${tile('Announced to close', n0(all.xmw) + ' MW', `${all.xn} plants`)}
      ${tile('Already dark', n0(all.rmw) + ' MW', `${n0(all.ret)} plants, nothing running`)}
    </div>
    <p class="note">Four different quantities, never added together. A plant can
    be running, closing and expanding at once, so the columns below keep them
    apart: <b>operating</b> is generating today, <b>closing</b> is the capacity
    of units with an announced retirement date, <b>planned</b> is proposed, and
    <b>dark</b> is capacity at sites where nothing runs at all — a further
    ${n0(all.rmwAny - all.rmw)} MW has been retired at plants that are still
    operating, which is counted separately for the same reason. Nameplate is not spare
    capacity — a nuclear plant at a 92% capacity factor and fully contracted has
    none, while a mid-merit gas plant at 45% has real headroom.</p>
  </section>

  <section class="panel card">
    <h2>By region</h2>
    ${table(['Region', { n: 'Plants' }, { n: 'Operating MW' }, { n: 'Closing MW' },
             { n: 'Planned MW' }, { n: 'Dark MW' }, 'Countries'], regionRows)}
  </section>

  <section class="panel card">
    <h2>By category</h2>
    ${table(['Fuel', { n: 'Plants' }, { n: 'Operating' }, { n: 'Operating MW' },
             { n: 'Closing MW' }, { n: 'Dark MW' }, 'Largest region'], fuelRows)}
    <p class="note"><b>Closing MW is United States only.</b> EIA publishes a
    planned-retirement date per generator and Global Energy Monitor does not, so
    an empty cell outside North America means the field does not exist rather
    than that nothing is closing. Storage is United States only for a different
    reason: Batteries sit in a separate
    Global Energy Monitor tracker that is not part of the Integrated Power
    Tracker, so the global half of this layer cannot see them.</p>
  </section>

  <section class="panel card">
    <h2>Capacity with an announced retirement <span class="dim">${all.xn}</span></h2>
    <p class="note">The reason this layer exists. What a data centre wants at a
    closing plant is not the boiler — it is the switchyard, the interconnection
    rights, the cooling water and the permitting posture. Soonest first.</p>
    ${table(['Plant', 'Fuel', 'Where', { n: 'From' }, { n: 'MW leaving' }, { n: 'MW running' }],
            leavingRows, leaving.length < all.xn
              ? `Showing the ${leaving.length} soonest of ${all.xn}.` : '')}
  </section>

  <section class="panel card">
    <h2>Already dark <span class="dim">${all.ret}</span></h2>
    <p class="note">Sites where nothing is generating but the interconnection may
    be reusable. Homer City, Cayuga and PORTS were all bought this way.</p>
    ${table(['Plant', 'Fuel', 'Where', { n: 'Closed' }, { n: 'MW was there' }],
            darkRows, dark.length < all.ret ? `Showing the ${dark.length} largest of ${all.ret}.` : '')}
  </section>

  <section class="panel card">
    <h2>Where this comes from</h2>
    <p class="note">United States from
    <a href="https://www.eia.gov/electricity/data/eia860m/" target="_blank" rel="noopener">EIA-860M</a>,
    June 2026, a US Government work in the public domain. Everywhere else from
    <a href="https://globalenergymonitor.org/projects/global-integrated-power-tracker/" target="_blank" rel="noopener">Global Energy Monitor</a>'s
    Global Integrated Power Tracker, August 2026, under
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
    GEM covers the US too and all of it is discarded — each record comes whole
    from one source, so there is nothing merged to get subtly wrong.
    ${n0(all.approx)} of ${n0(all.n)} carry a coordinate GEM grades as
    approximate rather than exact; those draw hollow on the map.</p>
  </section>`;

  return page({
    title: 'Power plants',
    lede: `${n0(all.n)} plants of 100 MW and up in ${cys.size} countries, and
      what is happening to them. Generation is here because it is the constraint
      on data centres: the same interconnection queue, the same regulators.`,
    body,
  });
}

const FUELC = {
  nuclear: '#8B5CF6', gas: '#F97316', coal: '#57534E', oil: '#A16207',
  hydro: '#0EA5E9', wind: '#06B6D4', solar: '#EAB308', storage: '#EC4899',
  other: '#94A3B8',
};
