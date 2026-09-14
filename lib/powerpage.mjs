// /power — the accumulation view: what fails together.
//
// The other summary pages count assets. This one counts CONCENTRATIONS, which
// is a different question and the one this registry was built to answer: if a
// single substation or a single generator goes, how many mega-assets and how
// many megawatts go with it.
//
// The page is built to resist its own most likely misreading. A dependency
// graph invites the eye to treat every line as equal, so the physical edges
// and the contractual ones are separated before anything is added up, the
// weakest evidence in a cluster is shown next to the total it supports, and
// the filed-but-unbuilt loads are counted apart from the ones the registry
// can point at on the ground.

import { esc, n0, tile, table, page } from './summary.mjs';
import { DEP_RELATION, DEP_EVIDENCE, isRegistryId } from './powerdep.mjs';

const mw0 = (v) => (v ? n0(Math.round(v)) + ' MW' : '');

// Confidence is shown as a band, not a decimal, everywhere a reader might
// otherwise take 0.85 for a measurement. The number is still there on hover.
const confChip = (c) => {
  if (c == null) return '';
  const band = c >= 0.9 ? 'high' : c >= 0.7 ? 'good' : c >= 0.5 ? 'fair' : 'weak';
  return `<span class="conf conf-${band}" title="confidence ${c.toFixed(2)}">${band}</span>`;
};

// A located substation links to the map at its own coordinate; an unlocated
// one says so, because "we have a name but not a place" is a different state
// from "here it is" and the reader should be able to tell at a glance.
const subLink = (a) => {
  const name = a.kind === 'substation'
    ? `<a href="/maps/substation/${encodeURIComponent(a.id)}"><b>${esc(a.name)}</b></a>`
    : `<b>${esc(a.name)}</b>`;
  return name + (a.lat != null && a.lon != null
    ? ` <a href="/@${a.lat},${a.lon},2000m" class="dim" title="show on the map">◉</a>`
    : ' <span class="dim" title="named in a filing, not yet matched to a mapped substation">unlocated</span>');
};

// The three biggest items, before any table. Each row is name · what it is ·
// magnitude, and the name links to wherever the detail lives - the point of
// putting impact on top is that it is a way IN, not a summary that dead-ends.
export function impactList(rows, moreCount, moreHref, moreLabel) {
  if (!rows.length) return '';
  return `<div class="impact">${rows.map(r => `<div class="impact-row">
      <span>${r.href ? `<a class="impact-nm" href="${esc(r.href)}">${esc(r.name)}</a>`
        : `<span class="impact-nm">${esc(r.name)}</span>`}${r.meta
        ? ` <span class="impact-meta">— ${esc(r.meta)}</span>` : ''}</span>
      <span class="impact-v">${esc(r.value)}</span>
    </div>`).join('')}${moreCount > 0
      ? `<div class="impact-more"><a href="${esc(moreHref)}">+ ${moreCount} more
         ${esc(moreLabel)} below</a></div>` : ''}</div>`;
}

// One link. The question, its verdict AND its answer are all visible closed -
// a collapsed link still says what it found, so the chain reads as seven
// answers at a glance and expanding is for the evidence behind one of them.
// Only the table hides.
//
// A link with nothing further to show is a plain row rather than a <details>
// that opens onto nothing: an affordance that does not pay out is worse than
// no affordance.
const STATE_LABEL = { held: 'Held', gap: 'Gap — ours', empty: 'Nothing filed',
                      none: 'Nobody holds this' };
export const chainLink = (n, q, state, body, detail = '') => {
  const head = `
      <span class="chain-n">${String(n).padStart(2, '0')}</span>
      <span class="chain-h">
        <span class="chain-q">${q}</span>
        <span class="chain-state cs-${state}">${STATE_LABEL[state] || state}</span>
      </span>
      <div class="chain-lede">${body}</div>`;
  if (!detail) {
    return `<div class="chainlink chain-${state} chainlink-static">
    <div class="chain-sum">${head}</div>
  </div>`;
  }
  return `<details class="chainlink chain-${state}">
    <summary class="chain-sum">${head}</summary>
    <div class="chain-b">${detail}</div>
  </details>`;
};

