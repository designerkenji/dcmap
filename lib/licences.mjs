// Who owns what this registry is built from, and what each licence obliges.
//
// THIS FILE IS THE REGISTER. It is the single source of truth for licensing,
// and it exists because the obligations were previously scattered across
// twenty Python docstrings and a handful of UI strings, which is a fine way to
// remember a decision and a poor way to answer "may we publish this?".
//
// Two things it does that a docs/ markdown table could not:
//   - it RENDERS, at /licences, so the attribution actually travels with the
//     product. ODbL 4.3 requires the notice to accompany any public use, and
//     a notice living only in a repo does not accompany anything.
//   - it is one artefact, so a new source cannot be added with its licence
//     recorded in a comment nobody reads.
//
// Every entry below was taken from this project's own source files, which
// recorded the terms at the time each source was adopted; `where` cites the
// file so a reader can check the claim against the code that made it. Where
// the position is genuinely unresolved it says so - an honest "unresolved" is
// worth more here than a confident guess, because the costly error in a
// licence register is the permissive one.

export const OPEN_QUESTIONS = [
  {
    q: 'Does publishing this registry trigger ODbL share-alike on the derived database?',
    detail:
      'ODbL 4.6: publicly using a Produced Work made from a Derivative Database obliges '
      + 'you to offer recipients the whole Derivative Database, or an alterations file, in '
      + 'machine-readable form. 4.7 forbids imposing terms or technical measures that '
      + 'restrict the rights ODbL grants. The Collective Database escape in 4.5(a) covers a '
      + 'database used UNMODIFIED alongside others, which merging OpenStreetMap-derived '
      + 'rows into one site table defeats. The relief is 4.5(c): use within an organisation '
      + 'is not use "to the public".\n\n'
      + 'So an internal registry is clearly fine. A published or paid one that merges '
      + 'OSM-derived geometry with licensed Regrid and Precisely parcels is the case that '
      + 'needs an actual decision - most likely separating the ODbL-derived layers from the '
      + 'licensed ones so the shareable database can be offered without the paid rows in it. '
      + 'This has not been decided, and it is not a decision to take from a code comment.',
    status: 'open — needs a decision, and counsel before any paid or public release',
  },
  {
    q: 'Can an FCC Broadband Data Collection aggregate be republished?',
    detail:
      'Every BDC availability row is keyed to a CostQuest Fabric Location ID, and '
      + 'CostQuest asserts IP in the Fabric. Aggregating to H3 cells is often assumed to '
      + 'launder that, but the aggregation key is itself Fabric-derived. The underlying '
      + 'availability data is a US federal government work; the Location ID layer is not. '
      + 'No fibre layer has been built, so nothing turns on this yet.',
    status: 'open — resolve before building a fibre layer',
  },
];

