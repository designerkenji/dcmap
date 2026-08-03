// Server-rendered page for one operator: /operator/<key>.
//
// The map's directory panel answers "who is big and where" while you are
// looking at the map. This is the shareable version of the same question, and
// it can afford to list every site rather than the first forty.
//
// Sites are grouped continent -> country because that is how the question is
// actually asked ("do they run anything in Asia?"), and every row carries both
// links it can: ours, which has the coordinates and the source trail, and the
// operator's own page for that building where match_site_links.py could prove
// which one it is.

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const HUES = [206, 12, 145, 268, 32, 190, 340, 96, 250, 58];

function logo(op, profile) {
  if (profile?.logo) {
    return `<span class="ops-logo ops-logo-xl"><img src="/logos/${esc(profile.logo)}" alt=""></span>`;
  }
  let h = 0;
  for (const ch of op.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = op.name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/)
    .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return `<span class="ops-logo ops-logo-xl ops-mono" style="--h:${HUES[h % HUES.length]}">${esc(initials)}</span>`;
}

export function renderOperatorPage(ctx) {
  const { op, profile, sites, regions, links } = ctx;

  // continent -> country -> rows
  const byCont = new Map();
  for (const s of sites) {
    const reg = regions[s.country] || {};
    const cont = reg.c || 'Unattributed';
    const cname = reg.n || s.country || 'Unknown';
    if (!byCont.has(cont)) byCont.set(cont, new Map());
    const m = byCont.get(cont);
    if (!m.has(cname)) m.set(cname, []);
    m.get(cname).push(s);
  }
  const conts = [...byCont.entries()]
    .map(([c, m]) => [c, m, [...m.values()].reduce((n, a) => n + a.length, 0)])
    .sort((a, b) => b[2] - a[2]);

  const linked = sites.filter(s => links[s.site_id]).length;

  // publishedFacilities is a researcher's sentence with its citation attached
  // ("41 campuses - the header of vantage-dc.com/... reads ..."). Only the
  // claim belongs on the page. Splitting on "." cut it mid-URL, so cut on the
  // dash or the citation verb that actually separates claim from evidence.
  // Names ending in s take the bare apostrophe: "Vantage Data Centers' page".
  const poss = esc(op.name) + (/s$/i.test(op.name) ? '&rsquo;' : '&rsquo;s');

  const rawPub = profile?.publishedFacilities || '';
  // Researchers record a negative finding as prose ("No facility count
  // published"), which must not render as "they publish No facility count".
  const published = /^\s*(no|none|not )/i.test(rawPub) ? '' : rawPub
    .split(/\s[—–-]\s|,\s*(?:stated|as stated|from|per|according|sourced)\b|\bstated on\b/)[0]
    .replace(/[;:,\s"'“”]+$/, '').replace(/^["'“”]+/, '')
    .slice(0, 90);

  const meta = [
    `${sites.length.toLocaleString()} site${sites.length === 1 ? '' : 's'}`,
    op.ai ? `${op.ai} AI` : '',
    profile?.kind || '',
    profile?.hqCountry ? `HQ ${esc(profile.hqCountry)}` : '',
    profile?.parent ? `part of ${esc(profile.parent)}` : '',
  ].filter(Boolean).join(' · ');

  const outLinks = [];
  if (profile?.domain) {
    outLinks.push(`<a href="https://${esc(profile.domain)}" target="_blank" rel="noopener noreferrer">${esc(profile.domain)}</a>`);
  }
  if (profile?.officialLocationList && profile.officialLocationList !== 'none found') {
    outLinks.push(`<a href="${esc(profile.officialLocationList)}" target="_blank" rel="noopener noreferrer">Their locations page</a>`);
  }

  const regionNav = conts.map(([c, , n]) =>
    `<a class="opx-chip" href="#c-${esc(c.replace(/\s+/g, '-'))}">${esc(c)} <b>${n}</b></a>`).join('');

  const body = conts.map(([cont, m, n]) => {
    const countries = [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    return `
  <section class="panel card" id="c-${esc(cont.replace(/\s+/g, '-'))}">
    <h2>${esc(cont)} <span class="dim">${n} site${n === 1 ? '' : 's'}</span></h2>
    ${countries.map(([cname, rows]) => `
      <h3 class="opx-country">${esc(cname)} <span class="dim">${rows.length}</span></h3>
      <ul class="opx-sites">
        ${rows.map(s => {
          const l = links[s.site_id];
          const name = s.name || s.epoch_name || 'Unnamed site';
          const where = [s.city].filter(Boolean).join(', ');
          return `<li>
            <a class="opx-name" href="/site/${encodeURIComponent(s.site_id)}">${esc(name)}</a>
            ${where ? `<span class="opx-where">${esc(where)}</span>` : ''}
            ${s.facility_type === 'ai' ? '<i class="ops-ai">AI</i>' : ''}
            ${l ? `<a class="opx-out" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"
                     title="${esc(l.name)} — on ${esc(op.name)}'s own site">↗</a>` : ''}
          </li>`;
        }).join('')}
      </ul>`).join('')}
  </section>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(op.name)} · Data Centre Registry</title>
<link rel="stylesheet" href="/app.css">
</head><body>
<header class="topbar">
  <a class="brand" href="/">◀ Data Centre Registry</a>
  <span class="spacer"></span>
  <a class="themebtn searchbtn" href="/?search=1" aria-label="Search the registry" title="Search"></a>
  <button id="themeBtn" class="themebtn" aria-label="Toggle day / night view"></button>
</header>
<main class="wrap">
  <header class="sitehead">
    <nav class="crumbs"><a href="/">Data Centres</a> <span>›</span>
      <a href="/?operators=1">Operators</a> <span>›</span> <b>${esc(op.name)}</b></nav>
    <div class="opx-hero">
      ${logo(op, profile)}
      <div>
        <h1>${esc(op.name)}</h1>
        <p class="opx-meta">${meta}</p>
        ${outLinks.length ? `<p class="opx-links">${outLinks.join(' · ')}</p>` : ''}
      </div>
    </div>
    ${profile?.profile ? `<p class="lede">${esc(profile.profile)}</p>` : ''}
    <p class="note">
      <a href="/?op=${encodeURIComponent(op.key)}">Show all ${sites.length} on the map</a>
      ${op.spellings > 1 ? ` · assembled from ${op.spellings} spellings of the operator name` : ''}
      ${linked ? ` · ${linked} linked to ${poss} own page` : ''}
      ${published ? ` · they publish ${esc(published)}` : ''}
    </p>
  </header>
  ${conts.length > 1 ? `<nav class="opx-nav">${regionNav}</nav>` : ''}
  ${body}
</main>
<script src="/theme.js"></script>
</body></html>`;
}
