// /review/names — the queue of name conflicts a rule cannot settle.
//
// site_names.py classifies 52 comparable site/footprint name pairs and applies
// the 14 it can defend. The remaining 29 are `conflict`: two different names
// for one building, where the registry and the map disagree and neither is
// obviously right. Two examples that look identical to any rule and are
// opposites in fact:
//
//     Interxion PAR6   vs  Digital Realty Paris PAR6   a real corporate rename
//     Cologix ASH2     vs  Cologix ASH1                the hall next door
//
// Guessing would put a wrong name into a registry whose whole value is
// provenance, so they wait for a person. This page is what a person needs to
// settle one in a few seconds: both names, who each side thinks the operator
// is, and the one number that usually decides it.
//
// DISTANCE IS THE STRONGEST CLUE AND IT IS NOT IN EITHER NAME
//
// The dot and the outline are either the same building or neighbours, and
// metres say which where words cannot. Skyways/Verizon UK4 sit at 0 m - one
// building, renamed. Equinix PA7/PA5 sit 170 m apart - two halls on one campus,
// and taking the footprint's name would move PA7's identity onto PA5. So the
// distance is shown first, in the reviewer's eye-line, and colour-coded.
//
// THREE ANSWERS, NOT TWO
//
// Keep, Take, and Neither. Neither matters: "Rad Web Hosting" against
// "DataBank" is a reseller inside a DataBank facility, so both names are true
// of different things and the right edit is not a name at all. Forcing a binary
// would record a decision nobody made.
//
// Every answer is recorded, including Keep - otherwise the same 29 come back
// every run and a reviewed pair is indistinguishable from an unexamined one.

import { esc, n0, page } from './summary.mjs';

const km = (v) => {
  if (v === '' || v == null) return '<span class="dim">—</span>';
  const n = +v;
  // Under ~30 m the two are the same structure; past ~120 m they are not.
  // The middle is where judgement is actually required, so it is amber rather
  // than pretending to a verdict.
  const cls = n < 0.03 ? 'rv-same' : n > 0.12 ? 'rv-far' : 'rv-mid';
  const t = n < 0.001 ? 'same spot' : n < 1 ? `${Math.round(n * 1000)} m`
                                            : `${n.toFixed(1)} km`;
  return `<span class="rv-km ${cls}">${esc(t)}</span>`;
};

const SRC = { osm: 'OpenStreetMap', im3: 'IM3 atlas', parcel: 'county parcel',
              'osm-landuse': 'OSM landuse', 'osm-site': 'OSM, unlabelled building',
              derived: 'derived hull', manual: 'drawn by hand' };

