// A page per substation: /maps/substation/<sub-id>.
//
// The plant and fab layers each got a page the moment they became something a
// reader might want to cite, and a substation carrying a gigawatt of filed
// load is squarely that. It is also the node whose page most needs to exist:
// a plant page answers "what is this", while a substation page answers "what
// goes down with it", which is the question the whole dependency layer was
// built for.
//
// The viewer carries the same footprint and parcel tooling the plant and fab
// pages have: a substation's perimeter is worth outlining, and a pulled parcel
// held against the imagery is exactly the kind of hand verification the rest of
// this registry runs on. What it does NOT carry is "fix the dot's position" -
// the coordinate comes from OpenStreetMap through a county-checked match, and a
// hand-typed override here would quietly disagree with the source it is meant
// to track. That correction belongs upstream, in OSM or in the filing extract.
//
// A substation with NO coordinate is the other case, and it gets a placement
// tool. There is no source to disagree with: OSM has never held it, or held
// nothing the county check would accept, and a hundred substations sit in that
// state - three of them carrying 3.2 GW the map cannot show for want of two
// numbers. The placement is recorded as its own evidence class and says so
// wherever it appears; it is never dressed up as an OSM match. See
// dcmap/lib/placements.mjs.

import { esc, n0, page } from './summary.mjs';
import { renderDependencyCard } from './powerpage.mjs';
import { PLACEMENT_BASIS } from './placements.mjs';

const fact = (label, value) => (value === '' || value == null ? ''
  : `<div class="fact"><span class="fk">${esc(label)}</span>`
  + `<span class="fv">${value}</span></div>`);