const assetHref = (id) => (
  /^site-/.test(id) ? '/maps/site/' + encodeURIComponent(id)
  : /^f/.test(id) ? '/maps/fab/' + encodeURIComponent(id)
  : /^[eg]/.test(id) ? '/maps/plant/' + encodeURIComponent(id) : '');

function assetCell(e) {
  const id = e.asset_id;
  const href = assetHref(id);
  const name = e.load ? e.load.name : id;
  if (!href) {
    // A filed load with no registry dot yet. Named, sourced, and explicitly
    // not counted as something the registry has seen.
    return `${esc(name)} <span class="dim">filed only</span>`;
  }
  return `<a href="${href}">${esc(name || id)}</a>`;
}

// The per-asset card, for a plant, fab or site page. Two directions, because
// an asset both DEPENDS on things and IS depended on: a fab hangs off a
// substation, a plant has loads hanging off it. Both are the same ledger read
// from opposite ends, and a page that showed only one would hide half the
// exposure.
export function renderDependencyCard({ id, depsByAsset = new Map(),
                                       depsByDep = new Map(), accumulation = [],
                                       nameOf = (x) => x }) {
  const mine = depsByAsset.get(id) || [];
  const onMe = depsByDep.get(id) || [];
  if (!mine.length && !onMe.length) return '';

  const row = (e, dir) => {
    const rel = DEP_RELATION[e.relationship] || {};
    const ev = DEP_EVIDENCE[e.evidence] || {};
    const other = dir === 'up' ? e.depName
      : (e.load ? e.load.name : (nameOf(e.asset_id) || e.asset_id));
    const href = dir === 'up'
      ? (/^sub-/.test(e.dependency_asset_id)
          ? '/maps/substation/' + encodeURIComponent(e.dependency_asset_id)
          : assetHref(e.dependency_asset_id))
      : assetHref(e.asset_id);
    // The vouched resilience facts, worn as chips where a reader inspects the
    // edge. Absence stays silent: an unresearched edge should not dress up.
    const chips = [
      e.withdrawn ? '<span class="kinbadge k-point" title="the NYISO queue lists this '
        + 'filing as status 0, Withdrawn - kept as history, counted nowhere">withdrawn</span>' : '',
      e.secondary_feed === 'none' ? '<span class="kinbadge k-point" title="researched: '
        + 'a single point of interconnection - this load is lost, not merely exposed, '
        + 'when the substation fails">no second feed</span>' : '',
      e.secondary_feed && e.secondary_feed !== 'none'
        ? '<span class="kinbadge k-campus" title="a redundant path is established; '
          + 'sharing the substation is part of what it says">2nd feed: '
          + esc(e.secondary_feed.replace(/^sub-/, '')) + '</span>' : '',
      e.backup_power && e.backup_power !== 'unknown'
        ? '<span class="kinbadge k-building" title="on-site backup generation, '
          + 'as vouched in dependency_overrides.csv">backup: '
          + esc(e.backup_power) + '</span>' : '',
    ].filter(Boolean).join(' ');
    return `<tr>
      <td>${href ? `<a href="${href}">${esc(other)}</a>` : esc(other)}${
        dir === 'down' && !href ? ' <span class="dim">filed only</span>' : ''}</td>
      <td>${esc(rel.label || e.relationship)}${rel.physical === false
        ? ' <span class="dim">paper only</span>' : ''}${chips ? ' ' + chips : ''}</td>
      <td class="num">${e.mw ? mw0(e.mw) : ''}</td>
      <td>${esc(ev.label || e.evidence)} ${confChip(e.confidence)}</td>
      <td class="dim">${esc((e.note || '').slice(0, 180))}${e.url
        ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</td>
    </tr>`;
  };

  // If something this asset depends on also carries other loads, say so here
  // rather than making the reader find the /power page to learn it.
  // One entry per dependency, not per edge: an asset with two queue positions
  // into the same substation depends on it twice and shares it once.
  const shared = [...new Set(mine.map(e => e.dependency_asset_id))]
    .map(id => accumulation.find(a => a.id === id))
    .filter(a => a && a.assets > 1);
  const sharedNote = shared.length ? `<p class="note"><b>Shared:</b> ${shared.map(a =>
    `${esc(a.name)} also carries ${a.assets - 1} other mega-load${a.assets > 2 ? 's' : ''}`
    + (a.mw ? ` (${mw0(a.mw)} in total)` : '')).join('; ')}. A failure there is a
    <a href="/power">correlated loss</a>, not an isolated one.</p>` : '';

  return `
  <section class="panel card" id="powerdep">
    <h2>Power dependency</h2>
    ${mine.length ? `<h3 class="subh">What this depends on</h3>
      ${table(['Depends on', 'Relationship', { n: 'Load' }, 'Evidence', 'Basis'],
              mine.map(e => row(e, 'up')).join(''))}` : ''}
    ${sharedNote}
    ${onMe.length ? `<h3 class="subh">What depends on this</h3>
      ${table(['Asset', 'Relationship', { n: 'Load' }, 'Evidence', 'Basis'],
              onMe.map(e => row(e, 'down')).join(''))}` : ''}
    <p class="note">Physical relationships — a feed, a co-location, a line — are the ones
    that carry correlated outage. A front-of-meter contract is marked
    <span class="dim">paper only</span>: it is a real commercial fact that shares no
    equipment. Confidence is the default for its evidence class; hover for the number.</p>
  </section>`;
}

