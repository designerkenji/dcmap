// A page per dot for the two layers that did not have one: /maps/plant/<id> and
// /maps/fab/<id>.
//
// Data centres have had /maps/site/<id> since the beginning, because a shareable URL
// per site is the whole point of the registry. Plants and fabs arrived as map
// layers and so had no way to be linked to, cited, or sent to somebody - which
// meant the interesting record (a coal plant closing in 2028 with a data centre
// campus being built on it) could be seen and not referenced.
//
// Both pages carry their SOURCE, prominently. The fab layer is hand-assembled
// and every record's provenance is the only reason to believe it; the plant
// layer is two public inventories with different licences and the CC BY one
// requires credit wherever it appears, not only on the map.

import { esc, n0, page, usdM, ESRI_CREDIT } from './summary.mjs';
import { LINK_STRUCTURE, PLANT_FIELDS, FAB_FIELDS } from './overrides.mjs';
import { renderDependencyCard } from './powerpage.mjs';

// The site pages' edit pen, aligned: the same header button, the same form
// contract (only what changes is written, a note says how you know), backed
// by data/asset_overrides.csv through POST /api/asset/<id>. The client half
// lives in public/asset-edit.js.
const editPen = `<button type="button" class="icobtn edit-pen" id="edit-open"
  title="Correct these details" aria-label="Correct these details">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
</button>`;

const editForm = (asset, FIELDS) => {
  const rows = Object.entries(FIELDS).map(([f, spec]) => {
    const v = asset[f] == null ? '' : String(asset[f]);
    return `<label><span>${esc(spec.label)}</span><input type="text" name="${f}"
      value="${esc(v)}" maxlength="300"${
      spec.suggest ? ` list="dl-${f}" autocomplete="off"` : ''}${
      spec.hint ? ` placeholder="${esc(spec.hint)}"` : ''}>${
      spec.suggest ? `<datalist id="dl-${f}"></datalist>` : ''}</label>`;
  }).join('');
  const edited = Object.entries(asset.edited || {}).filter(([f]) => FIELDS[f])
    .map(([f, e]) => `<b>${esc(FIELDS[f].label)}</b> was ${
      e.was === '' || e.was == null ? '(blank)' : `“${esc(String(e.was))}”`}`).join(', ');
  return `
  ${edited ? `<p class="note">Corrected by hand: ${edited}. Recorded in
    <span class="mono">data/asset_overrides.csv</span>, which the pipeline never
    overwrites.</p>` : ''}
  <form class="editform" id="editform" hidden data-asset="${esc(asset.id)}">
    <p class="note">These go to <span class="mono">data/asset_overrides.csv</span> as a
    source in their own right, so they survive every rebuild. Only what you change is
    written. Coordinates take decimal degrees.</p>
    <div class="editgrid">${rows}</div>
    <label class="editnote">Note <span class="dim">— how you know, optional</span>
      <input type="text" id="ed-note" maxlength="300"
             placeholder="operator's own site, regulatory filing, imagery…"></label>
    <div class="editbar">
      <button type="submit" class="tb-btn">Save</button>
      <button type="button" class="tb-btn" id="edit-cancel">Cancel</button>
      <span id="ed-msg" class="note"></span>
    </div>
  </form>
  <script src="/asset-edit.js" defer></script>`;
};