// grp orders the page. `obliges` is what WE must do, not a licence summary.
export const LICENCES = [
  // ---- share-alike, the ones that constrain what we may publish -----------
  { grp: 'Share-alike (ODbL)', source: 'OpenStreetMap',
    used: 'Site locations, building and landuse footprints, power-plant perimeters, '
        + 'substations, transmission corridors',
    licence: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    credit: '© OpenStreetMap contributors',
    obliges: 'Attribution, and share-alike on any Derivative Database — see the open '
           + 'question below. This is the licence that governs most of the registry.',
    where: 'src/osm.py, src/power_lines.py, src/substation_geo.py, src/footprints.py' },
  { grp: 'Share-alike (ODbL)', source: 'Overture Maps Foundation',
    used: 'ML-extracted building footprints where OSM has none',
    licence: 'ODbL 1.0 (the buildings theme includes OSM)',
    url: 'https://docs.overturemaps.org/attribution/',
    credit: 'Overture Maps Foundation',
    obliges: 'Attribution; inherits OSM share-alike.',
    where: 'src/footprints_overture.py' },
  { grp: 'Share-alike (ODbL)', source: 'IM3 Open Source Data Center Atlas (PNNL / DOE)',
    used: 'US data-centre footprints, as an independent corroboration set',
    licence: 'Data: ODbL 1.0 · Code: BSD-2-Clause (Battelle-modified)',
    url: 'https://doi.org/10.57931/3017294',
    credit: 'Mongird, Thurber, Vernon, Burleyson, Akdemir & Rice — IM3 Open Source Data '
          + 'Center Atlas, MSD-LIVE record p147s-4h760',
    obliges: 'Attribution and ODbL share-alike, same as OSM — the data is OSM-derived. '
           + 'The BSD grant covers their SOFTWARE only, not the data files, fonts or logos '
           + 'in their repository. Their licence also forbids using the Battelle name '
           + 'without written consent, so cite the authors and the MSD-LIVE record, not '
           + 'Battelle as an endorser.',
    where: 'src/im3.py' },
  { grp: 'Share-alike (ODbL)', source: 'Protomaps daily build',
    used: 'The vector basemap (PMTiles) and its glyphs',
    licence: 'ODbL 1.0 (OpenStreetMap-derived)',
    url: 'https://protomaps.com/',
    credit: '© OpenStreetMap contributors',
    obliges: 'Attribution. Self-hosted as a file rather than a hosted tile service, so no '
           + 'API key and no provider terms apply.',
    where: 'src/basemap_tiles.py' },

  // ---- attribution-only ---------------------------------------------------
  { grp: 'Attribution required (CC BY 4.0)', source: 'Epoch AI — AI Data Centers',
    used: 'AI compute sites: facility power, H100-equivalents, capital cost, chip counts',
    licence: 'CC BY 4.0', url: 'https://epoch.ai/data/ai-data-centers',
    credit: "Epoch AI, 'AI Data Centers'",
    obliges: 'Credit Epoch AI when redistributing these rows.',
    where: 'src/epoch.py' },
  { grp: 'Attribution required (CC BY 4.0)', source: 'Global Energy Monitor',
    used: 'Power plants outside the United States',
    licence: 'CC BY 4.0', url: 'https://globalenergymonitor.org/',
    credit: 'Global Energy Monitor',
    obliges: 'Attribution is a licence CONDITION, not a courtesy. The layer carries it in '
           + 'the panel; do not remove it.',
    where: 'src/plants.py' },
  { grp: 'Attribution required (CC BY 4.0)', source: 'PeeringDB',
    used: 'Facility interconnection: networks present, multi-tenancy signal',
    licence: 'CC BY 4.0', url: 'https://www.peeringdb.com/',
    credit: 'PeeringDB',
    obliges: 'Attribution.',
    where: 'src/peeringdb.py' },

  // ---- government works ---------------------------------------------------
  { grp: 'Public domain / government works', source: 'US EIA (Form 860M)',
    used: 'United States power plants',
    licence: 'US Government work — public domain',
    url: 'https://www.eia.gov/electricity/data/eia860m/',
    credit: 'US Energy Information Administration', obliges: 'Nothing required.',
    where: 'src/plants.py' },
  { grp: 'Public domain / government works', source: 'USGS',
    used: 'Earthquake epicentres and ShakeMap intensity sampled at each site',
    licence: 'US Government work — public domain',
    url: 'https://earthquake.usgs.gov/', credit: 'US Geological Survey',
    obliges: 'Nothing required.', where: 'src/quakes.py, src/shakemap.py' },
  { grp: 'Public domain / government works', source: 'US EPA — Community Water System Service Area Boundaries',
    used: 'Which named water utility each US site sits inside, with population served',
    licence: 'US Government work — public domain',
    url: 'https://www.epa.gov/ground-water-and-drinking-water/community-water-system-service-area-boundaries',
    credit: 'US EPA Office of Research and Development, SAB v3.0',
    obliges: 'Nothing required. EPA disclaims spatial accuracy and calls modelled '
           + 'boundaries estimates; the verification and method columns carry that '
           + 'caveat per row rather than hiding it.',
    where: 'src/water_service.py' },
  { grp: 'Public domain / government works', source: 'NYISO and PJM',
    used: 'Interconnection queue and TEAC filings behind the dependency graph',
    licence: 'Public filings', url: 'https://www.nyiso.com/interconnections',
    credit: 'NYISO interconnection queue; PJM TEAC filings',
    obliges: 'Nothing required; each edge cites its filing.',
    where: 'src/nyiso_loads.py, src/teac.py' },

  // ---- national cadastres, each with its own required wording -------------
  { grp: 'National cadastres', source: 'IGN — API Carto (France)',
    used: 'French parcel boundaries',
    licence: 'Etalab Licence Ouverte 2.0',
    url: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
    credit: 'IGN — plan cadastral', obliges: 'Attribution.',
    where: 'src/parcels_ign_fr.py, dcmap/lib/parcelpull.mjs' },
  { grp: 'National cadastres', source: 'HM Land Registry INSPIRE (England & Wales)',
    used: 'UK title-extent polygons as campus boundaries',
    licence: 'OGL v3 + Crown copyright',
    url: 'https://use-land-property-data.service.gov.uk/',
    credit: 'Contains HM Land Registry data © Crown copyright and database rights 2026, '
          + 'reproduced under OGL v3',
    obliges: 'That exact acknowledgement must travel with the polygons.',
    where: 'src/parcels_inspire_uk.py' },
  { grp: 'National cadastres', source: 'Registers of Scotland',
    used: 'Scottish cadastral parcels',
    licence: 'OGL v3', url: 'https://www.ros.gov.uk/',
    credit: '© Crown copyright. Reproduced with the permission of Registers of Scotland. '
          + 'Contains OS data © Crown copyright',
    obliges: 'That exact acknowledgement.', where: 'src/parcels_ros_scotland.py' },
  { grp: 'National cadastres', source: '法務省 — 登記所備付地図データ (Japan)',
    used: 'Japanese cadastral parcels',
    licence: 'Japanese government open data',
    url: 'https://www.moj.go.jp/', credit: '登記所備付地図データ（法務省）を加工して作成',
    obliges: 'That exact Japanese acknowledgement is required.',
    where: 'src/parcels_moj_jp.py' },

  // ---- bought, and therefore not ours to give away ------------------------
  { grp: 'Licensed — do not redistribute', source: 'Regrid',
    used: 'US parcel boundaries and ~160 county attributes, pulled per site',
    licence: 'Commercial licence, billed per parcel record returned',
    url: 'https://regrid.com/', credit: 'Regrid',
    obliges: 'Held for internal use. Do not republish the parcel geometry or attributes as '
           + 'a bulk layer. Tokens live in data/raw/, which is gitignored.',
    where: 'src/parcels_regrid.py, dcmap/lib/parcelpull.mjs' },
  { grp: 'Licensed — do not redistribute', source: 'Precisely',
    used: 'US parcel boundaries, pulled per site',
    licence: 'Commercial licence, billed per record',
    url: 'https://www.precisely.com/', credit: 'Precisely',
    obliges: 'As Regrid. Credentials in data/raw/, gitignored.',
    where: 'src/parcels_precisely.py' },
  { grp: 'Licensed — do not redistribute', source: 'Esri World Imagery',
    used: 'Satellite basemap and the dated Wayback archive on every detail page',
    licence: 'Esri Master License Agreement',
    url: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9',
    credit: 'Imagery © Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    obliges: 'DISPLAY ONLY. The tiles are fetched by the browser and never stored or '
           + 'redistributed. The credit line under each map is required and is rendered '
           + 'from one constant (ESRI_CREDIT in lib/summary.mjs).',
    where: 'dcmap/server.mjs PROVIDERS.esri, dcmap/lib/summary.mjs' },
];

