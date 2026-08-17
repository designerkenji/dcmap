// /quakes and /quake/<id> — the earthquake layer as pages.
//
// The layer could be looked at and not READ. Clicking an epicentre opened a
// panel, and that panel was the only place the exposure existed: you could not
// link to it, cite it, or answer "what did that M7.8 actually hit" without
// finding the right dot on a world map first. Plants and fabs got pages for
// exactly this reason; quakes are the last layer without them.
//
// WHY A TIME AXIS BELONGS HERE AND NOWHERE ELSE
//
// Every other layer in this project is a stock: 6,255 data centres, 28,152
// plants, 90 fabs, all of them true until the next ingest. An earthquake is an
// EVENT, the only thing here with a timestamp that means something, so it is
// the only layer where "how much, when" is a question the data can answer.
// 102 of 548 events in the trailing 90 days reached something in the registry,
// and the shape of that - long quiet stretches, then one day that shakes 149
// assets - is the finding, and is invisible in any per-event view.
//
// WHAT "IMPACTED" MEANS, AND WHAT IT DOES NOT
//
// Shaken, not damaged. Exposure is the USGS ShakeMap grid sampled at an
// asset's coordinate: it says the ground moved there, not that anything broke.
// MMI VI is where non-structural damage begins and most of what is counted
// here is MMI II-IV, which is "felt" rather than "harmed". Saying "impacted"
// without saying that would turn a shaking count into a damage report.

import { esc, n0, page, table, tile } from './summary.mjs';

const MMI_MEANS = { 2: 'weak', 3: 'weak', 4: 'light', 5: 'moderate',
  6: 'strong — non-structural damage begins', 7: 'very strong — moderate damage',
  8: 'severe', 9: 'violent' };

const KIND_N = { dc: 'data centres', plant: 'power plants', fab: 'fabs' };
const KIND_HREF = { dc: '/site/', plant: '/plant/', fab: '/fab/' };

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const when = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// A magnitude reads as a number and behaves as a logarithm, so the bar is
// scaled the way the energy is - an M7 beside an M5 should not look like 7:5.
const magBar = (m) => {
  const w = Math.max(2, Math.min(100, ((m - 4) / 4) * 100));
  return `<span class="qbar"><i style="width:${w.toFixed(0)}%"></i></span>`;
};

// ---- the impact-over-time chart --------------------------------------------
// One column per day that shook something, three stacked segments for the
// three layers. Bucketed by day rather than by week because the interesting
// structure is that it is spiky: a week bucket would average away the single
// day that did most of it.
function overTime(quakes) {
  const byDay = new Map();
  for (const q of quakes) {
    if (!q.exposed) continue;
    const k = day(q.time);
    const b = byDay.get(k) || { dc: 0, plant: 0, fab: 0, ev: 0, top: null };
    b.dc += q.dc || 0; b.plant += q.plant || 0; b.fab += q.fab || 0; b.ev++;
    if (!b.top || (q.exposed || 0) > (b.top.exposed || 0)) b.top = q;
    byDay.set(k, b);
  }
  if (!byDay.size) return '';
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const peak = Math.max(...days.map(([, b]) => b.dc + b.plant + b.fab));
  const W = 900, H = 200, PAD = 28;
  const step = (W - PAD) / days.length;
  const bw = Math.max(2, Math.min(14, step - 2));

  const bars = days.map(([d, b], i) => {
    const x = PAD + i * step;
    const total = b.dc + b.plant + b.fab;
    let y = H;
    const seg = (v, cls) => {
      if (!v) return '';
      const h = (v / peak) * (H - 24);
      y -= h;
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
             `width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`;
    };
    // Plants at the base because they are the most numerous, so the smaller
    // two stay visible on top instead of being a sliver at the bottom.
    return `<g><title>${esc(d)} — ${b.ev} event${b.ev === 1 ? '' : 's'}, ` +
      `${total} shaken: ${b.dc} data centres, ${b.plant} plants, ${b.fab} fabs` +
      (b.top ? `\n${esc(b.top.place)} (M${b.top.mag})` : '') + `</title>` +
      seg(b.plant, 'q-plant') + seg(b.dc, 'q-dc') + seg(b.fab, 'q-fab') + '</g>';
  }).join('');

  // Month ticks, so the axis is readable without a label per day.
  let lastMonth = '';
  const ticks = days.map(([d], i) => {
    const m = d.slice(0, 7);
    if (m === lastMonth) return '';
    lastMonth = m;
    const x = PAD + i * step;
    return `<text class="q-tick" x="${x.toFixed(1)}" y="${H + 13}">${esc(m)}</text>`;
  }).join('');

  return `<section class="panel card">
    <h2>What the shaking reached, day by day</h2>
    <p class="note">Assets inside the ShakeMap footprint of each event, over the
      trailing 90 days. Shaken is not damaged — most of this is MMI II–IV, which
      is felt and not harmful; MMI VI is where non-structural damage begins.
      Hover a column for the day and the event that dominated it.</p>
    <div class="qchart">
      <svg viewBox="0 0 ${W} ${H + 20}" preserveAspectRatio="none" role="img"
           aria-label="Assets shaken per day">
        <line class="q-axis" x1="${PAD}" y1="${H}" x2="${W}" y2="${H}"/>
        <text class="q-tick" x="0" y="12">${n0(peak)}</text>
        ${bars}${ticks}
      </svg>
    </div>
    <p class="qlegend">
      <span><i class="q-sw q-dc"></i> data centres</span>
      <span><i class="q-sw q-plant"></i> power plants</span>
      <span><i class="q-sw q-fab"></i> fabs</span>
    </p>
  </section>`;
}