// "The site, year by year" for the dot pages: the same Esri Wayback archive
// the site pages carry, through the lean shared viewer (public/wayback-lite.js)
// rather than the site page's full editing rig. Fabs default a notch further
// out than plants - a gigafab campus wants the wider frame.
// `tools` picks which hands-on controls appear. Plants and fabs get the lot;
// a substation gets footprints and parcels but NOT "fix the dot's position" -
// its coordinate comes from OpenStreetMap through a county-checked match, and
// a hand-typed override here would silently diverge from the source it is
// supposed to agree with. That correction belongs upstream.
// `place` is the deliberate exception, and only an UNPLACED substation gets
// it: with no match to diverge from there is nothing to overwrite, and the
// server refuses the call for anything OSM has already located.
export const wayback = (lat, lon, zoom, links = [], asset = '',
                        heading = 'The site, year by year',
                        tools = ['near', 'move', 'draw', 'parcels']) => {
  // Whether the French cadastre could have an answer here. A bounding box
  // rather than a country lookup because every caller already hands this
  // function a coordinate and not every asset kind carries a country code.
  // The box overshoots into Belgium, Geneva and Catalonia; the API is free
  // and answers empty there, so an overshown button costs a click, not money.
  const fr = lat >= 41.2 && lat <= 51.2 && lon >= -5.3 && lon <= 9.7;
  return `
  <section class="panel card" aria-label="${esc(heading)}">
    <!-- No VISIBLE heading: the tabs name the thing, and a title saying "the
         site, year by year" above a tab called "Year by year" was the same
         words twice. The heading argument survives as the section's
         accessible name,
         because a panel with no label is a worse answer for a screen reader
         than a redundant one is for everybody else.
         The tabs are a real tablist now - aria-selected, which is what the
         stylesheet has always keyed the selected state on while the markup set
         aria-pressed, so no tab has ever looked selected. -->
    <div class="wb-head">
      <div class="wb-tabs" id="wbl-tabs" role="tablist" aria-label="Imagery view">
        <button type="button" role="tab" data-t="live" aria-selected="true"
          title="The satellite view, with every editing tool">Live map</button>
        <button type="button" role="tab" data-t="wayback" aria-selected="false"
          title="Esri's dated imagery archive — imagery only">Year by year</button>
      </div>
    </div>
    <div class="wbl" id="wbl" hidden data-lat="${lat}" data-lon="${lon}" data-zoom="${zoom}"${links.length
      ? ` data-links="${esc(JSON.stringify(links))}"` : ''}${asset
      ? ` data-asset="${esc(asset)}"` : ''}>
      <!-- Inside the FRAME, not the container: the container also holds the
           slider row, so a control anchored to its foot sat on top of the
           date instead of on the imagery. -->
      <div class="wbl-frame">
        <!-- Shown while the frame has nothing on it. Driven by whether a tile
             has actually painted, not by a timer: the archive can be slow, and
             a spinner that leaves before the imagery arrives is worse than no
             spinner at all. -->
        <div class="wbl-loading" id="wbl-loading"><i></i><span>Loading imagery…</span></div>
        <div class="wbl-tools">
          <button type="button" class="wb-tool wbl-in" title="Zoom in">+</button>
          <button type="button" class="wb-tool wbl-out" title="Zoom out">&minus;</button>
          <button type="button" class="wb-tool wbl-home" title="Back to the site">&#9678;</button>
        </div>
        <!-- Same split as the Live map: navigation lower right, full screen in
             its own corner. Switching tabs must not move a button. -->
        <div class="wbl-fscorner">
          <button type="button" class="wb-tool wbl-fs" title="Full screen">&#9974;</button>
        </div>
      </div>
      <div class="wbl-bar">
        <button type="button" class="tb-btn wbl-play" aria-label="Play through the years">&#9654;</button>
        <input type="range" class="wbl-slider" min="0" max="0" value="0"
               aria-label="Imagery capture date">
        <span class="wbl-date mono"></span>
      </div>
    </div>
    <!-- The default tab: the homepage map's satellite view, same select/edit
         split as the site pages - the pen chip gates reshape and delete. -->
    <div id="wbl-live">
      <div class="sm-wrap">
        <div id="dotmap"></div>
        <div class="wb-tools">
          <button type="button" class="wb-tool" id="lv-in" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" class="wb-tool" id="lv-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
          <button type="button" class="wb-tool" id="lv-home" title="Back to the site" aria-label="Back to the site">&#9678;</button>
          ${asset && tools.includes('draw') ? `<button type="button" class="wb-tool" id="lv-pen" aria-pressed="false"
            title="Edit mode: select a shape to reshape or delete it"
            aria-label="Toggle edit mode">&#9998;</button>` : ''}
        </div>
        <!-- Full screen sits apart, top right. It is not a navigation control
             like zoom and home - it changes the size of the whole viewer - and
             it is the one button people hunt for by corner. -->
        <div class="wb-fscorner">
          <button type="button" class="wb-tool" id="lv-fs" title="Full screen" aria-label="Full screen">&#9974;</button>
        </div>
        <!-- The homepage's layer panel, scoped to this one asset. Same idiom -
             a checkbox, a swatch, a name - because a layer is a layer wherever
             you meet it. The difference is that here each row also carries an
             edit pencil: pressing it is how somebody says "I mean to change
             THIS layer", which is what decides whether clicking a shape reads
             it or offers to reshape and delete it.
             Only one layer is armed at a time. Editing is a statement about
             one kind of thing, and two kinds armed at once would make the
             selection bar ambiguous about what it is about to change. -->
        <!-- The homepage's layers button, same icon and same contract: it
             owns the pane's hidden attribute and mirrors it in aria-expanded, and
             that is the whole mechanism there too. Top left rather than the
             homepage's bottom left, because the foot of this map belongs to
             the selection bar. -->
        <button type="button" class="corner-btn map-layers-btn" id="lv-layers-btn"
                aria-expanded="true" aria-controls="lv-layers"
                title="Layers" aria-label="Layers">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3.5 12.5 8.5 4.7 8.5-4.7"/><path d="m3.5 16.8 8.5 4.7 8.5-4.7"/></svg>
        </button>
        <div class="map-layers" id="lv-layers">
          <!-- Context, not subject: these dots belong to OTHER assets, so the
               row carries no pencil. There is nothing on this page to edit
               about somebody else's site. Unchecked by default because
               drawing it costs a request, and most visits never need it. -->
          ${asset && tools.includes('near') ? `<label><input type="checkbox" id="lyr-near">
            <i class="sw sw-near"></i> Nearby dots</label>` : ''}
          <label><input type="checkbox" id="lyr-dot" checked>
            <i class="sw sw-dotcoord"></i> Site coordinate
            ${asset && (tools.includes('move') || tools.includes('place')) ? `<button
              type="button" class="lyr-edit" id="lv-edit-dot" aria-pressed="false"
              title="${tools.includes('place')
                ? 'Place this substation: click the switchyard on the imagery'
                : 'Move the dot: click where it belongs'}"
              aria-label="Edit the coordinate"><svg viewBox="0 0 24 24" aria-hidden="true" width="13" height="13"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ''}</label>
          <label><input type="checkbox" id="lyr-bldg" checked>
            <i class="sw sw-bldg"></i> Building footprint
            ${asset && tools.includes('draw') ? `<button type="button" class="lyr-edit"
              id="lv-edit-bldg" aria-pressed="false"
              title="Edit building outlines: draw one, or select one to reshape or delete"
              aria-label="Edit building footprints"><svg viewBox="0 0 24 24" aria-hidden="true" width="13" height="13"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ''}</label>
          <label><input type="checkbox" id="lyr-campus" checked>
            <i class="sw sw-campus"></i> Campus footprint
            ${asset && (tools.includes('draw') || tools.includes('parcels')) ? `<button
              type="button" class="lyr-edit" id="lv-edit-campus" aria-pressed="false"
              title="Edit the campus boundary: draw it, pull a parcel, or select it to reshape or delete"
              aria-label="Edit the campus footprint"><svg viewBox="0 0 24 24" aria-hidden="true" width="13" height="13"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ''}</label>

          <!-- One strip, not three. Only one layer is ever armed, so the tools
               shown are simply the armed layer's - and every button keeps the
               id its handler already binds to. -->
          <div class="lyr-tools" id="lv-tools">
            ${asset && tools.includes('move') ? `<button type="button" class="tb-btn" id="lv-move" aria-pressed="false"
              title="Click where the dot belongs; the distance is shown before you save">Fix the dot&#8217;s position</button>` : ''}
            ${asset && tools.includes('place') ? `<button type="button" class="tb-btn" id="lv-place" aria-pressed="false"
              title="Click the switchyard on the imagery to give this substation a coordinate">Place it on the map</button>` : ''}
            ${asset && tools.includes('draw') ? `<button type="button" class="tb-btn" id="lv-draw" aria-pressed="false"
              title="Click each corner on the map">Draw a footprint</button>` : ''}
            ${asset && tools.includes('parcels') ? `<button type="button" class="tb-btn" id="lv-pull-regrid"
              title="Ask Regrid for the parcel under this dot">Pull REGRID parcel</button>
            <button type="button" class="tb-btn" id="lv-pull-precisely"
              title="Ask Precisely for the parcel under this dot">Pull Precisely parcel</button>
            <button type="button" class="tb-btn" id="lv-again-regrid" hidden
              title="Fetch this parcel from Regrid again — this is billed">Ask Regrid again</button>
            <button type="button" class="tb-btn" id="lv-adopt-regrid" hidden
              title="Save this parcel as the boundary — a hand edit vouching for the shape">Save Regrid parcel as boundary</button>
            <button type="button" class="tb-btn" id="lv-adopt-precisely" hidden
              title="Save this parcel as the boundary — a hand edit vouching for the shape">Save Precisely parcel as boundary</button>
            <button type="button" class="tb-btn" id="lv-adopt-bldgs" hidden
              title="Save the building outlines Regrid matched to this parcel — a hand edit vouching for the shapes">Save Regrid buildings as building footprint</button>` : ''}
            ${asset && tools.includes('parcels') && fr ? `<button type="button" class="tb-btn" id="lv-pull-cadastre"
              title="Ask the French cadastre for the parcel under this dot — IGN's free API, no charge ever">Pull French cadastre parcel</button>
            <button type="button" class="tb-btn" id="lv-adopt-cadastre" hidden
              title="Save this parcel as the boundary — a hand edit vouching for the shape">Save cadastre parcel as boundary</button>` : ''}
          </div>
        </div>
        <!-- The message is a NOTIFICATION, not a toolbar item: it appears when
             something happened, and it leaves. Top right under full screen,
             where nothing else is competing for the corner. -->
        <div class="map-toast wb-status" id="lv-status" role="status" aria-live="polite"></div>
        <div class="wb-sel" id="lv-sel" hidden></div>
      </div>
    </div>
    <p class="note imagery-credit">${ESRI_CREDIT}</p>
  </section>
  <script src="/wayback-lite.js" defer></script>`;
};

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

export function renderPlantPage({ plant: p, sites, fabs, linked = [], linkedAnn = [], linkedFabs = [], geo, kmBetween,
                                 depsByAsset, depsByDep, accumulation, nameOf, meta = {} }) {
  const iso = BA_ISO[p.ba] || p.ba;
  // The registry's own country naming first; where its table has no entry
  // (Réunion, Martinique) the name GEM wrote, never a bare ISO code.
  const country = geo.country(p.cy) !== p.cy ? geo.country(p.cy) : (p.cyn || p.cy);
  // County-equivalent (EIA, already carrying its legal type: "Orleans
  // Parish", "Alexandria city") or state/province (both), then the ISO zone,
  // then the country - the most local fact first. This is the locality line,
  // not the address: GEM has no street at all, and EIA's comes from the
  // annual Plant file as addr/city/zip, shown as its own fact below.
  const where = [p.cnty, p.st, iso, country].filter(Boolean).join(' · ');
  const address = [p.addr, p.city, [p.st, p.zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  // The supply links, read from this side: data centres that NAME this plant
  // (hand-linked in the app or researched with a source), as opposed to the
  // proximity lists below, which only say what happens to be nearby. This is
  // the section that makes a paired announcement navigable in both
  // directions - campus page to plant page and back.
  const linkedRows = linked.map(s => {
    const st = LINK_STRUCTURE[s.link_structure] || null;
    const d = (s.lat != null && p.lat != null) ? kmBetween(+s.lon, +s.lat, p.lon, p.lat) : null;
    return `<tr>
    <td><a href="/maps/site/${esc(s.site_id)}"><b>${esc(s.name || s.epoch_name || s.operator || 'Data centre')}</b></a></td>
    <td class="dim">${esc(s.operator || '')}</td>
    <td>${st ? esc(st.label) : ''}</td>
    <td class="num">${d != null ? d.toFixed(1) + ' km' : ''}</td>
    <td class="dim">${esc(s.link_note || '')}${s.link_src
      ? ` <a href="${esc(s.link_src)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</td></tr>`;
  });
  // Fabs are loads with named plants too; they share the table.
  const fabLinkRows = linkedFabs.map(f => {
    const st = LINK_STRUCTURE[f.link_structure] || null;
    const d = (f.lat != null && p.lat != null) ? kmBetween(f.lon, f.lat, p.lon, p.lat) : null;
    return `<tr>
    <td><a href="/maps/fab/${esc(f.id)}"><b>${esc(f.n)}</b></a> <span class="dim">fab</span></td>
    <td class="dim">${esc(f.grp || f.op || '')}</td>
    <td>${st ? esc(st.label) : ''}</td>
    <td class="num">${d != null ? d.toFixed(1) + ' km' : ''}</td>
    <td class="dim">${esc(f.link_note || '')}${f.link_src
      ? ` <a href="${esc(f.link_src)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</td></tr>`;
  });
  // Campuses tied to this plant that the registry cannot list yet - announced
  // or under construction, researched with a source. No link: there is no
  // page to open until the campus becomes a dot.
  const annRows = linkedAnn.map(l => {
    const st = LINK_STRUCTURE[l.structure] || null;
    return `<tr>
    <td><b>${esc(l.dc.name)}</b> <span class="dim">${l.dc.corp
      ? 'corporate-wide offtake — no single load to pin'
      : 'announced — not yet a registry dot'}</span></td>
    <td></td>
    <td>${st ? esc(st.label) : ''}</td>
    <td></td>
    <td class="dim">${esc(l.note || '')}${l.url
      ? ` <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</td></tr>`;
  });

  const nearSites = near(p.lat, p.lon, sites, 25, kmBetween).slice(0, 15);
  const nearFabs = near(p.lat, p.lon, fabs, 50, kmBetween).slice(0, 8);

  const siteRows = nearSites.map(({ x, d }) => `<tr>
    <td><a href="/maps/site/${esc(x.id)}"><b>${esc(x.n || x.o || 'Data centre')}</b></a></td>
    <td class="dim">${esc(x.o || '')}</td>
    <td>${x.ft === 'ai' ? '<i class="ops-ai">AI</i>' : ''}</td>
    <td class="num">${x.mw ? n0(x.mw) + ' MW' : ''}</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);
  const fabRows = nearFabs.map(({ x, d }) => `<tr>
    <td><a href="/maps/fab/${esc(x.id)}"><b>${esc(x.n)}</b></a></td>
    <td class="dim">${esc(x.grp || x.op)}</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);

  const powerDep = renderDependencyCard({ id: p.id, depsByAsset, depsByDep, accumulation, nameOf });
  const body = `
  ${editForm(p, PLANT_FIELDS)}
  ${powerDep}
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
      ${fact('Project value', p.inv
        ? `<strong>${usdM(p.inv)}</strong> <span class="dim">announced/reported</span>` : '')}
      ${fact('Owner', esc(p.own || ''))}
      ${fact('Address', (p.addr || p.city) ? `${esc(address)} <span class="dim">EIA-860</span>` : '')}
      ${fact('Water source', p.ws ? `${esc(p.ws)} <span class="dim">EIA-860, as reported by the plant</span>` : '')}
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
    ${p.inv ? `<p class="note"><b>Project value:</b> ${usdM(p.inv)} —
      ${p.invn ? esc(p.invn) : 'announced or reported figure'}.
      ${(p.invsrc || []).map((u, i) =>
        `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">source${p.invsrc.length > 1 ? ` ${i + 1}` : ''}</a>`)
        .join(' · ')}
      This figure is hand-researched from announcements and reporting, not part
      of the GEM/EIA inventory below.</p>` : ''}
    ${shaken(p)}
    ${p.ax ? `<p class="note">Global Energy Monitor grades this coordinate as
      approximate — good for "there is a plant near this town", not for measuring
      a distance off the map. The nearby lists below inherit that uncertainty.</p>` : ''}
  </section>

  ${p.ax ? '' : wayback(p.lat, p.lon, 15,
    // The linked campuses ride into the archive viewer so the plant's frame
    // can point back at them - the same thread the site pages draw.
    linked.filter(s => s.lat != null && s.lat !== '').map(s => ({
      lat: +s.lat, lon: +s.lon,
      label: s.name || s.epoch_name || s.operator || 'Data centre',
      km: +kmBetween(+s.lon, +s.lat, p.lon, p.lat).toFixed(1),
      href: '/maps/site/' + s.site_id,
    })), p.id)}

  ${linkedRows.length || annRows.length || fabLinkRows.length ? `
  <section class="panel card">
    <h2>Loads supplied by this plant — ${linkedRows.length + annRows.length + fabLinkRows.length}</h2>
    <p class="note">Named links, not proximity: each of these campuses and fabs
    records THIS plant as its power arrangement, hand-linked or researched with
    the source shown. The lists further down are merely what sits nearby.</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Load</th><th>Operator</th><th>Arrangement</th><th>Distance</th><th>Basis</th></tr></thead>
      <tbody>${linkedRows.join('')}${fabLinkRows.join('')}${annRows.join('')}</tbody>
    </table></div>
  </section>` : ''}

  ${nearbyBlock(`Data centres within 25 km — ${nearSites.length}`,
     siteRows, 'No registry site within 25 km.')}
  ${nearbyBlock(`Fabs within 50 km — ${nearFabs.length}`, fabRows, 'No fab within 50 km.')}

  <section class="panel card">
    <h2>Source</h2>
    <p class="note">${p.src === 'gem'
      ? `<a href="https://globalenergymonitor.org/projects/global-integrated-power-tracker/" target="_blank" rel="noopener">Global Energy Monitor</a>,
         Global Integrated Power Tracker, ${esc(meta.gem || '')}, under
         <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.`
      : `<a href="https://www.eia.gov/electricity/data/eia860m/" target="_blank" rel="noopener">EIA-860M</a>,
         ${esc(meta.eia || '')} — a US Government work in the public domain. Aggregated from
         generator-level rows to one record per plant by
         <span class="mono">src/plants.py</span>.${(p.addr || p.city || p.ws || p.cnty)
           ? ` Address and water source from the annual
         <a href="https://www.eia.gov/electricity/data/eia860/" target="_blank" rel="noopener">EIA-860</a>
         (${esc(meta.eia_annual || '')}); county-equivalent names from the US Census Gazetteer (${esc(meta.census || '')}).` : ''}`}</p>
  </section>`;

  return page({
    title: p.n,
    crumb: p.n,
    h1Extra: editPen,
    parent: { name: 'Power plants', href: '/plants' },
    lede: `${esc(FUEL[p.f] || p.f)} · ${esc(where)}`,
    note: `<a href="/plants">All power plants</a> · <a href="/maps?plant=${encodeURIComponent(p.id)}">Show on the map</a>`,
    body,
  });
}

// ---- fab -------------------------------------------------------------------

export function renderFabPage({ fab: f, sites, plants, linkedPlant = null, geo, kmBetween,
                               depsByAsset, depsByDep, accumulation, nameOf }) {
  // The named power arrangement, when research has established one - the fab
  // twin of the site pages' Power supply card, minus the picker: fab links
  // come from the researched file, not hand edits.
  const fst = LINK_STRUCTURE[f.link_structure] || null;
  const supply = linkedPlant && fst ? `
  <section class="panel card">
    <h2>Power supply</h2>
    <div class="facts">
      ${fact('Plant', `<a href="/maps/plant/${esc(f.link_plant_id)}"><strong>${esc(linkedPlant.n)}</strong></a>`)}
      ${fact('Arrangement', esc(fst.label))}
      ${fact('Capacity', linkedPlant.mw ? `${n0(linkedPlant.mw)} MW operating` :
        linkedPlant.pmw ? `${n0(linkedPlant.pmw)} MW planned` : '')}
      ${fact('Owner', esc(linkedPlant.own || ''))}
      ${f.lat != null && linkedPlant.lat != null ? fact('Distance',
        `${kmBetween(f.lon, f.lat, linkedPlant.lon, linkedPlant.lat).toFixed(1)} km`) : ''}
    </div>
    <p class="note">${esc(fst.blurb)}</p>
    ${f.link_note ? `<p class="note"><b>Basis:</b> ${esc(f.link_note)}${f.link_src
      ? ` <a href="${esc(f.link_src)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</p>` : ''}
  </section>` : '';

  const nearSites = near(f.lat, f.lon, sites, 25, kmBetween).slice(0, 12);
  const nearPlants = near(f.lat, f.lon, plants, 25, kmBetween)
    .filter(({ x }) => x.k === 'op' && x.mw).slice(0, 12);
  const genMw = nearPlants.reduce((a, { x }) => a + x.mw, 0);

  const siteRows = nearSites.map(({ x, d }) => `<tr>
    <td><a href="/maps/site/${esc(x.id)}"><b>${esc(x.n || x.o || 'Data centre')}</b></a></td>
    <td class="dim">${esc(x.o || '')}</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);
  const plantRows = nearPlants.map(({ x, d }) => `<tr>
    <td><a href="/maps/plant/${esc(x.id)}"><b>${esc(x.n)}</b></a></td>
    <td class="dim">${esc(FUEL[x.f] || x.f)}</td>
    <td class="num">${n0(x.mw)} MW</td>
    <td class="num">${d.toFixed(1)} km</td></tr>`);

  const powerDep = renderDependencyCard({ id: f.id, depsByAsset, depsByDep, accumulation, nameOf });
  const body = `
  ${editForm(f, FAB_FIELDS)}
  ${powerDep}
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
      ${fact('Announced investment', f.inv ? `<strong>${usdM(f.inv)}</strong>` : '')}
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
    ${f.inv ? `<p class="note"><b>Announced investment:</b> ${usdM(f.inv)}${f.invn
      ? ` — ${esc(f.invn)}` : ''}. Unlike the load estimate above this is a
      figure somebody announced, not a model — but announcements routinely
      cover a whole campus or only a first phase, which is what the note
      says.</p>` : ''}
    ${shaken(f)}
    ${f.nt ? `<p class="note">${esc(f.nt)}</p>` : ''}
    ${f.pn ? `<p class="note">${esc(f.pn)}</p>` : ''}
  </section>

  ${supply}

  ${wayback(f.lat, f.lon, 15, linkedPlant && linkedPlant.lat != null
    ? [{ lat: linkedPlant.lat, lon: linkedPlant.lon, label: linkedPlant.n,
         km: +kmBetween(f.lon, f.lat, linkedPlant.lon, linkedPlant.lat).toFixed(1),
         href: '/maps/plant/' + f.link_plant_id }] : [], f.id)}

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
    h1Extra: editPen,
    parent: { name: 'Fabs', href: '/fabs' },
    lede: `${esc(f.grp || f.op)} · ${esc([f.pl, geo.country(f.cy)].filter(Boolean).join(', '))}`,
    note: `<a href="/fabs">All fabs</a> · <a href="/maps?fab=${encodeURIComponent(f.id)}">Show on the map</a>`,
    body,
  });
}