// Sources deliberately NOT used, and why. A register that lists only what was
// taken loses the more useful half of the record: the refusals, which are the
// decisions most likely to be re-litigated by someone who has forgotten them.
export const REFUSED = [
  { source: 'HIFLD transmission lines (via Esri)',
    why: 'Carries the Esri Master License Agreement, so it could not be redistributed in '
       + 'this registry. Corridors were built from OpenStreetMap instead. Note that PNNL, '
       + 'whose README cites HIFLD, in fact ship the OpenStreetMap branch of their own '
       + 'notebook — the same conclusion reached independently.' },
  { source: 'SEMI World Fab Forecast', why: 'US$11,100/yr.' },
  { source: 'Wikipedia fab list',
    why: 'CC BY-SA share-alike, and no coordinates. Used only as a worklist of NAMES — '
       + 'names are facts, not protectable expression — with every value then sourced '
       + 'independently. Nothing was copied across.' },
  { source: 'CSET / ETO', why: 'CC BY-NC: non-commercial only.' },
  { source: 'SIA US fab map', why: 'No licence stated and copyright asserted.' },
  { source: 'Google Maps places and imagery',
    why: 'Terms forbid bulk extraction and re-serving. Hand fact-checks are fine when the '
       + 'override note cites its source.' },
  { source: 'DataCenterMap', why: 'Systematic scraping forbidden by its terms.' },
];