// ---- /quakes ----------------------------------------------------------------

export function renderQuakesPage(quakes) {
  const hit = quakes.filter(q => q.exposed > 0);
  const sum = (k) => quakes.reduce((a, q) => a + (q[k] || 0), 0);
  const biggest = quakes.slice().sort((a, b) => b.mag - a.mag)[0];
  const worst = hit.slice().sort((a, b) => (b.exposed || 0) - (a.exposed || 0));

  const tiles = [
    tile('Events', n0(quakes.length), 'USGS M5+, trailing 90 days'),
    tile('Reached something', n0(hit.length),
         `${Math.round(hit.length / Math.max(1, quakes.length) * 100)}% of events`),
    tile('Data centres shaken', n0(sum('dc')), 'counted once per event'),
    tile('Power plants shaken', n0(sum('plant'))),
    tile('Fabs shaken', n0(sum('fab'))),
    tile('Largest event', `M${biggest.mag}`, biggest.place),
  ].join('');

  const rows = worst.map(q => `<tr>
    <td><a href="/quake/${esc(q.id)}">M${q.mag.toFixed(1)}</a> ${magBar(q.mag)}</td>
    <td>${esc(q.place)}</td>
    <td class="dim">${esc(day(q.time))}</td>
    <td class="num">${n0(q.dc)}</td>
    <td class="num">${n0(q.plant)}</td>
    <td class="num">${n0(q.fab)}</td>
    <td class="num">${q.maxMmi ? (+q.maxMmi).toFixed(1) : ''}</td>
  </tr>`).join('');

  // The ones that shook nothing are still events, and saying so is the point:
  // "no registry site was shaken" is a fact about the registry's footprint.
  const quiet = quakes.length - hit.length;

  return page({
    title: 'Earthquakes',
    crumb: 'Earthquakes',
    lede: `${n0(quakes.length)} USGS M5+ events in the trailing 90 days.
      ${n0(hit.length)} of them reached something this registry tracks;
      ${n0(quiet)} shook nothing it knows about.`,
    note: `Exposure is the USGS ShakeMap grid sampled at each asset's
      coordinate. It says the ground moved there — not that anything broke.`,
    body: `<section class="fabtiles">${tiles}</section>
      ${overTime(quakes)}
      <section class="panel card">
        <h2>Every event that reached something <span class="dim">${n0(hit.length)}</span></h2>
        ${table(['Magnitude', 'Place', 'Date', { n: 'Data centres' },
                 { n: 'Power plants' }, { n: 'Fabs' }, { n: 'Max MMI' }], rows)}
      </section>`,
  });
}

