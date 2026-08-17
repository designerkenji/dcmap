// /datacentres — the registry itself as tables.
//
// The map already had a list view and per-site pages; what it never had was the
// aggregate. 6,269 sites is a number nobody can hold, and the questions people
// actually ask of a registry are comparative: who is big, where, how much of
// this do we even know.
//
// THAT LAST ONE GETS ITS OWN COLUMN EVERYWHERE
// This registry is assembled from OSM, PeeringDB and Epoch, and coverage is
// wildly uneven between fields: 6,255 sites have a coordinate and 50 have a
// power figure. A summary that printed totals without denominators would imply
// a completeness the data does not have, and the power column is the worst
// offender - "14,979 MW" reads as the registry's load when it is 50 sites of
// 6,269. Every derived total here carries what it was computed over.

import { esc, n0, tile, table, page, makeGeo, countryList } from './summary.mjs';

const ST = {
  operational: 'Operational', under_construction: 'Building',
  proposed: 'Proposed', '': 'Unknown',
};

function roll(list) {
  const mw = list.filter(s => s.mw);
  const ft2 = list.filter(s => s.ft2);
  const gen = list.filter(s => s.gen);
  return {
    n: list.length,
    ai: list.filter(s => s.ft === 'ai').length,
    mapped: list.filter(s => s.lat != null).length,
    mw: mw.reduce((a, s) => a + s.mw, 0), mwN: mw.length,
    ft2: ft2.reduce((a, s) => a + s.ft2, 0), ft2N: ft2.length,
    gen: gen.length,
    ops: new Set(list.map(s => s.o).filter(Boolean)).size,
  };
}

// A total that always shows its denominator. Written once because getting this
// wrong in one cell undoes saying it correctly in the other ten.
const cov = (v, have, total) => (have
  ? `${n0(v)}<span class="dim"> ${have}/${total}</span>`
  : '<span class="dim">—</span>');