function card(c) {
  const mapHref = `/?lat=${esc(c.lat)}&lon=${esc(c.lon)}&z=17`;
  // Google's documented Maps URL API rather than a hand-built /maps/@ path:
  // basemap=satellite is a supported parameter there, where the older form
  // encodes it as an opaque !3m1!1e3 blob that Google is free to change.
  //
  // Imagery from a second provider is the point. Deciding whether two names
  // are one building or two is a question about what is actually on the
  // ground, and Esri's picture of a given roof can be years older than
  // Google's - a hall built since the last Esri capture is invisible in the
  // app's own view and obvious here. The coordinates double as the label so
  // they can be read and copied without following the link.
  // esc() over the WHOLE url, not just the values interpolated into it. The
  // ampersands matter: HTML5 still resolves a handful of named entities
  // without their semicolon, `&cent` among them, so a raw `&center=` is parsed
  // as `¢er=` and the link silently goes to the wrong place. Escaped to
  // `&amp;center=` it survives.
  const gmaps = esc('https://www.google.com/maps/@?api=1&map_action=map'
    + `&center=${c.lat},${c.lon}&zoom=18&basemap=satellite`);
  const coords = (c.lat !== '' && c.lon !== '')
    ? `${(+c.lat).toFixed(5)}, ${(+c.lon).toFixed(5)}` : '';
  return `<article class="rvcard" data-site="${esc(c.site_id)}">
    <header class="rvhead">
      ${km(c.km)}
      <span class="dim">${esc([c.city, c.country].filter(Boolean).join(', '))}</span>
      <span class="spacer"></span>
      ${coords ? `<a class="rv-gps mono" href="${gmaps}" target="_blank" rel="noopener"
        title="Open these coordinates in Google Maps satellite view">${esc(coords)}</a>` : ''}
      <a class="tb-btn" href="/site/${esc(c.site_id)}" target="_blank" rel="noopener">Site page</a>
      <a class="tb-btn" href="${mapHref}" target="_blank" rel="noopener">On the map</a>
    </header>
    <div class="rvpair">
      <div class="rvside">
        <span class="fk">Registry says</span>
        <b>${esc(c.site)}</b>
        <span class="dim">${esc(c.operator || 'no operator recorded')}</span>
        <button class="tb-btn rv-go" data-act="keep">Keep this</button>
      </div>
      <div class="rvside">
        <span class="fk">The outline says</span>
        <b>${esc(c.fp)}</b>
        <span class="dim">${esc(SRC[c.src] || c.src)}${
          c.fp_op ? ` · ${esc(c.fp_op)}` : ''}${
          c.m2 ? ` · ${n0(c.m2)} m²` : ''}</span>
        <button class="tb-btn go rv-go" data-act="take">Use this name</button>
      </div>
    </div>
    <footer class="rvfoot">
      <input type="text" class="rv-note" placeholder="How you know — optional"
             aria-label="Note">
      <button class="tb-btn rv-go" data-act="neither">Neither — leave it alone</button>
      <span class="rv-msg"></span>
    </footer>
  </article>`;
}

export function renderReviewPage(queue, doneCount) {
  const body = queue.length
    ? `<section class="rvlist">${queue.map(card).join('')}</section>`
    : `<section class="panel card"><p class="note">Nothing waiting. Every name
        conflict site_names.py could find has been ruled on. Re-run
        <span class="mono">python3 src/site_names.py</span> after the next
        footprint build to refill the queue.</p></section>`;

  return page({
    title: 'Name conflicts',
    crumb: 'Name conflicts',
    lede: `${n0(queue.length)} pair${queue.length === 1 ? '' : 's'} where the
      registry and the outline drawn round it disagree about the name, and no
      rule can say which is right.${doneCount
        ? ` ${n0(doneCount)} already settled.` : ''}`,
    note: `A rename and a mismapping look identical in the words. The distance
      is usually what separates them: at the same spot it is one building under
      two names, and a hundred metres away it is the hall next door wearing its
      neighbour's label.`,
    body: body + `
      <script>
      document.addEventListener('click', async (e) => {
        const b = e.target.closest('.rv-go');
        if (!b) return;
        const card = b.closest('.rvcard');
        const msg = card.querySelector('.rv-msg');
        const act = b.dataset.act;
        // The name a "take" would write is the outline's, read back out of the
        // card rather than passed around, so what is saved is what was shown.
        const chosen = act === 'take'
          ? card.querySelectorAll('.rvside b')[1].textContent.trim()
          : act === 'keep' ? card.querySelectorAll('.rvside b')[0].textContent.trim() : '';
        card.querySelectorAll('.rv-go').forEach(x => { x.disabled = true; });
        msg.textContent = 'saving…';
        try {
          const r = await fetch('/api/name-review', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              site_id: card.dataset.site, decision: act, chosen,
              note: card.querySelector('.rv-note').value,
            }),
          });
          const out = await r.json();
          if (!r.ok) throw new Error(out.error || r.status);
          card.classList.add('rv-done');
          msg.textContent = act === 'take' ? 'renamed' :
                            act === 'keep' ? 'kept' : 'left alone';
        } catch (err) {
          msg.textContent = 'failed: ' + err.message;
          card.querySelectorAll('.rv-go').forEach(x => { x.disabled = false; });
        }
      });
      </script>`,
  });
}
