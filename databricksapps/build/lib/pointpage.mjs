// /maps/point/<id> — the page a dropped pin gets.
//
// It has two lives. Before a kind is chosen it is a coordinate and a question:
// what is this? After one is chosen it renders as that kind, with that kind's
// fields, and the question is replaced by a readiness line saying what the
// record still needs before it can join the layer it belongs to.
//
// The tooling is the same tooling every other asset page has - parcel pulls,
// footprint drawing, the imagery viewer - because the whole point of dropping
// a pin at a coordinate is to work out what is there, and that is exactly the
// work those tools do.

import { esc, page } from './summary.mjs';
import { POINT_KINDS, kindLabel, readiness } from './points.mjs';

const input = (f, spec, v) => {
  if (spec.options) {
    return `<select name="${f}">${spec.options.map(o =>
      `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${o ? esc(o) : '—'}</option>`
    ).join('')}</select>`;
  }
  return `<input type="text" name="${f}" value="${esc(v)}" maxlength="300"${
    spec.suggest ? ` list="dl-${esc(spec.suggest)}" autocomplete="off"` : ''}${
    spec.hint ? ` placeholder="${esc(spec.hint)}"` : ''}>`
    + (spec.suggest ? `<datalist id="dl-${esc(spec.suggest)}"></datalist>` : '');
};

export function renderPointPage({ pt, wayback }) {
  const kind = pt.kind || '';
  const spec = POINT_KINDS[kind] || null;
  const fields = pt.fields || {};
  const title = fields.name || (kind ? kindLabel(kind) : 'Dropped point');
  const rd = readiness(pt);

  const picker = `
  <section class="panel card">
    <h2>What is this?</h2>
    <p class="note">A dropped point is a claim, not a record. Say what stands here and
    the page becomes that kind of page; leave it blank and it stays a pin with a
    coordinate and no opinion.</p>
    <div class="wb-toolbar" id="pt-kinds">
      ${Object.entries(POINT_KINDS).map(([k, s]) =>
        `<button type="button" class="tb-btn" data-k="${k}"
           aria-pressed="${k === kind}">${esc(s.label)}</button>`).join('')}
      ${kind ? '<button type="button" class="tb-btn" data-k="">Clear</button>' : ''}
    </div>
    ${spec ? `<p class="note">${esc(spec.blurb)}</p>` : ''}
  </section>`;

  const form = spec ? `
  <section class="panel card">
    <h2>${esc(spec.label)}</h2>
    <form class="editform" id="ptform" data-point="${esc(pt.id)}">
      <div class="editgrid">
        ${Object.entries(spec.fields).map(([f, s]) =>
          `<label><span>${esc(s.label)}</span>${input(f, s, fields[f] == null ? '' : String(fields[f]))}</label>`
        ).join('')}
      </div>
      <label class="editnote">Note <span class="dim">— how you know, and anything the
        fields cannot hold</span>
        <input type="text" id="pt-note" maxlength="500" value="${esc(pt.note || '')}"
               placeholder="imagery, a permit, an operator's own page…"></label>
      <div class="editbar">
        <button type="submit" class="tb-btn">Save</button>
        <span id="pt-msg" class="note"></span>
      </div>
    </form>
    <p class="note"><b>${rd.ready ? 'Ready.' : 'Not ready yet —'}</b>
      ${rd.ready
        ? 'This point has what its kind needs. Promoting it into the layer it belongs to '
          + 'is a pipeline step, so it keeps this page until a build has given it a real id.'
        : 'still needs ' + esc(rd.missing.join(', ')) + '.'}</p>
  </section>` : '';

  const body = `
  ${picker}
  ${form}
  ${wayback ? wayback(pt.lat, pt.lon, 16, [], pt.id, 'This point, year by year',
                      ['near', 'move', 'draw', 'parcels']) : ''}
  <section class="panel card">
    <h2>The point itself</h2>
    <div class="facts">
      <div class="fact"><span class="fk">Coordinates</span><span class="fv mono">
        <a href="/@${pt.lat},${pt.lon},1200m">${pt.lat}, ${pt.lon}</a></span></div>
      <div class="fact"><span class="fk">Id</span><span class="fv mono">${esc(pt.id)}</span></div>
      <div class="fact"><span class="fk">Dropped</span><span class="fv">${esc(pt.created || '')}</span></div>
      ${pt.edited ? `<div class="fact"><span class="fk">Edited</span><span class="fv">${esc(pt.edited)}</span></div>` : ''}
    </div>
    <p class="note">Kept in <span class="mono">data/draft_points.json</span>, which no
    pipeline generates and none overwrites. Footprints and parcels saved here attach to
    this point's id and follow it.</p>
    <div class="editbar">
      <button type="button" class="tb-btn" id="pt-del">Delete this point</button>
      <span id="pt-delmsg" class="note"></span>
    </div>
  </section>
  <script src="/point-edit.js" defer></script>`;

  return page({
    title,
    crumb: title,
    parent: { name: 'Map', href: '/' },
    lede: kind
      ? `${esc(kindLabel(kind))} — dropped by hand, not yet in the ${esc(kindLabel(kind).toLowerCase())} layer`
      : 'A point somebody dropped on the map. Not yet anything in particular.',
    note: `<a href="/@${pt.lat},${pt.lon},1200m">Show on the map</a>`,
    body,
  });
}