export function renderDcPage(sites, regions, operators) {
  const geo = makeGeo(regions);
  const all = roll(sites);
  const cys = new Set(sites.map(s => s.c).filter(Boolean));

  // ---- by region -----------------------------------------------------------
  const byReg = new Map();
  for (const s of sites) {
    const r = geo.region(s.c);
    if (!byReg.has(r)) byReg.set(r, []);
    byReg.get(r).push(s);
  }
  const regionRows = [...byReg.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, list]) => {
      const r = roll(list);
      return `<tr>
        <td><b>${esc(name)}</b></td>
        <td class="num">${n0(r.n)}</td>
        <td class="num">${r.ai || ''}</td>
        <td class="num">${n0(r.ops)}</td>
        <td class="num">${cov(r.mw, r.mwN, r.n)}</td>
        <td class="num">${cov(r.ft2, r.ft2N, r.n)}</td>
        <td class="dim">${countryList(list, s => s.c, geo, 5)}</td>
      </tr>`;
    }).join('');

  // ---- by operator ---------------------------------------------------------
  // Keyed on the registry's own canonical operator key, not the raw string -
  // "Equinix" and "Equinix, Inc." are one company and the directory already
  // knows it. Grouping on the raw name splits them and reports both as smaller
  // than they are.
  const byOp = new Map();
  for (const s of sites) {
    const k = s.o || '(unresolved)';
    if (!byOp.has(k)) byOp.set(k, []);
    byOp.get(k).push(s);
  }
  const opsSorted = [...byOp.entries()].sort((a, b) => b[1].length - a[1].length);
  const TOP = 40;
  const opRows = opsSorted.slice(0, TOP).map(([name, list]) => {
    const r = roll(list);
    const key = operators?.find(o => o.name === name)?.key;
    const label = key
      ? `<a href="/operator/${encodeURIComponent(key)}"><b>${esc(name)}</b></a>`
      : `<b>${esc(name)}</b>`;
    const regs = [...new Set(list.map(s => geo.region(s.c)))].filter(x => x !== 'Unattributed');
    return `<tr>
      <td>${label}</td>
      <td class="num">${n0(r.n)}</td>
      <td class="num">${r.ai || ''}</td>
      <td class="num">${[...new Set(list.map(s => s.c))].length}</td>
      <td class="num">${cov(r.mw, r.mwN, r.n)}</td>
      <td class="num">${cov(r.ft2, r.ft2N, r.n)}</td>
      <td class="dim">${esc(regs.slice(0, 3).join(' · '))}${regs.length > 3 ? ' …' : ''}</td>
    </tr>`;
  }).join('');

  // ---- what the registry actually knows ------------------------------------
  const fields = [
    ['A coordinate', s => s.lat != null],
    ['An operator', s => !!s.o],
    ['A city', s => !!s.ci],
    ['A build year', s => !!s.by],
    ['A serving utility', s => !!s.u],
    ['Power, MW', s => !!s.mw],
    ['Floor area (ft²)', s => !!s.ft2],
    ['Generation within 25 km', s => !!s.gen],
  ];
  const covRows = fields.map(([label, has]) => {
    const k = sites.filter(has).length;
    const pct = (k / all.n * 100);
    return `<tr>
      <td><b>${esc(label)}</b></td>
      <td class="num">${n0(k)}</td>
      <td class="num">${pct.toFixed(pct < 1 ? 1 : 0)}%</td>
      <td><span class="covbar"><i style="width:${Math.max(1, pct).toFixed(1)}%"></i></span></td>
    </tr>`;
  }).join('');

  // ---- the biggest, by the two figures that exist --------------------------
  const byMw = sites.filter(s => s.mw).sort((a, b) => b.mw - a.mw).slice(0, 20);
  const mwRows = byMw.map(s => `<tr>
    <td><a href="/site/${esc(s.id)}"><b>${esc(s.n || s.o || 'Data centre')}</b></a></td>
    <td>${esc(s.o || '')}</td>
    <td class="dim">${esc([s.ci, geo.country(s.c)].filter(Boolean).join(', '))}</td>
    <td>${s.ft === 'ai' ? '<i class="ops-ai">AI</i>' : ''}</td>
    <td class="num">${n0(s.mw)}</td>
    <td class="num">${s.gen ? n0(s.gen) : '<span class="dim">—</span>'}</td>
  </tr>`).join('');

  const body = `
  <section class="panel card">
    <div class="fabtiles">
      ${tile('Sites', n0(all.n), `${cys.size} countries`)}
      ${tile('AI sites', n0(all.ai), 'Epoch-tracked')}
      ${tile('Operators', n0(all.ops), 'distinct names')}
      ${tile('On the map', n0(all.mapped), `${all.n - all.mapped} search-only`)}
    </div>
    <p class="note">Assembled from OpenStreetMap, PeeringDB and Epoch AI, which
    means coverage is uneven by field rather than by site — nearly everything
    has a coordinate and almost nothing has a power figure. Every total below
    carries the count it was computed over for that reason.</p>
  </section>

  <section class="panel card">
    <h2>By region</h2>
    ${table(['Region', { n: 'Sites' }, { n: 'AI' }, { n: 'Operators' },
             { n: 'MW' }, { n: 'Floor area ft²' }, 'Countries'], regionRows)}
  </section>

  <section class="panel card">
    <h2>By operator <span class="dim">${n0(opsSorted.length)}</span></h2>
    ${table(['Operator', { n: 'Sites' }, { n: 'AI' }, { n: 'Countries' },
             { n: 'MW' }, { n: 'Floor area ft²' }, 'Regions'], opRows,
            `Showing the ${TOP} largest of ${n0(opsSorted.length)}.
             <a href="/?operators=1">The full directory</a> has the rest.`)}
  </section>

  <section class="panel card">
    <h2>What the registry knows</h2>
    ${table(['Field', { n: 'Sites' }, { n: 'Share' }, ''], covRows)}
    <p class="note">Read this before trusting any total on the page. Power is
    known for the Epoch-tracked AI sites and essentially nowhere else; floor
    area comes from Virginia county parcel records, so it is one state's data;
    and generation within 25 km is derived here rather than sourced, which is
    why it covers most of the registry when the others do not.</p>
  </section>

  <section class="panel card">
    <h2>Largest by known load</h2>
    ${table(['Site', 'Operator', 'Where', '', { n: 'MW' }, { n: 'Generation ≤25 km' }], mwRows,
            `The ${byMw.length} largest of the ${all.mwN} sites that have a power
             figure at all — not of ${n0(all.n)}.`)}
  </section>`;

  return page({
    title: 'Data centres',
    lede: `${n0(all.n)} sites in ${cys.size} countries, deduped from three
      sources into one record each with a stable, shareable URL.`,
    body,
  });
}