// ---- the page ---------------------------------------------------------------
import { esc, page } from './summary.mjs';

export function renderLicencesPage() {
  const groups = [];
  for (const l of LICENCES) {
    let g = groups.find(x => x.name === l.grp);
    if (!g) groups.push(g = { name: l.grp, rows: [] });
    g.rows.push(l);
  }
  const body = groups.map(g => `
  <section class="panel card">
    <h2>${esc(g.name)}</h2>
    <div class="tablewrap"><table>
      <tr><th>Source</th><th>What it gives us</th><th>Licence</th><th>What it obliges</th></tr>
      ${g.rows.map(r => `<tr>
        <td><b>${esc(r.source)}</b><br><span class="dim mono">${esc(r.where)}</span></td>
        <td>${esc(r.used)}</td>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.licence)}</a>
            <br><span class="dim">${esc(r.credit)}</span></td>
        <td class="dim">${esc(r.obliges)}</td>
      </tr>`).join('')}
    </table></div>
  </section>`).join('');

  const open = `
  <section class="panel card" id="open">
    <h2>Unresolved — ${OPEN_QUESTIONS.length}</h2>
    <p class="note">An open question stated plainly is worth more than a confident guess:
    the costly error in a licence register is the permissive one.</p>
    ${OPEN_QUESTIONS.map(q => `<div class="fact-block">
      <h3>${esc(q.q)}</h3>
      <p class="note" style="white-space:pre-line">${esc(q.detail)}</p>
      <p class="note"><b>Status:</b> ${esc(q.status)}</p>
    </div>`).join('')}
  </section>`;

  const refused = `
  <section class="panel card" id="refused">
    <h2>Deliberately not used — ${REFUSED.length}</h2>
    <p class="note">The refusals are the half of a register most likely to be re-litigated
    by somebody who has forgotten them.</p>
    <div class="tablewrap"><table>
      <tr><th>Source</th><th>Why not</th></tr>
      ${REFUSED.map(r => `<tr><td><b>${esc(r.source)}</b></td>
        <td class="dim">${esc(r.why)}</td></tr>`).join('')}
    </table></div>
  </section>`;

  return page({
    title: 'Licences and attribution',
    crumb: 'Licences',
    lede: 'Every source this registry is built from, what its licence obliges, and the '
        + 'questions that are still open.',
    note: 'This page is rendered from dcmap/lib/licences.mjs, which is the register itself '
        + '— there is no second copy to drift. Attribution has to travel with the product, '
        + 'not sit in a repository: ODbL 4.3 requires the notice to accompany any public use.',
    body: body + open + refused,
  });
}
