/* dcmap frontend: one state object driving two renderers.
 *
 * 2D is MapLibre with a vector basemap built from our own Natural Earth
 * GeoJSON — no external tile service, so the app works offline and the
 * day/night styles are just two palettes over the same sources.
 * 3D is globe.gl drawing the same polygons and points on a sphere.
 *
 * Dots are deduplicated sites; clicking one opens /site/<site_id> in a new
 * tab, which is the shareable unit.
 */
(async function () {
  'use strict';

  const state = {
    mode: '2d',
    layers: { facilities: true, ai: true, ercot: false, pjm: false, nyiso: false,
      countries: false, quake: false },
    filter: null,   // {key,value,label} from search — narrows the dots shown
    time: null,     // {q, mode:'cum'|'year'} while the timeline bar is open
  };

  const PALETTES = {
    day: {
      ocean: '#DFE9F0', land: '#F6F8FA', border: '#C4CFD8',
      fac: '#0E8A7C', ai: '#B5761E', halo: '#FFFFFF',
      ercot: '#B5761E', pjm: '#3B82C4', nyiso: '#2E9E83', cty: '#7C5FBF',
      // The globe was night in both themes: one hard-coded texture and a black
      // background in each palette. Day now gets a lit sky; night stays dark.
      bg3d: '#CFE0EE', atmosphere: '#9FD0FF',
      // The globe's basemap gets MORE contrast than the 2D one, not the same.
      // 2D can separate #DFE9F0 ocean from #F6F8FA land because it is flat,
      // evenly lit and viewed head-on. Wrap those two on a sphere behind an
      // atmosphere and they are one colour. A globe needs a blue ocean.
      globeOcean: '#A8CCE6', globeLand: '#F4F7F9', globeBorder: '#8FA9BE',
      // Fallback only, for a browser that will not give us a 2D canvas
      // context. The globe wore this photograph until people started reading
      // it as satellite imagery - see globeMapTexture().
      globeTexture: '/textures/earth-day.jpg',
      // Added flat, not multiplied through the texture: a multiplicative lift
      // leaves dark pixels dark, which is the whole problem being solved.
      globeLift: 0x1d2b3a, ambient: 4.2, sun: 0.55,
      fac3d: 'rgba(64,196,180,0.85)', ai3d: 'rgba(224,167,92,0.95)',
    },
    night: {
      ocean: '#0A1016', land: '#151C24', border: '#2E3A46',
      fac: '#40C4B4', ai: '#E0A75C', halo: '#0A1016',
      ercot: '#FFB03B', pjm: '#60A5EB', nyiso: '#4FD1AC', cty: '#A78BFA',
      bg3d: '#000000', atmosphere: '#274060',
      globeOcean: '#0C1B2A', globeLand: '#22303C', globeBorder: '#44586B',
      globeTexture: '/textures/earth-topo-bathy.jpg',   // fallback only
      // Night stays night - just enough lift to keep it from going muddy.
      globeLift: 0x0a0f14, ambient: 3.0, sun: 0.9,
      fac3d: 'rgba(64,196,180,0.85)', ai3d: 'rgba(224,167,92,0.95)',
    },
  };
  const pal = () => PALETTES[document.documentElement.dataset.theme === 'night' ? 'night' : 'day'];

  // ---- data ----------------------------------------------------------------
  const [sites, ercot, pjm, nyiso, countries, basemap, timeline, quakes] = await Promise.all(
    ['sites', 'ercot', 'pjm', 'nyiso', 'countries', 'basemap', 'timeline', 'quakes']
      .map(n => fetch(`/data/${n}.json`).then(r => r.json())));

  const drawable = sites.filter(s => s.lat != null);
  const sitesFC = {
    type: 'FeatureCollection',
    features: drawable.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: s,
    })),
  };
  // Esri-derived rings wind clockwise; GeoJSON expects counter-clockwise
  // outer rings, and three-globe takes a clockwise ring to mean "everything
  // except this area" - which painted the whole sphere solid when a zone
  // layer switched on. Normalise winding once, for both renderers.
  const ccw = (ring) => {
    // Dedupe consecutive vertices and close the ring: 4-dp rounding upstream
    // creates degenerate slivers whose winding test flips arbitrarily, and one
    // mis-classified ring paints the entire sphere.
    const pts = [];
    for (const pt of ring) {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) pts.push(pt);
    }
    if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) {
      pts.push(pts[0]);
    }
    if (pts.length < 4) return null;
    let a = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      a += (pts[i + 1][0] - pts[i][0]) * (pts[i + 1][1] + pts[i][1]);
    }
    if (Math.abs(a) < 1e-7) return null;         // sliver: drop, don't guess
    return a < 0 ? pts : pts.reverse();
  };
  const zoneFC = (zones) => ({
    type: 'FeatureCollection',
    features: zones.map(z => ({
      type: 'Feature',
      geometry: { type: 'MultiPolygon',
        coordinates: z.rings.map(r => ccw(r)).filter(Boolean).map(r => [r]) },
      properties: Object.fromEntries(Object.entries(z).filter(([k]) => k !== 'rings')),
    })),
  });
  // USGS ships one MultiLineString per MMI half-step with its own colour, so
  // the layer reads like every other ShakeMap rather than a house palette.
  // Decimal year for an epoch-ms instant, so events and build dates share one
  // axis without converting the whole registry to milliseconds.
  const decYear = (ms) => {
    const d = new Date(ms), y = d.getUTCFullYear();
    return y + (d - Date.UTC(y, 0, 1)) / (365.25 * 86400000);
  };
  for (const q of quakes) q.dy = decYear(q.time);

  // Every epicentre in one source; the ShakeMap of whichever event is open in
  // another. Contours for 519 events would be tens of MB and unreadable.
  const quakeFC = { type: 'FeatureCollection', features: [] };   // filled on click
  const epicentreFC = {
    type: 'FeatureCollection',
    features: quakes.map(q => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [q.lon, q.lat] },
      properties: q,     // includes dy, the decimal year the cursor compares
    })),
  };
  let openEvent = null;

  const ercotFC = zoneFC(ercot);
  const pjmFC = zoneFC(pjm);
  const nyisoFC = zoneFC(nyiso);
  const ctyFC = zoneFC(countries);

  const openSite = (id) => window.open(`/site/${encodeURIComponent(id)}`, '_blank', 'noopener');
  window.__openSite = openSite; // test hook


  // Repaint everything the visibility predicates feed: both renderers, and -
  // while the timeline is open - its count line and Top-15 chart, which read
  // the same filters. Reassigned once the timeline module loads.
  let refreshView = () => { applyVisibility(); refreshGlobe(); };
  // Declared here, not next to the basemap UI further down: styleGlobe() and
  // initGlobe() are defined above that point and would hit the temporal dead
  // zone reading it.
  let currentBasemap = '';          // '' = our own vector basemap
  let providers = [];
  let globeAlt = 2.5;               // globe camera altitude; see pointRadius()

  const tip = document.getElementById('tip');
  function showTip(x, y, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14;
    tip.style.left = Math.min(x + pad, innerWidth - tip.offsetWidth - pad) + 'px';
    tip.style.top = Math.min(y + pad, innerHeight - tip.offsetHeight - pad) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const siteFacts = (p) => {
    const bits = [p.o, p.ci || p.c, p.mw ? p.mw.toLocaleString() + ' MW' : '', p.u]
      .filter(Boolean).map(esc).join(' · ');
    return `<div class="t">${esc(p.n || p.o || 'Data centre')}</div>` +
           (bits ? `<div class="d">${bits}</div>` : '') +
           (p.gp === 'town' ? '<div class="d">approximate location — geocoded to the town, not the building</div>' : '') +
           (p.rv ? '<div class="d">unverified — PeeringDB listing with no networks, IXs or carriers</div>' : '') +
           (p.mmi ? `<div class="d">worst recent shaking: MMI ${(+p.mmi).toFixed(1)}` +
             `${p.mmiEv ? ' — ' + esc(p.mmiEv) : ''}</div>` : '');
  };

  // Hovering a dot. "Click" means the dot under the cursor, which by
  // definition exists - you are pointing at it.
  const siteTip = (p) => siteFacts(p) + '<div class="d">click to open site page</div>';

  // A popup is not a hover tip and cannot borrow its wording. Popups are
  // opened by search, by a deep link and by the operator directory, and none
  // of those need a dot on the map to work - switch the Data Center Facilities
  // layer off, pick a site out of an operator's list, and the popup used to
  // arrive telling you to click a dot that is not being drawn. Dead end.
  //
  // A real anchor rather than a click handler, so the site page can also be
  // opened in a background tab or a new window the usual ways.
  const sitePopup = (p) => siteFacts(p) +
    `<a class="pop-open" href="/site/${encodeURIComponent(p.id)}" ` +
    `target="_blank" rel="noopener">Open site page →</a>`;

  // ---- 2D: MapLibre ---------------------------------------------------------
  // Site dots, solid at every zoom, ringed in the halo colour.
  //
  // They used to fade to a ring past z12, on the theory that over imagery a
  // filled disc is a lid you cannot see the building through. That was true
  // when the dot was the only thing marking the site and it was drawn far too
  // big. It stopped being true once the dot got small enough to sit on a
  // single roof - and a hollow ring over a bright roof is not a subtle marker,
  // it is an invisible one. A marker's first job is to be found.
  //
  // Hollow now carries exactly one meaning, the one it carries on the globe:
  // the coordinate is a town centroid, not a located building.
  //
  // The ring is the halo colour - white by day, near-black by night - which is
  // what lets one dot colour work over a dark field and pale concrete alike.
  function dotPaint(colour, halo, base) {
    const town = ['==', ['get', 'gp'], 'town'];
    // `zoom` HAS to be the top-level operand of the interpolate. Nesting it
    // inside a `case` - which reads more naturally, town first then the rest -
    // is a hard validation error in MapLibre, and it takes the whole layer with
    // it: both dot layers rendered nothing at all until this was inverted.
    // So interpolate is outermost and the per-feature `case` goes in the stops.
    const z = (near, far) => ['interpolate', ['linear'], ['zoom'], 11, near, 14, far];
    return {
      'circle-color': ['case', town, 'rgba(0,0,0,0)', colour],
      'circle-radius': z(base, base * 1.5),
      // No zoom term: these are the same whether you are looking at the world
      // or at one building.
      'circle-opacity': ['case', town, 0, 0.92],
      'circle-stroke-color': ['case', town, colour, halo],
      // The ring thickens with zoom because it is proportionally thinner as
      // the dot grows, and a town ring stays thicker than a halo since for
      // town dots the ring IS the marker.
      'circle-stroke-width': z(['case', town, 1.6, 0.8], ['case', town, 2.2, 1.8]),
      'circle-stroke-opacity': 0.95,
    };
  }

  function buildStyle() {
    const c = pal();
    const clamp01 = (e) => ['min', 1, ['max', 0, e]];
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        basemap: { type: 'geojson', data: basemap },
        cty: { type: 'geojson', data: ctyFC },
        ercot: { type: 'geojson', data: ercotFC },
        pjm: { type: 'geojson', data: pjmFC },
        nyiso: { type: 'geojson', data: nyisoFC },
        quake: { type: 'geojson', data: quakeFC },
        epicentre: { type: 'geojson', data: epicentreFC },
        sites: { type: 'geojson', data: sitesFC },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': c.ocean } },
        { id: 'land', type: 'fill', source: 'basemap', paint: { 'fill-color': c.land } },
        { id: 'land-line', type: 'line', source: 'basemap',
          paint: { 'line-color': c.border, 'line-width': 0.6 } },
        { id: 'cty', type: 'fill', source: 'cty', layout: { visibility: 'none' },
          paint: { 'fill-color': c.cty,
            'fill-opacity': ['+', 0.06, ['*', ['get', 'share'], 0.42]] } },
        { id: 'ercot', type: 'fill', source: 'ercot', layout: { visibility: 'none' },
          paint: { 'fill-color': c.ercot,
            'fill-opacity': ['+', 0.08, ['*', clamp01(['/', ['-', ['get', 'growth'], 1], 4]), 0.38]] } },
        { id: 'ercot-line', type: 'line', source: 'ercot', layout: { visibility: 'none' },
          paint: { 'line-color': c.ercot, 'line-width': 1.4, 'line-opacity': 0.8 } },
        { id: 'pjm', type: 'fill', source: 'pjm', layout: { visibility: 'none' },
          paint: { 'fill-color': c.pjm,
            'fill-opacity': ['+', 0.07, ['*', ['get', 'share'], 0.36]] } },
        { id: 'pjm-line', type: 'line', source: 'pjm', layout: { visibility: 'none' },
          paint: { 'line-color': c.pjm, 'line-width': 1.2, 'line-opacity': 0.7 } },
        { id: 'nyiso', type: 'fill', source: 'nyiso', layout: { visibility: 'none' },
          paint: { 'fill-color': c.nyiso,
            'fill-opacity': ['+', 0.08, ['*', ['get', 'share'], 0.5]] } },
        { id: 'nyiso-line', type: 'line', source: 'nyiso', layout: { visibility: 'none' },
          paint: { 'line-color': c.nyiso, 'line-width': 1.2, 'line-opacity': 0.75 } },
        { id: 'quake', type: 'line', source: 'quake', layout: { visibility: 'none' },
          paint: { 'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['get', 'value'], 2, 0.8, 8, 2.6],
            'line-opacity': 0.9 } },
        // A town-level coordinate is drawn hollow: same position, but the
        // ring says "somewhere in this settlement", not "this building".
        { id: 'sites', type: 'circle', source: 'sites',
          filter: ['!=', ['get', 'ft'], 'ai'],
          paint: dotPaint(c.fac, c.halo, 3.2) },
        { id: 'epicentre', type: 'circle', source: 'epicentre', layout: { visibility: 'none' },
          paint: {
            // Magnitude is logarithmic, so area should be too - a linear
            // radius makes an M7 look barely worse than an M5.
            'circle-radius': ['interpolate', ['exponential', 1.9], ['get', 'mag'],
              5, 3.5, 6, 6, 7, 10, 8, 15],
            // Red where the shaking actually reached a registry site.
            'circle-color': ['case', ['>', ['coalesce', ['get', 'exposed'], 0], 0],
              '#d7263d', 'rgba(0,0,0,0)'],
            'circle-opacity': 0.55,
            'circle-stroke-color': ['case', ['>', ['coalesce', ['get', 'exposed'], 0], 0],
              '#d7263d', '#9aa7b2'],
            'circle-stroke-width': 1.4,
          } },
        { id: 'sites-ai', type: 'circle', source: 'sites',
          filter: ['==', ['get', 'ft'], 'ai'],
          paint: dotPaint(c.ai, c.halo, 5) },
      ],
    };
  }

  const map = new maplibregl.Map({
    container: 'map2d',
    style: buildStyle(),
    center: [-30, 28],
    zoom: 1.7,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  window.__map = map; window.__state = state; // test hooks

  // The container's final size can land after construction (fonts, the fixed
  // topbar, embedded panes); MapLibre keeps the stale canvas size otherwise.
  //
  // Ignore zero-size reports. Switching to 3D sets `hidden` on this element,
  // which fires the observer at 0x0; resizing the map to nothing made
  // MapLibre drop every tile it held, and coming back re-rendered an empty
  // style - the basemap returned but the 6,248 dots did not.
  const el2d = document.getElementById('map2d');
  new ResizeObserver(() => {
    if (el2d.hidden || !el2d.clientWidth || !el2d.clientHeight) return;
    map.resize();
  }).observe(el2d);

  const LAYER_IDS = {
    facilities: ['sites'],
    ai: ['sites-ai'],
    ercot: ['ercot', 'ercot-line'],
    pjm: ['pjm', 'pjm-line'],
    nyiso: ['nyiso', 'nyiso-line'],
    countries: ['cty'],
    quake: ['quake', 'epicentre'],
  };
  // Traditional and AI facilities are separate layers over the same source;
  // each keeps its kind filter, and the search facet composes on top.
  const KIND_FILTER = {
    sites: ['!=', ['get', 'ft'], 'ai'],
    'sites-ai': ['==', ['get', 'ft'], 'ai'],
  };
  // 519 events span 0.98 of a quarter, so a quarterly slider cannot sequence
  // them at all - every one lands on the same stop. The cursor therefore has
  // two resolutions: quarters for an 11-year build-out, days for an event
  // window. Both are decimal years, so every predicate below is unchanged.
  const evDays = (() => {
    const ts = quakes.map(q => q.dy).sort((a, b) => a - b);
    if (!ts.length) return [];
    const step = 1 / 365.25, out = [];
    for (let t = Math.floor(ts[0] * 365.25) / 365.25; t <= ts[ts.length - 1] + step; t += step) {
      out.push(Math.round(t * 365.25) / 365.25);
    }
    return out;
  })();
  const stops = () => (state.time && state.time.scale === 'day' ? evDays : timeline.quarters);
  const timeT = () => stops()[Math.min(state.time.q, stops().length - 1)];
  // A slider stop labels a whole quarter, so "built by Q4 2024" includes
  // builds through the end of that quarter (t + 0.25), not just its first
  // day. Year mode's first year means "2019 and earlier": 84 dated sites
  // predate the slider range and must stay reachable.
  const inTime = (d) => {
    if (!state.time || state.time.view === 'line') return true;
    const t = timeT(), y = Math.floor(t), end = t + (state.time.scale === 'day' ? 1 / 365.25 : 0.25);
    // "Built by then" keeps undated sites on the map. 97% of sites have no
    // operational date, and hiding them emptied the map the moment the
    // timeline opened - which is what made the cursor useless for anything
    // else. Showing them asserts only "this exists", which is why the other
    // two modes, which place a site at a specific time, still exclude them.
    if (state.time.mode === 'cum' && d.by == null) return true;
    // Under construction: ground broken by this quarter and capacity still
    // rising afterwards. Deliberately NOT "not yet operational" - a campus is
    // routinely live and building its next phase at the same time, and the
    // earlier test dropped all 32 of those. Epoch-tracked sites only.
    if (state.time.mode === 'uc') {
      return d.cs != null && d.cs < end && d.ge != null && d.ge >= end;
    }
    if (d.by == null) return false;
    if (state.time.mode === 'cum') return d.by < end;
    return y === timeline.quarters[0] ? d.by < y + 1 : Math.floor(d.by) === y;
  };
  // `region` is an optional second axis, used by the operator directory to say
  // "Equinix, but only in Europe". Kept as a modifier on the existing filter
  // rather than a second filter slot, so the chip, the count and the layer
  // expression all stay in agreement with one source of truth.
  const matchesFilter = (d) => !state.filter
    || (state.filter.value === '__shaken__' ? !!(shakenIds && shakenIds.has(d.id))
        : d[state.filter.key] === state.filter.value
          && (!state.filter.region || d.rg === state.filter.region));
  const shown = () => drawable.filter(d =>
    (d.ft === 'ai' ? state.layers.ai : state.layers.facilities) &&
    matchesFilter(d) && inTime(d));

  // Events are always time-aware, in both resolutions: show what had happened
  // at or before the cursor. With the timeline closed, show everything.
  function eventClause() {
    if (!state.time || state.time.view === 'line') return null;
    return ['<=', ['get', 'dy'], timeT() + (state.time.scale === 'day' ? 1 / 365.25 : 0.25)];
  }

  function dateClause() {
    if (!state.time || state.time.view === 'line') return null;
    const t = timeT(), y = Math.floor(t), end = t + (state.time.scale === 'day' ? 1 / 365.25 : 0.25);
    if (state.time.mode === 'uc') {
      return ['all',
        ['<', ['coalesce', ['get', 'cs'], 9999], end],
        ['>=', ['coalesce', ['get', 'ge'], -1], end]];
    }
    // 9999 -> -1: an undated site now passes the cumulative test rather than
    // failing it, matching inTime above.
    if (state.time.mode === 'cum') return ['<', ['coalesce', ['get', 'by'], -1], end];
    if (y === timeline.quarters[0]) return ['<', ['coalesce', ['get', 'by'], 9999], y + 1];
    return ['==', ['floor', ['coalesce', ['get', 'by'], -1]], y];
  }

  // The title slot is a live readout of what the map is actually drawing, so
  // every filter, layer toggle and timeline step is accounted for on screen.
  // Counts the filtered set rather than the viewport: panning should not
  // change the number, and un-geocoded sites are excluded because they are
  // precisely the ones with no dot.
  const dotcount = document.getElementById('dotcount');
  function updateCount() {
    const n = shown().length;
    dotcount.textContent = `${n.toLocaleString()} data center${n === 1 ? '' : 's'}`;
  }

  updateCount();   // paint the real number now; the style takes seconds to load

  function applyVisibility() {
    for (const [id, kind] of Object.entries(KIND_FILTER)) {
      if (map.getLayer(id)) {
        const parts = [kind];
        if (state.filter) {
          parts.push(state.filter.value === '__shaken__'
            ? ['in', ['get', 'id'], ['literal', [...(shakenIds || [])]]]
            : ['==', ['get', state.filter.key], state.filter.value]);
          if (state.filter.region) parts.push(['==', ['get', 'rg'], state.filter.region]);
        }
        const dc = dateClause();
        if (dc) parts.push(dc);
        map.setFilter(id, parts.length > 1 ? ['all', ...parts] : kind);
      }
    }
    if (map.getLayer('epicentre')) map.setFilter('epicentre', eventClause());
    for (const [key, ids] of Object.entries(LAYER_IDS)) {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', state.layers[key] ? 'visible' : 'none');
        }
      }
    }
    updateCount();
  }
  // 'styledata' fires repeatedly DURING style load, and setLayoutProperty
  // throws while the style is loading - which wedged the style in a permanently
  // "not done loading" state. 'style.load' fires once, after load completes.
  map.on('load', applyVisibility);
  map.on('style.load', applyVisibility);

  for (const id of ['sites', 'sites-ai']) {
    map.on('click', id, (e) => {
      const f = e.features && e.features[0];
      if (f) openSite(f.properties.id);
    });
    map.on('mousemove', id, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features[0];
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, siteTip(f.properties));
    });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; hideTip(); });
  }

  const MMI_MEANS = { 2: 'weak', 3: 'weak', 4: 'light', 5: 'moderate',
    6: 'strong — non-structural damage begins', 7: 'very strong — moderate damage',
    8: 'severe', 9: 'violent' };
  const zoneTips = {
    ercot: (p) => `<div class="t">${esc(p.name)}</div><div class="d">${p.sites} sites · ${p.aiSites} AI · ` +
      `${(p.mwCurrent || 0).toLocaleString()} → ${(p.mwPeak || 0).toLocaleString()} MW` +
      (p.growth ? ` (${p.growth}×)` : '') + '</div>',
    pjm: (p) => `<div class="t">${esc(p.name)}</div><div class="d">${esc(p.utility)}</div>` +
      `<div class="d">${p.sites} sites · ${(p.mw2026 || 0).toLocaleString()} MW 2026 → ` +
      `${(p.mw2046 || 0).toLocaleString()} MW 2046</div>`,
    nyiso: (p) => `<div class="t">${esc(p.name)}</div>` +
      `<div class="d">${p.sites} data centres · ${p.multiTenant} multi-tenant</div>` +
      `<div class="d">${(p.share * 100).toFixed(0)}% of NY state stock</div>`,
    cty: (p) => `<div class="t">${esc(p.name)}</div><div class="d">${(p.sites || 0).toLocaleString()} data centres · ` +
      `${p.multiTenant || 0} multi-tenant` +
      (p.aiSites ? ` · ${p.aiSites} AI, ${(p.mwCurrent || 0).toLocaleString()} MW` : '') + '</div>',
  };
  map.on('mousemove', 'quake', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai'] }).length) return;
    const v = e.features[0].properties.value;
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      `<div class="t">MMI ${v}</div><div class="d">${esc(MMI_MEANS[Math.floor(v)] || '')}</div>` +
      `<div class="d">${esc(openEvent ? openEvent.title : '')}</div>`);
  });
  map.on('mouseleave', 'quake', hideTip);
  map.on('mousemove', 'epicentre', (e) => {
    const q = e.features[0].properties;
    map.getCanvas().style.cursor = q.detail ? 'pointer' : '';
    const when = new Date(+q.time).toISOString().slice(0, 10);
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      `<div class="t">M${q.mag} — ${esc(q.place)}</div>` +
      `<div class="d">${when} · depth ${q.depthKm} km</div>` +
      `<div class="d">${q.exposed ? `${q.exposed} registry sites shaken, max MMI ${q.maxMmi}`
        : q.near200 ? `${q.near200} sites within 200 km, none shaken at MMI 2+`
        : 'no registry site within 200 km'}</div>` +
      (q.detail ? '<div class="d">click for its ShakeMap and exposure</div>' : ''));
  });
  map.on('mouseleave', 'epicentre', () => { map.getCanvas().style.cursor = ''; hideTip(); });

  // Clicking an epicentre loads that event's precomputed footprint.
  map.on('click', 'epicentre', (e) => {
    const q = e.features[0].properties;
    if (!q.detail) return;
    fetch(`/data/quake/${encodeURIComponent(q.id)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
      .then(det => {
        openEvent = det;
        map.getSource('quake').setData({
          type: 'FeatureCollection',
          features: det.contours.map(c => ({
            type: 'Feature',
            geometry: { type: 'MultiLineString', coordinates: c.segments },
            properties: { value: c.value, color: c.color },
          })),
        });
        renderEq(det);
        eqPanel.hidden = false;
      })
      .catch(err => console.warn('[quake] detail load failed:', err));
  });

  for (const id of ['ercot', 'pjm', 'nyiso', 'cty']) {
    map.on('mousemove', id, (e) => {
      // A dot under the cursor wins the tooltip.
      if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai'] }).length) return;
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, zoneTips[id](e.features[0].properties));
    });
    map.on('mouseleave', id, hideTip);
  }

  // ---- earthquake exposure -----------------------------------------------
  // The map answers "where relative to the shaking"; it cannot answer "which
  // sites, how hard, in what order" - ordering by intensity is the analytic
  // content and a scatter of dots does not carry it. So the layer opens a
  // ranked list beside it: bands first for the shape of the exposure, then
  // every site worst-first with its MMI and distance, each row clickable.
  let shakenIds = null;   // site ids of the open event, for the map filter
  const eqPanel = document.getElementById('eqpanel');
  const eqRows = document.getElementById('eq-rows');
  const eqOnly = document.getElementById('eq-only');
  let shaken = [];   // the exposed list of whichever event is open

  function renderEq(det) {
    const bandColor = Object.fromEntries((det.bands || []).map(b => [b.mmi, b.color]));
    shaken = det.exposed || [];
    document.getElementById('eq-title').textContent = det.title || '';
    document.getElementById('eq-sub').textContent = shaken.length
      ? `${shaken.length} registry sites inside the shaking footprint, worst first. ` +
        `MMI is observed intensity — VI is where non-structural damage begins.`
      : 'No registry site was shaken at MMI 2 or above by this event.';
    document.getElementById('eq-bands').innerHTML = (det.bands || [])
      .map(b => `<div class="eq-band"><i style="background:${b.color}"></i>` +
        `<b>${b.sites}</b> <span>${esc(b.label)}</span></div>`).join('');
    eqRows.innerHTML = shaken.map(e =>
      `<li class="eq-row" data-id="${esc(e.site_id)}" title="Open site page">` +
      `<i style="background:${bandColor[Math.floor(e.mmi)] || '#888'}"></i>` +
      `<span class="eq-name">${esc(e.name || e.operator || e.site_id)}</span>` +
      `<span class="eq-mmi">${e.mmi.toFixed(1)}</span>` +
      `<span class="eq-km">${Math.round(e.km)} km</span></li>`).join('');
    eqOnly.hidden = !shaken.length;
  }
  eqRows.addEventListener('click', (e) => {
    const row = e.target.closest('.eq-row');
    if (row) openSite(row.dataset.id);
  });
  eqRows.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.eq-row');
    if (!row) return hideTip();
    const s = sites.find(x => x.id === row.dataset.id);
    if (s) showTip(e.clientX, e.clientY, siteTip(s));
  });
  eqRows.addEventListener('mouseleave', hideTip);

  // Filtering to the shaken set reuses the same chip the search facets use,
  // so there is one mechanism for "the map is showing a subset", not two.
  eqOnly.addEventListener('click', () => {
    const on = eqOnly.getAttribute('aria-pressed') !== 'true';
    eqOnly.setAttribute('aria-pressed', String(on));
    shakenIds = on ? new Set(shaken.map(e => e.site_id)) : null;
    setFilter(on ? { key: 'mmi', value: '__shaken__',
                     label: `Shaken by M${openEvent.mag}`,
                     count: shaken.length, unmapped: 0 } : null);
  });
  document.getElementById('eq-close').addEventListener('click', () => {
    const cb = document.getElementById('lyr-quake');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
  });

  // ---- 3D: globe.gl ----------------------------------------------------------
  let globe = null;
  const el3d = document.getElementById('map3d');

  // Land is the same raster texture worldmonitor uses (copied from its
  // public/textures, served locally) - no land polygons at all. The old 110m
  // polygon caps looked nothing like worldmonitor up close AND sat at altitude
  // 0.004, an opaque roof over the dots at 0.002: the "dots behind the map"
  // bug. Zone and country fills stay hexPolygonsData: the simplified Esri
  // rings self-intersect, and ear-cut triangulation turns one bad ring into a
  // fill across the whole sphere; hex sampling is immune to that.
  function globeHexes() {
    const zone = (zones, kind) => zones.map(z => ({
      kind, z,
      geometry: { type: 'MultiPolygon',
        coordinates: z.rings.map(r => ccw(r)).filter(Boolean).map(r => [r]) },
    }));
    const byCc = new Map(countries.map(z => [z.cc, z]));
    const cty = basemap.features.map(f => {
      const props = f.properties || {};
      const cc = props.ISO_A2 !== '-99' ? props.ISO_A2 : props.ISO_A2_EH;
      const z = byCc.get(cc);
      return z ? { kind: 'cty', z, geometry: f.geometry } : null;
    }).filter(Boolean);
    return []
      .concat(state.layers.countries ? cty : [])
      .concat(state.layers.ercot ? zone(ercot, 'ercot') : [])
      .concat(state.layers.pjm ? zone(pjm, 'pjm') : [])
      .concat(state.layers.nyiso ? zone(nyiso, 'nyiso') : []);
  }

  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  function styleGlobe() {
    const c = pal();
    // Only reassign when it actually changes - globe.gl re-downloads and
    // rebuilds the material on every call to globeImageUrl. Skipped entirely
    // while a tile engine is running, or a theme toggle would drop live
    // imagery back to the flat texture.
    const tex = globeMapTexture();
    if (!currentBasemap && globe.globeImageUrl() !== tex) {
      globe.globeImageUrl(tex);
    }
    globe.backgroundColor(c.bg3d)
      .atmosphereColor(c.atmosphere)
      .hexPolygonColor(d => {
        if (d.kind === 'ercot') {
          const t = Math.max(0, Math.min(1, ((d.z.growth || 0) - 1) / 4));
          return hexA(c.ercot, 0.25 + t * 0.55);
        }
        if (d.kind === 'pjm') return hexA(c.pjm, 0.25 + (d.z.share || 0) * 0.55);
        if (d.kind === 'nyiso') return hexA(c.nyiso, 0.28 + (d.z.share || 0) * 0.55);
        return hexA(c.cty, 0.18 + (d.z.share || 0) * 0.6);
      })
      .pointColor(pointColour);

    // Lighting follows WHICH basemap is on the sphere, not the theme. The
    // palette's values are a rescue job on a photograph - ambient 4.2 exists
    // to drag a near-black true-colour ocean up to something readable. Point
    // that at a drawn map and every colour clips to white. A drawn map wants
    // to arrive as drawn: flat, evenly lit, no terminator, no lift.
    //
    // PI is not a fudge. three.js divides ambient irradiance by PI on its way
    // through the Lambert BRDF, so an ambient intensity of PI renders a
    // texture at exactly the colours it was authored in and nothing else
    // touches it - no sun, so no terminator, and no emissive lift. The drawn
    // map then matches the 2D map's palette to the byte. (It also explains the
    // 4.2 above: that is PI plus a third, to drag a dark photograph up.)
    const lit = currentBasemap
      ? { ambient: c.ambient, sun: c.sun, lift: c.globeLift }
      : { ambient: Math.PI, sun: 0, lift: 0x000000 };

    // three-globe nulls material.color once a texture loads, so the earth
    // cannot be tinted the usual way. `emissive` still works and is what
    // carries day/night here.
    const m = globe.globeMaterial();
    if (m) {
      // three-globe ships shininess 30 with a grey specular, which puts a hard
      // white hotspot over the Arctic that reads as a rendering fault rather
      // than sunlight. The earth is not glossy; take it off entirely.
      m.shininess = 0;
      m.specular?.setHex(0x000000);
      m.emissive?.setHex(lit.lift);
      m.needsUpdate = true;
    }
    // Reapplied on every call rather than once at init: swapping the texture
    // rebuilds the material, so a one-shot setup silently reverts on the first
    // theme change.
    const lights = globe.lights();
    if (lights?.length >= 2) {
      lights[0].intensity = lit.ambient;   // ambient: most of the light, so there
      lights[1].intensity = lit.sun;       // is no terminator across the disc
      globe.lights(lights);
    }
  }

  // ---- the globe's own basemap ----------------------------------------------
  // Drawn, not photographed. The globe used to wear earth-day.jpg, and people
  // zoomed in, saw a photograph and assumed they were looking at satellite
  // imagery - which the Satellite basemap next to it actually is. A map that
  // cannot be told apart from the imagery beside it is worse than a coarse
  // one, so the Map basemap is now unmistakably a map: our own coastlines,
  // our own palette, a graticule over the top.
  //
  // Same geometry and same colours as the 2D basemap, so switching between
  // 2D and 3D is a change of projection and nothing else.
  //
  // Equirectangular is the projection three-globe wraps onto the sphere, so
  // lon -> x and lat -> y IS drawing on the globe; no reprojection needed.
  const GLOBE_TEX_W = 4096, GLOBE_TEX_H = 2048;      // ~10 km/px at the equator
  const globeTexCache = new Map();

  function globeMapTexture() {
    const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day';
    const hit = globeTexCache.get(theme);
    if (hit) return hit;

    const c = pal();
    const cv = document.createElement('canvas');
    cv.width = GLOBE_TEX_W; cv.height = GLOBE_TEX_H;
    const g = cv.getContext('2d');
    if (!g) return c.globeTexture;            // fall back to the photograph
    const X = lon => (lon + 180) / 360 * GLOBE_TEX_W;
    const Y = lat => (90 - lat) / 180 * GLOBE_TEX_H;

    g.fillStyle = c.globeOcean;
    g.fillRect(0, 0, GLOBE_TEX_W, GLOBE_TEX_H);

    // Rings are drawn into one path per polygon so the nonzero winding rule
    // punches the holes out - GeoJSON winds exteriors and holes in opposite
    // directions, which is exactly what nonzero wants. Filling ring by ring
    // would paint the Caspian and every other hole solid land.
    const ringPath = (poly, dx) => {
      g.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const [lon, lat] = ring[i];
          const x = X(lon) + dx, y = Y(lat);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.closePath();
      }
    };
    const lonSpan = (poly) => {
      let lo = Infinity, hi = -Infinity;
      for (const ring of poly) for (const [lon] of ring) {
        if (lon < lo) lo = lon;
        if (lon > hi) hi = lon;
      }
      return [X(lo), X(hi)];
    };

    g.fillStyle = c.globeLand;
    g.strokeStyle = c.globeBorder;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    for (const f of basemap.features) {
      const geom = f.geometry;
      if (!geom) continue;
      const polys = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates : [];
      for (const poly of polys) {
        // Drawn up to three times, shifted a full texture width each way. A
        // country that crosses the antimeridian has vertices at both +179 and
        // -179 and would otherwise be stretched right across the map; the
        // copies mean whatever falls off one edge arrives at the other.
        //
        // Only where a copy would actually land on the canvas, though - this
        // runs over every polygon in the basemap and blindly tripling the path
        // work to serve the handful that touch 180 is most of the cost of
        // building the texture.
        const [lo, hi] = lonSpan(poly);
        for (const dx of [-GLOBE_TEX_W, 0, GLOBE_TEX_W]) {
          if (lo + dx > GLOBE_TEX_W || hi + dx < 0) continue;
          ringPath(poly, dx);
          g.fill();
          g.stroke();
        }
      }
    }

    // The graticule is what makes it read as a map at a glance rather than on
    // inspection - no satellite image has lines of latitude on it.
    g.strokeStyle = c.globeBorder;
    g.globalAlpha = 0.55;
    g.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), GLOBE_TEX_H); g.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(GLOBE_TEX_W, Y(lat)); g.stroke();
    }
    // Equator and tropics dashed, as they are drawn on a printed map.
    g.setLineDash([14, 10]);
    g.lineWidth = 1.6;
    g.globalAlpha = 0.75;
    for (const lat of [0, 23.4363, -23.4363]) {
      g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(GLOBE_TEX_W, Y(lat)); g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;

    // Flat colours, so PNG is both small and exact - a JPEG would ring along
    // every coastline.
    const url = cv.toDataURL('image/png');
    globeTexCache.set(theme, url);
    return url;
  }

  // The MMI contours are open lines, not rings, so on the globe they go to
  // pathsData rather than the hex sampling the zone layers use. The epicentre
  // rides ringsData because pointsData is already the sites.
  const quakePaths = () => (state.layers.quake && openEvent
    ? openEvent.contours.flatMap(c => c.segments.map(seg => ({ seg, color: c.color, value: c.value })))
    : []);

  function refreshGlobe() {
    if (!globe) return;
    try {
      globe.hexPolygonsData(globeHexes());
      globe.pathsData(quakePaths());
      globe.pointsData([]);   // force pointRadius to re-evaluate against the filter
      drawDots();
      styleGlobe();
    } catch (err) {
      console.error('[globe] refresh failed:', err);
    }
  }

  // Point radius is in DEGREES OF ARC, not pixels, so a dot that reads well
  // from orbit covers a whole town from 0.05 altitude - with imagery underneath
  // that means the marker hides the building it marks. Scaling the radius with
  // altitude holds the dot at roughly a constant SCREEN size instead, and the
  // floor keeps it visible when the camera is right down on a roof.
  //
  // globeAlt is fed by onZoom below; before the first camera event it is the
  // starting altitude, so the very first render is sized correctly too.
  // Declared at the top of the IIFE with the other shared state - styleGlobe()
  // reads it and is defined above this point.

  // Radius is in DEGREES OF ARC - a distance on the GROUND, not on screen.
  // The camera makes the conversion: measured against this globe, one degree
  // of arc covers about 12.5 / altitude pixels, so a dot's screen size is
  //
  //     px = 2 * radius / altitude * 12.5
  //
  // WATCH THE UNITS. An earlier version floored the radius at 0.012 "to keep
  // the dot visible". That is 1.3 km. Every dot clamped to a 2.7 km blob that
  // swallowed the town it was marking. A floor expressed in degrees is a floor
  // expressed in kilometres.
  //
  // WHY A POWER LAW, NOT A PROPORTION
  // radius proportional to altitude is the obvious answer, and it is wrong: it
  // cancels the altitude term above exactly, pinning every dot at one screen
  // size forever. Tuned for the world view that is ~1 px, which reads as a fine
  // speckle across 6,249 sites but leaves a single region looking empty; tuned
  // for a region it is a lid over every building on the globe. There is no
  // constant that is right at both ends.
  //
  // An exponent below 1 lets the dot grow slowly on screen as you descend while
  // still shrinking on the ground - which is the actual requirement. You cannot
  // tell which dot is which building until the dot is smaller than the building:
  //
  //     altitude   view      ground diameter   on screen
  //     2.5        world     20 km             ~1 px    speckle
  //     0.15       1,700 km  3.0 km            ~2 px
  //     0.033      375 km    1.1 km            ~4 px
  //     0.008      91 km     400 m             ~6 px    campus-sized
  //     0.002      23 km     156 m             ~9 px    one hall
  //     0.0005     5.7 km    62 m              ~14 px   sits ON the building
  //
  // 0.68 is where the ground size crosses building scale at roughly the zoom
  // where buildings become legible in the imagery.
  const GLOBE_REF_ALT = 2.5;        // the default world view, where base is tuned
  const GLOBE_SIZE_EXP = 0.68;
  function pointRadius(d) {
    const base = d.ft === 'ai' ? 0.18 : 0.09;
    // Sparse filtered sets still get bigger dots - a lone site on a globe has
    // to be findable at all.
    const spread = state.filter ? Math.min(7, Math.max(2, 700 / state.filter.count)) : 1;
    // Guard the base of the power: altitude 0 would collapse every dot to
    // nothing rather than to something small.
    const alt = Math.max(1e-5, globeAlt) / GLOBE_REF_ALT;
    return base * spread * Math.pow(alt, GLOBE_SIZE_EXP);
  }

  // three-globe points are extruded CYLINDERS, not decals, and pointAltitude
  // is how far they stand off the surface measured in globe RADII. It cannot
  // be made small: three-globe floors the height at 0.1 scene units to keep
  // the transform matrix invertible, and 0.1 of a 100-unit globe is 0.001
  // radii - 6.4 km. From orbit that is a third of a pixel. From four
  // kilometres up it is a tower, and any dot away from the view centre is
  // drawn as a streak lying across the imagery rather than a disc on a roof.
  //
  // So below CLOSE_ALT the dots in view are handed to DOM markers instead
  // (see closeSites) - which always face the camera and sit exactly on their
  // coordinate - and pointAltitude only has to serve the far view.
  function pointAltitude() {
    return Math.max(2e-6, Math.min(0.002, globeAlt * 0.0008));
  }

  // How close the camera may come, as an altitude in globe radii.
  //
  // It used to stop at 5.5e-4 - a 6.3 km view - with the tile engine capped at
  // level 17. That cap was INERT, and it is worth knowing why before touching
  // any of this. three-slippy-map-globe picks the level from altitude alone:
  //
  //     level = smallest i where 8 / 2^i <= altitude
  //
  // Level 17 needs altitude <= 6.1e-5. The camera could not get below 5.5e-4,
  // which selects level 14 - 6.5 m/px, slightly COARSER than the 4.9 m/px that
  // closest view could display. So the imagery was mildly under-resolved and
  // the 17 cap never clamped anything; raising it alone would have done
  // nothing whatsoever.
  //
  // The actual limit was the NEAR PLANE. globe.gl fixes camera.near at 0.05
  // scene units - 3.2 km on a 100-unit globe - and the camera sat 3.5 km off
  // the surface. Three hundred metres of clearance before the planet gets
  // sliced open by its own clipping plane. Pull the near plane in with the
  // camera and the floor moves with it.
  //
  // 3e-5 is a ~340 m view at 0.27 m/px, and selects level 19 at 0.2 m/px.
  // Going closer would only magnify the same pixels.
  const MIN_ALT = 3e-5;

  // three.js clips anything nearer than camera.near. Only ever pulled IN from
  // globe.gl's 0.05, never pushed out, so the depth range at planetary zoom -
  // where a huge near/far ratio would cost precision - is what it always was.
  function setCameraNear(alt) {
    const cam = globe.camera();
    if (!cam) return;
    const near = Math.min(0.05, Math.max(2e-4, alt * globe.getGlobeRadius() * 0.25));
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
  }

  // Below this the WebGL dots are streaks, so the ones in view become DOM
  // markers. ~115 km of view, well before a building is legible.
  const CLOSE_ALT = 0.015;
  // DOM markers, not GPU instances, so this is bounded - but the bound has to
  // clear the densest metro in the registry or the overflow keeps its WebGL
  // pin and you get rings and streaks side by side in one view. Measured at
  // CLOSE_ALT: Ashburn 124, London 193, Amsterdam 110, Frankfurt 70. 400 is
  // twice the worst case, and the count falls off as the square of altitude,
  // so it can only ever bind at the very top of the close range.
  const CLOSE_CAP = 400;

  // Half the viewport in DEGREES OF ARC. Falls out of the same 12.5/altitude
  // relation as pointRadius, and the viewport width cancels, so this is just
  // the camera: half-view = 51.2 * altitude.
  const halfViewDeg = () => 51.2 * globeAlt;

  // Screen pixels per degree of arc, measured off the live camera rather than
  // assumed, so DOM markers come out exactly the size the WebGL dot would have
  // been and the handover at CLOSE_ALT is invisible.
  function pxPerArcDeg() {
    const p = globe.pointOfView();
    const a = globe.getScreenCoords(p.lat, p.lng - 0.01);
    const b = globe.getScreenCoords(p.lat, p.lng + 0.01);
    if (!a || !b) return null;
    return (Math.hypot(b.x - a.x, b.y - a.y) / 0.02) / Math.cos(p.lat * Math.PI / 180);
  }

  // Wrappers are memoised by site id so that panning does not hand globe.gl a
  // fresh object for a marker that has not moved - it keys on identity and
  // would rebuild the element every frame.
  const closeWrap = new Map();

  // The sites close enough to the camera to be worth a DOM marker. 1.3x the
  // half-view because the corners of a rectangular viewport reach further than
  // its half-width, and a marker should not pop in at the edge of the frame.
  function closeSites() {
    if (globeAlt >= CLOSE_ALT) return [];
    const p = globe.pointOfView();
    const reach = halfViewDeg() * 1.3;
    const cosLat = Math.cos(p.lat * Math.PI / 180);
    const near = [];
    for (const d of shown()) {
      const dy = d.lat - p.lat;
      if (Math.abs(dy) > reach) continue;
      let dx = d.lon - p.lng;
      if (dx > 180) dx -= 360; else if (dx < -180) dx += 360;
      dx *= cosLat;
      const r2 = dx * dx + dy * dy;
      if (r2 <= reach * reach) near.push([r2, d]);
    }
    // Nearest to the view centre first, so a cap trims the far edge and never
    // the site the camera is actually pointed at.
    near.sort((a, b) => a[0] - b[0]);
    // Never truncate silently: an overflowing view still draws the rest, but
    // as WebGL pins, and knowing that is the difference between "this metro is
    // denser than the cap" and "the map is broken".
    if (near.length > CLOSE_CAP) {
      console.warn(`[globe] ${near.length} sites in view, capping close markers at ` +
        `${CLOSE_CAP} — the rest stay as WebGL dots`);
    }
    return near.slice(0, CLOSE_CAP).map(([, d]) => {
      let w = closeWrap.get(d.id);
      if (!w) closeWrap.set(d.id, w = { lat: d.lat, lng: d.lon, site: d });
      return w;
    });
  }

  function closeMarker(d) {
    const el = document.createElement('div');
    el.className = 'dc-marker' + (d.site.ft === 'ai' ? ' dc-ai' : '')
      // Hollow still means something, just not "you are zoomed in": it means
      // the coordinate is a town centroid, not a located building. Same
      // convention the 2D dots use, so a ring reads the same in both.
      + (d.site.gp === 'town' ? ' dc-town' : '');
    const ppd = pxPerArcDeg();
    const px = ppd ? Math.max(8, 2 * pointRadius(d.site) * ppd) : 10;
    el.style.width = el.style.height = `${px.toFixed(1)}px`;
    el.title = [d.site.n || d.site.o || 'Data centre', d.site.ci || d.site.c]
      .filter(Boolean).join(' — ');
    el.addEventListener('click', () => openSite(d.site.id));
    return el;
  }

  // The two dot layers are one decision, so they are set in one place: a site
  // promoted to a DOM marker must come OUT of pointsData, or its 6.4 km pin
  // goes on smearing underneath the marker that replaced it.
  //
  // The epicentre markers share htmlElementsData - globe.gl has only the one
  // slot - so the two kinds travel together and are told apart by `.site`.
  let closeKey = '';
  let closeAt = { lat: 0, lng: 0 };   // camera centre at the last close-set check
  function drawDots(close) {
    if (!globe) return;
    close = close || closeSites();
    closeKey = close.map(w => w.site.id).join(',');
    const promoted = new Set(close.map(w => w.site.id));
    globe.pointsData(promoted.size ? shown().filter(d => !promoted.has(d.id)) : shown());
    globe.htmlElementsData([
      ...(state.layers.quake ? quakes.map(q => ({ lat: q.lat, lng: q.lon, q })) : []),
      ...close,
    ]);
  }

  // Solid at every altitude. These used to fade towards transparent as the
  // camera came down, so you could read the roof through the marker - which
  // was worth it back when the marker was kilometres wide and covered the
  // building. It is not any more: the dot is sized to the building and, below
  // CLOSE_ALT, is a DOM marker anyway. All the fade did was make the dot hard
  // to find over bright imagery, which is the opposite of a marker's job.
  const pointColour = (d) => (d.ft === 'ai' ? pal().ai3d : pal().fac3d);

  function initGlobe() {
    globe = new Globe(el3d, { animateIn: false });
    window.__globe = globe; // test hook
    globe.controls().minDistance = globe.getGlobeRadius() * (1 + MIN_ALT);
    globe.width(el3d.clientWidth).height(el3d.clientHeight)
      .showAtmosphere(true)
      .atmosphereAltitude(0.25)
      .hexPolygonGeoJsonGeometry(d => d.geometry)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.15)
      .hexPolygonAltitude(0.006)
      .hexPolygonLabel(d => {
        if (d.kind === 'ercot') return zoneTips.ercot(d.z);
        if (d.kind === 'pjm') return zoneTips.pjm(d.z);
        if (d.kind === 'nyiso') return zoneTips.nyiso(d.z);
        return zoneTips.cty(d.z);
      })
      .pathPoints(d => d.seg)
      .pathPointLat(pt => pt[1])
      .pathPointLng(pt => pt[0])
      .pathColor(d => d.color)
      .pathStroke(1.2)
      .pathPointAlt(0.007)          // clear of the hex fills and the dots
      .pathTransitionDuration(0)
      .pathLabel(d => `<div class="t">MMI ${d.value}</div>` +
        `<div class="d">${esc(MMI_MEANS[Math.floor(d.value)] || '')}</div>` +
        `<div class="d">${esc(openEvent ? openEvent.title : '')}</div>`)
      // A pulsing ring was decoration drawn in the same visual language as
      // the contours - perfect circles that read as MMI bands carrying no
      // data. The epicentre is now the same static marker 2D uses.
      .htmlLat(d => d.lat).htmlLng(d => d.lng)
      // 0.009 is 57 km. Fine for an epicentre seen from orbit, absurd for a
      // marker on a roof, which wants to be exactly where its coordinate is.
      .htmlAltitude(d => (d.site ? 0 : 0.009))
      .htmlElement(d => {
        if (d.site) return closeMarker(d);
        const el = document.createElement('div');
        el.className = 'epi-marker' + (d.q.exposed ? ' epi-hit' : '');
        // Same log scaling as 2D, so an M7 reads as an M7 in both renderers.
        const r = Math.round(4 + Math.pow(1.9, d.q.mag - 5) * 2);
        el.style.width = el.style.height = `${Math.min(r, 22)}px`;
        el.title = `M${d.q.mag} — ${d.q.place}`
          + (d.q.exposed ? ` · ${d.q.exposed} sites shaken, max MMI ${d.q.maxMmi}` : '');
        if (d.q.detail) {
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            fetch(`/data/quake/${encodeURIComponent(d.q.id)}`)
              .then(r => r.json())
              .then(det => { openEvent = det; renderEq(det); eqPanel.hidden = false; refreshGlobe(); })
              .catch(err => console.warn('[quake] detail load failed:', err));
          });
        }
        return el;
      })
      .pointLat(d => d.lat).pointLng(d => d.lon)
      .pointAltitude(pointAltitude)
      .pointRadius(pointRadius)
      .pointLabel(d => siteTip(d))
      .onPointClick(d => openSite(d.id));
    // Re-size and re-shade the dots as the camera moves. Both read globeAlt,
    // so the values have to be pushed back through globe.gl to take effect.
    //
    // NOT onZoom. globe.gl raises onZoom from the orbit controls, which only
    // hear about gestures the USER makes - pointOfView() moves the camera in
    // silence. setMode('3d') calls it on every 2D -> 3D switch, so arriving on
    // the globe already zoomed into a city left globeAlt at the world-view 2.5
    // and every dot drawn a thousand times too wide: the whole town under one
    // disc. Reading the camera each frame cannot miss a move, whoever made it.
    (function watchCamera() {
      if (!el3d.hidden) {
        const alt = globe.pointOfView().altitude;
        // Only when it actually matters: this runs every frame, and
        // re-evaluating 6,249 points per frame is not free.
        if (Math.abs(Math.log((alt || 1) / (globeAlt || 1))) > 0.04) {
          globeAlt = alt;
          // Colour is no longer altitude-dependent, so it stays where
          // styleGlobe() put it; only size and stand-off follow the camera.
          globe.pointRadius(pointRadius).pointAltitude(pointAltitude);
          setCameraNear(alt);
          drawDots();
        } else if (globeAlt < CLOSE_ALT) {
          // Panning at a fixed altitude changes which sites are in view but
          // not the zoom, so the altitude test above never fires.
          //
          // Gated on the camera having actually travelled, because the test
          // itself is not free: closeSites() walks every site, and doing that
          // 60 times a second to discover nothing moved is the kind of cost
          // that only shows up on someone else's laptop. A tenth of the view
          // is far below the distance that changes which sites are in frame.
          const pov = globe.pointOfView();
          const step = halfViewDeg() * 0.1;
          if (Math.abs(pov.lat - closeAt.lat) > step ||
              Math.abs(pov.lng - closeAt.lng) * Math.cos(pov.lat * Math.PI / 180) > step) {
            closeAt = { lat: pov.lat, lng: pov.lng };
            const close = closeSites();
            if (close.map(w => w.site.id).join(',') !== closeKey) drawDots(close);
          }
        }
      }
      requestAnimationFrame(watchCamera);
    })();
    refreshGlobe();
    window.addEventListener('resize', () =>
      globe.width(el3d.clientWidth).height(el3d.clientHeight));
    // Carry whatever basemap 2D is showing onto the globe the moment it exists.
    applyGlobeBasemap();
  }

  // ---- mode + theme + layer wiring -------------------------------------------
  const btn2d = document.getElementById('mode2d');
  const btn3d = document.getElementById('mode3d');
  // A theme change never touches geometry, sources or layer structure - only
  // colours. setStyle was the wrong instrument for that at every setting:
  // diff:false tore down and re-tiled all five GeoJSON sources (30+ s blank),
  // and diffing still wedges permanently if it runs while #map2d is
  // display:none, which is exactly what happens when the theme is toggled
  // from 3D. Setting the paint properties directly has neither failure mode
  // and works whether the container is visible or not.
  const THEME_PAINT = [
    ['bg', 'background-color', c => c.ocean],
    ['land', 'fill-color', c => c.land],
    ['land-line', 'line-color', c => c.border],
    ['cty', 'fill-color', c => c.cty],
    ['ercot', 'fill-color', c => c.ercot],
    ['ercot-line', 'line-color', c => c.ercot],
    ['pjm', 'fill-color', c => c.pjm],
    ['pjm-line', 'line-color', c => c.pjm],
    ['nyiso', 'fill-color', c => c.nyiso],
    ['nyiso-line', 'line-color', c => c.nyiso],
    // The site dots are deliberately NOT listed here - see below.
  ];
  function applyTheme() {
    const c = pal();
    for (const [layer, prop, val] of THEME_PAINT) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, val(c));
    }
    // Dots carry zoom-dependent expressions, so re-apply the WHOLE paint from
    // the one function that defines it. Listing individual properties here is
    // how a theme toggle would quietly reset the stroke to a flat colour and
    // stop the dots ever going hollow again - the failure would show up one
    // interaction after the change that caused it.
    for (const [id, colour, base] of [['sites', c.fac, 3.2], ['sites-ai', c.ai, 5]]) {
      if (!map.getLayer(id)) continue;
      for (const [prop, val] of Object.entries(dotPaint(colour, c.halo, base))) {
        map.setPaintProperty(id, prop, val);
      }
    }
  }

  function setMode(mode) {
    state.mode = mode;
    btn2d.setAttribute('aria-selected', String(mode === '2d'));
    btn3d.setAttribute('aria-selected', String(mode === '3d'));
    document.getElementById('map2d').hidden = mode !== '2d';
    el3d.hidden = mode !== '3d';
    hideTip();
    if (mode === '3d') {
      if (!globe) initGlobe();
      globe.width(el3d.clientWidth).height(el3d.clientHeight);
      const cc = map.getCenter();
      globe.pointOfView({ lat: cc.lat, lng: cc.lng,
        altitude: Math.min(3, Math.max(0.15, 2.5 * Math.pow(2, -map.getZoom() + 1))) }, 400);
    } else if (globe) {
      const pov = globe.pointOfView();
      map.jumpTo({ center: [pov.lng, pov.lat],
        zoom: Math.min(14, Math.max(0.8, 1 + Math.log2(2.5 / Math.max(0.05, pov.altitude)))) });
      // MapLibre stops painting while its container is hidden, and resize()
      // is a no-op when the dimensions have not changed - so coming back from
      // 3D left the canvas holding whatever it had before, i.e. blank. Ask
      // for a frame explicitly.
      map.resize();
      map.triggerRepaint();
    }
  }
  btn2d.addEventListener('click', () => setMode('2d'));
  btn3d.addEventListener('click', () => setMode('3d'));

  for (const key of Object.keys(state.layers)) {
    document.getElementById(`lyr-${key}`).addEventListener('change', (e) => {
      state.layers[key] = e.target.checked;
      if (key === 'quake') {
        if (state.time) syncScaleUI();
        if (!e.target.checked) {
          eqPanel.hidden = true;
          openEvent = null;
          map.getSource('quake').setData({ type: 'FeatureCollection', features: [] });
        }
        if (!e.target.checked && eqOnly.getAttribute('aria-pressed') === 'true') {
          eqOnly.setAttribute('aria-pressed', 'false');
          shakenIds = null;
          setFilter(null);
        }
      }
      refreshView();
    });
  }

  // Restyling while #map2d is display:none wedges MapLibre permanently: it
  // pauses rendering, the style load never completes, and the sources are
  // gone for good - isStyleLoaded stays false and getSource('sites') returns
  // nothing even after the element is shown again. So while 3D is up, only
  // record that a restyle is owed and apply it on the way back.
  window.addEventListener('dcmap-theme', () => {
    // Let MapLibre DIFF the two styles. A theme change is only paint colours,
    // so diffing resolves to a handful of setPaintProperty calls. diff:false
    // tore down and re-tiled all five GeoJSON sources - 13k tiled features for
    // the dots alone - which left the map completely blank for 30+ seconds and
    // read as "the dots are gone". The clean rebuild was a workaround for the
    // old 'styledata' bug, and that was fixed properly by moving to
    // 'style.load', so it is no longer buying anything.
    applyTheme();
    if (globe) styleGlobe();
  });

  // ---- search ----------------------------------------------------------------
  // One flat index over everything the app knows: individual sites, plus the
  // facets you would otherwise have to eyeball off the map (every operator,
  // utility and country), plus the zones from the layer configs. Selecting a
  // site flies to it; selecting a facet filters the dots to it; selecting a
  // zone switches that layer on and frames it.
  //
  // 6,262 sites is small enough to rank with a linear scan per keystroke
  // (~2 ms), so there is no prefix tree to keep in sync with the data.
  // The basemap is 110m Natural Earth: past ~z9 it has no detail left to draw,
  // so a site lands on a blank field. Stop where the coast and the neighbouring
  // sites are still visible.
  const SITE_ZOOM = 9;
  const norm = (v) => String(v ?? '').toLowerCase();

  const index = [];
  for (const s of sites) {
    index.push({
      kind: s.ft === 'ai' ? 'ai' : 'site', site: s,
      label: s.n || s.en || s.o || s.ref || s.id,
      sub: [s.o, [s.ci, s.c].filter(Boolean).join(', '), s.u].filter(Boolean).join(' · '),
      num: s.mw ? s.mw.toLocaleString() + ' MW' : '',
      hay: norm([s.n, s.en, s.o, s.ci, s.c, s.u, s.ref, s.id, s.t].join(' ')),
    });
  }
  // Sites carry ISO codes, not names, so "japan" would find nothing without
  // the country layer's names - which is where the readable label lives.
  const ccName = new Map(countries.map(z => [z.cc, z.name]));
  const facet = (key, kind, label = (v) => v) => {
    const tally = new Map();
    for (const s of sites) {
      const v = s[key];
      if (v) tally.set(v, (tally.get(v) || 0) + 1);
    }
    for (const [value, n] of tally) {
      index.push({ kind, key, value, label: label(value),
        sub: `${n.toLocaleString()} site${n === 1 ? '' : 's'} — filter the map`,
        num: '', hay: norm(`${value} ${label(value)}`) });
    }
  };
  // The review queue needs to be reachable, not just recorded.
  const unver = sites.filter(s => s.rv);
  if (unver.length) {
    index.push({ kind: 'operator', key: 'rv', value: 'no_interconnection',
      label: 'Unverified listings',
      sub: `${unver.length.toLocaleString()} sites — PeeringDB rows with no networks, IXs or carriers`,
      num: '', hay: 'unverified needs review no interconnection peeringdb suspect' });
  }

  facet('o', 'operator');
  facet('u', 'utility');
  facet('c', 'country', (cc) => ccName.get(cc) || cc);

  const ringsBounds = (rings) => {
    let w = 180, s2 = 90, e = -180, n = -90;
    for (const ring of rings) for (const [x, y] of ring) {
      if (x < w) w = x; if (x > e) e = x;
      if (y < s2) s2 = y; if (y > n) n = y;
    }
    return [[w, s2], [e, n]];
  };
  for (const [zones, kind, layer] of [[ercot, 'ercot', 'ercot'], [pjm, 'pjm', 'pjm'],
                                      [nyiso, 'nyiso', 'nyiso']]) {
    for (const z of zones) {
      index.push({ kind, zone: z, layer, bounds: ringsBounds(z.rings),
        label: z.name,
        sub: kind === 'ercot' ? `ERCOT load zone · ${z.sites} sites`
           : kind === 'nyiso' ? `NYISO load zone · ${z.sites} sites`
                              : `PJM zone · ${z.utility || ''}`.trim(),
        num: kind === 'ercot' ? `${(z.mwCurrent || 0).toLocaleString()} MW`
           : kind === 'nyiso' ? `${z.sites} sites`
                              : `${(z.mw2026 || 0).toLocaleString()} MW`,
        hay: norm([z.name, z.utility, kind].join(' ')) });
    }
  }

  function rank(q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const it of index) {
      if (!tokens.every(t => it.hay.includes(t))) continue;
      const l = norm(it.label);
      let sc;
      if (l === q) sc = 1000;
      else if (l.startsWith(q)) sc = 800 - l.length;
      else if (l.includes(' ' + q)) sc = 620 - l.length;
      else if (l.includes(q)) sc = 440 - l.length;
      else sc = 200 - l.length;
      // Facets and zones stand for many sites, so they lead on equal footing.
      if (it.key || it.zone) sc += 40;
      out.push([sc, it]);
    }
    out.sort((a, b) => b[0] - a[0]);
    return out.slice(0, 50).map(x => x[1]);
  }

  const dlg = document.getElementById('palette');
  const qIn = document.getElementById('palq');
  const resEl = document.getElementById('palres');
  let hits = [], cursor = 0;

  const KIND_LABEL = { site: 'site', ai: 'AI site', operator: 'operator',
    utility: 'utility', country: 'country', ercot: 'ERCOT', pjm: 'PJM',
    nyiso: 'NYISO' };

  function highlight(label, q) {
    const i = q ? norm(label).indexOf(q) : -1;
    if (i < 0) return esc(label);
    return esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + q.length)) +
      '</mark>' + esc(label.slice(i + q.length));
  }

  function draw(q) {
    if (!hits.length) {
      resEl.innerHTML = `<li class="pal-empty">${q ? 'No match for “' + esc(q) + '”'
        : 'Type to search ' + sites.length.toLocaleString() + ' sites, their operators, utilities and zones.'}</li>`;
      return;
    }
    resEl.innerHTML = hits.map((it, i) => {
      const nogeo = it.site && it.site.lat == null;
      return `<li class="pal-row" role="option" data-i="${i}" aria-selected="${i === cursor}">` +
        `<span class="pal-kind k-${it.kind}">${KIND_LABEL[it.kind]}</span>` +
        `<span class="pal-label">${highlight(it.label, q)}</span>` +
        `<span class="pal-sub">${esc(it.sub)}${nogeo ? ' · no coordinates' : ''}</span>` +
        `<span class="pal-num">${esc(it.num)}</span></li>`;
    }).join('');
  }

  function move(delta) {
    if (!hits.length) return;
    cursor = (cursor + delta + hits.length) % hits.length;
    for (const el of resEl.children) el.setAttribute('aria-selected', String(+el.dataset.i === cursor));
    resEl.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }

  const chip = document.getElementById('chip');
  function setFilter(f) {
    state.filter = f;
    chip.hidden = !f;
    if (f) {
      chip.innerHTML = `<b>${esc(f.label)}</b> <span>${f.count.toLocaleString()} sites` +
        (f.unmapped ? ` · ${f.unmapped} without coordinates` : '') + '</span>';
    }
    refreshView();
  }
  chip.addEventListener('click', () => setFilter(null));

  function frame(bounds, pad) {
    const [[w, s2], [e, n]] = bounds;
    if (state.mode === '2d') {
      map.fitBounds([[w, s2], [e, n]], { padding: pad, duration: 900, maxZoom: 11 });
    } else {
      const span = Math.max(e - w, n - s2, 1);
      globe.pointOfView({ lat: (s2 + n) / 2, lng: (w + e) / 2,
        altitude: Math.min(2.5, Math.max(0.25, span / 45)) }, 900);
    }
  }

  // Flying to a site whose layer is switched off lands you on empty map. The
  // search palette has always turned the layer back on first; the operator
  // directory did not, so picking a site out of an operator's list flew you to
  // a dot that was not being drawn - and the popup that arrived with it said
  // "click to open site page". Same rule for every path in, stated once.
  function ensureLayerFor(site) {
    const cb = document.getElementById(`lyr-${site.ft === 'ai' ? 'ai' : 'facilities'}`);
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
  }

  function goTo(lon, lat, site) {
    if (state.mode === '2d') {
      map.flyTo({ center: [lon, lat], zoom: SITE_ZOOM, duration: 1100 });
      new maplibregl.Popup({ closeOnClick: true, offset: 10 })
        .setLngLat([lon, lat]).setHTML(sitePopup(site)).addTo(map);
    } else {
      globe.pointOfView({ lat, lng: lon, altitude: 0.32 }, 1100);
    }
  }

  function choose(it, openPage) {
    dlg.close();
    if (it.site) {
      // An un-geocoded site cannot be flown to, so its page is the only
      // meaningful destination - go straight there rather than doing nothing.
      if (openPage || it.site.lat == null) return openSite(it.site.id);
      if (state.time) setTimelineOpen(false);   // the dot must exist to fly to it
      ensureLayerFor(it.site);
      return goTo(it.site.lon, it.site.lat, it.site);
    }
    if (it.zone) {
      const cb = document.getElementById(`lyr-${it.layer}`);
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      return frame(it.bounds, 60);
    }
    // The chip must agree with the number the palette just showed, which
    // counts every site - so report the total and say plainly how many of
    // them the map cannot draw, rather than quietly showing a smaller figure.
    const all = sites.filter(d => d[it.key] === it.value);
    const pts = drawable.filter(d => d[it.key] === it.value);
    setFilter({ key: it.key, value: it.value, label: it.label,
      count: all.length, unmapped: all.length - pts.length });
    if (pts.length) frameSites(pts);
  }

  // A bounding box is the wrong frame for a globe: Digital Realty's box spans
  // the planet, and its centre is in the Atlantic off Africa - a view with
  // none of its sites in it. Average the points as unit vectors instead. The
  // resultant length falls from 1 (tight cluster) toward 0 (spread worldwide),
  // which is exactly the altitude signal we want, and it crosses the
  // antimeridian without the special case a min/max box would need.
  function frameSites(pts) {
    if (state.mode === '2d') {
      const lons = pts.map(d => d.lon), lats = pts.map(d => d.lat);
      return frame([[Math.min(...lons), Math.min(...lats)],
                    [Math.max(...lons), Math.max(...lats)]], 90);
    }
    let x = 0, y = 0, z = 0;
    for (const d of pts) {
      const la = d.lat * Math.PI / 180, lo = d.lon * Math.PI / 180;
      x += Math.cos(la) * Math.cos(lo);
      y += Math.cos(la) * Math.sin(lo);
      z += Math.sin(la);
    }
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;          // mean direction, as a unit vector
    // Widest angle any site sits from that direction: the half-angle of the
    // cone containing the whole set. A camera at altitude a (globe radii above
    // the surface) sees a half-angle of acos(1/(1+a)), so invert that for the
    // altitude which just fits the cone, with a fifth again for margin.
    let widest = 0;
    for (const d of pts) {
      const la = d.lat * Math.PI / 180, lo = d.lon * Math.PI / 180;
      const dot = Math.cos(la) * Math.cos(lo) * x + Math.cos(la) * Math.sin(lo) * y +
        Math.sin(la) * z;
      widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, dot))));
    }
    const theta = Math.min(1.45, widest * 1.2 + 0.04);
    globe.pointOfView({
      lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI,
      lng: Math.atan2(y, x) * 180 / Math.PI,
      altitude: Math.min(3.2, Math.max(0.25, 1 / Math.cos(theta) - 1)),
    }, 900);
  }

  function search() {
    const q = norm(qIn.value.trim());
    hits = q ? rank(q) : [];
    cursor = 0;
    draw(q);
  }

  qIn.addEventListener('input', search);
  qIn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && hits[cursor]) {
      e.preventDefault();
      choose(hits[cursor], e.metaKey || e.ctrlKey);
    }
    // <dialog> closes itself on Escape, but only for real user keystrokes -
    // close explicitly so the documented shortcut always holds.
    else if (e.key === 'Escape') dlg.close();
  });
  resEl.addEventListener('click', (e) => {
    const row = e.target.closest('.pal-row');
    if (row) choose(hits[+row.dataset.i], e.metaKey || e.ctrlKey);
  });
  // A click on the backdrop lands on the dialog element itself.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  function openPalette() {
    hideTip();
    qIn.value = '';
    search();
    dlg.showModal();
    qIn.focus();
  }
  document.getElementById('searchBtn').addEventListener('click', openPalette);
  // Site pages link here with ?search=1 to hand the query straight over.
  if (new URLSearchParams(location.search).has('search')) openPalette();
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !dlg.open)) {
      e.preventDefault();
      openPalette();
    }
  });
  window.__search = { rank, choose, setFilter, open: openPalette }; // test hook

  // ---- build-out timeline ----------------------------------------------------
  // The clock button opens a quarter slider (Q1 2019 - Q1 2030). Two modes:
  // cumulative ("built by then") and per-year ("built that year"). Only dated
  // sites can play - every AI site carries its first Epoch observation, but
  // just the ~200 traditional facilities whose OSM element has a build tag -
  // so the bar says what is hidden rather than pretending completeness.
  const timebar = document.getElementById('timebar');
  const timeBtn = document.getElementById('timeBtn');
  const tslider = document.getElementById('tslider');
  const tlabel = document.getElementById('tq-label');
  const tcount = document.getElementById('tq-count');
  const tplay = document.getElementById('tplay');
  const tchartEl = document.getElementById('tchart');
  const tchartBtn = document.getElementById('tchartBtn');
  const tchartRows = document.getElementById('tchart-rows');
  const seriesById = new Map(timeline.sites.map(t => [t.id, t]));
  const datedTotal = drawable.filter(x => x.by != null).length;
  let playTimer = null;

  tslider.max = String(timeline.quarters.length - 1);
  // Open at the last quarter that has already begun.
  const now = new Date();
  const nowT = now.getFullYear() + Math.floor(now.getMonth() / 3) * 0.25;
  const defaultQ = Math.max(0, timeline.quarters.findLastIndex(q => q <= nowT));

  const qLabel = (q) => {
    const list = stops();
    const t = list[Math.min(q, list.length - 1)];
    if (state.time && state.time.scale === 'day') {
      const y = Math.floor(t);
      const d = new Date(Date.UTC(y, 0, 1) + (t - y) * 365.25 * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return `Q${Math.round((t % 1) * 4) + 1} ${Math.floor(t)}`;
  };
  const fmtCompute = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
    : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(v);

  function renderChart() {
    if (tchartEl.hidden || !state.time) return;
    const q = state.time.q;
    const ranked = timeline.sites
      .map(t => ({ ...t, v: t.series[q], site: sites.find(x => x.id === t.id) }))
      .filter(t => t.v > 0 && t.site && inTime(t.site) &&
        (!state.filter || t.site[state.filter.key] === state.filter.value))
      .sort((a, b) => b.v - a.v)
      .slice(0, 15);
    document.getElementById('tchart-title').textContent =
      `Top ${ranked.length} by compute — ${qLabel(q)}`;
    const max = ranked[0]?.v || 1;
    tchartRows.innerHTML = ranked.map((t, i) =>
      `<li class="tchart-row" data-id="${esc(t.id)}" title="Open site page">` +
      `<span class="tcr-top"><span class="tcr-name">${esc(t.n)}</span>` +
      `<span class="tcr-val">${fmtCompute(t.v)} H100e</span></span>` +
      `<span class="tcr-bar" style="width:${(t.v / max * 100).toFixed(1)}%"></span></li>`).join('');
    if (!ranked.length) {
      tchartRows.innerHTML = '<li class="hint">No AI site has compute at this quarter under the current filters.</li>';
    }
  }
  tchartRows.addEventListener('click', (e) => {
    const row = e.target.closest('.tchart-row');
    if (row) openSite(row.dataset.id);
  });

  function updateTimeline() {
    if (!state.time) return;
    if (state.time.view === 'line') { applyVisibility(); refreshGlobe(); return; }
    tlabel.textContent = qLabel(state.time.q);
    tslider.setAttribute('aria-valuetext', qLabel(state.time.q));
    const visible = shown().length;
    const csTotal = drawable.filter(d => d.cs != null).length;
    tcount.textContent = state.time.mode === 'uc'
      ? `${visible.toLocaleString()} under construction · ground broken, capacity still rising — includes live campuses building a further phase. ` +
        `Only the ${csTotal} Epoch-tracked AI sites have a construction-start date, so this counts those alone.`
      : `${visible.toLocaleString()} sites shown` +
        (state.time.mode === 'cum'
          ? ` · includes the ${(drawable.length - datedTotal).toLocaleString()} with no known` +
            ` build date, which are shown rather than assumed absent · `
          : ' · dated by when they became operational · ') +
        `${datedTotal.toLocaleString()} of ${drawable.length.toLocaleString()} have one.` +
        (state.time.mode === 'year' && Math.floor(timeT()) === timeline.quarters[0]
          ? ` ${Math.floor(timeT())} includes everything built earlier.` : '');
    applyVisibility();
    refreshGlobe();
    renderChart();
  }

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; tplay.textContent = '▶'; }
  }

  function setTimelineOpen(on) {
    timebar.hidden = !on;
    timeBtn.setAttribute('aria-pressed', String(on));
    if (on) {
      const selMode = ['cum', 'year', 'uc'].find(m =>
        document.getElementById(`tmode-${m}`).getAttribute('aria-selected') === 'true') || 'cum';
      const selScale = document.getElementById('tres-d').getAttribute('aria-selected') === 'true'
        ? 'day' : 'quarter';
      const lineView = document.getElementById('tview-line').getAttribute('aria-selected') === 'true';
      state.time = { q: +tslider.value, mode: selMode, scale: selScale,
        view: lineView ? 'line' : 'snap' };
      syncScaleUI();
      applyView();
    } else {
      stopPlay();
      state.time = null;
      tchartEl.hidden = true;
      tlineEl.hidden = true;
      hidePop();
      applyVisibility();
      refreshGlobe();
    }
  }
  tslider.value = String(defaultQ);

  // The resolution switch only appears when there is event data to sequence.
  function syncScaleUI() {
    const seg = document.getElementById('tscale-seg');
    seg.hidden = !state.layers.quake || !evDays.length;
    if (seg.hidden && state.time && state.time.scale === 'day') {
      state.time.scale = 'quarter';
      for (const [bid, m] of RES) {
        document.getElementById(bid).setAttribute('aria-selected', String(m === 'quarter'));
      }
    }
    const list = stops();
    tslider.max = String(list.length - 1);
    if (state.time) state.time.q = Math.min(state.time.q, list.length - 1);
    tslider.value = String(state.time ? state.time.q : 0);
  }
  window.__syncScaleUI = syncScaleUI;

  timeBtn.addEventListener('click', () => setTimelineOpen(timebar.hidden));
  document.getElementById('timeClose').addEventListener('click', () => setTimelineOpen(false));

  tslider.addEventListener('input', () => {
    if (!state.time) return;
    state.time.q = +tslider.value;
    updateTimeline();
  });

  const RES = [['tres-q', 'quarter'], ['tres-d', 'day']];
  for (const [id, sc] of RES) {
    document.getElementById(id).addEventListener('click', () => {
      if (!state.time || state.time.scale === sc) return;
      // Keep the instant, not the index: switching resolution should not jump
      // the cursor to a different date.
      const now = timeT();
      state.time.scale = sc;
      const list = stops();
      let best = 0;
      for (let i = 0; i < list.length; i++) if (list[i] <= now) best = i;
      state.time.q = best;
      tslider.max = String(list.length - 1);
      tslider.value = String(best);
      for (const [bid, m] of RES) {
        document.getElementById(bid).setAttribute('aria-selected', String(m === sc));
      }
      updateTimeline();
    });
  }

  const MODES = [['tmode-cum', 'cum'], ['tmode-year', 'year'], ['tmode-uc', 'uc']];
  for (const [id, mode] of MODES) {
    document.getElementById(id).addEventListener('click', () => {
      state.time.mode = mode;
      for (const [bid, m] of MODES) {
        document.getElementById(bid).setAttribute('aria-selected', String(m === mode));
      }
      updateTimeline();
    });
  }

  tchartBtn.addEventListener('click', () => {
    const on = tchartBtn.getAttribute('aria-pressed') !== 'true';
    tchartBtn.setAttribute('aria-pressed', String(on));
    tchartEl.hidden = !on;
    renderChart();
  });

  tplay.addEventListener('click', () => {
    if (playTimer) return stopPlay();
    if (+tslider.value >= timeline.quarters.length - 1) {
      tslider.value = '0';
      state.time.q = 0;
      updateTimeline();   // render the first frame; ticks advance from here
    }
    tplay.textContent = '⏸';
    playTimer = setInterval(() => {
      const q = +tslider.value + 1;
      if (q >= timeline.quarters.length) return stopPlay();
      tslider.value = String(q);
      state.time.q = q;
      updateTimeline();
    }, 500);
  });

  // ---- snapshot <-> timeline view --------------------------------------------
  // Snapshot is the slider; Timeline is the Epoch-style record chart: the
  // compute of whichever AI site is largest, stepped through every dated
  // restatement. In timeline view the map is unfiltered - the chart carries
  // the time axis instead of the dots.
  const tlineEl = document.getElementById('tline');
  const snapEls = ['tmode-seg', 'tq-label', 'tchartBtn', 'trow-play', 'tq-count']
    .map(id => document.getElementById(id));

  function applyView() {
    const line = state.time.view === 'line';
    for (const el of snapEls) el.hidden = line;
    tlineEl.hidden = !line;
    if (line) { stopPlay(); tchartEl.hidden = true; renderTLine(); }
    else {
      hidePop();
      tchartEl.hidden = tchartBtn.getAttribute('aria-pressed') !== 'true';
    }
    document.getElementById('tview-snap').setAttribute('aria-selected', String(!line));
    document.getElementById('tview-line').setAttribute('aria-selected', String(line));
    updateTimeline();
  }
  for (const [id, view] of [['tview-snap', 'snap'], ['tview-line', 'line']]) {
    document.getElementById(id).addEventListener('click', () => {
      if (!state.time || state.time.view === view) return;
      state.time.view = view;
      applyView();
    });
  }

  // The record series: every dated compute restatement, folded into "current
  // maximum across the given sites" events. The line can fall if a leader is
  // restated down; dots mark every change at the top.
  function recordEvents(group) {
    const evs = [];
    for (const t of group) {
      for (const [at, v] of t.obs) evs.push({ at, v, t });
    }
    evs.sort((a, b) => a.at - b.at);
    const val = new Map();
    const out = [];
    for (const e of evs) {
      val.set(e.t.id, e.v);
      let mv = 0, mt = null;
      for (const t of group) {
        const v = val.get(t.id) || 0;
        if (v > mv) { mv = v; mt = t; }
      }
      const last = out[out.length - 1];
      if (mt && (!last || last.v !== mv || last.t.id !== mt.id)) {
        out.push({ at: e.at, v: mv, t: mt });
      }
    }
    return out;
  }

  // "Colour by" splits the single frontier into one frontier per owner or per
  // primary user, Epoch-style. Categorical palette assigned by peak, so the
  // biggest players keep stable, prominent colours; both themes keep contrast.
  let tColor = 'none';
  let tSel = null;   // selected group name; that frontier stays vivid, others dim
  let tScale = 'lin';  // 'lin' | 'log' — compute spans 4 decades, so log matters
  const TL_PALETTE = ['#2E86C1', '#E67E22', '#E74C3C', '#2C4FC4', '#D81B7A',
    '#1E8449', '#7C3AED', '#26C6DA', '#FF7043', '#7DCB4B', '#155E75',
    '#B8860B', '#0D9488', '#8D6E63', '#A78BFA', '#607D8B'];

  function tlGroups() {
    if (tColor === 'none') return [{ name: '', sites: timeline.sites }];
    const by = new Map();
    for (const t of timeline.sites) {
      const key = (tColor === 'o' ? t.o : t.pu) || 'Other';
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(t);
    }
    return [...by.entries()]
      .map(([name, sites]) => ({ name, sites,
        peak: Math.max(...sites.flatMap(t => t.obs.map(o => o[1]))) }))
      .sort((a, b) => b.peak - a.peak)
      .map((g, i) => ({ ...g, color: TL_PALETTE[i % TL_PALETTE.length] }));
  }

  function renderTLine() {
    const groups = tlGroups().map(g => ({ ...g, evs: recordEvents(g.sites) }))
      .filter(g => g.evs.length);
    const evs = groups.flatMap(g => g.evs).sort((a, b) => a.at - b.at);
    if (!evs.length) return;
    const W = 940, H = 380, L = 64, R = 18, T = 14, B = 34;
    const x0 = Math.floor(evs[0].at), x1 = 2030;
    const peak = Math.max(...evs.map(e => e.v));
    const maxV = peak * 1.08;
    // Log axis: floor at 1K like Epoch's, top at the next power of ten. Values
    // at or under the floor pin to the baseline rather than diverging.
    const LOG_FLOOR = 1000;
    const logTop = 10 ** Math.max(Math.ceil(Math.log10(peak)), 4);
    const logSpan = Math.log10(logTop) - Math.log10(LOG_FLOOR);
    const now = nowT;
    const px = (t) => L + (W - L - R) * ((t - x0) / (x1 - x0));
    const py = tScale === 'log'
      ? (v) => T + (H - T - B) *
          (1 - (Math.log10(Math.max(v, LOG_FLOOR)) - Math.log10(LOG_FLOOR)) / logSpan)
      : (v) => T + (H - T - B) * (1 - v / maxV);
    const svg = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Largest AI data centre by compute over time">`];
    svg.push(`<rect class="tl-future" x="${px(now).toFixed(1)}" y="${T}" width="${(px(x1) - px(now)).toFixed(1)}" height="${H - T - B}"/>`);
    svg.push(`<text class="tl-flabel" x="${(px(now) + 10).toFixed(1)}" y="${H - B - 10}">Future plans</text>`);
    // y grid: decades on the log axis, a {1,2,5}·10^k step aiming for ~5 lines
    // on the linear one.
    const ticks = [];
    if (tScale === 'log') {
      for (let v = LOG_FLOOR; v <= logTop; v *= 10) ticks.push(v);
    } else {
      const rawStep = maxV / 5, mag = 10 ** Math.floor(Math.log10(rawStep));
      const step = [1, 2, 5, 10].map(m => m * mag).find(v => v >= rawStep);
      for (let v = 0; v <= maxV; v += step) ticks.push(v);
    }
    for (const v of ticks) {
      svg.push(`<line class="tl-grid" x1="${L}" y1="${py(v).toFixed(1)}" x2="${W - R}" y2="${py(v).toFixed(1)}"/>`);
      svg.push(`<text class="tl-axis" x="${L - 8}" y="${(py(v) + 4).toFixed(1)}" text-anchor="end">${fmtCompute(v)}</text>`);
    }
    for (let y = x0; y <= x1; y++) {
      svg.push(`<line class="tl-grid" x1="${px(y).toFixed(1)}" y1="${T}" x2="${px(y).toFixed(1)}" y2="${H - B}"/>`);
      if ((x1 - x0) <= 14 || y % 2 === 0) {
        svg.push(`<text class="tl-axis" x="${px(y).toFixed(1)}" y="${H - B + 16}" text-anchor="middle">${y}</text>`);
      }
    }
    // step paths, split at "now" so the future segment can dash
    const seg = (list, cls, stroke) => {
      if (list.length < 2) return '';
      let d = `M${list[0][0].toFixed(1)},${list[0][1].toFixed(1)}`;
      for (let i = 1; i < list.length; i++) d += `L${list[i][0].toFixed(1)},${list[i][1].toFixed(1)}`;
      return `<path class="${cls}"${stroke ? ` style="stroke:${stroke}"` : ''} d="${d}"/>`;
    };
    if (tSel && !groups.some(g => g.name === tSel)) tSel = null;
    const ordered = tSel
      ? groups.filter(g => g.name !== tSel).concat(groups.filter(g => g.name === tSel))
      : groups;
    const dotEvents = [];
    for (const g of ordered) {
      const past = [], future = [];
      let prevY = py(0);
      for (const e of g.evs) {
        const xx = px(e.at), yy = py(e.v);
        const target = e.at <= now ? past : future;
        if (e.at > now && past.length && !future.length) {
          past.push([px(now), prevY]);
          future.push([px(now), prevY]);
        }
        target.push([xx, prevY], [xx, yy]);
        prevY = yy;
      }
      (future.length ? future : past).push([px(x1), prevY]);
      const dim = tSel && g.name !== tSel ? ' tl-dim' : '';
      const hot = tSel && g.name === tSel ? ' tl-hot' : '';
      svg.push(seg(past, `tl-path${dim}${hot}`, g.color));
      svg.push(seg(future, `tl-path tl-path-future${dim}${hot}`, g.color));
      for (const e of g.evs) {
        svg.push(`<circle class="tl-dot${dim}" data-i="${dotEvents.length}"` +
          `${g.color ? ` style="fill:${g.color}"` : ''}` +
          ` cx="${px(e.at).toFixed(1)}" cy="${py(e.v).toFixed(1)}" r="${groups.length > 1 ? 3.4 : 4}"/>`);
        dotEvents.push({ ...e, g });
      }
    }
    svg.push('</svg>');
    document.getElementById('tline-chart').innerHTML = svg.join('');

    const legend = document.getElementById('tl-legend');
    legend.hidden = tColor === 'none';
    legend.innerHTML = groups.map(g =>
      `<li data-g="${esc(g.name)}"${g.name === tSel ? ' class="sel"' : ''}>` +
      `<i class="sw" style="background:${g.color}"></i>${esc(g.name)}</li>`).join('');
    legend.onclick = (ev) => {
      const li = ev.target.closest('li[data-g]');
      if (!li) return;
      tSel = tSel === li.dataset.g ? null : li.dataset.g;
      hidePop();
      renderTLine();
    };

    const ccName2 = new Map(countries.map(z => [z.cc, z.name]));
    const holder = document.getElementById('tline-chart');
    holder.onmousemove = (ev) => {
      const dot = ev.target.closest('.tl-dot');
      if (!dot) return hideTip();
      const e = dotEvents[+dot.dataset.i];
      const qtr = `Q${Math.floor((e.at % 1) * 4) + 1} ${Math.floor(e.at)}`;
      showTip(ev.clientX, ev.clientY,
        `<div class="t">${esc(e.t.n)}</div>` +
        `<div class="d">${[e.t.o, ccName2.get(e.t.c) || e.t.c].filter(Boolean).map(esc).join(' · ')}</div>` +
        (e.t.pu ? `<div class="d">primary user: ${esc(e.t.pu)}</div>` : '') +
        `<div class="d">${qtr} · ${fmtCompute(e.v)} H100e</div>` +
        `<div class="d">click to highlight this path</div>`);
    };
    holder.onmouseleave = hideTip;
    holder.onclick = (ev) => {
      const dot = ev.target.closest('.tl-dot');
      if (!dot) {                       // background click clears the story
        if (tSel || !pop.hidden) { tSel = null; hidePop(); renderTLine(); }
        return;
      }
      const e = dotEvents[+dot.dataset.i];
      tSel = e.g.name || null;          // '' in colour-by-none: popup only
      hideTip();
      renderTLine();
      showPop(ev.clientX, ev.clientY, e, ccName2);
    };
  }

  // Pinned popup: stays put so the link is clickable; ✕, background click,
  // colour change or leaving timeline view dismiss it.
  const pop = document.getElementById('tl-pop');
  function hidePop() { pop.hidden = true; }
  function showPop(x, y, e, ccName2) {
    const qtr = `Q${Math.floor((e.at % 1) * 4) + 1} ${Math.floor(e.at)}`;
    pop.innerHTML =
      `<button class="x" aria-label="Close">✕</button>` +
      `<div class="t">${esc(e.t.n)}</div>` +
      `<div class="d">${[e.t.o, ccName2.get(e.t.c) || e.t.c].filter(Boolean).map(esc).join(' · ')}</div>` +
      (e.t.pu ? `<div class="d">primary user: ${esc(e.t.pu)}</div>` : '') +
      `<div class="d">${qtr} · ${fmtCompute(e.v)} H100e</div>` +
      `<a href="/site/${encodeURIComponent(e.t.id)}" target="_blank" rel="noopener">View data centre →</a>`;
    pop.hidden = false;
    const pad = 14;
    pop.style.left = Math.min(x + pad, innerWidth - pop.offsetWidth - pad) + 'px';
    pop.style.top = Math.min(y + pad, innerHeight - pop.offsetHeight - pad) + 'px';
    pop.querySelector('.x').onclick = () => { tSel = null; hidePop(); renderTLine(); };
  }

  for (const [id, sc] of [['tscale-lin', 'lin'], ['tscale-log', 'log']]) {
    document.getElementById(id).addEventListener('click', () => {
      if (tScale === sc) return;
      tScale = sc;
      document.getElementById('tscale-lin').setAttribute('aria-selected', String(sc === 'lin'));
      document.getElementById('tscale-log').setAttribute('aria-selected', String(sc === 'log'));
      hidePop();
      renderTLine();
    });
  }

  for (const [id, mode] of [['tcolor-none', 'none'], ['tcolor-o', 'o'], ['tcolor-pu', 'pu']]) {
    document.getElementById(id).addEventListener('click', () => {
      if (tColor === mode) return;
      tColor = mode;
      tSel = null;
      hidePop();
      for (const [bid, m] of [['tcolor-none', 'none'], ['tcolor-o', 'o'], ['tcolor-pu', 'pu']]) {
        document.getElementById(bid).setAttribute('aria-selected', String(m === mode));
      }
      renderTLine();
    });
  }

  refreshView = () => {
    if (state.time) updateTimeline();       // includes applyVisibility + globe + chart
    else { applyVisibility(); refreshGlobe(); }
  };

  window.__timeline = { open: setTimelineOpen, state, renderChart }; // test hook

  // ---- satellite basemap -----------------------------------------------------
  // The server decides which providers exist, because only it knows whether a
  // Google key is configured. Asking it means the UI never offers an option
  // that would fail on click.
  const bmSeg = document.getElementById('bm-seg');

  // Each provider gets its OWN source and layer, added the first time it is
  // chosen. The first version used one shared source created empty and swapped
  // its URL with setTiles - which silently did nothing: a raster source built
  // with `tiles: []` never initialises, so there was nothing for setTiles to
  // update. serialize() reported the new URL while the source stayed dead and
  // not one tile was ever requested.
  let pendingBasemap = null;

  // The globe takes the SAME imagery, as a tile engine rather than a raster
  // source. three-globe asks for (x, y, level) and wants a URL back, so the
  // provider's {z}/{y}/{x} template is filled in directly. This is what makes
  // 3D zoomable: the drawn texture it falls back to is one 4096x2048 image for
  // the whole planet, which goes soft well before street level. That is the
  // honest division of labour - Satellite is the zoomable basemap, Map is the
  // overview - and it is also why the two must not look alike.
  function applyGlobeBasemap() {
    if (!globe) return;
    const p = providers.find(x => x.id === currentBasemap);
    if (!p) {
      globe.globeTileEngineUrl(null);
      // Re-assert the texture: clearing the tile engine leaves the globe bare.
      globe.globeImageUrl(globeMapTexture());
    } else {
      const tpl = p.tiles[0];
      globe.globeTileEngineUrl((x, y, l) =>
        new URL(tpl.replace('{z}', l).replace('{y}', y).replace('{x}', x), location.href).href);
      // The provider's own maximum, held at 19. Esri stops there anyway;
      // Google advertises 22 but is billed per tile request, and past 19 the
      // extra levels are mostly the same pixels enlarged.
      globe.globeTileEngineMaxLevel(Math.min(p.maxzoom ?? 17, 19));
    }
    // The two basemaps want opposite lighting - imagery needs lifting, a drawn
    // map needs leaving alone - so the switch has to re-light, not just
    // re-texture. Without this, going Satellite -> Map keeps ambient 4.2 and
    // the drawn map arrives washed to white.
    styleGlobe();
  }

  function setBasemap(id) {
    for (const b of bmSeg.children) b.setAttribute('aria-selected', String(b.dataset.bm === id));
    const p = providers.find(x => x.id === id);

    // TRY IT, DO NOT ASK FIRST. addSource/addLayer throw "Style is not done
    // loading" before the style is ready, so the obvious guard is
    // `if (!map.isStyleLoaded()) defer`. That guard was wrong twice over:
    // isStyleLoaded() reports false during ordinary style mutations long after
    // the map is usable, so a click would defer when it did not need to - and
    // then the retry hung off an event that may never fire again, leaving the
    // button selected and the basemap silently unchanged.
    //
    // Attempting the work and catching the one error MapLibre actually raises
    // has no such failure mode: it succeeds whenever it can, and retries only
    // when it genuinely could not.
    try {
      if (p && !map.getSource(`sat-${p.id}`)) {
        map.addSource(`sat-${p.id}`, {
          type: 'raster', tiles: p.tiles, tileSize: 256,
          maxzoom: p.maxzoom || 19, attribution: p.attribution || '',
        });
        // Beneath `land` so the data layers above it are untouched.
        map.addLayer({ id: `sat-${p.id}`, type: 'raster', source: `sat-${p.id}`,
                       layout: { visibility: 'none' } }, 'land');
      }
      for (const q of providers) {
        if (map.getLayer(`sat-${q.id}`)) {
          map.setLayoutProperty(`sat-${q.id}`, 'visibility', q.id === id ? 'visible' : 'none');
        }
      }
      // Imagery already draws the coastline; our 110m polygons over the top of
      // it would be a coarser outline on a finer one.
      for (const l of ['land', 'land-line']) {
        if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', p ? 'none' : 'visible');
      }
    } catch (err) {
      pendingBasemap = id;
      map.once('idle', () => {
        const q = pendingBasemap;
        pendingBasemap = null;
        if (q !== null) setBasemap(q);
      });
      return;
    }
    currentBasemap = id;
    showBasemapNote(id);
    applyGlobeBasemap();
  }

  const bmNote = document.getElementById('bm-note');

  fetch('/api/basemaps').then(r => r.json()).then(list => {
    providers = list;
    bmSeg.innerHTML = `<button data-bm="" role="tab" aria-selected="true">Map</button>`
      + list.map(p => `<button data-bm="${esc(p.id)}" role="tab" aria-selected="false">${esc(p.label)}</button>`).join('');
    showBasemapNote('');
  }).catch(() => {});

  // Imagery is licensed, not free, and which licence applies depends on the
  // provider. Saying so where the switch is beats burying it in a comment.
  function showBasemapNote(id) {
    if (!bmNote) return;
    const p = providers.find(x => x.id === id);
    bmNote.textContent = p ? `${p.attribution.replace(/&copy;/g, '©')} · ${p.licence || ''}` : '';
    bmNote.hidden = !p;
  }

  bmSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-bm]');
    if (b) setBasemap(b.dataset.bm);
  });

  // ---- lifecycle status ------------------------------------------------------
  // Operational / under construction, as its own filter. The counts are shown
  // rather than implied, and UNKNOWN is shown alongside them rather than hidden,
  // because it is 97% of the registry: OSM and PeeringDB record where a facility
  // is, never what stage it is at. Presenting two tidy numbers without the third
  // would imply a completeness this data does not have.
  const ST = [
    ['op', 'Operational', 'st-op'],
    ['uc', 'Under construction', 'st-uc'],
    ['', 'Status unknown', 'st-un'],
  ];
  const stRow = document.getElementById('st-row');
  const stNote = document.getElementById('st-note');

  function renderStatus() {
    // Count against everything the layer toggles admit, so the numbers track
    // whatever else is switched on rather than quoting a fixed total.
    const pool = drawable.filter(d =>
      (d.ft === 'ai' ? state.layers.ai : state.layers.facilities) && inTime(d));
    const n = { op: 0, uc: 0, '': 0 };
    for (const d of pool) n[d.st || ''] += 1;
    const active = state.filter && state.filter.key === 'st' ? state.filter.value : null;
    stRow.innerHTML = ST.map(([k, label, cls]) => `
      <button class="st-chip" data-st="${k}" aria-pressed="${active === k}">
        <i class="st-dot ${cls}"></i><span class="st-lab">${label}</span>
        <span class="st-n">${n[k].toLocaleString()}</span>
      </button>`).join('');
    const known = n.op + n.uc;
    stNote.textContent = pool.length
      ? `Known for ${known.toLocaleString()} of ${pool.length.toLocaleString()}`
        + ` (${(known / pool.length * 100).toFixed(0)}%). Derived from build dates —`
        + ` no source in the registry publishes a status field.`
      : '';
  }

  stRow.addEventListener('click', (e) => {
    const b = e.target.closest('.st-chip');
    if (!b) return;
    const k = b.dataset.st;
    const on = state.filter && state.filter.key === 'st' && state.filter.value === k;
    if (on) return setFilter(null);
    const all = sites.filter(d => (d.st || '') === k);
    const pts = drawable.filter(d => (d.st || '') === k);
    setFilter({ key: 'st', value: k, label: ST.find(s => s[0] === k)[1],
                count: all.length, unmapped: all.length - pts.length });
  });

  // Recount whenever anything that changes the visible set changes.
  const _refresh = refreshView;
  refreshView = () => { _refresh(); renderStatus(); };
  renderStatus();

  // ---- operator directory -----------------------------------------------------
  // Browse by company rather than by dot. The registry knows 2,613 companies,
  // so this is a searchable list rather than a curated ten - but the ones with
  // a profile float to the top of an unfiltered view, because "who are the big
  // operators" is the question people actually arrive with.
  const opsPanel = document.getElementById('ops');
  const opsRows = document.getElementById('ops-rows');
  const opsQ = document.getElementById('ops-q');
  const opsBtn = document.getElementById('opsBtn');
  const opsSub = document.getElementById('ops-sub');
  const opsMore = document.getElementById('ops-more');
  const opsListView = document.getElementById('ops-list-view');
  const opsDetail = document.getElementById('ops-detail');
  const LIST_CAP = 60;

  let opsData = null, opsRegion = '', opsCurrent = null;

  // Monogram fallback. A company with no cached logo still needs a stable,
  // distinguishable tile, and hashing the key means it never changes between
  // loads the way a random colour would.
  const HUES = [206, 12, 145, 268, 32, 190, 340, 96, 250, 58];
  function logoHtml(o, big) {
    const cls = 'ops-logo' + (big ? ' ops-logo-lg' : '');
    if (o.logo) {
      return `<span class="${cls}"><img src="/logos/${esc(o.logo)}" alt="" loading="lazy"></span>`;
    }
    let h = 0;
    for (const ch of o.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const initials = o.name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/)
      .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    return `<span class="${cls} ops-mono" style="--h:${HUES[h % HUES.length]}">${esc(initials)}</span>`;
  }

  function opsFiltered() {
    const q = opsQ.value.trim().toLowerCase();
    let list = opsData.operators;
    if (opsRegion) list = list.filter(o => (o.byContinent[opsRegion] || 0) > 0);
    if (q) list = list.filter(o => o.name.toLowerCase().includes(q) || o.key.includes(q));
    if (opsRegion) {
      // Ranking by global size inside a regional view is misleading: it puts a
      // 174-site company with one African site above the operator that actually
      // runs Africa. Rank by presence in the region being looked at.
      list = [...list].sort((a, b) => (b.byContinent[opsRegion] || 0) - (a.byContinent[opsRegion] || 0)
        || a.name.localeCompare(b.name));
    } else if (!q) {
      list = [...list].sort((a, b) => (b.profile ? 1 : 0) - (a.profile ? 1 : 0) || b.n - a.n);
    }
    return list;
  }

  function renderOpsList() {
    const list = opsFiltered();
    const shownList = list.slice(0, LIST_CAP);
    const total = list.reduce((s, o) => s + (opsRegion ? o.byContinent[opsRegion] : o.n), 0);
    opsSub.textContent = `${list.length.toLocaleString()} operator${list.length === 1 ? '' : 's'}`
      + ` · ${total.toLocaleString()} sites` + (opsRegion ? ` in ${opsRegion}` : '');
    opsMore.hidden = list.length <= LIST_CAP;
    opsMore.textContent = `Showing the top ${LIST_CAP}. Type to narrow the list.`;
    opsRows.innerHTML = shownList.map(o => {
      const n = opsRegion ? o.byContinent[opsRegion] : o.n;
      const where = Object.keys(o.byContinent).slice(0, 2).join(' · ');
      return `<li><button class="ops-row" data-key="${esc(o.key)}">
        ${logoHtml(o)}
        <span class="ops-name">
          <b>${esc(o.name)}${o.ai ? ` <i class="ops-ai">${o.ai} AI</i>` : ''}</b>
          <em>${esc(opsRegion || where)}</em></span>
        <span class="ops-n">${n.toLocaleString()}</span>
        <span class="ops-chev">›</span></button></li>`;
    }).join('');
  }

  function openOperator(key) {
    const o = opsData.operators.find(x => x.key === key);
    if (!o) return;
    opsCurrent = o;
    opsListView.hidden = true;
    opsDetail.hidden = false;
    document.getElementById('ops-d-logo').innerHTML = logoHtml(o, true);
    document.getElementById('ops-d-name').textContent = o.name;

    const mine = sites.filter(d => d.ok === key);
    const meta = [`${o.n.toLocaleString()} sites`];
    if (o.ai) meta.push(`${o.ai} AI`);
    if (o.kind) meta.push(o.kind);
    if (o.parent) meta.push(`part of ${o.parent}`);
    if (o.spellings > 1) meta.push(`${o.spellings} name variants merged`);
    document.getElementById('ops-d-meta').textContent = meta.join(' · ');

    const prof = document.getElementById('ops-d-profile');
    prof.textContent = o.profile || '';
    prof.hidden = !o.profile;

    const links = [`<a href="/operator/${encodeURIComponent(o.key)}" target="_blank">Full page ↗</a>`];
    if (o.domain) links.push(`<a href="https://${esc(o.domain)}" target="_blank" rel="noopener noreferrer">${esc(o.domain)}</a>`);
    if (o.officialLocationList && o.officialLocationList !== 'none found') {
      links.push(`<a href="${esc(o.officialLocationList)}" target="_blank" rel="noopener noreferrer">official location list</a>`);
    }
    document.getElementById('ops-d-links').innerHTML = links.join(' · ');

    // Regions, biggest first, each a filter down to that operator in that place.
    document.getElementById('ops-d-regions').innerHTML =
      Object.entries(o.byContinent).map(([c, n]) => {
        const countries = Object.entries(o.byCountry)
          .filter(([iso]) => (opsData.regions[iso]?.c || 'Unattributed') === c)
          .slice(0, 6)
          .map(([iso, k]) => `${esc(opsData.regions[iso]?.n || iso)} ${k}`).join(', ');
        return `<li><button class="ops-region" data-rg="${esc(c)}">
          <span class="ops-region-n">${n}</span>
          <span><b>${esc(c)}</b><em>${esc(countries)}</em></span></button></li>`;
      }).join('');

    document.getElementById('ops-d-count').textContent =
      mine.length > 40 ? `(showing 40 of ${mine.length.toLocaleString()})` : '';
    document.getElementById('ops-d-sites').innerHTML = mine.slice(0, 40).map(s => `
      <li><button class="tchart-row ops-site" data-id="${esc(s.id)}">
        <span class="ops-site-n">${esc(s.n || s.en || 'Unnamed site')}</span>
        <span class="ops-site-w">${esc([s.ci, s.c].filter(Boolean).join(', '))}</span>
      </button></li>`).join('');

    const showBtn = document.getElementById('ops-d-show');
    const on = state.filter && state.filter.key === 'ok' && state.filter.value === key;
    showBtn.setAttribute('aria-pressed', String(!!on));
    showBtn.textContent = on ? 'Showing only these — clear' : 'Show only these on the map';
  }

  function closeDetail() {
    opsDetail.hidden = true;
    opsListView.hidden = false;
    opsCurrent = null;
  }

  function filterToOperator(key, region) {
    const all = sites.filter(d => d.ok === key && (!region || d.rg === region));
    const pts = all.filter(d => d.lat != null);
    const o = opsData.operators.find(x => x.key === key);
    setFilter({
      key: 'ok', value: key, region,
      label: (o ? o.name : key) + (region ? ` · ${region}` : ''),
      count: all.length, unmapped: all.length - pts.length,
    });
    // Both layers must be on or the filter looks broken: an operator with only
    // AI sites shows nothing when the AI layer happens to be off.
    for (const k of ['facilities', 'ai']) {
      const cb = document.getElementById(`lyr-${k}`);
      if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    }
    if (pts.length) frameSites(pts);
  }

  async function setOpsOpen(open) {
    opsPanel.hidden = !open;
    opsBtn.setAttribute('aria-pressed', String(open));
    if (!open || opsData) return;
    opsData = await (await fetch('/data/operators.json')).json();
    const conts = [...new Set(opsData.operators.flatMap(o => Object.keys(o.byContinent)))]
      .sort((a, b) => a.localeCompare(b));
    const seg = document.getElementById('ops-region-seg');
    seg.innerHTML = `<button data-rg="" role="tab" aria-selected="true">All</button>`
      + conts.map(c => `<button data-rg="${esc(c)}" role="tab" aria-selected="false">${esc(c)}</button>`).join('');
    renderOpsList();
  }

  opsBtn.addEventListener('click', () => setOpsOpen(opsPanel.hidden));
  document.getElementById('ops-close').addEventListener('click', () => setOpsOpen(false));
  document.getElementById('ops-back').addEventListener('click', closeDetail);
  opsQ.addEventListener('input', renderOpsList);

  document.getElementById('ops-region-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rg]');
    if (!b) return;
    opsRegion = b.dataset.rg;
    for (const el of e.currentTarget.children) {
      el.setAttribute('aria-selected', String(el.dataset.rg === opsRegion));
    }
    renderOpsList();
  });

  opsRows.addEventListener('click', (e) => {
    const b = e.target.closest('.ops-row');
    if (b) openOperator(b.dataset.key);
  });

  document.getElementById('ops-d-show').addEventListener('click', () => {
    if (!opsCurrent) return;
    const on = state.filter && state.filter.key === 'ok' && state.filter.value === opsCurrent.key;
    if (on) setFilter(null); else filterToOperator(opsCurrent.key);
    openOperator(opsCurrent.key);
  });

  document.getElementById('ops-d-regions').addEventListener('click', (e) => {
    const b = e.target.closest('.ops-region');
    if (b && opsCurrent) filterToOperator(opsCurrent.key, b.dataset.rg);
  });

  document.getElementById('ops-d-sites').addEventListener('click', (e) => {
    const b = e.target.closest('.ops-site');
    if (!b) return;
    const s = sites.find(x => x.id === b.dataset.id);
    if (!s) return;
    if (s.lat == null) return openSite(s.id);
    if (state.time) setTimelineOpen(false);
    ensureLayerFor(s);
    goTo(s.lon, s.lat, s);
  });

  // ---- deep link: /?operators=1 opens the directory, /?op=<key> filters to one
  // Operator pages link back here with these, so the map is the same object
  // seen spatially rather than a separate place you have to re-navigate.
  const qs = new URLSearchParams(location.search);
  if (qs.has('operators') || qs.has('op')) {
    setOpsOpen(true).then(() => {
      const key = qs.get('op');
      if (!key) return;
      if (opsData.operators.some(o => o.key === key)) {
        openOperator(key);
        filterToOperator(key);
      }
    });
  }

  // ---- deep link: /?site=<id> flies to the site -------------------------------
  const focusId = new URLSearchParams(location.search).get('site');
  if (focusId) {
    const s = sites.find(x => x.id === focusId);
    if (s && s.lat != null) {
      map.once('load', () => {
        map.flyTo({ center: [s.lon, s.lat], zoom: SITE_ZOOM, duration: 1200 });
        new maplibregl.Popup({ closeOnClick: true, offset: 10 })
          .setLngLat([s.lon, s.lat]).setHTML(sitePopup(s)).addTo(map);
      });
    }
  }
})();