export function renderPowerPage({ accumulation, powerDeps, substationById,
                                  siteById, fabById, plantById }) {
  const withdrawn = powerDeps.filter(e => e.withdrawn);
  const physical = powerDeps.filter(e => e.physical && !e.withdrawn);
  const paper = powerDeps.filter(e => !e.physical && !e.withdrawn);
  // Megawatts belong to the FILING, not to each point it names (src_ref).
  const withdrawnMw = [...new Map(withdrawn.map(e => [e.src_ref || e.asset_id, e.mw || 0])).values()]
    .reduce((t, m) => t + m, 0);
  const multi = accumulation.filter(a => a.assets > 1);
  const registryAssets = new Set(physical.map(e => e.asset_id).filter(isRegistryId));
  const filedOnly = new Set(physical.map(e => e.asset_id).filter(id => !isRegistryId(id)));
  const totalMw = accumulation.reduce((t, a) => t + a.mw, 0);

  const nameOf = (id) => {
    const s = siteById.get(id);
    if (s) return s.name || s.epoch_name || id;
    const f = fabById.get(id);
    if (f) return f.n || id;
    const p = plantById.get(id);
    if (p) return p.n || id;
    return id;
  };

  const tiles = [
    tile('Dependency points', n0(accumulation.length), 'substations and generators with a physical edge'),
    tile('Withdrawn filings', n0(new Set(withdrawn.map(e => e.src_ref || e.asset_id)).size),
         withdrawn.length ? mw0(withdrawnMw) + ' MW kept on the graph as history, excluded from every number here'
                          : 'none in the current queue'),
    tile('Carrying more than one', n0(multi.length), 'a shared point of failure'),
    tile('Load behind them', mw0(totalMw), 'where the filing states a number'),
    tile('Assets in the registry', n0(registryAssets.size),
         filedOnly.size ? `+ ${filedOnly.size} filed but not yet registry dots` : ''),
  ].join('');

  // ---- the clusters -------------------------------------------------------
  const clusterRows = multi.map(a => {
    const assets = [];
    const seen = new Set();
    for (const e of a.edges) {
      if (seen.has(e.asset_id)) continue;
      seen.add(e.asset_id);
      assets.push(assetCell(e));
    }
    const rels = [...new Set(a.edges.map(e => (DEP_RELATION[e.relationship] || {}).label
      || e.relationship))];
    return `<tr>
      <td>${subLink(a)}${a.kv ? ` <span class="dim">${a.kv} kV</span>` : ''}
        <span class="dim">${esc(a.kind)}</span></td>
      <td class="num">${n0(a.assets)}</td>
      <td class="num">${a.mw ? mw0(a.mw) : '<span class="dim">—</span>'}</td>
      <td>${assets.join(', ')}</td>
      <td>${esc(rels.join(' · '))} ${confChip(a.minConfidence)}</td>
    </tr>`;
  }).join('');

  // ---- single-asset concentrations ---------------------------------------
  // One campus behind one bus is still a concentration; it is simply not a
  // SHARED one. Underwriters ask both questions, so both are shown.
  const soloRows = accumulation.filter(a => a.assets === 1 && a.mw >= 100)
    .slice(0, 25).map(a => `<tr>
      <td>${subLink(a)}${a.kv ? ` <span class="dim">${a.kv} kV</span>` : ''}</td>
      <td class="num">${mw0(a.mw)}</td>
      <td>${a.edges.map(e => assetCell(e)).filter((v, i, s) => s.indexOf(v) === i).join(', ')}</td>
      <td>${confChip(a.minConfidence)}</td>
    </tr>`).join('');

  // ---- named by a filing, placed by nobody ---------------------------------
  // Ranked by the load behind them, because that is what decides which gap is
  // worth an hour of somebody's time: three of these carry 3.2 GW between
  // them, and the map cannot show any of it for want of two numbers.
  const unplaced = accumulation
    .filter(a => a.kind === 'substation' && a.lat == null)
    .sort((x, y) => (y.mw - x.mw) || (y.assets - x.assets));
  // All of them, not a top-30: this table IS the work queue, and a queue
  // that hides seventy of its items just moves the gap somewhere invisible.
  const unplacedRows = unplaced.map(a => {
    const s = substationById.get(a.id) || {};
    return `<tr>
      <td><a href="/maps/substation/${encodeURIComponent(a.id)}#place"><b>${esc(a.name)}</b></a>${
        s.kv ? ` <span class="dim">${s.kv} kV</span>` : ''}</td>
      <td class="num">${n0(a.assets)}</td>
      <td class="num">${a.mw ? mw0(a.mw) : '<span class="dim">—</span>'}</td>
      <td class="dim">${(s.counties || []).length
        ? esc(s.counties.join(' / ')) : '<span class="dim">not stated</span>'}</td>
      <td class="dim">${esc(s.geo_rejected
        || (s.region === 'VA' ? 'no OpenStreetMap match — most Virginia needs describe a '
            + 'substation that is not built yet' : 'no OpenStreetMap match under this name'))}</td>
    </tr>`;
  }).join('');

  // ---- the paper edges ----------------------------------------------------
  const paperRows = paper.map(e => `<tr>
      <td>${assetCell(e)}</td>
      <td>${esc(e.depName)}</td>
      <td>${esc((DEP_RELATION[e.relationship] || {}).label || e.relationship)}</td>
      <td class="dim">${esc((e.note || '').slice(0, 160))}${e.url
        ? ` <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</td>
    </tr>`).join('');

  // ---- where the evidence comes from -------------------------------------
  const byEv = new Map();
  for (const e of powerDeps) {
    if (!byEv.has(e.evidence)) byEv.set(e.evidence, []);
    byEv.get(e.evidence).push(e);
  }
  const evRows = [...byEv.entries()]
    .sort((a, b) => (DEP_EVIDENCE[b[0]]?.confidence || 0) - (DEP_EVIDENCE[a[0]]?.confidence || 0))
    .map(([k, list]) => {
      const spec = DEP_EVIDENCE[k] || {};
      return `<tr>
        <td><b>${esc(spec.label || k)}</b></td>
        <td class="num">${n0(list.length)}</td>
        <td class="num">${spec.confidence != null ? spec.confidence.toFixed(2) : ''}</td>
        <td class="dim">${esc(spec.blurb || '')}</td>
      </tr>`;
    }).join('');

  const body = `
  <section class="panel card">
    <div class="evhead" style="border-left-color:var(--supply)">
      <span class="eyebrow" style="color:var(--supply)">The dependency ledger · ${n0(powerDeps.length)} edges · ${n0(substationById.size)} substations</span>
      <h2 style="margin-bottom:8px">What fails together</h2>
      <p class="note">Every edge below comes from a document that names both ends. Nothing
      here is inferred from distance.</p>
    </div>
    <div class="fabtiles" style="margin-top:18px">${tiles}</div>
    ${impactList(
      multi.slice(0, 3).map(a => ({
        name: a.name,
        href: a.kind === 'substation' ? '/maps/substation/' + encodeURIComponent(a.id)
            : a.kind === 'plant' ? '/maps/plant/' + encodeURIComponent(a.id) : '',
        meta: `${a.assets} mega-loads`
          + (a.registry ? `, ${a.registry} in the registry` : ', all filed only'),
        value: a.mw ? mw0(a.mw) : '—',
      })),
      Math.max(0, multi.length - 3), '#substations', 'shared points')}
    <p class="note">A dependency here is a piece of equipment an asset needs, not a
    company it buys from. ${n0(physical.length)} of the ${n0(powerDeps.length)} edges are
    <b>physical</b> — a feed, a co-location, a line — and only those are added up on this
    page. The other ${n0(paper.length)} are contractual or announced, and are listed at the
    bottom without being counted, because a contract shares no equipment.</p>
  </section>

  <section class="panel card" id="substations">
    <h2>Shared dependency points — ${n0(multi.length)}</h2>
    <p class="note">Each row is one substation or generator that more than one mega-asset
    depends on. These are the correlated-loss candidates: a transformer bank, a bus or a
    switchyard whose failure takes every asset in the row with it. The confidence chip is
    the <em>weakest</em> evidence in the row — a cluster is only as sourced as its worst
    link.</p>
    ${table(['Dependency', { n: 'Assets' }, { n: 'Load' }, 'Who depends on it', 'How, and how well known'],
            clusterRows) || '<p class="note">No shared dependency established yet.</p>'}
  </section>

  <section class="panel card" id="unplaced">
    <h2>Named but not placed — ${n0(unplaced.length)}</h2>
    <p class="note">A filing names these as somebody's point of interconnection, and no
    county-checked OpenStreetMap match exists for them — so they carry filed load on this
    ledger while being absent from the map, and from every radius an event or a quake
    draws. Most of Virginia's are <em>proposed</em> substations and legitimately have no
    place yet. The built ones are a gap, and each page has a tool to close it by hand.</p>
    ${table(['Substation', { n: 'Assets' }, { n: 'Filed load' }, 'County, per the filings',
             'Why it is not placed'], unplacedRows)
      || '<p class="note">Every substation on the ledger is placed.</p>'}
    <p class="note">Placing one is a person identifying a switchyard on imagery — weaker
    evidence than a match against a published record, recorded as its own class and
    marked wherever it is used. It is offered only where there is no match to contradict.</p>
  </section>

  <section class="panel card">
    <h2>Single-asset concentrations</h2>
    <p class="note">One asset behind one dependency point, 100 MW and over. Not a shared
    failure, but not diversified either — a gigawatt on one bus is a gigawatt on one bus.</p>
    ${table(['Dependency', { n: 'Load' }, 'Asset', 'Evidence'], soloRows)
      || '<p class="note">None recorded.</p>'}
  </section>

  <section class="panel card" id="transmission">
    <h2>How each edge is known — ${n0(powerDeps.length)}</h2>
    <p class="note">Confidence in this layer is a property of the <b>evidence class</b>, not
    a per-edge intuition: every edge sourced the same way carries the same number, and an
    edge that departs from its class has to say why in its own note. That is the only way a
    confidence column stays meaningful once there are thousands of rows.</p>
    ${table(['Evidence', { n: 'Edges' }, { n: 'Confidence' }, 'What it is worth'], evRows)}
  </section>

  <section class="panel card">
    <h2>Recorded but not counted — ${n0(paper.length)}</h2>
    <p class="note">Front-of-meter contracts and announced pairings. They are real
    commercial facts and they belong in the registry, but they carry <b>no outage
    correlation</b>: the plant sells to the grid, the load buys from the grid, and the
    electrons do not follow the paperwork. Counting them as dependency would be the
    single easiest way to make this page lie.</p>
    ${table(['Asset', 'Counterparty', 'Arrangement', 'Basis'], paperRows)}
  </section>

  <section class="panel card">
    <div class="evhead" style="border-left-color:var(--ai)">
      <span class="eyebrow" style="color:var(--ai)">Where this layer stops</span>
      <div class="chain-head">
        <h2 style="margin:0">The accumulation chain</h2>
        <button type="button" class="tb-btn" id="chain-all" aria-expanded="false">Expand all</button>
      </div>
      <p class="note">Seven questions stand between a failure and a business-interruption
      number. This page answers the first four for every dependency point in the ledger; a
      <a href="/">simulated event</a> answers them for one failure at one coordinate. The
      last three are marked rather than guessed.</p>
    </div>

    <div class="chain-list" style="margin-top:18px">
    ${chainLink(1, 'What stands at a location?', 'held',
      `<p class="note">${n0(substationById.size)} substations named by filings,
       ${n0([...substationById.values()].filter(x => x.located).length)} of them placed on
       the ground by an OpenStreetMap match checked against the county the filing gives.
       The rest keep a name and no coordinate rather than a plausible-looking one.</p>`)}

    ${chainLink(2, 'Which loads depend on it?', 'held',
      `<p class="note">${n0(physical.length)} physical edges, each from a filing that names
       a point of interconnection. There is deliberately no “nearest substation” edge: the
       nearest substation is frequently not the serving one, and six thousand guesses would
       drown the edges that are actually sourced.</p>`)}

    ${chainLink(3, 'Physical or contractual?', 'held',
      `<p class="note">Split before anything is added up. ${n0(paper.length)} contractual and
       announced edges are listed above and counted in nothing — a front-of-meter contract
       shares no equipment, and letting it inflate a concentration is the single easiest way
       to make this page lie.</p>`)}

    ${chainLink(4, 'How much, and how well known?', 'held',
      `<p class="note">${mw0(totalMw)} of filed load across ${n0(accumulation.length)}
       dependency points, every edge carrying a confidence that is the documented default
       for its evidence class rather than a per-edge intuition.</p>`)}

    ${chainLink(5, 'Is there a second feed?', 'gap',
      `<p class="note"><span class="mono">secondary_feed</span> exists on every edge and is
       set on <b>none of them</b>. Until it is, this page reports load that is
       <em>exposed</em>, not load that is <em>lost</em>.</p>`)}

    ${chainLink(6, 'On-site generation, and for how long?', 'gap',
      `<p class="note"><span class="mono">backup_power</span> reads
       <span class="mono">unknown</span> on all ${n0(powerDeps.length)} edges and
       <span class="mono">backup_hours</span> is set on none. A campus with 72 hours of fuel
       and one with none are the same row here.</p>`)}

    ${chainLink(7, 'What is the interruption worth?', 'none',
      `<p class="note">Restoration time × revenue at risk × the policy's own terms. No public
       dataset holds any of the three. This is where the registry hands over to whoever owns
       the exposure file.</p>`)}
    </div>

    <p class="note" style="margin-top:20px"><b>And coverage follows disclosure, not
    importance.</b> NYISO is the only US market publishing a per-project load
    interconnection queue that names a point of interconnection, so New York is dense here
    and everywhere else is thin — ERCOT aggregates to the load zone and says so explicitly,
    and PJM has no load queue at all because load interconnects through the transmission
    owner under state jurisdiction. An empty region on this page means nobody published,
    not that nothing is at risk. Nor is a filed load a built one: the rows marked
    <span class="dim">filed only</span> are requests no registry dot corresponds to yet.</p>
  </section>`;

  const chainScript = '<script src="/chain.js" defer></script>';

  return page({
    title: 'Power dependency',
    crumb: 'Power dependency',
    lede: 'What fails together: shared substations, shared generators, and the '
        + 'evidence behind each claim.',
    note: '<a href="/supply">Supply links</a> · <a href="/plants">All power plants</a>',
    body: body + chainScript,
  });
}
