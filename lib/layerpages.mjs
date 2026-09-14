// /supply and /footprints — summary pages for the two layers that had none.
//
// Every other layer's toolbar entry links out to its tables (/datacentres,
// /fabs, /plants, /quakes); these two carried their whole story in tooltips.
// The supply page is the LEDGER made readable: every researched pairing in
// dc_plant_links.json plus every hand-made link, with its arrangement, basis
// and source. The footprints page is the coverage accounting: what shape
// data exists, from which source, under which licence - the same denominators
// the /datacentres page insists on.

import { esc, n0, tile, table, page, makeGeo } from './summary.mjs';
import { LINK_STRUCTURE } from './overrides.mjs';

const stLabel = (k) => (LINK_STRUCTURE[k] || {}).label || k || '';
const kmApart = (aLon, aLat, bLon, bLat) => {
  const dx = (aLon - bLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.hypot(dx, (aLat - bLat) * 111.32);
};
const srcCell = (note, url) => `${esc(note || '')}${url
  ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}`;

// ---- /supply ----------------------------------------------------------------

export function renderSupplyPage({ sites, fabs, plantById, annByPlant }) {
  const plantCell = (pid) => {
    const p = plantById.get(pid);
    return p ? `<a href="/maps/plant/${esc(pid)}"><b>${esc(p.n)}</b></a>` : esc(pid);
  };

  // Solid links: sites and fabs whose record names a plant in the inventory.
  const solid = [];
  for (const s of sites) {
    if (!s.linked_plant_id || !plantById.has(s.linked_plant_id)) continue;
    const p = plantById.get(s.linked_plant_id);
    solid.push({
      load: `<a href="/maps/site/${esc(s.site_id)}"><b>${esc(s.name || s.epoch_name || s.operator || 'Data centre')}</b></a>`,
      kind: 'data centre', op: s.operator || '',
      pid: s.linked_plant_id, st: s.link_structure,
      km: s.lat != null && p.lat != null ? kmApart(+s.lon, +s.lat, p.lon, p.lat) : null,
      note: s.link_note, url: s.link_src,
    });
  }
  for (const f of fabs) {
    if (!f.link_plant_id || !plantById.has(f.link_plant_id)) continue;
    const p = plantById.get(f.link_plant_id);
    solid.push({
      load: `<a href="/maps/fab/${esc(f.id)}"><b>${esc(f.n)}</b></a>`,
      kind: 'fab', op: f.grp || f.op || '',
      pid: f.link_plant_id, st: f.link_structure,
      km: f.lat != null && p.lat != null ? kmApart(f.lon, f.lat, p.lon, p.lat) : null,
      note: f.link_note, url: f.link_src,
    });
  }
  const solidRows = solid.map(l => `<tr>
    <td>${l.load} <span class="dim">${l.kind}</span></td>
    <td class="dim">${esc(l.op)}</td>
    <td>${plantCell(l.pid)}</td>
    <td>${esc(stLabel(l.st))}</td>
    <td class="num">${l.km != null ? l.km.toFixed(1) + ' km' : ''}</td>
    <td class="dim">${srcCell(l.note, l.url)}</td>
  </tr>`).join('');

  // Named generation with no inventory record yet: the site says what powers
  // it, and the plant layer cannot answer - permitted turbines, an SMR.
  const named = sites.filter(s => !s.linked_plant_id && s.link_plant_name);
  const namedRows = named.map(s => `<tr>
    <td><a href="/maps/site/${esc(s.site_id)}"><b>${esc(s.name || s.epoch_name || s.operator || 'Data centre')}</b></a></td>
    <td class="dim">${esc(s.operator || '')}</td>
    <td><b>${esc(s.link_plant_name)}</b></td>
    <td>${esc(stLabel(s.link_structure))}</td>
    <td class="dim">${srcCell(s.link_note, s.link_src)}</td>
  </tr>`).join('');

  // The researched remainder: announced campuses (drawn hollow on the map)
  // and corporate offtakes (rows on the plant pages, nothing to pin).
  const ann = [], corp = [];
  for (const ls of annByPlant.values()) {
    for (const l of ls) (l.dc && l.dc.corp ? corp : ann).push(l);
  }
  const annRows = ann.map(l => `<tr>
    <td><b>${esc(l.dc.name)}</b></td>
    <td>${plantCell(l.plant_id)}</td>
    <td>${esc(stLabel(l.structure))}</td>
    <td class="dim">${srcCell(l.note, l.url)}</td>
  </tr>`).join('');
  const corpRows = corp.map(l => `<tr>
    <td><b>${esc(l.dc.name)}</b></td>
    <td>${plantCell(l.plant_id)}</td>
    <td>${esc(stLabel(l.structure))}</td>
    <td class="dim">${srcCell(l.note, l.url)}</td>
  </tr>`).join('');

  const body = `
  <section class="panel card">
    <div class="fabtiles">
      ${tile('Linked loads', n0(solid.length), 'site/fab ⇆ plant, both on the map')}
      ${tile('Named generation', n0(named.length), 'no EIA/GEM record yet')}
      ${tile('Announced campuses', n0(ann.length), 'hollow markers on the map')}
      ${tile('Corporate offtakes', n0(corp.length), 'no single load to pin')}
    </div>
    <p class="note">Named pairings only, never proximity: every row records a
    documented arrangement — a PUCT docket, an executed PPA, an air permit for
    on-site turbines — researched with the source shown and adversarially
    verified before it was written down. Hand edits made on a site page win
    over the researched file. The map draws these as the green Supply Links
    layer.</p>
  </section>

  <section class="panel card">
    <h2>Linked loads <span class="dim">${n0(solid.length)}</span></h2>
    ${table(['Load', 'Operator', 'Plant', 'Arrangement', { n: 'Distance' }, 'Basis'],
            solidRows, 'A contract is not a wire: front-of-meter contracts cross any distance; behind-the-meter and net-metered pairings are physical.')}
  </section>

  ${named.length ? `<section class="panel card">
    <h2>Named generation, not yet in the plant inventory <span class="dim">${n0(named.length)}</span></h2>
    ${table(['Site', 'Operator', 'Generation', 'Arrangement', 'Basis'], namedRows,
            'Real generation the EIA/GEM inventory has not caught up with — permitted on-site turbines, an SMR under construction. The link gains a plant page when the inventory does.')}
  </section>` : ''}

  ${ann.length ? `<section class="panel card">
    <h2>Announced campuses <span class="dim">${n0(ann.length)}</span></h2>
    ${table(['Campus', 'Plant', 'Arrangement', 'Basis'], annRows,
            'Verified pairings whose campus is not a registry dot yet — announced or under construction. Drawn hollow on the map at the researched coordinate; each graduates to a linked load when the campus lands in the registry’s sources.')}
  </section>` : ''}

  ${corp.length ? `<section class="panel card">
    <h2>Corporate offtakes <span class="dim">${n0(corp.length)}</span></h2>
    ${table(['Buyer', 'Plant', 'Arrangement', 'Basis'], corpRows,
            'Company-wide deals with a named plant and no single load to pin — the TSMC offshore-wind CPPAs, the fleet PPAs. They surface on the plant’s page and nowhere on the map, because a marker needs a place to stand.')}
  </section>` : ''}`;

  return page({
    title: 'Supply links',
    crumb: 'Supply links',
    lede: 'Who powers whom — every arrangement somebody has established',
    note: '<a href="/">Show on the map</a>',
    body,
  });
}

// ---- /footprints ------------------------------------------------------------

// What each src value means and under which licence its shapes arrived.
// Kept next to the counts because the licence is part of the answer.
const SRC_INFO = {
  osm: ['OpenStreetMap buildings', 'ODbL — © OpenStreetMap contributors'],
  'osm-site': ['Large buildings on a registry site (OSM)', 'ODbL — © OpenStreetMap contributors'],
  'osm-landuse': ['Parcels a mapper drew (OSM landuse)', 'ODbL — © OpenStreetMap contributors'],
  'osm-plant': ['Power-plant site perimeters (OSM)', 'ODbL — © OpenStreetMap contributors'],
  overture: ['Overture Maps buildings (ML-extracted)', 'ODbL; includes OSM'],
  im3: ['IM3 data-centre atlas', 'US DOE / PNNL'],
  parcel: ['Cadastral parcels (county, WFS, HMLR, RoS, MOJ, Precisely CA/AU)',
           'Mixed: public records, OGL v3 + Crown copyright (England & Wales, Scotland), 法務省 (Japan), licensed vendor (CA/AU)'],
  derived: ['Site boundaries hulled from their own buildings', 'derived in-repo'],
};

export function renderFootprintsPage({ footprints, sites, fabs = [], plantById = new Map(), regions = {} }) {
  const geo = makeGeo(regions);
  // What each shape belongs TO, and where that thing is: the attached ids
  // name a data centre (site-...), a fab (f<nnn>) or a plant (EIA/GEM id),
  // and the asset's own country places the shape in a region.
  const siteCy = new Map(sites.map(s => [s.site_id ?? s.id, s.country ?? s.c]));
  const fabCy = new Map(fabs.map(f => [f.id, f.cy]));
  const typeAndCy = (ids) => {
    for (const raw of ids || []) {
      const id = String(raw);
      if (id.startsWith('site-')) return ['dc', siteCy.get(id)];
      if (/^f\d+$/.test(id)) return ['fab', fabCy.get(id)];
      const pl = plantById.get(id);
      if (pl) return ['plant', pl.cy];
    }
    return ['none', null];
  };

  // The same resolution again, but for LINKING and NAMING rather than
  // counting. Every kind a footprint can attach to has a page, and the
  // leaderboard below used to link only site- ids - so a table whose top rows
  // are all power plants offered not one link, and showed the shape's own id
  // where the plant's name was sitting one lookup away.
  const siteName = new Map(sites.map(s => [s.site_id ?? s.id, s.name ?? s.n]));
  const fabName = new Map(fabs.map(f => [f.id, f.n]));
  const assetRef = (ids) => {
    for (const raw of ids || []) {
      const id = String(raw);
      if (id.startsWith('site-')) {
        return { href: '/maps/site/' + encodeURIComponent(id), what: 'Data centre',
                 name: siteName.get(id) || '' };
      }
      if (/^f\d+$/.test(id)) {
        return { href: '/maps/fab/' + encodeURIComponent(id), what: 'Fab',
                 name: fabName.get(id) || '' };
      }
      if (id.startsWith('sub-')) {
        return { href: '/maps/substation/' + encodeURIComponent(id), what: 'Substation', name: '' };
      }
      const pl = plantById.get(id);
      if (pl) {
        return { href: '/maps/plant/' + encodeURIComponent(id), what: 'Power plant',
                 name: pl.n || '' };
      }
    }
    return { href: '', what: '', name: '' };
  };

  const feats = footprints.features;
  const bySrc = new Map(), byKind = new Map();
  const byRegion = new Map();     // region -> {dc, fab, plant}
  let unattached = 0;
  const covered = new Set();
  let area = 0;
  for (const f of feats) {
    const p = f.properties;
    bySrc.set(p.src, (bySrc.get(p.src) || 0) + 1);
    byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);
    const [ty, cy] = typeAndCy(p.sites);
    if (ty === 'none') unattached++;
    else {
      const reg = geo.region(cy) || 'Unattributed';
      if (!byRegion.has(reg)) byRegion.set(reg, { dc: 0, fab: 0, plant: 0 });
      byRegion.get(reg)[ty]++;
    }
    if (p.kind === 'campus' && p.src !== 'derived' && p.src !== 'osm-landuse') {
      for (const sid of p.sites || []) covered.add(sid);
    }
    if (p.m2) area += p.m2;
  }
  const mapped = sites.filter(s => s.lat != null).length;
  const siteCovered = sites.filter(s => covered.has(s.site_id ?? s.id)).length;

  // Coverage: of the assets each region HAS, how many carry any shape at all.
  const attached = new Set();
  for (const f of feats) for (const id of f.properties.sites || []) attached.add(String(id));
  const covByRegion = new Map();
  const bump = (cy, ty, id) => {
    const reg = geo.region(cy) || 'Unattributed';
    if (!covByRegion.has(reg)) {
      covByRegion.set(reg, { dc: [0, 0], fab: [0, 0], plant: [0, 0] });
    }
    const c = covByRegion.get(reg)[ty];
    c[1]++;
    if (attached.has(id)) c[0]++;
  };
  for (const s of sites) {
    if ((s.lat ?? null) !== null && s.lat !== '') bump(s.country ?? s.c, 'dc', s.site_id ?? s.id);
  }
  for (const f of fabs) bump(f.cy, 'fab', f.id);
  for (const pl of plantById.values()) bump(pl.cy, 'plant', pl.id);
  const pctCell = ([cov2, tot]) => (tot
    ? `${n0(cov2)}/${n0(tot)}<span class="dim"> ${Math.round(cov2 / tot * 100)}%</span>`
    : '<span class="dim">—</span>');
  const covRegionRows = [...covByRegion.entries()]
    .sort((a, b) => (b[1].dc[1] + b[1].fab[1] + b[1].plant[1]) - (a[1].dc[1] + a[1].fab[1] + a[1].plant[1]))
    .map(([reg, c]) => `<tr>
      <td><b>${esc(reg)}</b></td>
      <td class="num">${pctCell(c.dc)}</td>
      <td class="num">${pctCell(c.fab)}</td>
      <td class="num">${pctCell(c.plant)}</td>
    </tr>`).join('');

  const regionRows = [...byRegion.entries()]
    .sort((a, b) => (b[1].dc + b[1].fab + b[1].plant) - (a[1].dc + a[1].fab + a[1].plant))
    .map(([reg, c]) => `<tr>
      <td><b>${esc(reg)}</b></td>
      <td class="num">${c.dc ? n0(c.dc) : '<span class="dim">—</span>'}</td>
      <td class="num">${c.fab ? n0(c.fab) : '<span class="dim">—</span>'}</td>
      <td class="num">${c.plant ? n0(c.plant) : '<span class="dim">—</span>'}</td>
      <td class="num">${n0(c.dc + c.fab + c.plant)}</td>
    </tr>`).join('')
    + (unattached ? `<tr>
      <td><span class="dim">Attached to nothing</span></td>
      <td class="num"><span class="dim">—</span></td>
      <td class="num"><span class="dim">—</span></td>
      <td class="num"><span class="dim">—</span></td>
      <td class="num dim">${n0(unattached)}</td>
    </tr>` : '');

  const srcRows = [...bySrc.entries()].sort((a, b) => b[1] - a[1]).map(([src, n]) => {
    const [what, licence] = SRC_INFO[src] || [src, ''];
    return `<tr>
      <td><b>${esc(what)}</b> <span class="dim mono">${esc(src)}</span></td>
      <td class="num">${n0(n)}</td>
      <td class="dim">${esc(licence)}</td>
    </tr>`;
  }).join('');

  const kindRows = [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr>
    <td><b>${esc(k)}</b></td>
    <td class="num">${n0(n)}</td>
    <td class="dim">${k === 'campus'
      ? 'a boundary — parcel, site perimeter or hull'
      : 'an individual building outline'}</td>
  </tr>`).join('');

  const measured = feats
    .filter(f => f.properties.kind === 'campus' && f.properties.m2)
    .sort((a, b) => b.properties.m2 - a.properties.m2);

  const row = (f) => {
      const p = f.properties;
      const ref = assetRef(p.sites);
      // The shape's own name first, then the asset's. A plant footprint traced
      // from OSM landuse frequently has no name of its own, and printing
      // "fp-plant-w1343836078" when the plant is called Bhadla Solar Park is a
      // worse answer than the lookup that was already available.
      const label = p.name || ref.name || p.op || p.id;
      return `<tr>
        <td>${ref.href
          ? `<a href="${esc(ref.href)}"><b>${esc(label)}</b></a>`
          : `<b>${esc(label)}</b>`}</td>
        <td class="dim">${esc(ref.what || 'unattached')}</td>
        <td class="dim mono">${esc(p.src)}</td>
        <td class="num">${n0(p.m2)} m²</td>
      </tr>`;
  };

  // Two leaderboards, and the registry's own subject goes first. Sorting every
  // measured shape by area puts fifteen offshore wind farms and solar parks at
  // the top - they are campus-kind shapes measured in hundreds of square
  // kilometres - and buries every data centre beneath them. Both lists are
  // worth having; only one of them is what this registry is about.
  const topDc = measured
    .filter(f => (f.properties.sites || []).some(s => String(s).startsWith('site-')))
    .slice(0, 15).map(row).join('');
  const top = measured.slice(0, 15).map(row).join('');

  const body = `
  <section class="panel card">
    <div class="fabtiles">
      ${tile('Shapes', n0(feats.length), `${n0(byKind.get('campus') || 0)} campuses · ${n0(byKind.get('building') || 0)} buildings`)}
      ${tile('Sites with an outline', n0(siteCovered), `of ${n0(mapped)} mapped — ${Math.round(siteCovered / mapped * 100)}%`)}
      ${tile('Sources', n0(bySrc.size), 'each with its licence below')}
      ${tile('Mapped area', n0(Math.round(area / 1e6)) + ' km²', 'sum of measured shapes')}
    </div>
    <p class="note">The dots say where; these say what shape. Faded outlines on
    the map are inferred (a big building on a known site, a model’s read of a
    roof), solid ones are asserted by a person or a public record. Shapes load
    per viewport from zoom 11; the pink rings at world zoom mark where they
    exist. Parcels follow one rule everywhere: the parcel CONTAINING the dot
    (or, second chance, a building’s rooftop centroid) or nothing.</p>
  </section>

  <section class="panel card">
    <h2>By region and type</h2>
    ${table(['Region', { n: 'Data centres' }, { n: 'Fabs' }, { n: 'Power plants' }, { n: 'Total' }],
      regionRows,
      'Counts are SHAPES, not assets — a campus of six mapped buildings counts '
      + 'six times, which is what a shape inventory should count. The type is '
      + 'whichever registry record the shape is attached to; its region comes '
      + 'from that record’s own country.')}
  </section>

  <section class="panel card">
    <h2>Coverage by region</h2>
    ${table(['Region', { n: 'Data centres' }, { n: 'Fabs' }, { n: 'Power plants' }],
      covRegionRows,
      'Of the assets each region has, how many carry at least one shape. '
      + 'Data-centre denominators are mapped sites; fab and plant denominators '
      + 'are the whole layer, approximate coordinates included — a plant whose '
      + 'location is a town centroid cannot honestly carry a perimeter, which '
      + 'is much of why plant coverage sits where it does. The three summary '
      + 'pages carry the same numbers per operator, region and fuel, and their '
      + 'per-asset tables filter on the words “outlined” and “unmapped”.')}
  </section>

  <section class="panel card">
    <h2>By source</h2>
    ${table(['Source', { n: 'Shapes' }, 'Licence'], srcRows,
      'Contains HM Land Registry data © Crown copyright and database rights 2026, reproduced under OGL v3. ' +
      '© Crown copyright, reproduced with the permission of Registers of Scotland. ' +
      '登記所備付地図データ（法務省）を加工して作成.')}
  </section>

  <section class="panel card">
    <h2>By kind</h2>
    ${table(['Kind', { n: 'Shapes' }, 'Meaning'], kindRows)}
  </section>

  <section class="panel card">
    <h2>Largest measured data-centre campuses</h2>
    ${table(['Campus', 'What', 'Source', { n: 'Area' }], topDc,
      'Campuses attached to a data centre in the registry. Every row links to the '
      + 'asset it belongs to.')}
  </section>

  <section class="panel card">
    <h2>Largest measured campuses, every layer</h2>
    ${table(['Campus', 'What', 'Source', { n: 'Area' }], top,
      'Area is the shape’s own measurement where one exists; most shapes are not '
      + 'measured, so this is a leaderboard of the measured, not of the world. It also '
      + 'spans every layer rather than data centres alone — a solar park or an offshore '
      + 'wind farm is a campus-kind shape too, and at hundreds of square kilometres they '
      + 'take the top of any list sorted by area. The What column says which is which.')}
  </section>`;

  return page({
    title: 'Building footprints',
    crumb: 'Building footprints',
    lede: 'Every shape the registry knows, by source and licence',
    note: '<a href="/">Show on the map</a>',
    body,
  });
}
