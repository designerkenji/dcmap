// /event/<id> — the accumulation chain, computed for one simulated failure.
//
// The page is deliberately built as the CHAIN rather than as a result: seven
// questions stand between a failure and a business-interruption number, this
// registry can answer the first four, and a page that printed a megawatt total
// without saying which link it stopped at would be the exact false precision
// the whole dependency layer is engineered against.

import { esc, n0, tile, table, page } from './summary.mjs';
import { chainLink, impactList } from './powerpage.mjs';
import { EVENT_KINDS, eventExposure, MAX_RADIUS_KM } from './events.mjs';
import { DEP_RELATION } from './powerdep.mjs';

const mw0 = (v) => (v ? n0(Math.round(v)) + ' MW' : '');

const band = (c) => (c == null ? '' : c >= 0.9 ? 'high' : c >= 0.7 ? 'good'
  : c >= 0.5 ? 'fair' : 'weak');

export function renderEventPage({ ev, accumulation, kmBetween, nameOf }) {
  const spec = EVENT_KINDS[ev.kind] || {};
  const x = eventExposure({ ev, accumulation, kmBetween });
  // The coordinate is stated ONCE, in the lede. It was in the crumb, the
  // title, the lede and link one's answer - four times on one screen, and a
  // heading made of digits is a poor name for a thing anyway.
  const title = ev.name || `Simulated ${(spec.label || 'event').toLowerCase()}`;

  const pointRows = x.points.map(p => `<tr>
    <td>${p.kind === 'substation'
      ? `<a href="/maps/substation/${encodeURIComponent(p.id)}"><b>${esc(p.name)}</b></a>`
      : `<a href="/maps/plant/${encodeURIComponent(p.id)}"><b>${esc(p.name)}</b></a>`}
      ${p.kv ? `<span class="dim">${p.kv} kV</span>` : ''}</td>
    <td class="dim">${esc(p.kind)}</td>
    <td class="num">${p.km} km</td>
    <td class="num">${n0(p.assets)}</td>
    <td class="num">${p.mw ? mw0(p.mw) : '<span class="dim">—</span>'}</td>
  </tr>`).join('');

  const loadRows = x.loads.map(l => `<tr>
    <td>${l.registry
      ? `<a href="${/^site-/.test(l.id) ? '/maps/site/' : /^f/.test(l.id) ? '/maps/fab/' : '/maps/plant/'}${encodeURIComponent(l.id)}"><b>${esc(nameOf ? nameOf(l.id) : l.name)}</b></a>`
      : `${esc(l.name)} <span class="dim">filed only</span>`}</td>
    <td class="num">${l.mw ? mw0(l.mw) : '<span class="dim">—</span>'}</td>
    <td>${esc(l.rels.map(r => (DEP_RELATION[r] || {}).label || r).join(' · '))}</td>
    <td class="dim">${esc(l.via.join(', '))}</td>
  </tr>`).join('');

  const tiles = [
    tile('Dependency points hit', n0(x.points.length),
         `${ev.radius_km} km radius · ${esc(spec.label || ev.kind)}`),
    tile('Mega-loads exposed', n0(x.loads.length),
         x.filedLoads ? `${x.registryLoads} in the registry, ${x.filedLoads} filed only` : ''),
    tile('Filed load behind them', x.mw ? mw0(x.mw) : '—',
         'where a filing states a number'),
    tile('Weakest evidence', x.minConfidence == null ? '—'
         : band(x.minConfidence), x.minConfidence == null ? ''
         : `confidence ${x.minConfidence.toFixed(2)} — the chain is only as sourced as this`),
  ].join('');

  const body = `
  <section class="panel card">
    <div class="evhead">
      <span class="eyebrow">Simulated failure — nothing here has happened</span>
      <p class="note"><span class="evsim">This is a simulated event.</span> Nothing here has happened. It is a
    question put to the dependency ledger — <em>place this failure here, reaching this far,
    and tell me what is behind it</em> — and it is the one thing on this map that is not a
    record of something real. The earthquake layer next to it is the opposite: those
      happened.</p>
    </div>
    <div class="fabtiles" style="margin-top:18px">${tiles}</div>
    ${impactList(
      x.loads.slice(0, 3).map(l => ({
        name: nameOf && l.registry ? nameOf(l.id) : l.name,
        href: l.registry
          ? (/^site-/.test(l.id) ? '/maps/site/' : /^f/.test(l.id) ? '/maps/fab/' : '/maps/plant/')
            + encodeURIComponent(l.id)
          : '',
        meta: (l.registry ? '' : 'filed only')
          + (l.via.length ? (l.registry ? 'behind ' : ' · behind ') + l.via.join(', ') : ''),
        value: l.mw ? mw0(l.mw) : '—',
      })),
      Math.max(0, x.loads.length - 3), '#loads', 'exposed')}
    ${spec.blurb ? `<p class="note">${esc(spec.blurb)}</p>` : ''}
    ${ev.note ? `<p class="note"><b>Note:</b> ${esc(ev.note)}</p>` : ''}
  </section>

  <section class="panel card">
    <div class="chain-head">
      <h2>The accumulation chain</h2>
      <button type="button" class="tb-btn" id="chain-all" aria-expanded="false">Expand all</button>
    </div>
    <p class="note">Seven questions stand between a failure and a business-interruption
    number. Each has to hold before the next means anything, so the page says which link
    it stops at rather than printing a total and letting it look complete.</p>

    <div class="chain-list">
    ${chainLink(1, 'What failed?', 'held', `<p class="note">A ${esc((spec.label || ev.kind).toLowerCase())}
      reaching ${ev.radius_km} km, taking <b>${n0(x.points.length)}</b> dependency
      point${x.points.length === 1 ? '' : 's'}.</p>`,
      table(['Point', 'Kind', { n: 'Distance' }, { n: 'Loads' }, { n: 'Filed load' }],
            pointRows) || '<p class="note">None within ' + ev.radius_km + ' km.</p>')}

    ${chainLink(2, 'Which loads depend on them?', x.loads.length ? 'held' : 'empty',
      x.loads.length
        ? `<p class="note"><b>${n0(x.loads.length)}</b> mega-load${x.loads.length === 1 ? '' : 's'},
           each from a filing that names its point of interconnection — not from proximity.
           Deduplicated two ways: an asset behind two of the points above is one exposed
           asset, and an asset holding two queue positions into one point is one asset
           whose megawatts add.</p>`
        : `<p class="note">None. No dependency point inside this radius has a load filed
           behind it. That is an absence of <em>disclosure</em>, not an absence of load:
           coverage follows what markets publish, and outside New York almost nothing is
           published per project.</p>`,
      x.loads.length
        ? table(['Load', { n: 'Filed load' }, 'Relationship', 'Behind'], loadRows)
        : '')}

    ${chainLink(3, 'Physical or contractual?', x.loads.length ? 'held' : 'empty',
      `<p class="note">Only physical edges are counted — a feed, a co-location, a line. A
       front-of-meter contract shares no equipment and is excluded from every total above
       by construction.</p>`)}

    ${chainLink(4, 'How much, and how well known?', x.mw ? 'held' : 'empty',
      `<p class="note">${x.mw ? `<b>${mw0(x.mw)}</b> of filed load` : 'No stated load'},
       at ${x.minConfidence == null ? 'no established confidence'
         : `a weakest-link confidence of <b>${x.minConfidence.toFixed(2)}</b>`}.
       Confidence is the documented default for each edge's evidence class, never a
       per-edge intuition.</p>`)}

    ${chainLink(5, 'Is there a second feed?', x.resil.feedSet ? 'held' : 'gap',
      `<p class="note">${x.resil.feedSet
        ? `<span class="mono">secondary_feed</span> is established on <b>${x.resil.feedSet}</b>
           of ${x.resil.edges} touched edge${x.resil.edges === 1 ? '' : 's'}${x.resil.feedNone
             ? ` — <b>${x.resil.feedNone}</b> researched as having <em>no</em> second feed,
               which is load that is <em>lost</em>, not merely exposed`
             : ''}. Two feeds off one substation still share the substation; an edge naming
           its own substation as the secondary is saying exactly that.`
        : `<span class="mono">secondary_feed</span> is set on <b>none</b> of the
           ${x.resil.edges} touched edge${x.resil.edges === 1 ? '' : 's'}. Until it is, this
           page reports load that is <em>exposed</em>, not load that is <em>lost</em> — two
           feeds off one substation still share the substation, and that has to be
           established rather than assumed.`}
       Hand-vouched in <span class="mono">data/dependency_overrides.csv</span>; research
       candidates wait in <span class="mono">data/review/</span>.</p>`)}

    ${chainLink(6, 'On-site generation, and for how long?', x.resil.backupSet ? 'held' : 'gap',
      `<p class="note">${x.resil.backupSet
        ? `<span class="mono">backup_power</span> is established on <b>${x.resil.backupSet}</b>
           of ${x.resil.edges} touched edge${x.resil.edges === 1 ? '' : 's'};
           <span class="mono">backup_hours</span> on ${x.resil.hoursSet || 'none'}.`
        : `<span class="mono">backup_power</span> reads <span class="mono">unknown</span> on
           every touched edge and <span class="mono">backup_hours</span> is set on none.`}
       A campus with 72 hours of fuel and one with none are the same dot until the hours
       are recorded.</p>`)}

    ${chainLink(7, 'What is the interruption worth?', 'none',
      `<p class="note">Restoration time × revenue at risk × the policy's own terms. No public
       dataset holds any of the three; it needs the insured's figures and the slip. This is
       where the registry hands over.</p>`)}
    </div>
  </section>



  <section class="panel card">
    <h2>What this does not say</h2>
    <p class="note">It does not say these loads go dark. It says they sit behind equipment
    inside the radius, which is the correlation an accumulation question is asking about —
    not a claim that any one of them is fragile.</p>
    <p class="note">It counts <b>filed</b> mega-loads only. Households, industrial load below
    the filing threshold, and anything served through a substation nobody named in a filing
    are all real and all absent. In New York the threshold is 10 MW at 115 kV and above.</p>
    <p class="note">And the radius is a blunt instrument standing in for a hazard footprint.
    A real one is a flood polygon, a wind field, a shake contour — the earthquake layer
    already carries proper contours because USGS publishes them.</p>
  </section>`;

  const chainScript = '<script src="/chain.js" defer></script>';

  return page({
    title,
    crumb: title,
    parent: { name: 'Power dependency', href: '/power' },
    // The heading already says which kind of failure; the lede carries the
    // two facts that vary between events of the same kind.
    lede: `${ev.radius_km} km radius · ${ev.lat}, ${ev.lon}`,
    note: `<a href="/maps/@${ev.lat},${ev.lon},${Math.round(ev.radius_km * 2200)}m">Show on the map</a>`
        + ` · <a href="/power">The dependency ledger</a>`,
    body: body + chainScript,
  });
}