// ---- /quake/<id> ------------------------------------------------------------

export function renderQuakePage({ quake: q, detail, geo }) {
  const ex = (detail?.exposed || []).slice().sort((a, b) => b.mmi - a.mmi);
  const kinds = detail?.kinds || { dc: q.dc || 0, plant: q.plant || 0, fab: q.fab || 0 };
  const nearest = ex.length ? ex.reduce((a, b) => (a.km < b.km ? a : b)) : null;

  const tiles = [
    tile('Magnitude', `M${q.mag.toFixed(1)}`, `${n0(q.depthKm)} km deep`),
    tile('When', day(q.time), when(q.time).slice(11)),
    tile('Assets shaken', n0(ex.length || q.exposed || 0)),
    tile('Data centres', n0(kinds.dc)),
    tile('Power plants', n0(kinds.plant)),
    tile('Fabs', n0(kinds.fab)),
    detail?.mwShaken ? tile('Generation shaken', `${n0(detail.mwShaken)} MW`,
                            'operating nameplate') : '',
    nearest ? tile('Nearest asset', `${nearest.km.toFixed(0)} km`, nearest.name || '') : '',
  ].join('');

  const bands = (detail?.bands || []).map(b => `<tr>
    <td><i class="q-band" style="background:${esc(b.color)}"></i> MMI ${b.mmi}</td>
    <td>${esc((b.label || '').replace(/^\S+\s+/, '') || MMI_MEANS[b.mmi] || '')}</td>
    <td class="num">${n0(b.sites)}</td>
  </tr>`).join('');

  const rows = ex.map(x => {
    const href = KIND_HREF[x.kind];
    const name = x.name || x.site_id;
    return `<tr>
      <td>${href ? `<a href="${href}${esc(x.site_id)}">${esc(name)}</a>` : esc(name)}</td>
      <td class="dim">${esc(KIND_N[x.kind] || x.kind).replace(/s$/, '')}</td>
      <td>${esc(x.operator || '')}</td>
      <td class="num">${(+x.mmi).toFixed(1)}</td>
      <td class="num">${x.km.toFixed(0)} km</td>
    </tr>`;
  }).join('');

  const worst = ex[0];

  return page({
    title: detail?.title || `M${q.mag} — ${q.place}`,
    crumb: `M${q.mag}`,
    parent: { href: '/quakes', name: 'Earthquakes' },
    lede: `${esc(when(q.time))}. ${ex.length
      ? `Reached ${n0(ex.length)} thing${ex.length === 1 ? '' : 's'} this registry
         tracks, the worst at MMI ${(+worst.mmi).toFixed(1)}
         (${esc(MMI_MEANS[Math.floor(worst.mmi)] || '')}).`
      : 'Nothing this registry tracks lay inside its ShakeMap footprint.'}`,
    note: `Shaken, not damaged — MMI is observed ground motion. MMI VI is where
      non-structural damage begins. <a href="${esc(q.url)}" target="_blank"
      rel="noopener">USGS event page</a>.`,
    body: `<section class="fabtiles">${tiles}</section>
      ${bands ? `<section class="panel card">
        <h2>How hard, and how many</h2>
        ${table(['Intensity', 'Means', { n: 'Assets' }], bands,
          'Bands are the ShakeMap contours this event was cut into.')}
      </section>` : ''}
      ${rows ? `<section class="panel card">
        <h2>Everything it reached <span class="dim">${n0(ex.length)}</span></h2>
        ${table(['Name', 'Kind', 'Operator', { n: 'MMI' }, { n: 'Distance' }], rows)}
      </section>`
      : `<section class="panel card"><p class="note">No data centre, power plant
         or fab in this registry lay inside the ShakeMap footprint. That is a
         fact about where this registry has coverage as much as about the
         earthquake.</p></section>`}`,
  });
}