// The panel that turns "we know its name and its county" into a coordinate.
// Shown only when there is nothing to overwrite.
function placementCard(sub, centres) {
  const opts = Object.entries(PLACEMENT_BASIS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)} — ${esc(v.hint)}</option>`)
    .join('');
  const counties = (sub.counties || []);
  const chips = counties.map((c, i) => {
    const cc = centres && centres.get(`${sub.region}|${c.replace(/^St\.\s+/i, 'St ')}`);
    return `<button type="button" class="tb-btn co-chip" data-i="${i}"
      ${cc ? `data-lat="${cc.lat}" data-lon="${cc.lon}"
              data-bbox="${esc(JSON.stringify(cc.bbox))}"` : 'disabled'}
      aria-pressed="${i === 0 ? 'true' : 'false'}"
      title="${cc ? 'Open the map over this county' : 'No county-level match for this name'}"
      >${esc(c)} County${cc ? '' : ' <span class="dim">(not resolved)</span>'}</button>`;
  }).join('');

  return `
  <section class="panel card" id="place">
    <h2>Place this substation</h2>
    <p class="note">This one has a name from ${sub.named_by === 1 ? 'a filing' : 'filings'}
    and no coordinate — so it is absent from the map, and from every radius an event
    or a quake draws, while the load behind it stays on the ledger. Nothing here
    overwrites a source: OpenStreetMap holds no match this passes, which is precisely
    why the gap is yours to fill.</p>
    ${counties.length ? `<div class="co-chips">
      <span class="fk">Its filings say</span> ${chips}
      ${counties.length > 1 ? `<span class="note dim">The filings disagree —
        place it where you can see it, not where a majority votes.</span>` : ''}
    </div>` : `<p class="note"><b>No county either.</b> Nothing in the filings says
      where to start looking, so the map opens on the region. Be correspondingly
      careful.</p>`}
    <p class="note"><b>How to be right about it:</b> a substation reads as a fenced
    rectangle of bus work and transformer pads, usually beside a transmission line
    and often with a switchyard's distinctive lattice shadow. Zoom in far enough to
    see the equipment. If you are matching a name to a yard you cannot positively
    identify, leave it unplaced — an absent substation is honest and a wrong one
    silently moves a gigawatt.</p>
    <p class="note">Use <b>Place it on the map</b> under the imagery below, then click
    the switchyard. The form to confirm it appears beneath the map.</p>
  </section>`;
}

// The commitment half, rendered BELOW the viewer. Splitting the panel is not
// cosmetic: the click happens on the map, and a form above it would send the
// placer scrolling away from the thing they are identifying at the exact
// moment they have to describe it.
function placementForm() {
  const opts = Object.entries(PLACEMENT_BASIS)
    .map(([k, v]) => `<option value="${k}">${esc(v.label)} — ${esc(v.hint)}</option>`)
    .join('');
  return `
  <section class="panel card" id="place-confirm">
    <h2>Confirm the placement</h2>
    <p class="note" id="pf-idle">Nothing chosen yet — click <b>Place it on the map</b>
    above, then click the point.</p>
    <div class="place-form" id="place-form" hidden>
      <div class="pf-row">
        <span class="fk">Point</span>
        <span class="fv mono" id="pf-coord">—</span>
      </div>
      <label class="pf-row"><span class="fk">How you know</span>
        <select id="pf-basis">${opts}</select></label>
      <label class="pf-row"><span class="fk">Note</span>
        <input id="pf-note" type="text" maxlength="500" required
               placeholder="What you saw, and where — this is the whole audit trail"></label>
      <div class="pf-row pf-act">
        <button type="button" class="tb-btn" id="pf-save" disabled>Save the placement</button>
        <button type="button" class="tb-btn" id="pf-cancel">Cancel</button>
        <span class="wb-status" id="pf-status"></span>
      </div>
    </div>
  </section>`;
}

export function renderSubstationPage({ sub, deps = [], accumulation = [],
                                       depsByDep, nameOf, wayback, countyCentre }) {
  const acc = accumulation.find(a => a.id === sub.id) || null;
  const loads = [...new Set(deps.map(e => e.asset_id))];
  const mw = deps.reduce((t, e) => t + (e.mw || 0), 0);
  const inRegistry = loads.filter(id => !id.startsWith('load-')).length;

  const where = [sub.osm_county, sub.region, sub.country].filter(Boolean).join(' · ');
  const volts = (sub.kvs && sub.kvs.length > 1)
    ? sub.kvs.slice().sort((a, b) => b - a).join(' / ') + ' kV'
    : (sub.kv ? sub.kv + ' kV' : '');

  const facts = `
  <section class="panel card">
    <h2>Substation</h2>
    <div class="facts">
      ${fact('Voltage', esc(volts))}
      ${fact('Operator', esc(sub.operator || ''))}
      ${fact('Mega-loads behind it', acc ? n0(acc.assets) : n0(loads.length))}
      ${fact('Filed load', mw ? n0(Math.round(mw)) + ' MW' : '')}
      ${fact('In the registry', inRegistry
        ? `${n0(inRegistry)} <span class="dim">of ${n0(loads.length)}</span>`
        : `<span class="dim">none yet — ${n0(loads.length)} filed only</span>`)}
      ${fact('Named by', sub.named_by
        ? `${n0(sub.named_by)} filing${sub.named_by === 1 ? '' : 's'}`
        + (sub.sources && sub.sources.length
          ? ` <span class="dim">queue ${esc(sub.sources.join(', '))}</span>` : '') : '')}
      ${fact('Coordinates', sub.located
        ? `<a href="/@${sub.lat},${sub.lon},2000m" class="mono">${sub.lat}, ${sub.lon}</a>`
        : '<span class="dim">not placed</span>')}
      ${fact('Placed by', sub.placed_by_hand
        ? `hand <span class="dim">${esc((PLACEMENT_BASIS[sub.placed_basis] || {}).label
            || 'no basis given').toLowerCase()}</span>`
        : sub.located ? 'OpenStreetMap <span class="dim">county-checked</span>' : '')}
      ${fact('OpenStreetMap', sub.osm
        ? `<a href="https://www.openstreetmap.org/${esc(sub.osm)}" target="_blank"
             rel="noopener noreferrer">${esc(sub.osm_name || sub.osm)}</a>` : '')}
      ${fact('County', !sub.osm_county && (sub.counties || []).length
        ? esc(sub.counties.join(' / ')) + ' <span class="dim">from the filings</span>' : '')}
    </div>
    ${sub.placed_by_hand ? `<p class="note"><b>Placed by hand${sub.placed_on
      ? ` on ${esc(sub.placed_on.slice(0, 10))}` : ''}:</b> ${esc(sub.placed_note || '')}
      ${sub.geo_rejected_was ? ` <span class="dim">It had no OpenStreetMap match:
        ${esc(sub.geo_rejected_was)}.</span>` : ''}
      This coordinate is a person's identification on imagery, not a match against a
      published record — weaker evidence than the county-checked OSM matches elsewhere
      in this ledger, and marked as such wherever it is used.</p>` : ''}
    ${sub.aka && sub.aka.length ? `<p class="note">Also written
      ${sub.aka.map(a => `“${esc(a)}”`).join(', ')} in the filings.</p>` : ''}
    ${sub.kv_note ? `<p class="note">Voltage check: ${esc(sub.kv_note)}.</p>` : ''}
    ${sub.geo_rejected ? `<p class="note"><b>Not placed:</b> ${esc(sub.geo_rejected)}.
      It stays on the ledger without a coordinate rather than being pinned to a
      plausible-looking substation of the same name.</p>` : ''}
    <p class="note">A substation is not a registry asset: it is here because a filing
    named it as a load's point of interconnection, and it is placed — when it can be —
    by matching that name against OpenStreetMap and checking the result against the
    county the filing gives. ${sub.placed_by_hand
      ? 'This one failed that and was placed by hand instead.'
      : sub.located ? 'This one passed both.'
      : 'This one has a name and no verified place.'}</p>
  </section>`;

  // Where the viewer opens. A placed substation opens on itself at working
  // zoom; an unplaced one opens on the county its filings name, well back,
  // and the panel above says in as many words that the centre is the county's
  // and not the substation's.
  const first = (sub.counties || [])[0];
  const cc = first && countyCentre
    && countyCentre.get(`${sub.region}|${first.replace(/^St\.\s+/i, 'St ')}`);
  const view = sub.located ? { lat: sub.lat, lon: sub.lon, zoom: 15 }
    : cc ? { lat: cc.lat, lon: cc.lon, zoom: 10 }
    : { lat: sub.region === 'VA' ? 37.9 : 42.9, lon: sub.region === 'VA' ? -78.0 : -75.5, zoom: 6 };

  const body = `
  ${facts}
  ${renderDependencyCard({ id: sub.id, depsByDep, accumulation, nameOf })}
  ${!sub.located ? placementCard(sub, countyCentre) : ''}
  ${wayback ? wayback(view.lat, view.lon, view.zoom, [], sub.id,
                      sub.located ? 'The substation, year by year'
                                  : 'Find it on the imagery',
                      sub.located ? ['near', 'draw', 'parcels']
                                  : ['place', 'parcels']) : ''}
  ${!sub.located ? placementForm() : ''}
  <section class="panel card">
    <h2>What this page is not</h2>
    <p class="note">The loads above are the ones a filing has NAMED at this substation.
    Others are certainly served from it — every house and shop on the same distribution
    system, and any load below the threshold at which an interconnection has to be filed
    (in New York, 10 MW at 115 kV and above). This page counts filed mega-loads, not
    everything behind the transformer.</p>
    <p class="note">Nor does a shared substation mean a shared fate in every scenario. It
    means a shared piece of equipment: a bus, a transformer bank, a switchyard. Two loads
    here fail together when that equipment fails, which is the correlation an underwriter
    is asking about — not a claim that either one is otherwise fragile.</p>
  </section>`;

  return page({
    title: sub.name,
    crumb: sub.name,
    parent: { name: 'Power dependency', href: '/power' },
    lede: [volts && volts + ' substation', where].filter(Boolean).join(' · '),
    note: `<a href="/power#substations">All shared dependency points</a>`
        + (sub.located ? ` · <a href="/@${sub.lat},${sub.lon},2000m">Show on the map</a>` : ''),
    body,
  });
}
