// The furniture behind /plants, /fabs and /datacentres, and the per-dot pages.
//
// Three summary pages that answer the same shape of question - how many, where,
// whose, how big - so they are one renderer taking a config rather than three
// files that drift. The fab page was written first and standalone; when the
// other two arrived its hand-written 13-country region map would have had to be
// copied twice and would have been wrong for 186 countries the first time.
//
// REGIONS COME FROM THE OPERATOR DIRECTORY, which already carries a 240-entry
// ISO2 -> {name, continent, subregion} table used by the operator pages. Adding
// a second region table here is how two parts of one app start disagreeing
// about whether Türkiye is in Europe.
//
// That only works because every layer now keys countries the same way. Plants
// did not until this page needed them to: GEM names countries in prose and EIA
// does not name them at all, so src/plants.py normalises to ISO2 against
// Natural Earth. A shared page forced a fix that was overdue anyway.

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const n0 = (v) => (v == null || v === '' ? '' : Math.round(v).toLocaleString('en-US'));

// A number with the count it was computed over. Used everywhere a total could
// be read as covering the whole group when it covers the part that had data -
// the fab layer's 1,903 MW is 14 fabs of 90, and printing it bare was the
// single easiest way to mislead with this dataset.
export const ofN = (v, have, total) =>
  (v ? n0(v) : '') + (have < total ? `<span class="dim"> ${have} of ${total}</span>` : '');

export function tile(label, value, sub = '') {
  return `<div class="fabtile"><span class="fk">${esc(label)}</span>` +
    `<span class="fabtile-v">${value}</span>` +
    (sub ? `<span class="fabtile-s">${esc(sub)}</span>` : '') + '</div>';
}

export function table(head, rows, note = '') {
  if (!rows) return '';
  return `<div class="tablewrap"><table>
    <thead><tr>${head.map(h => typeof h === 'string'
      ? `<th>${esc(h)}</th>` : `<th class="num">${esc(h.n)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>` + (note ? `<p class="note">${note}</p>` : '');
}

// Group a list, roll each group up, sort biggest first, render.
export function groupBy(list, keyOf, render, { limit = 0, sortBy } = {}) {
  const m = new Map();
  for (const x of list) {
    const k = keyOf(x);
    if (k == null || k === '') continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  let entries = [...m.entries()];
  entries.sort(sortBy || ((a, b) => b[1].length - a[1].length));
  const total = entries.length;
  if (limit) entries = entries.slice(0, limit);
  return { html: entries.map(([k, v]) => render(k, v)).join(''), total, shown: entries.length };
}

export function page({ title, crumb, parent, lede, note, body }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Data Centre Registry</title>
<link rel="stylesheet" href="/app.css">
</head><body>
<header class="topbar">
  <a class="brand" href="/">◀ Data Centre Registry</a>
  <span class="spacer"></span>
  <a class="sumnav" href="/datacentres">Data centres</a>
  <a class="sumnav" href="/plants">Power plants</a>
  <a class="sumnav" href="/fabs">Fabs</a>
  <a class="sumnav" href="/quakes">Earthquakes</a>
  <button id="themeBtn" class="themebtn" aria-label="Toggle day / night view"></button>
</header>
<main class="wrap">
  <header class="sitehead">
    <nav class="crumbs"><a href="/">Map</a> <span>›</span>` +
      (parent ? `<a href="${esc(parent.href)}">${esc(parent.name)}</a> <span>›</span>` : '') + `
      <b>${esc(crumb || title)}</b></nav>
    <h1>${esc(title)}</h1>
    ${lede ? `<p class="lede">${lede}</p>` : ''}
    ${note ? `<p class="note">${note}</p>` : ''}
  </header>
  ${body}
</main>
<script src="/theme.js"></script>
</body></html>`;
}

// ---- regions ---------------------------------------------------------------
// `regions` is data.operatorsPayload.regions: ISO2 -> {n, c, s}.
export const makeGeo = (regions) => ({
  country: (cc) => regions[cc]?.n || cc || 'Unknown',
  region: (cc) => regions[cc]?.c || 'Unattributed',
  sub: (cc) => regions[cc]?.s || '',
});

// The countries inside a region, most-populous first, as a dim trailing cell.
export function countryList(list, cyOf, geo, limit = 6) {
  const c = new Map();
  for (const x of list) c.set(cyOf(x), (c.get(cyOf(x)) || 0) + 1);
  const sorted = [...c.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, limit)
    .map(([k, v]) => `${esc(geo.country(k))} ${v}`).join(' · ');
  return head + (sorted.length > limit ? ` <span class="dim">+${sorted.length - limit} more</span>` : '');
}
