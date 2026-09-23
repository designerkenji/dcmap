/* dcmap frontend: one state object driving two renderers.
 *
 * 2D is MapLibre with a vector basemap built from our own Natural Earth
 * GeoJSON — no external tile service, so the app works offline and the
 * day/night styles are just two palettes over the same sources.
 * 3D is globe.gl drawing the same polygons and points on a sphere.
 *
 * Dots are deduplicated sites; clicking one opens /maps/site/<site_id> in a new
 * tab, which is the shareable unit.
 */
(async function () {
  'use strict';

  const state = {
    // range: a hand-narrowed [lo, hi] for the ramp, set by dragging on the
    // distribution chart; null means the domain is computed from the data.
    // hideMissing: drop the grey no-value dots entirely while the ramp paints
    // - a real filter through the visibility machinery, not a repaint.
    // hex: the same measure aggregated into H3 hexagons - a form of the
    // heatmap, not a layer of its own. Which facility layers go into the
    // cells is state.layers, the same toggles that draw them as dots.
    // res: a hand-picked H3 resolution, or null to let it follow the zoom.
    heat: { on: false, k: 'mw', range: null, hideMissing: false,
      hex: false, res: null },
    mode: '2d',
    fpOnly: false,
    layers: { facilities: true, footprints: true, regrid: false, precisely: false, supply: true, subs: true, trans: true, lines: false, water: false, points: true, events: true, ercot: false, pjm: false,
      nyiso: false, countries: false, quake: false, plants: false, fabs: false },
    fuels: null,    // Set of fuel keys while the plant legend is filtering
    // AI and traditional are two KINDS of data centre, not two layers. They
    // were two checkboxes because they are drawn as two MapLibre layers, which
    // is an implementation detail leaking into the pane - nobody thinks of an
    // AI campus as a different subject from the building next to it. Same
    // shape as `fuels`: null when everything is on, so the common case costs
    // no filter at all.
    dcKinds: null,
    filter: null,   // {key,value,label} from search — narrows the dots shown
    time: null,     // {q, mode:'cum'|'year'} while the timeline bar is open
    fpEdit: false,  // the ✎ button: clicks edit footprints instead of opening pages
  };

  const PALETTES = {
    day: {
      ocean: '#DFE9F0', land: '#F6F8FA', border: '#C4CFD8',
      fac: '#0E8A7C', ai: '#B5761E', halo: '#FFFFFF',
      // Place names and political boundaries, drawn from the vector basemap.
      // Only used when imagery is OFF - over a photograph these lose to
      // white-on-dark, whatever the theme. See labelInk().
      lbl: '#3D4C59', lblHalo: 'rgba(255,255,255,0.85)', bnd: '#9BADBC',
      // See --fp in app.css: footprints are drawn over PHOTOGRAPHY, so the
      // hue is picked against the earth rather than against this palette.
      fp: '#E0148C', fpCase: 'rgba(28,4,18,0.55)',
      // Regrid parcels get their own ink: azure, nothing else on the map owns
      // it at parcel zoom, and the whole point of the layer is telling these
      // apart from the pink footprints they are being checked against.
      regrid: '#2563EB',
      precisely: '#7C3AED',
      // Supply links get green: energy flowing, and nothing else on the map
      // owns a saturated green at any zoom.
      supply: '#059669',
      ercot: '#B5761E', pjm: '#3B82C4', nyiso: '#2E9E83', cty: '#7C5FBF',
      // The globe was night in both themes: one hard-coded texture and a black
      // background in each palette. Day now gets a lit sky; night stays dark.
      bg3d: '#CFE0EE', atmosphere: '#9FD0FF',
      // The globe's basemap gets MORE contrast than the 2D one, not the same.
      // 2D can separate #DFE9F0 ocean from #F6F8FA land because it is flat,
      // evenly lit and viewed head-on. Wrap those two on a sphere behind an
      // atmosphere and they are one colour. A globe needs a blue ocean.
      globeOcean: '#CFE8F7', globeLand: '#EDF2F5', globeBorder: '#6E8FA6',
      // Nine pastels indexed by Natural Earth's MAPCOLOR9 - see globeMapTexture().
      globeCountry: ['#A8D8A0', '#F5CE7E', '#A9C8EC', '#F0A9A2', '#D2B4E8',
                     '#F2E68C', '#9FD8CE', '#EFC08A', '#C9E08A'],
      // Fallback only, for a browser that will not give us a 2D canvas
      // context. The globe wore this photograph until people started reading
      // it as satellite imagery - see globeMapTexture().
      globeTexture: '/textures/earth-day.jpg',
      // Added flat, not multiplied through the texture: a multiplicative lift
      // leaves dark pixels dark, which is the whole problem being solved.
      globeLift: 0x1d2b3a, ambient: 4.2, sun: 0.55,
      // The hatch a hexagon with nothing to sum wears - see HEX_HATCH.
      hatch: 'hex-hatch-day',
      fac3d: 'rgba(64,196,180,0.85)', ai3d: 'rgba(224,167,92,0.95)',
    },
    night: {
      ocean: '#0A1016', land: '#151C24', border: '#2E3A46',
      fac: '#40C4B4', ai: '#E0A75C', halo: '#0A1016',
      lbl: '#C3CFDA', lblHalo: 'rgba(10,16,22,0.85)', bnd: '#4A5B6D',
      fp: '#FF63BE', fpCase: 'rgba(0,0,0,0.6)',
      regrid: '#60A5FA',
      precisely: '#A78BFA',
      supply: '#34D399',
      ercot: '#FFB03B', pjm: '#60A5EB', nyiso: '#4FD1AC', cty: '#A78BFA',
      bg3d: '#000000', atmosphere: '#274060',
      globeOcean: '#0C1B2A', globeLand: '#22303C', globeBorder: '#44586B',
      // Same nine hues held down to night values: enough to tell countries
      // apart, not enough to glow.
      globeCountry: ['#26382C', '#3B3529', '#252F42', '#3C2B2C', '#332B3E',
                     '#3A3726', '#22383A', '#3A3128', '#31382A'],
      globeTexture: '/textures/earth-topo-bathy.jpg',   // fallback only
      // Night stays night - just enough lift to keep it from going muddy.
      globeLift: 0x0a0f14, ambient: 3.0, sun: 0.9,
      hatch: 'hex-hatch-night',
      fac3d: 'rgba(64,196,180,0.85)', ai3d: 'rgba(224,167,92,0.95)',
    },
  };
  const pal = () => PALETTES[document.documentElement.dataset.theme === 'night' ? 'night' : 'day'];

  // ---- data ----------------------------------------------------------------
  // Transmission is NOT in this list any more: it arrives as vector tiles for
  // the viewport (see initTransmission below), with the GeoJSON as a fallback.
  // It was 1.45 MB gzipped on every load for corridors mostly out of view.
  const [sites, ercot, pjm, nyiso, countries, basemap, timeline, quakes, plants, fabs,
         regridFC, preciselyFC, supplyLinks, fpLocators, substations, depLinks, points, events, plantsMeta]
    = await Promise.all(
    ['sites', 'ercot', 'pjm', 'nyiso', 'countries', 'basemap', 'timeline', 'quakes', 'plants',
     'fabs', 'regrid', 'precisely', 'supply_links', 'fp_locators', 'substations', 'dep_links', 'points', 'events',
     'plants_meta']
      .map(n => fetch(`/data/${n}.json`).then(r => r.json())));
  // The layer credit names the releases the data was built from, written by
  // the pipeline beside the data so the note cannot lag a vintage bump.
  for (const el of document.querySelectorAll('[data-vintage]')) el.textContent = plantsMeta[el.dataset.vintage] || '';

  // Footprints arrive per viewport from /api/footprints, not in one payload -
  // see the note on that route. This starts empty and is filled by
  // loadFootprints() below whenever the map settles somewhere close enough in.
  const footprints = { type: 'FeatureCollection', features: [] };

  // Where the REGRID layer HAS data, visible from orbit: a 38-parcel layer at
  // world zoom is an empty map, and an empty map reads as a broken toggle. So
  // each parcel also becomes one point - its bbox centre - drawn as a hollow
  // ring that fades out exactly as the real lot lines fade in. Clicking a
  // ring dives to the lot.
  const parcelDots = (fc) => ({
    type: 'FeatureCollection',
    features: (fc.features || []).map(f => {
      let xs = [], ys = [];
      const walk = (c) => (typeof c[0] === 'number'
        ? (xs.push(c[0]), ys.push(c[1]))
        : c.forEach(walk));
      walk(f.geometry.coordinates);
      return { type: 'Feature',
        geometry: { type: 'Point', coordinates: [
          (Math.min(...xs) + Math.max(...xs)) / 2,
          (Math.min(...ys) + Math.max(...ys)) / 2] },
        properties: f.properties };
    }),
  });
  const regridDotFC = parcelDots(regridFC);
  const preciselyDotFC = parcelDots(preciselyFC);

  // Footprint locators: bare [lon,lat] pairs from the server, one per
  // footprint-bearing asset, so the footprints toggle shows its coverage
  // from world zoom instead of an empty map until z11.
  const fpLocFC = { type: 'FeatureCollection',
    features: fpLocators.map(c => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: c }, properties: {} })) };

  // Supply links drawn twice, for the same reason the parcels are: a line
  // from a campus to the plant net-metering it is 4-40 km long - a subpixel
  // at world zoom - so each pair also gets a hollow ring at its midpoint
  // that hands over to the line as the pair becomes separable. Both carry
  // the endpoints in properties so a click can frame the pair.
  const SUPPLY_ST = { btm: 'Behind the meter', netmeter: 'Net-metered co-location',
                      ppa: 'Front-of-meter contract', announced: 'Announced only' };
  const supplyProps = (l) => ({ sid: l.sid, ann: l.ann ? 1 : 0, st: l.st,
    pid: l.pid, sn: l.sn, pn: l.pn,
    sx: l.s[0], sy: l.s[1], px: l.p[0], py: l.p[1] });
  const supplyLineFC = { type: 'FeatureCollection',
    features: supplyLinks.map(l => ({ type: 'Feature',
      geometry: { type: 'LineString', coordinates: [l.s, l.p] },
      properties: supplyProps(l) })) };
  const supplyDotFC = { type: 'FeatureCollection',
    features: supplyLinks.map(l => ({ type: 'Feature',
      geometry: { type: 'Point',
        coordinates: [(l.s[0] + l.p[0]) / 2, (l.s[1] + l.p[1]) / 2] },
      properties: supplyProps(l) })) };
  // Announced campuses have no registry dot to land the thread on, so the
  // thread's campus end gets its own marker: hollow, the map's established
  // dialect for "approximate / not yet real".
  const supplySiteFC = { type: 'FeatureCollection',
    features: supplyLinks.filter(l => l.ann).map(l => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: l.s },
      properties: supplyProps(l) })) };

  // Substations carrying a dependency edge. A SEPARATE layer from Supply
  // Links on purpose: that layer draws who SELLS power to whom, mostly
  // contractual; this one draws the equipment whose failure takes several
  // loads out at once. Collapsing them would undo the one distinction the
  // dependency ledger exists to make.
  const subFC = { type: 'FeatureCollection',
    features: substations.map(x => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      properties: x })) };

  // Dependency links as straight segments. Amber like the substations they
  // mostly end at, dashed because a straight line between two dots is the
  // RELATIONSHIP and not the path any conductor takes - the map should not
  // imply a route it has never surveyed.
  const depLinkFC = { type: 'FeatureCollection',
    features: depLinks.map(l => ({ type: 'Feature',
      geometry: { type: 'LineString', coordinates: [l.a, l.b] },
      properties: { an: l.an, bn: l.bn, rel: l.rel, ev: l.ev, to: l.to } })) };

  // Dropped points. Hollow, which is this map's established dialect for
  // "asserted, not yet established" - the same shape an announced campus
  // gets - because that is exactly what a dropped pin is.
  const PT_KIND = { datacentre: 'Data centre', fab: 'Semiconductor fab',
                    plant: 'Power plant', substation: 'Substation' };
  const ptFC = { type: 'FeatureCollection',
    features: points.map(x => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      properties: { id: x.id, n: x.n || '', kind: x.kind || '' } })) };

  // Simulated events. The ring is a real geographic circle - a polygon of 72
  // points - not a circle layer, whose radius is in PIXELS and would quietly
  // change what the event means at every zoom.
  const ringOf = (lat, lon, km, n = 72) => {
    const out = [];
    const dLat = km / 110.574;
    const dLon = km / (111.320 * Math.cos(lat * Math.PI / 180) || 1e-6);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI;
      out.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
    }
    return out;
  };
  const evRingFC = { type: 'FeatureCollection',
    features: events.map(e => ({ type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ringOf(e.lat, e.lon, e.radius_km)] },
      properties: { id: e.id, n: e.name || '', kind: e.kind, r: e.radius_km } })) };
  const evDotFC = { type: 'FeatureCollection',
    features: events.map(e => ({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { id: e.id, n: e.name || '', kind: e.kind, r: e.radius_km } })) };

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
  // The hexagon heatmap's cells, rebuilt by applyHeat whenever the painted
  // set, the measure or the resolution moves. One object for the style AND
  // for setData, the way quakeFC is, so the source keeps its identity.
  const hexFC = { type: 'FeatureCollection', features: [] };
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

  // ---- power plants ---------------------------------------------------------
  // US generation at or above 100 MW, from EIA-860M. Drawn as RINGS, where a
  // data centre is a solid dot: at Ashburn or in ERCOT the two layers overlap
  // heavily, and hue alone would not survive that - especially with the
  // heatmap on, which owns green through red for the site dots.
  //
  // Conventional fuel colours anyway, because coal-is-black and solar-is-yellow
  // are read faster than any palette picked to avoid a collision, and the
  // ring/disc distinction is what carries the layer apart.
  const FUEL_COLOUR = {
    nuclear: '#8B5CF6', gas: '#F97316', coal: '#57534E', oil: '#A16207',
    hydro: '#0EA5E9', wind: '#06B6D4', solar: '#EAB308', storage: '#EC4899',
    other: '#94A3B8',
  };
  const FUEL_LABEL = {
    nuclear: 'Nuclear', gas: 'Gas', coal: 'Coal', oil: 'Oil', hydro: 'Hydro',
    wind: 'Wind', solar: 'Solar', storage: 'Storage', other: 'Other',
  };
  // Balancing authority to the market whose rules apply. Only the seven that
  // have a co-location regime worth naming; everything else is a vertically
  // integrated utility where the question is a state commission's, not an RTO's.
  const BA_ISO = {
    PJM: 'PJM', ERCO: 'ERCOT', MISO: 'MISO', ISNE: 'ISO-NE',
    NYIS: 'NYISO', CISO: 'CAISO', SWPP: 'SPP',
  };
  const STATUS_LABEL = { op: 'Operating', plan: 'Planned', ret: 'Retired' };

  // The capacity the dot is sized on: what is running, or failing that what was
  // there, or failing that what is proposed. A retired 2 GW coal station is a
  // big dot on purpose - the interconnection is the asset.
  for (const p of plants) p.smw = p.mw || p.rmw || p.pmw || 0;

  const plantFC = {
    type: 'FeatureCollection',
    features: plants.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: p,
    })),
  };

  const fuelOn = (f) => !state.fuels || state.fuels.has(f);
  // null when nothing is deselected, because setFilter(null) clears rather than
  // matching everything - the same contract eventClause() has.
  const plantClause = () => (state.fuels
    ? ['in', ['get', 'f'], ['literal', [...state.fuels]]] : null);

  const mwText = (v) => `${Math.round(v).toLocaleString()} MW`;
  // Project value arrives in US$ MILLIONS from every layer - sites, plants and
  // fabs share the unit because they share a ramp. Formatted to two-ish
  // significant figures: these are announcements, and "$65bn" is the precision
  // they were announced at. $12,400 -> $12bn, $6,400 -> $6.4bn, $800 -> $800M.
  const usdText = (m) => (m >= 950000
    ? `$${(m / 1e6).toFixed(m >= 9.5e6 ? 0 : 1)}tn`
    : m >= 1000
      ? `$${m >= 9500 ? Math.round(m / 1000).toLocaleString() : (m / 1000).toFixed(1)}bn`
      : `$${Math.round(m).toLocaleString()}M`);
  const plantTip = (p) => {
    const iso = BA_ISO[p.ba] || p.ba;
    const head = p.k === 'op'
      ? `${mwText(p.mw)} operating${p.u > 1 ? ` · ${p.u} units` : ''}${p.y ? ` · since ${p.y}` : ''}`
      : p.k === 'ret'
        ? `Retired${p.ry ? ` ${p.ry}` : ''} · ${mwText(p.rmw)} was here`
        : `Planned${p.y ? ` for ${p.y}` : ''} · ${mwText(p.pmw)}`;
    // EIA's technology is often a longer way of saying the fuel - "Nuclear"
    // for nuclear, but "Natural Gas Fired Combined Cycle" for gas, which is
    // worth the line. Only print both when they differ.
    const kind = p.tech === FUEL_LABEL[p.f] ? FUEL_LABEL[p.f]
      : `${FUEL_LABEL[p.f]} · ${p.tech}`;
    // US records carry a state and a balancing authority; GEM records carry a
    // province (where the tracker files one) and a country, and no BA.
    // Filtering empties keeps one line doing both jobs.
    const where = p.src === 'gem' ? [p.st, p.cyn || p.cy, p.own] : [p.st, iso, p.own];
    return `<div class="t">${esc(p.n)}</div>` +
      `<div class="d">${esc(kind)}</div>` +
      `<div class="d">${head}</div>` +
      // Announced for a project, reported for a build - the note on the
      // plant's page says which, and what the figure covers.
      (p.inv ? `<div class="d">${usdText(p.inv)} announced/reported cost</div>` : '') +
      // The two lines that answer the co-location question, when they apply:
      // capacity about to free up, and capacity being added on the same pad.
      // EIA gives the capacity that is leaving; GEM gives only the date. Both
      // are worth saying - an announced closure is the clearest signal in the
      // layer that interconnection is about to free up - so the date alone
      // still gets a line rather than being dropped for want of a number.
      (p.xmw ? `<div class="d">${mwText(p.xmw)} retiring from ${p.ry}</div>`
        : p.k === 'op' && p.ry ? `<div class="d">Retirement announced for ${p.ry}</div>` : '') +
      (p.k === 'op' && p.pmw ? `<div class="d">${mwText(p.pmw)} more planned here</div>` : '') +
      `<div class="d">${esc(where.filter(Boolean).join(' · '))}</div>` +
      // Said out loud, the way a town-geocoded data centre says it. GEM grades
      // its own coordinates and 47% of these are settlement-level, which is
      // fine for "there is a 600 MW gas plant near this city" and not fine for
      // measuring a distance off the map.
      (p.ax ? '<div class="d">approximate location — accurate to the area, not the site</div>' : '') +
      '<div class="d">click to open this plant\u2019s page</div>';
  };

  // ---- semiconductor fabs ---------------------------------------------------
  // A third class of thing on one map, so a third visual language: data centres
  // are solid dots, plants are rings, fabs are a solid dot with a dark rim in a
  // colour nothing else uses. Few enough that they can all be drawn at any zoom.
  //
  // They are here because a leading-edge fab draws 100-500 MW and competes with
  // data centres for the same interconnection queue - it is the same grid
  // question the plant layer asks, from the demand side.
  const FAB_COLOUR = '#BE185D';
  const FAB_STATUS = { operating: 'Operating', construction: 'Under construction',
                       announced: 'Announced', closed: 'Closed' };

  const fabFC = {
    type: 'FeatureCollection',
    features: fabs.map(f => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: f,
    })),
  };

  const fabTip = (f) => {
    const spec = [f.nm ? f.nm + ' nm' : '', f.wf ? f.wf + ' mm' : '',
                  f.ws ? f.ws.toLocaleString() + ' wafers/mo' : ''].filter(Boolean).join(' · ');
    return `<div class="t">${esc(f.n)}</div>` +
      `<div class="d">${esc(f.op)}</div>` +
      (spec ? `<div class="d">${esc(spec)}</div>` : '') +
      // Announced, not modelled - the one figure on this layer that is a
      // reading rather than an estimate. What it covers is on the fab's page.
      (f.inv ? `<div class="d">${usdText(f.inv)} announced investment</div>` : '') +
      // ESTIMATED, said every single time. No fab on earth publishes its
      // electricity demand, so this is modelled from wafer capacity and node
      // and is good to about a factor of two. Printing it bare would turn a
      // calculation into a reading.
      (f.mw ? `<div class="d">~${f.mw.toLocaleString()} MW <em>estimated</em>, not measured</div>`
            : f.pn ? '' : '<div class="d">power not estimated — capacity or node unpublished</div>') +
      (f.pn ? `<div class="d">${esc(f.pn)}</div>` : '') +
      (f.nt ? `<div class="d">${esc(f.nt)}</div>` : '') +
      `<div class="d">${esc([FAB_STATUS[f.k] || f.k, f.pl, f.cy].filter(Boolean).join(' · '))}</div>` +
      '<div class="d">click to open this fab\u2019s page</div>';
  };

  const openSite = (id) => window.open(`/maps/site/${encodeURIComponent(id)}`, '_blank', 'noopener');
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

  // Quotes matter as much as angle brackets here: almost every use of this is
  // inside an attribute (data-g=, data-v=, value=, href=), so a name carrying
  // a " breaks out of the attribute without ever needing a <. The three
  // server-side escapers - sitepage.mjs, summary.mjs, operatorpage.mjs - all
  // escape it; this one did not, and operator names are hand-editable.
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const siteFacts = (p) => {
    // `est.` on the capex, always: it is Epoch's estimate at projected peak,
    // not an announcement - the same contract as a fab's modelled MW.
    const bits = [p.o, p.ci || p.c, p.mw ? p.mw.toLocaleString() + ' MW' : '',
                  p.inv ? usdText(p.inv) + ' est. capex' : '', p.u]
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
    `<a class="pop-open" href="/maps/site/${encodeURIComponent(p.id)}" ` +
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
    // The dot hands over to the footprint. Once you are close enough that the
    // building itself is on screen, the dot is a worse target than the roof it
    // stands on - it covers the thing it is pointing at, and clicking "the
    // site" should mean clicking the site. So a dot whose asset HAS a
    // footprint shrinks to nothing between z14 and z15.5, by which point
    // footprints (loaded from z11) have long been drawn, and the shape takes
    // over both the seeing and the clicking. The radius goes to zero as well
    // as the opacity, deliberately: an invisible circle still answers
    // queryRenderedFeatures, which would leave a dot you cannot see but can
    // still click - exactly the thing this removes.
    //
    // A site with NO footprint keeps its dot at every zoom. It is the only
    // mark that asset has, and fading it out would erase the site.
    // Same crossfade the fp-loc locator ring already does at z11.5.
    // Interpolate OUTERMOST, the per-feature case inside the stops - the same
    // inversion the radius above needs, and for the same reason: a zoom
    // expression nested inside a `case` is a hard MapLibre validation error
    // that takes the whole style down. It did, again, writing this.
    const hasFp = ['==', ['get', 'fp'], 1];
    const handoff = (vis, off = 0) => ['interpolate', ['linear'], ['zoom'],
      14, vis, 15.5, ['case', hasFp, off, vis]];
    return {
      'circle-color': ['case', town, 'rgba(0,0,0,0)', colour],
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        11, base, 14, base * 1.5, 15.5, ['case', hasFp, 0, base * 1.5]],
      // No zoom term below the handoff: these are the same whether you are
      // looking at the world or at a city.
      'circle-opacity': ['interpolate', ['linear'], ['zoom'],
        14, ['case', town, 0, 0.92],
        15.5, ['case', town, 0, ['case', hasFp, 0, 0.92]]],
      'circle-stroke-color': ['case', town, colour, halo],
      // The ring thickens with zoom because it is proportionally thinner as
      // the dot grows, and a town ring stays thicker than a halo since for
      // town dots the ring IS the marker.
      'circle-stroke-width': z(['case', town, 1.6, 0.8], ['case', town, 2.2, 1.8]),
      // The ring goes with the dot, or a halo hangs over the roof alone.
      'circle-stroke-opacity': handoff(0.95),
    };
  }

  // Theme-independent, like the epicentre layer and for the same reason: these
  // are the fuel's colours, not the app's, so they must not go through
  // THEME_PAINT - which is a flat [layer, property, fn] list that would clobber
  // the match expression with a single constant on the first day/night toggle.
  function plantPaint() {
    const fuel = ['match', ['get', 'f'],
      ...Object.entries(FUEL_COLOUR).flatMap(([k, v]) => [k, v]), FUEL_COLOUR.other];
    // sqrt, so AREA tracks capacity rather than radius: linear radius makes a
    // 6.8 GW dam look four times a 400 MW peaker instead of seventeen times.
    const cap = ['sqrt', ['/', ['max', 1, ['to-number', ['get', 'smw'], 0]], 100]];
    const k = ['get', 'k'];
    const z = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
    return {
      'circle-color': fuel,
      // Capped at each stop so a dam does not swallow a county at low zoom.
      'circle-radius': z(2, ['min', 7, ['*', 1.3, cap]],
                         6, ['min', 14, ['*', 2.4, cap]],
                         11, ['min', 34, ['*', 5.5, cap]]),
      // Barely filled: these are rings, and the fill is only there so a small
      // dot still reads as its fuel colour when the ring is a hairline.
      //
      // Emptied entirely when the coordinate is only approximate, which is the
      // same thing hollow means on a town-geocoded site dot: the ring says
      // "somewhere around here", not "this switchyard". 47% of the global
      // records are graded that way by GEM itself.
      'circle-opacity': ['case', ['==', ['get', 'ax'], 1], 0,
        ['match', k, 'op', 0.26, 'plan', 0.14, 0.05]],
      'circle-stroke-color': fuel,
      'circle-stroke-width': z(2, 1, 11, 2.2),
      // Retired plants stay faint. They are on the map because the
      // interconnection may be reusable, not because anything is running.
      'circle-stroke-opacity': ['match', k, 'op', 0.95, 'plan', 0.7, 0.5],
    };
  }

  function fabPaint() {
    // sqrt of the estimate where there is one, a fixed small dot where there is
    // not - so an unknown fab reads as present-but-unmeasured rather than tiny.
    const cap = ['sqrt', ['/', ['max', 100, ['to-number', ['get', 'mw'], 100]], 100]];
    const z = (...st) => ['interpolate', ['linear'], ['zoom'], ...st];
    return {
      'circle-color': FAB_COLOUR,
      'circle-radius': z(2, ['min', 8, ['*', 2.2, cap]], 6, ['min', 15, ['*', 3.6, cap]],
                         11, ['min', 30, ['*', 7, cap]]),
      'circle-opacity': ['match', ['get', 'k'], 'operating', 0.9, 0.45],
      'circle-stroke-color': '#4A0E28',
      'circle-stroke-width': 1.4,
      'circle-stroke-opacity': 0.95,
    };
  }

  // Footprint stroke widths scale with zoom. A footprint is looked at from two
  // distances that want opposite things: zoomed out it is one shape among
  // hundreds and must stay a hairline or the layer turns into a blur of
  // outlines, and zoomed in it is the subject and should be a line you can
  // trace around a roof.
  const fpWidth = (base) => ['interpolate', ['linear'], ['zoom'],
    9, base * 0.65, 14, base, 18, base * 1.7];

  function buildStyle() {
    const c = pal();
    const clamp01 = (e) => ['min', 1, ['max', 0, e]];
    return {
      version: 8,
      // Served out of data/raw/glyphs by src/basemap_tiles.py. This pointed at
      // demotiles.maplibre.org - MapLibre's DEMO host - which was harmless only
      // because the style had no symbol layers to spend a glyph on. It has now.
      glyphs: '/glyphs/{fontstack}/{range}.pbf',
      sources: {
        basemap: { type: 'geojson', data: basemap },
        cty: { type: 'geojson', data: ctyFC },
        ercot: { type: 'geojson', data: ercotFC },
        pjm: { type: 'geojson', data: pjmFC },
        nyiso: { type: 'geojson', data: nyisoFC },
        quake: { type: 'geojson', data: quakeFC },
        epicentre: { type: 'geojson', data: epicentreFC },
        hex: { type: 'geojson', data: hexFC },
        plant: { type: 'geojson', data: plantFC },
        fab: { type: 'geojson', data: fabFC },
        sites: { type: 'geojson', data: sitesFC },
        fp: { type: 'geojson', data: footprints },
        regrid: { type: 'geojson', data: regridFC },
        'regrid-dot': { type: 'geojson', data: regridDotFC },
        precisely: { type: 'geojson', data: preciselyFC },
        'precisely-dot': { type: 'geojson', data: preciselyDotFC },
        sub: { type: 'geojson', data: subFC },
        pts: { type: 'geojson', data: ptFC },
        evring: { type: 'geojson', data: evRingFC },
        evdot: { type: 'geojson', data: evDotFC },
        deplink: { type: 'geojson', data: depLinkFC },
        // OSM transmission corridors. Off by default: it is a lot of line
        // work and it answers a different question from everything else here.
        'supply-line': { type: 'geojson', data: supplyLineFC },
        'supply-dot': { type: 'geojson', data: supplyDotFC },
        'supply-site': { type: 'geojson', data: supplySiteFC },
        'fp-loc': { type: 'geojson', data: fpLocFC },
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
        // Footprints sit under every dot: the shape is what a dot stands ON,
        // and a marker's first job is to stay findable. Campus boundaries are
        // dashed - a fence line, not a roof - and barely filled, so imagery
        // stays readable inside one. line-dasharray cannot vary per feature,
        // hence a line layer per kind over the one fill.
        //
        // Each line is CASED: a dark, wider line underneath the coloured one.
        // Over our own basemap a bare line is fine, but over imagery the
        // background is whatever was on the ground that day - a white roof, wet
        // asphalt, a solar array - and no single colour survives all of them.
        // A casing does, because it puts a dark edge against the light
        // backgrounds and the bright line against the dark ones.
        //
        // Dash lengths are in multiples of the LINE WIDTH, so the casing's
        // array is scaled by the width ratio (1.8/3.6) to make its dashes land
        // on exactly the same pixels as the line it sits under.
        // Barely tinted, and deliberately so. The fill's job is to give the
        // shape a clickable interior and a hint of where it is; the cased
        // outline is what makes it findable. At the 0.13 it started from, a
        // magenta wash sat over every roof and hid the thing the footprint is
        // there to help you look at.
        // Regrid parcels sit UNDER the footprints: the comparison the layer
        // exists for reads as a pink building standing on an azure lot, and
        // dashes keep the boundary legible where the two lines coincide.
        { id: 'regrid-fill', type: 'fill', source: 'regrid',
          layout: { visibility: 'none' },
          paint: { 'fill-color': c.regrid, 'fill-opacity': 0.06 } },
        { id: 'regrid-line', type: 'line', source: 'regrid',
          layout: { visibility: 'none' },
          paint: { 'line-color': c.regrid, 'line-width': fpWidth(1.6),
            'line-dasharray': [2, 1.6], 'line-opacity': 0.95 } },
        // A hollow ring, not a disc: most of these parcels have a site dot at
        // the same coordinate, and a disc would sit on top of it. The ring
        // hands over to the actual lot lines between z12 and z13.5.
        { id: 'regrid-dot', type: 'circle', source: 'regrid-dot',
          layout: { visibility: 'none' },
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 6, 8, 8, 12, 10],
            'circle-stroke-color': c.regrid,
            'circle-stroke-width': 2,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
              12, 0.95, 13.5, 0] } },
        // Precisely, the second vendor on trial: identical treatment in
        // violet, so agreement and disagreement with Regrid's azure lots are
        // both visible at a glance.
        { id: 'precisely-fill', type: 'fill', source: 'precisely',
          layout: { visibility: 'none' },
          paint: { 'fill-color': c.precisely, 'fill-opacity': 0.06 } },
        { id: 'precisely-line', type: 'line', source: 'precisely',
          layout: { visibility: 'none' },
          paint: { 'line-color': c.precisely, 'line-width': fpWidth(1.6),
            'line-dasharray': [2, 1.6], 'line-opacity': 0.95 } },
        { id: 'precisely-dot', type: 'circle', source: 'precisely-dot',
          layout: { visibility: 'none' },
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 6, 8, 8, 12, 10],
            'circle-stroke-color': c.precisely,
            'circle-stroke-width': 2,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
              12, 0.95, 13.5, 0] } },
        // The green thread from a campus to the plant somebody has tied it
        // to. Below the dots deliberately: a link is a relationship between
        // two subjects, and must never cover either one.
        { id: 'ev-fill', type: 'fill', source: 'evring',
          layout: { visibility: 'visible' },
          paint: { 'fill-color': '#B91C1C', 'fill-opacity': 0.07 } },
        { id: 'ev-ring', type: 'line', source: 'evring',
          layout: { visibility: 'visible' },
          paint: { 'line-color': '#B91C1C', 'line-width': 1.6,
                   'line-dasharray': [3, 2], 'line-opacity': 0.85 } },
        { id: 'ev-dot', type: 'circle', source: 'evdot',
          layout: { visibility: 'visible' },
          paint: { 'circle-color': '#B91C1C',
                   'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3.5, 10, 7],
                   'circle-stroke-color': '#fff', 'circle-stroke-width': 1.8 } },
        // Corridors sit at the BOTTOM of the overlay stack — under the
        // dependency edges, under every dot, and under the dropped-point
        // labels. The ordering is the argument: a corridor is context, a
        // dependency edge is evidence, and evidence must never be buried
        // under context. Placing it above pt-label let 9,368 grey lines
        // cross the text of hand-dropped pins.
        // power-line is added by initTransmission(), before pt-dot, once the
        // tile archive (or its GeoJSON fallback) is known to be there.
        { id: 'pt-dot', type: 'circle', source: 'pts',
          layout: { visibility: 'visible' },
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8, 14, 11],
            'circle-stroke-color': ['case', ['==', ['get', 'kind'], ''], '#7c3aed', '#0E8A7C'],
            'circle-stroke-width': 2.4 } },
        { id: 'pt-label', type: 'symbol', source: 'pts',
          layout: { visibility: 'visible', 'text-field': ['get', 'n'], 'text-size': 11,
                    'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': false },
          paint: { 'text-color': '#5b21b6', 'text-halo-color': '#fff', 'text-halo-width': 1.4,
                   'text-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0, 10, 1] } },
        { id: 'dep-line', type: 'line', source: 'deplink',
          layout: { 'line-cap': 'round', visibility: 'visible' },
          paint: { 'line-color': '#D97706',
            'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 9, 2, 14, 3],
            'line-dasharray': [2, 1.6],
            'line-opacity': 0.85 } },
        // Amber, and square-shouldered: every other node layer on this map
        // is a circle, so a substation reads as a different KIND of thing at
        // a glance rather than as another asset. Size follows how many loads
        // stand behind it - the accumulation is the point.
        { id: 'sub-dot', type: 'circle', source: 'sub',
          layout: { visibility: 'visible' },
          paint: {
            'circle-color': '#D97706',
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              3, ['case', ['>', ['get', 'as'], 1], 4, 2.5],
              8, ['case', ['>', ['get', 'as'], 1], 8, 5],
              13, ['case', ['>', ['get', 'as'], 1], 13, 8]],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.6,
            'circle-opacity': 0.92 } },
        // A ring around the ones carrying more than one load: the shared
        // points are the whole reason this layer exists, so they are the
        // ones visible from further out.
        { id: 'sub-share', type: 'circle', source: 'sub',
          filter: ['>', ['get', 'as'], 1],
          layout: { visibility: 'visible' },
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 8, 8, 14, 13, 22],
            'circle-stroke-color': '#D97706',
            'circle-stroke-width': 1.6,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.75, 12, 0.25] } },
        { id: 'sub-label', type: 'symbol', source: 'sub',
          layout: { visibility: 'visible',
            'text-field': ['get', 'n'],
            'text-size': 11,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-allow-overlap': false },
          paint: { 'text-color': '#B45309', 'text-halo-color': '#fff',
                   'text-halo-width': 1.4,
                   'text-opacity': ['interpolate', ['linear'], ['zoom'], 8.5, 0, 9.5, 1] } },
        { id: 'supply-line', type: 'line', source: 'supply-line',
          layout: { 'line-cap': 'round', visibility: 'visible' },
          paint: { 'line-color': c.supply,
            'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 9, 2.5, 14, 4],
            'line-opacity': 0.85 } },
        // A pair 4-40 km apart is a subpixel from orbit, so the ring marks
        // where a link EXISTS from world zoom and dissolves once the line
        // itself is legible - the vendor rings' trick at a wider zoom band.
        { id: 'supply-dot', type: 'circle', source: 'supply-dot',
          layout: { visibility: 'visible' },
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 7, 8, 9],
            'circle-stroke-color': c.supply,
            'circle-stroke-width': 2,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
              7.5, 0.9, 9, 0] } },
        // Where a verified pairing's campus is not a registry dot yet, the
        // thread still needs an end: hollow green, fading in exactly as the
        // locator ring above fades out.
        { id: 'supply-site', type: 'circle', source: 'supply-site',
          layout: { visibility: 'visible' },
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 13, 7],
            'circle-stroke-color': c.supply,
            'circle-stroke-width': 1.8,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
              7.5, 0, 9, 0.9] } },
        // The footprint layer's own vendor-ring trick: shapes only load from
        // z11, so these tiny hollow rings say "footprints mapped here" from
        // orbit and dissolve exactly as the real outlines take over. At the
        // very bottom of the thematic stack - a locator loses to everything.
        { id: 'fp-loc', type: 'circle', source: 'fp-loc',
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 6, 3.5, 10, 6],
            'circle-stroke-color': c.fp,
            'circle-stroke-width': 1.1,
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'],
              0, 0.5, 8, 0.65, 10.5, 0.65, 11.5, 0] } },
        { id: 'fp-fill', type: 'fill', source: 'fp',
          paint: { 'fill-color': c.fp,
            'fill-opacity': ['case', ['==', ['get', 'kind'], 'campus'], 0.04, 0.07] } },
        // Inferred halls are drawn a shade back from asserted ones. Same
        // colour and same shape - they are footprints either way - but a
        // building nobody labelled should not look as certain on the map as
        // one somebody did.
        // Overture fades with osm-site: both are inferences - a big building
        // on a known site, a model's read of a roof - not somebody's label.
        { id: 'fp-line-case', type: 'line', source: 'fp',
          filter: ['!=', ['get', 'kind'], 'campus'],
          paint: { 'line-color': c.fpCase, 'line-width': fpWidth(2.6),
            'line-opacity': ['case',
              ['in', ['get', 'src'], ['literal', ['osm-site', 'overture']]], 0.5, 0.85] } },
        { id: 'fp-line', type: 'line', source: 'fp',
          filter: ['!=', ['get', 'kind'], 'campus'],
          paint: { 'line-color': c.fp, 'line-width': fpWidth(1.3),
            'line-opacity': ['case',
              ['in', ['get', 'src'], ['literal', ['osm-site', 'overture']]], 0.62, 1] } },
        // A derived boundary fades the same way an inferred hall does. It is
        // the hull of the buildings, not a line anybody surveyed, and it must
        // not read as firmly as a parcel somebody mapped.
        { id: 'fp-line-campus-case', type: 'line', source: 'fp',
          filter: ['==', ['get', 'kind'], 'campus'],
          paint: { 'line-color': c.fpCase, 'line-width': fpWidth(3.2),
            'line-opacity': ['case', ['==', ['get', 'src'], 'derived'], 0.45, 0.85],
            'line-dasharray': [1.5, 1] } },
        { id: 'fp-line-campus', type: 'line', source: 'fp',
          filter: ['==', ['get', 'kind'], 'campus'],
          paint: { 'line-color': c.fp, 'line-width': fpWidth(1.6),
            'line-opacity': ['case', ['==', ['get', 'src'], 'derived'], 0.6, 1],
            'line-dasharray': [3, 2] } },
        // The hexagon form of the heatmap. Above every fill and ring that
        // is context (zones, parcels, footprint rings, the dependency graph)
        // and below the marker layers that stay clickable while it is on -
        // plants, fabs, epicentres. The dot layers it replaces are hidden by
        // applyVisibility while it is showing. Colour is set by applyHeat
        // because it depends on the domain; the hairline is the one part
        // that is fixed: a light seam between cells, so two neighbours of
        // one shade still read as two cells and not one blob.
        { id: 'hex-fill', type: 'fill', source: 'hex', layout: { visibility: 'none' },
          filter: ['>', ['get', 'v'], 0],
          paint: { 'fill-color': '#9AA7B2', 'fill-opacity': 0.7,
            'fill-outline-color': 'rgba(255,255,255,0.45)' } },
        // Cells with nothing to sum. A SEPARATE layer, and hatched rather
        // than shaded, because "not measured" is a different kind of answer
        // from "lowest" - the same claim the grey dots make. Shading could
        // not carry it here: composited over the land, a grey cell and the
        // palest step of a one-hue ramp came out at 1.04:1 against each
        // other, one flat field to any eye and identical to a colour-blind
        // one. A texture is categorical, it survives any ramp, and the gaps
        // show the ground through - which is the point being made.
        { id: 'hex-none', type: 'fill', source: 'hex', layout: { visibility: 'none' },
          filter: ['<=', ['get', 'v'], 0],
          paint: { 'fill-pattern': 'hex-hatch-day', 'fill-opacity': 0.85 } },
        // Under the site dots on purpose: generation is the context this app
        // reads data centres against, not the subject.
        { id: 'plant', type: 'circle', source: 'plant', layout: { visibility: 'none' },
          paint: plantPaint() },
        { id: 'fab', type: 'circle', source: 'fab', layout: { visibility: 'none' },
          paint: fabPaint() },
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
            // Red where the shaking actually reached a registry site, slate
            // where it did not. Slate rather than nothing: an unexposed event
            // used to draw a fully transparent fill behind a #9aa7b2 hairline,
            // which on the light basemap made an M7.7 in the Flores Sea read
            // the same as empty ocean. "No site was shaken" is a fact about
            // the registry, not a reason to hide the earthquake.
            'circle-color': ['case', ['>', ['coalesce', ['get', 'exposed'], 0], 0],
              '#d7263d', '#94A3B8'],
            'circle-opacity': 0.5,
            'circle-stroke-color': ['case', ['>', ['coalesce', ['get', 'exposed'], 0], 0],
              '#d7263d', '#475569'],
            // Magnitude carries in the outline too, so the big ones stay
            // legible when a cluster of aftershocks overlaps them.
            'circle-stroke-width': ['interpolate', ['linear'], ['get', 'mag'],
              5, 1, 6, 1.4, 7, 2, 8, 2.6],
          } },
        { id: 'sites-ai', type: 'circle', source: 'sites',
          filter: ['==', ['get', 'ft'], 'ai'],
          paint: dotPaint(c.ai, c.halo, 5) },
      ],
    };
  }

  // The view IS the URL, in Google Maps' own dialect: /@lat,lon,4370m
  // (or ...,12z). The path is parsed for the opening camera and rewritten
  // on every pan and zoom, so the address bar is always a shareable link
  // back to this exact view. The metres form is what Google shares: the
  // viewport's ground height, which converts through the web-mercator
  // ground resolution (156543.03 * cos(lat) / 2^z metres per pixel).
  const GROUND = 156543.03392;
  const viewH = () => document.getElementById('map2d').clientHeight || 800;
  const zoomForMetres = (m, lat) =>
    Math.log2(GROUND * Math.cos(lat * Math.PI / 180) * viewH() / Math.max(1, m));
  const metresForZoom = (z, lat) =>
    Math.round(GROUND * Math.cos(lat * Math.PI / 180) * viewH() / Math.pow(2, z));
  let initCenter = [-30, 28], initZoom = 1.7;
  // /maps/@lat,lon,zoom is the canonical camera, spelled the way Google
  // spells it. The bare /@... form is still read here as well as redirected
  // server-side: the redirect handles a fresh navigation, and this handles a
  // link opened straight into an already-running page.
  const atPath = location.pathname.match(
    /^(?:\/maps)?\/@(-?[\d.]+),(-?[\d.]+)(?:,([\d.]+)(m|z))?/);
  const oldHash = location.hash.match(/^#v=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
  if (atPath) {
    const lat = +atPath[1];
    initCenter = [+atPath[2], lat];
    initZoom = atPath[4] === 'z' ? +atPath[3]
      : atPath[4] === 'm' ? zoomForMetres(+atPath[3], lat)
      : 14;
  } else if (oldHash) {
    // The short-lived #v= links keep working.
    initCenter = [+oldHash[3], +oldHash[2]];
    initZoom = +oldHash[1];
  }

  const map = new maplibregl.Map({
    container: 'map2d',
    style: buildStyle(),
    center: initCenter,
    zoom: Math.max(0, Math.min(22, initZoom)),
    attributionControl: false,
  });
  map.on('moveend', () => {
    const c = map.getCenter();
    // replaceState, not pushState: panning is one continuous act, not a
    // browser-history entry per wiggle. Deep-link params are dropped once
    // the camera moves - the view in the bar is now the truth to share.
    history.replaceState(null, '', '/maps/@' + c.lat.toFixed(7) + ','
      + c.lng.toFixed(7) + ',' + metresForZoom(map.getZoom(), c.lat) + 'm');
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  // A bar that says how far. Every distance on this map - a 3 km nearby-dot
  // radius, a substation's reach, how far a dot moved when somebody corrected
  // it - is quoted in kilometres, and until now the map gave no way to see
  // what a kilometre looks like at the current zoom. Metric only: the registry
  // states distances in km throughout and a bar that disagreed with the prose
  // would be worse than no bar.
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }),
                 'bottom-left');

  // North stays up. On a 2D registry map, rotation (right-drag, touch twist,
  // shift+arrows) and touch pitch only ever happen by accident, and with the
  // compass hidden there is no control to undo them with.
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();
  if (map.keyboard && map.keyboard.disableRotation) map.keyboard.disableRotation();

  window.__map = map; window.__state = state; // test hooks

  // Wait for the map to be genuinely ready, EVEN IN A HIDDEN TAB.
  //
  // Browsers suspend requestAnimationFrame while a tab or pane is hidden, and
  // MapLibre's render loop rides on rAF. A map built while hidden therefore
  // never finishes: isStyleLoaded() stays false, getLayer() returns undefined
  // for layers that are right there in the style, and queryRenderedFeatures
  // comes back empty. Every one of those reads EXACTLY like a broken layer,
  // which has now cost two debugging sessions chasing a bug that was not
  // there.
  //
  // It cannot be worked around from in here, and it is worth being exact
  // about why. MapLibre's Style.loadJSON wraps _load in frameAsync(), a
  // requestAnimationFrame promise. Hidden means that promise never settles,
  // so there is no parsed style at all - map.redraw() has nothing to render
  // and pumping it from setTimeout (which IS still delivered, throttled to
  // about 1 Hz) changes nothing. Measured: 26 pumps over 25 s, style still
  // unparsed. Nor is this a bug to fix: a background tab that declines to
  // build a WebGL scene is behaving correctly, and a reader who focuses the
  // tab gets their map.
  //
  // So the fix is to make the deadlock ANNOUNCE ITSELF instead of looking
  // like a broken layer. Anything driving this map from automation should
  // await __mapReady() first and read `blocked`.
  window.__mapReady = (timeoutMs = 20000) => new Promise((resolve) => {
    const t0 = Date.now();
    // Three states, because they license different assertions:
    //   parsed  - getStyle()/getLayer() are meaningful. Layer existence and
    //             querySourceFeatures() can be trusted.
    //   settled - tiles have actually rendered, so queryRenderedFeatures()
    //             is meaningful too. Needs CONTINUOUS frames.
    // A hidden pane gets neither until something composites it; one
    // screenshot buys 'parsed', sustained visibility buys 'settled'.
    const parsed = () => { try { return !!map.getStyle(); } catch { return false; } };
    const st = () => ({ hidden: document.hidden, ms: Date.now() - t0,
      parsed: parsed(), settled: map.isStyleLoaded() && map.loaded() });
    const tick = () => {
      const s = st();
      if (s.settled) return resolve({ ok: true, rendered: true, ...s });
      // Parsed but not settled is the normal hidden-pane state after one
      // forced frame: assert on layers, do NOT trust rendered-feature reads.
      if (s.parsed && document.hidden && s.ms > 600) {
        return resolve({ ok: true, rendered: false, ...s,
          note: 'Style parsed, tiles not settled (pane hidden). getLayer and '
              + 'querySourceFeatures are valid; queryRenderedFeatures may return [].' });
      }
      if (!s.parsed && document.hidden && s.ms > 1000) {
        return resolve({ ok: false, rendered: false, blocked: 'hidden-tab', ...s,
          why: 'The pane or tab is hidden, so requestAnimationFrame is suspended and '
             + 'MapLibre never runs the frame its style load is wrapped in. getLayer() '
             + 'returns undefined for layers that are present and fine.',
          remedy: 'Force one composited frame - screenshot the pane, or show it - then '
                + 'call again. Do not read this as a missing layer.' });
      }
      if (s.ms > timeoutMs) return resolve({ ok: false, rendered: false, blocked: 'timeout', ...s });
      setTimeout(tick, 100);
    };
    tick();
  });

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
    // One layer, two MapLibre layers under it: AI and traditional dots differ
    // in colour and size, which is a paint difference, not a subject one. The
    // kind chips below decide which of the two is drawn.
    facilities: ['sites', 'sites-ai'],
    footprints: ['fp-fill', 'fp-line-case', 'fp-line', 'fp-line-campus-case', 'fp-line-campus', 'fp-loc'],
    regrid: ['regrid-fill', 'regrid-line', 'regrid-dot'],
    precisely: ['precisely-fill', 'precisely-line', 'precisely-dot'],
    supply: ['supply-line', 'supply-dot', 'supply-site'],
    subs: ['sub-share', 'sub-dot', 'sub-label'],
    trans: ['dep-line'],
    lines: ['power-line'],
    water: ['water-fill', 'water-line'],
    points: ['pt-dot', 'pt-label'],
    events: ['ev-fill', 'ev-ring', 'ev-dot'],
    ercot: ['ercot', 'ercot-line'],
    pjm: ['pjm', 'pjm-line'],
    nyiso: ['nyiso', 'nyiso-line'],
    countries: ['cty'],
    quake: ['quake', 'epicentre'],
    plants: ['plant'],
    fabs: ['fab'],
  };
  // Traditional and AI facilities are separate layers over the same source;
  // each keeps its kind filter, and the search facet composes on top.
  const KIND_FILTER = {
    sites: ['!=', ['get', 'ft'], 'ai'],
    'sites-ai': ['==', ['get', 'ft'], 'ai'],
  };

  // Where the dot hands the site over to its own footprint. The paint fades
  // the dot out between z14 and here (see dotPaint); at this zoom the feature
  // leaves the layer altogether.
  //
  // Fading alone was not enough, and the reason is worth keeping: a circle
  // with radius 0 and opacity 0 is invisible but STILL ANSWERS
  // queryRenderedFeatures, so the dot stayed clickable - a target you cannot
  // see, sitting on top of the roof you are trying to click. A filter is the
  // honest instrument: a filtered-out feature is not rendered and not hit,
  // and every consumer - click, hover cursor, the search-facet paths - reads
  // the same truth without being told about zoom.
  const FP_HANDOFF_ZOOM = 15.5;
  const handoffClause = () =>
    (map.getZoom() >= FP_HANDOFF_ZOOM ? ['!=', ['get', 'fp'], 1] : null);
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
  // The list is a filter on the map, not a separate view of the same data.
  // Set by the list to a Set of ids whenever anything is filtering there, and
  // null when nothing is - null rather than a Set of all 6,263 so the common
  // case costs no lookup and the map's own layer expression stays untouched.
  let listIds = null;
  const inList = (d) => !listIds || listIds.has(d.id);

  const dcKind = (d) => (d.ft === 'ai' ? 'ai' : 'traditional');
  const dcOn = (d) => !state.dcKinds || state.dcKinds.has(dcKind(d));

  // The worklist filter: assets with no footprint. The flag is only ever
  // present (fp: 1) on outlined assets, so "missing" is the absent key.
  // Spelled twice, declared once - `unmapped` for the JS predicates and
  // unmappedClause() below for the MapLibre layer filters, the same pairing
  // dcOn/KIND_FILTER and fuelOn/plantClause already use. It used to be the
  // clause alone, which is how the dot layers came to honour this filter
  // while shown() did not: the 2D map drew 37 dots and the count underneath
  // said 6,289, and anything else reading shown() - the globe, the heat
  // domain, the timeline - was reading the wrong 6,289 too.
  const unmapped = (d) => !state.fpOnly || !d.fp;

  // "Hide no-value dots" from the distribution panel. Active only while the
  // ramp is painting, and implemented as a FILTER through this file's normal
  // visibility machinery - shown() for the count/globe/search, a MapLibre
  // filter clause per layer for 2D - never as transparent paint, which would
  // leave invisible dots hoverable and a title count that lies.
  const hideMissingActive = () => !!(state.heat.on && state.heat.hideMissing);
  // The heatmap in its hexagon form: the dots are binned rather than drawn.
  // Off with the heat switch, whatever the hex toggle says - the switch is
  // the master, the toggle picks the form.
  const hexOn = () => !!(state.heat.on && state.heat.hex);
  // True for a layer the cells are currently built from - one whose own
  // markers step aside for them. Every facility layer that is on is in the
  // cells, so this is just "hexagons, and this layer is drawn".
  const aggregated = (kind) => {
    if (!hexOn()) return false;
    const K = HEX_KINDS.find(x => x.kind === kind);
    return !!(K && state.layers[K.layer]);
  };
  // heatHas and heatSpec are defined with the heatmap block far below; both
  // are only ever CALLED at runtime, the same arrangement pointColour uses.
  const hideMissingClause = (which) => {
    if (!hideMissingActive()) return null;
    const m = heatSpec();
    const key = which === 'plant' ? m.pk : which === 'fab' ? m.fk : m.k;
    if (!key) return null;   // measure means nothing on this layer: not grey, keep
    return m.zeroIsReal ? ['has', key] : ['>', ['to-number', ['get', key], 0], 0];
  };

  const shown = () => drawable.filter(d =>
    state.layers.facilities && dcOn(d) && unmapped(d) &&
    matchesFilter(d) && inTime(d) && inList(d) &&
    (!hideMissingActive() || heatHas(d)));

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
    // Sitting under the layer's own name now, so it does not repeat it. The
    // hollow note is the other thing worth knowing about these dots and had
    // nowhere to be said before.
    dotcount.textContent = `${n.toLocaleString()} shown — hollow means the location `
                         + 'is approximate';
  }

  updateCount();   // paint the real number now; the style takes seconds to load

  // The layer-filter spelling of `unmapped` above.
  const unmappedClause = () => (state.fpOnly ? ['!', ['has', 'fp']] : null);

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
        if (listIds) parts.push(['in', ['get', 'id'], ['literal', [...listIds]]]);
        const dc = dateClause();
        if (dc) parts.push(dc);
        const hm = hideMissingClause('site');
        if (hm) parts.push(hm);
        const uc = unmappedClause();
        if (uc) parts.push(uc);
        // Zoomed in past the handoff, a footprint-bearing site IS its
        // footprint; the dot would only be in the way.
        const ho = handoffClause();
        if (ho) parts.push(ho);
        map.setFilter(id, parts.length > 1 ? ['all', ...parts] : kind);
      }
    }
    if (map.getLayer('epicentre')) map.setFilter('epicentre', eventClause());
    if (map.getLayer('plant')) {
      const pp = [plantClause(), hideMissingClause('plant'), unmappedClause()].filter(Boolean);
      map.setFilter('plant', pp.length > 1 ? ['all', ...pp] : (pp[0] || null));
    }
    // The fab layer never had a filter before this; null clears it again.
    if (map.getLayer('fab')) {
      const fp_ = [hideMissingClause('fab'), unmappedClause()].filter(Boolean);
      map.setFilter('fab', fp_.length > 1 ? ['all', ...fp_] : (fp_[0] || null));
    }
    for (const [key, ids] of Object.entries(LAYER_IDS)) {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', state.layers[key] ? 'visible' : 'none');
        }
      }
    }
    // The kind chips ride on top of the layer toggle: switching the layer off
    // hides both, and with it on each kind answers for itself.
    if (state.layers.facilities) {
      for (const [id, kind] of [['sites', 'traditional'], ['sites-ai', 'ai']]) {
        if (!map.getLayer(id)) continue;
        const on = !state.dcKinds || state.dcKinds.has(kind);
        map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      }
    }
    // The aggregated layer's own dots are not drawn: at world zoom a dense
    // cell is 17 px wide and holds a hundred 6 px dots, so the colour the
    // cell exists to show would be buried under exactly the records it
    // counts. Only the SUBJECT's - the other layers stay drawn on top, in
    // their own colours, because plant rings over data-centre cells is the
    // comparison the form is for. The records are still in the set the
    // cells are built from; this hides the markers, not the data.
    if (hexOn()) {
      for (const K of HEX_KINDS) {
        if (!state.layers[K.layer]) continue;
        for (const id of K.dots) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }
      }
    }
    updateCount();
    // The ramp is scaled to what is on screen, so it has to be rebuilt
    // whenever what is on screen changes.
    if (window.__applyHeat) window.__applyHeat();
  }
  // 'styledata' fires repeatedly DURING style load, and setLayoutProperty
  // throws while the style is loading - which wedged the style in a permanently
  // "not done loading" state. 'style.load' fires once, after load completes.
  map.on('load', applyVisibility);
  // Re-filter only when the handoff threshold is actually crossed. Refiltering
  // on every zoom frame would rebuild both dot layers' filters continuously
  // for a change that happens twice a session.
  let pastHandoff = null;
  map.on('zoom', () => {
    const now = map.getZoom() >= FP_HANDOFF_ZOOM;
    if (now === pastHandoff) return;
    pastHandoff = now;
    applyVisibility();
  });
  map.on('style.load', applyVisibility);

  for (const id of ['sites', 'sites-ai']) {
    map.on('click', id, (e) => {
      // Mid-edit, a click is aimed at geometry; opening a page over the
      // editor would be the map changing the subject.
      if (state.fpEdit) return;
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
  // "12 assets" answers nothing - a shaken fab and a shaken solar farm are
  // different events. Counts are carried per kind and read out per kind.
  const KIND_1 = { dc: 'data centre', plant: 'power plant', fab: 'fab' };
  const KIND_N = { dc: 'data centres', plant: 'power plants', fab: 'fabs' };
  const kindList = (q) => ['dc', 'plant', 'fab']
    .filter(k => q[k]).map(k => `${q[k]} ${q[k] === 1 ? KIND_1[k] : KIND_N[k]}`)
    .join(', ') || `${q.exposed} assets`;

  map.on('mousemove', 'epicentre', (e) => {
    const q = e.features[0].properties;
    map.getCanvas().style.cursor = q.detail ? 'pointer' : '';
    const when = new Date(+q.time).toISOString().slice(0, 10);
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      `<div class="t">M${q.mag} — ${esc(q.place)}</div>` +
      `<div class="d">${when} · depth ${q.depthKm} km</div>` +
      `<div class="d">${q.exposed ? `${kindList(q)} shaken, max MMI ${q.maxMmi}`
        : q.near200 ? `${q.near200} assets within 200 km, none shaken at MMI 2+`
        : 'nothing within 200 km'}</div>` +
      (q.detail ? '<div class="d">click for its ShakeMap and exposure</div>' : ''));
  });
  map.on('mouseleave', 'epicentre', () => { map.getCanvas().style.cursor = ''; hideTip(); });

  // A dot under the cursor wins: the plant rings are large and would otherwise
  // steal the tooltip from every data centre sitting inside one.
  map.on('mousemove', 'plant', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai'] }).length) return;
    showTip(e.originalEvent.clientX, e.originalEvent.clientY, plantTip(e.features[0].properties));
  });
  map.on('mouseleave', 'plant', hideTip);
  // A dot you cannot open is a dead end. Sites have had a page since the start;
  // plants and fabs only got one when /plant and /fab were added, so the click
  // is wired here rather than at layer-creation time.
  map.on('click', 'plant', (e) => {
    if (state.fpEdit) return;     // see the sites handler above
    const f = e.features && e.features[0];
    if (f) window.open('/maps/plant/' + encodeURIComponent(f.properties.id), '_blank', 'noopener');
  });
  map.on('mouseenter', 'plant', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'plant', () => { map.getCanvas().style.cursor = ''; });

  map.on('mousemove', 'fab', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai'] }).length) return;
    showTip(e.originalEvent.clientX, e.originalEvent.clientY, fabTip(e.features[0].properties));
  });
  map.on('mouseleave', 'fab', hideTip);
  map.on('click', 'fab', (e) => {
    if (state.fpEdit) return;     // see the sites handler above
    const f = e.features && e.features[0];
    if (f) window.open('/maps/fab/' + encodeURIComponent(f.properties.id), '_blank', 'noopener');
  });
  map.on('mouseenter', 'fab', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'fab', () => { map.getCanvas().style.cursor = ''; });

  // ---- Regrid parcels --------------------------------------------------------
  // Hover only - the layer is a comparison surface, not a subject, so it gets
  // a tooltip saying whose lot this is and why it was bought, and no page.
  const regridTip = (p) => {
    const meta = [p.ref, p.locality, p.acres ? p.acres + ' ac' : ''].filter(Boolean);
    return `<div class="t">${esc(p.op || 'Parcel')}</div>` +
      (meta.length ? `<div class="d">${esc(meta.join(' \u00b7 '))}</div>` : '') +
      `<div class="d">${p.grp === 'verify'
        ? 'bought to verify against the footprint drawn here'
        : 'new coverage \u2014 no footprint existed for this site'}</div>` +
      `<div class="d">${p.src === 'precisely' ? 'Precisely' : 'Regrid'} parcel</div>`;
  };
  for (const vendor of ['regrid', 'precisely']) {
    map.on('mousemove', `${vendor}-fill`, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai'] }).length) return;
      if (!e.features.length) return hideTip();
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, regridTip(e.features[0].properties));
    });
    map.on('mouseleave', `${vendor}-fill`, hideTip);
    map.on('mousemove', `${vendor}-dot`, (e) => {
      if (!e.features.length) return hideTip();
      const p = e.features[0].properties;
      showTip(e.originalEvent.clientX, e.originalEvent.clientY,
        regridTip(p) + '<div class="d">click to dive to the lot</div>');
    });
    map.on('mouseleave', `${vendor}-dot`, hideTip);
    map.on('mouseenter', `${vendor}-dot`, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('click', `${vendor}-dot`, (e) => {
      if (!e.features.length) return;
      map.flyTo({ center: e.features[0].geometry.coordinates, zoom: 15.3 });
    });
  }

  // Footprint locators: any dot wins the hover and the click; on bare ground
  // a ring dives to where its shapes will actually render.
  const DOT_LAYERS = ['sites', 'sites-ai', 'plant', 'fab'];
  map.on('mousemove', 'fp-loc', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    if (!e.features.length) return hideTip();
    map.getCanvas().style.cursor = 'pointer';
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      '<div class="t">Building footprints mapped here</div>'
      + '<div class="d">click to dive to the outlines</div>');
  });
  map.on('mouseleave', 'fp-loc', () => { map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('click', 'fp-loc', (e) => {
    if (!e.features.length) return;
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    map.flyTo({ center: e.features[0].geometry.coordinates, zoom: 13.2 });
  });

  // The dependency link. The tooltip says what KIND of dependency, because a
  // straight amber line is otherwise indistinguishable from the green supply
  // thread it deliberately is not.
  const DEP_REL = { primary_feed: 'Primary feed', secondary_feed: 'Secondary feed',
    behind_meter: 'Behind the meter', net_metered: 'Net-metered co-location',
    generation_source: 'Injects into', transmission_path: 'Transmission path' };
  map.on('mousemove', 'dep-line', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    if (!e.features.length) return hideTip();
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = 'pointer';
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      `<div class="t">${esc(p.an)} → ${esc(p.bn)}</div>`
      + `<div class="d">${esc(DEP_REL[p.rel] || p.rel)}</div>`
      + '<div class="d">the dependency, drawn straight — not the route the '
      + 'conductors take</div>');
  });
  map.on('mouseleave', 'dep-line', () => { map.getCanvas().style.cursor = ''; hideTip(); });

  // Corridors get a hover tip and NOTHING on click. The server already trims
  // the payload down to these two fields, so without this they shipped on
  // 9,368 features and were never read by anything.
  //
  // Guarded on DOT_LAYERS like every other line handler here: 9,368 grey lines
  // cross a great many dots, and a corridor stealing the hover from a data
  // centre would make the registry's own subject unclickable. Deliberately no
  // click handler - a corridor has no page to open, and it is not evidence of
  // anything a reader should be invited to follow.
  map.on('mousemove', 'power-line', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    if (!e.features.length) return hideTip();
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = 'default';
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      `<div class="t">${esc(p.n || 'Transmission line')}</div>`
      + (p.kv ? `<div class="d">${esc(p.kv)} kV</div>` : '')
      + '<div class="d">a corridor from OpenStreetMap — where the conductors '
      + 'run, not a statement about who is served</div>');
  });
  map.on('mouseleave', 'power-line', () => { map.getCanvas().style.cursor = ''; hideTip(); });
  // The water utility under the cursor: the same facts the site page states,
  // read off the tile. Anything that IS a site beats the area it sits in.
  map.on('mousemove', 'water-fill', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: [...DOT_LAYERS, 'fp-fill'] }).length) {
      return hideTip();
    }
    if (!e.features.length) return hideTip();
    const p = e.features[0].properties;
    map.getCanvas().style.cursor = 'default';
    const n = (v) => (v ? (+v).toLocaleString('en-US') : '');
    showTip(e.originalEvent.clientX, e.originalEvent.clientY,
      `<div class="t">${esc(p.n || 'Community water system')}</div>`
      + (p.pop ? `<div class="d">serving ${n(p.pop)} people` + (p.conn ? `, ${n(p.conn)} connections` : '') + '</div>' : '')
      + `<div class="d">${n(p.s)} registry ${+p.s === 1 ? 'site' : 'sites'} inside · ${esc(p.m || 'boundary')}</div>`
      + `<div class="d">EPA service area · ${esc(p.pwsid)}</div>`);
  });
  map.on('mouseleave', 'water-fill', () => { map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('click', 'dep-line', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    if (e.features.length) window.open('/power#transmission', '_blank', 'noopener');
  });

  // A shared drag: both corner figures are carried onto the map and dropped,
  // so the gesture lives once and each button says what to do with the
  // coordinate it lands on.
  // `dangle` hangs the figure from a pivot ABOVE the cursor and lets it swing,
  // the way the pegman does on Google's map. It is a pendulum rather than a
  // tilt: the lean is driven by how fast the pointer is moving and then springs
  // back, so flicking the figure across the map swings it and stopping lets it
  // settle upright.
  //
  // The pivot sits at the top of the ghost, 30px above the pointer, which is
  // the one detail that keeps this honest: the FEET stay at the cursor at rest
  // and swing in an arc around it, so the drop point is still the point the
  // figure is standing on. Pivoting at the cursor instead would hang the body
  // over the map and put the feet 28px from where the pin actually lands.
  //
  // Only the pin gets it. A lightning bolt is not a thing that hangs from your
  // fingers, and swinging it would say something about the gesture that is not
  // true.
  function dragToDrop(btn, onDrop, { dangle = false } = {}) {
    if (!btn) return;
    btn.addEventListener('dragstart', (e) => e.preventDefault());
    let ghost = null, raf = 0;
    let angle = 0, avel = 0, lean = 0, lastX = null, lastT = 0;  // degrees
    const move = (x, y) => { if (ghost) { ghost.style.left = (x - 14) + 'px'; ghost.style.top = (y - 30) + 'px'; } };

    function swing() {
      if (!ghost) { raf = 0; return; }
      // Spring the angle toward the lean the motion is asking for, then decay
      // the lean itself. That second decay is what makes it settle upright
      // instead of hanging crooked wherever the pointer happened to stop.
      avel += (lean - angle) * 0.15;
      avel *= 0.80;
      angle += avel;
      lean *= 0.88;
      if (Math.abs(angle) < 0.02 && Math.abs(avel) < 0.02 && Math.abs(lean) < 0.02) {
        angle = avel = lean = 0;
      }
      ghost.style.transform = 'rotate(' + angle.toFixed(2) + 'deg)';
      raf = requestAnimationFrame(swing);
    }

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Whatever the last drag left behind goes first. Reassigning `ghost`
      // without this abandons the previous node in the DOM with nothing
      // holding a reference to it - a second figure stuck beside the button
      // that no later pointerup can ever remove, because the handler only
      // knows about the newest one.
      clear();
      try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      ghost = btn.querySelector('svg').cloneNode(true);
      ghost.setAttribute('width', '28'); ghost.setAttribute('height', '28');
      ghost.style.cssText = 'position:fixed;z-index:60;pointer-events:none;fill:currentColor;'
        + 'color:' + getComputedStyle(btn).color
        + ';filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))'
        + (dangle ? ';transform-origin:50% 0' : '');
      document.body.appendChild(ghost);
      document.body.classList.add('pegging');
      angle = avel = lean = 0; lastX = null;
      move(e.clientX, e.clientY);
      if (dangle && !raf) raf = requestAnimationFrame(swing);
    });

    btn.addEventListener('pointermove', (e) => {
      move(e.clientX, e.clientY);
      if (!dangle || !ghost) return;
      const now = performance.now();
      if (lastX != null) {
        // Guard the interval: two moves in the same millisecond would divide
        // by ~0 and fling the figure round like a propeller.
        const dt = Math.max(8, now - lastT);
        const vx = (e.clientX - lastX) / dt * 16;      // px per 60Hz frame
        // A hanging figure lags behind the hand carrying it, so it leans
        // AGAINST the direction of travel.
        // Clamped well short of the angle you actually want to see: the spring
        // overshoots its target by roughly a fifth, so a 32 degree lean peaks
        // near 38 and the figure never looks like it is spinning.
        lean = Math.max(-32, Math.min(32, -vx * 2.0));
      }
      lastX = e.clientX; lastT = now;
    });

    const clear = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (ghost) { ghost.remove(); ghost = null; }
      document.body.classList.remove('pegging');
    };

    btn.addEventListener('pointerup', async (e) => {
      if (!ghost) return;
      clear();
      // Released over the controls, the layer pane, the timeline bar or off
      // the map entirely: no drop. This used to test the canvas RECTANGLE,
      // which is the whole window - so letting go on the very button you
      // picked the figure up from dropped a point underneath the button, and
      // a plain click on the pegman quietly created one.
      const under = document.elementFromPoint(e.clientX, e.clientY);
      if (!under || !map.getCanvasContainer().contains(under)) return;
      const r = map.getCanvas().getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      await onDrop(ll);
    });
    btn.addEventListener('pointercancel', clear);

    // A release the button never hears about still has to end the drag.
    // setPointerCapture throws on some pointers (the call above is wrapped for
    // exactly that reason), and a pointerup over browser chrome never reaches
    // any element in the page - either way the ghost outlives the gesture.
    // Window-level, and guarded on `ghost`, so the button's own handler runs
    // first and this only mops up what it missed.
    addEventListener('pointerup', () => { if (ghost) clear(); });
    addEventListener('pointercancel', () => { if (ghost) clear(); });
    addEventListener('blur', () => { if (ghost) clear(); });
  }

  // The bolt: drop a SIMULATED failure and read what is behind it. Same
  // gesture as the pin, opposite question - and the only thing this map draws
  // that is not a record of something real, which is why its page opens
  // saying so.
  dragToDrop(document.getElementById('evtBtn'), async (ll) => {
    try {
      const resp = await fetch('/api/event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: ll.lat, lon: ll.lng, kind: 'outage', radius_km: 25 }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || ('HTTP ' + resp.status));
      const lat = +ll.lat.toFixed(6), lon = +ll.lng.toFixed(6);
      evRingFC.features.push({ type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ringOf(lat, lon, 25)] },
        properties: { id: out.id, n: '', kind: 'outage', r: 25 } });
      evDotFC.features.push({ type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { id: out.id, n: '', kind: 'outage', r: 25 } });
      if (map.getSource('evring')) map.getSource('evring').setData(evRingFC);
      if (map.getSource('evdot')) map.getSource('evdot').setData(evDotFC);
      window.open(out.href, '_blank', 'noopener');
    } catch (err) { alert('could not place an event: ' + err.message); }
  });

  const EV_KIND = { outage: 'Supply outage', substation: 'Substation failure',
                    generation: 'Generation loss' };
  const evTip = (p) => `<div class="t">${esc(p.n || 'Simulated event')}</div>`
    + `<div class="d">${esc(EV_KIND[p.kind] || p.kind)} · ${p.r} km radius</div>`
    + '<div class="d">simulated — not a record of anything that happened</div>'
    + '<div class="d">click for what it would expose</div>';
  for (const lyr of ['ev-dot', 'ev-ring']) {
    map.on('mousemove', lyr, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
      if (!e.features.length) return hideTip();
      map.getCanvas().style.cursor = 'pointer';
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, evTip(e.features[0].properties));
    });
    map.on('mouseleave', lyr, () => { map.getCanvas().style.cursor = ''; hideTip(); });
    map.on('click', lyr, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
      if (e.features.length) {
        window.open('/event/' + encodeURIComponent(e.features[0].properties.id),
                    '_blank', 'noopener');
      }
    });
  }

  // ---- the pegman ---------------------------------------------------------
  // Drag the figure onto the map and let go: the drop point becomes a dropped
  // point, and its page opens. HTML5 drag-and-drop is avoided deliberately -
  // its drop coordinates are unreliable over a WebGL canvas and it cannot be
  // driven from touch at all - so this is a plain pointer drag, which works
  // the same for a mouse, a trackpad and a finger.
  // This used to be a second copy of the whole pointer-drag, which made the
  // shared helper's "the gesture lives once" comment untrue and left two
  // implementations to keep in step. It is the same gesture; only the dangle
  // and what happens to the coordinate differ.
  dragToDrop(document.getElementById('pegBtn'), async (ll) => {
    try {
      const resp = await fetch('/api/point', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: ll.lat, lon: ll.lng }),
      });
      const out = await resp.json();
      if (!resp.ok) throw new Error(out.error || ('HTTP ' + resp.status));
      // Draw it immediately rather than waiting for a reload: the pin
      // should stay where it was let go.
      ptFC.features.push({ type: 'Feature',
        geometry: { type: 'Point', coordinates: [+ll.lng.toFixed(6), +ll.lat.toFixed(6)] },
        properties: { id: out.id, n: '', kind: '' } });
      if (map.getSource('pts')) map.getSource('pts').setData(ptFC);

      // The drop used to open the point's page in a new tab immediately, which
      // took you off the map for a gesture that is easy to make by accident -
      // and left a record behind whether or not you meant it. The pin lands,
      // and a popup says where it went and offers the page: opening it is a
      // decision now rather than a consequence. Remove is offered in the same
      // breath, because the moment you can see it is wrong is this one.
      const popup = new maplibregl.Popup({ closeOnClick: false, offset: 10 })
        .setLngLat([ll.lng, ll.lat])
        .setHTML('<div class="t">Dropped point</div>'
          + '<div class="d mono">' + ll.lat.toFixed(6) + ', ' + ll.lng.toFixed(6) + '</div>'
          + '<div class="d">not yet anything in particular — its page is where you '
          + 'say what it is</div>'
          + '<a class="pop-open" href="' + out.href + '" target="_blank" '
          + 'rel="noopener">Open its page →</a>'
          + '<button type="button" class="pop-undo">Remove</button>')
        .addTo(map);

      const undo = popup.getElement().querySelector('.pop-undo');
      undo.addEventListener('click', async () => {
        undo.disabled = true;
        undo.textContent = 'removing…';
        try {
          const del = await fetch('/api/point/' + encodeURIComponent(out.id), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ delete: true }),
          });
          if (!del.ok) throw new Error('HTTP ' + del.status);
          ptFC.features = ptFC.features.filter(f => f.properties.id !== out.id);
          if (map.getSource('pts')) map.getSource('pts').setData(ptFC);
          popup.remove();
        } catch (err) {
          undo.disabled = false;
          undo.textContent = 'Remove';
          alert('could not remove the point: ' + err.message);
        }
      });
    } catch (err) {
      alert('could not drop a point: ' + err.message);
    }
  }, { dangle: true });

  // A dropped point names itself if it has been given a name, and says what
  // it is still waiting to become if it has not.
  const ptTip = (p) => `<div class="t">${esc(p.n || 'Dropped point')}</div>`
    + `<div class="d">${p.kind ? esc(PT_KIND[p.kind] || p.kind)
        + ' — dropped by hand, not yet in that layer'
        : 'not yet anything in particular'}</div>`
    + '<div class="d">click to open its page</div>';
  map.on('mousemove', 'pt-dot', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    if (!e.features.length) return hideTip();
    map.getCanvas().style.cursor = 'pointer';
    showTip(e.originalEvent.clientX, e.originalEvent.clientY, ptTip(e.features[0].properties));
  });
  map.on('mouseleave', 'pt-dot', () => { map.getCanvas().style.cursor = ''; hideTip(); });
  map.on('click', 'pt-dot', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
    if (e.features.length) {
      window.open('/maps/point/' + encodeURIComponent(e.features[0].properties.id),
                  '_blank', 'noopener');
    }
  });

  // Substations: the hover answers the accumulation question directly -
  // how many loads stand behind this, and how much of them.
  const subTip = (p) => {
    // MapLibre flattens nested feature properties to JSON strings.
    let who = [];
    try { who = typeof p.who === 'string' ? JSON.parse(p.who) : (p.who || []); } catch { who = []; }
    const names = who.slice(0, 4).map(w =>
      `<div class="d">· ${esc(w.n)}${w.mw ? ' — ' + Number(w.mw).toLocaleString() + ' MW' : ''}`
      + `${w.reg ? '' : ' <span class="dim">filed only</span>'}</div>`).join('');
    const more = who.length > 4 ? `<div class="d dim">+ ${who.length - 4} more</div>` : '';
    return `<div class="t">${esc(p.n)}${p.kv ? ' · ' + p.kv + ' kV' : ''}</div>`
      + `<div class="d">${p.as > 1
          ? p.as + ' mega-loads depend on this substation'
          : 'one mega-load depends on this substation'}`
      + `${p.mw ? ' · ' + Number(p.mw).toLocaleString() + ' MW' : ''}</div>`
      + names + more
      + '<div class="d">click for the substation page</div>';
  };
  for (const lyr of ['sub-dot', 'sub-share']) {
    map.on('mousemove', lyr, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
      if (!e.features.length) return hideTip();
      map.getCanvas().style.cursor = 'pointer';
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, subTip(e.features[0].properties));
    });
    map.on('mouseleave', lyr, () => { map.getCanvas().style.cursor = ''; hideTip(); });
    map.on('click', lyr, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: DOT_LAYERS }).length) return;
      if (!e.features.length) return;
      window.open('/maps/substation/' + encodeURIComponent(e.features[0].properties.id),
                  '_blank', 'noopener');
    });
  }

  // Supply links: hover names the pair and the arrangement; click frames
  // both ends, from where each dot's own click opens its page - the pages
  // carry the filings, the map carries the geometry.
  const supplyTip = (p) => `<div class="t">${esc(p.sn)} ⇆ ${esc(p.pn)}</div>` +
    `<div class="d">${esc(SUPPLY_ST[p.st] || p.st)}</div>` +
    (p.ann ? '<div class="d">announced campus — not yet a registry dot; '
           + 'the plant page carries the story</div>' : '') +
    '<div class="d">click to frame the pair — each dot opens its page</div>';
  for (const lyr of ['supply-line', 'supply-dot', 'supply-site']) {
    map.on('mousemove', lyr, (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai', 'plant'] }).length) return;
      if (!e.features.length) return hideTip();
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, supplyTip(e.features[0].properties));
    });
    map.on('mouseleave', lyr, hideTip);
    map.on('mouseenter', lyr, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('click', lyr, (e) => {
      if (!e.features.length) return;
      if (map.queryRenderedFeatures(e.point, { layers: ['sites', 'sites-ai', 'plant'] }).length) return;
      const p = e.features[0].properties;
      map.fitBounds([[Math.min(p.sx, p.px), Math.min(p.sy, p.py)],
                     [Math.max(p.sx, p.px), Math.max(p.sy, p.py)]],
                    { padding: 110, maxZoom: 12.5, duration: 900 });
    });
  }

  // Clicking an epicentre loads that event's precomputed footprint.
  map.on('click', 'epicentre', (e) => {
    if (state.fpEdit) return;     // see the sites handler above
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
    // Everything in this panel is thrown away on the next click. The page is
    // the same event as a URL - shareable, citable, and listing the assets in
    // full rather than in a scrolling column.
    const pageLink = document.getElementById('eq-page');
    if (pageLink) pageLink.href = det.id ? `/quake/${encodeURIComponent(det.id)}` : '/quakes';
    const byKind = { dc: 0, plant: 0, fab: 0 };
    for (const e of shaken) byKind[e.kind || 'dc']++;
    const parts = ['dc', 'plant', 'fab'].filter(k => byKind[k])
      .map(k => `${byKind[k]} ${byKind[k] === 1 ? KIND_1[k] : KIND_N[k]}`);
    document.getElementById('eq-sub').textContent = shaken.length
      ? `${parts.join(', ')} inside the shaking footprint, worst first` +
        (det.mwShaken ? ` — ${det.mwShaken.toLocaleString()} MW of operating generation` : '') +
        `. MMI is observed intensity — VI is where non-structural damage begins.`
      : 'Nothing in the registry, the plant layer or the fab layer was shaken at MMI 2 or above.';
    document.getElementById('eq-bands').innerHTML = (det.bands || [])
      .map(b => `<div class="eq-band"><i style="background:${b.color}"></i>` +
        `<b>${b.sites}</b> <span>${esc(b.label)}</span></div>`).join('');
    eqRows.innerHTML = shaken.map(e =>
      `<li class="eq-row" data-id="${esc(e.site_id)}" data-kind="${esc(e.kind || 'dc')}"` +
      ` title="Open this ${esc(KIND_1[e.kind] || 'site')}">` +
      `<i style="background:${bandColor[Math.floor(e.mmi)] || '#888'}"></i>` +
      `<span class="eq-name">${esc(e.name || e.operator || e.site_id)}</span>` +
      // Outside .eq-name, which ellipsises: the fuel and megawatts are the
      // reason a plant is in this list, so the name gives way, not the chip.
      ((e.kind && e.kind !== 'dc')
        ? `<b class="eq-kind eq-k-${esc(e.kind)}">${e.kind === 'fab' ? 'FAB'
            : esc((e.fuel || 'plant').toUpperCase())}${e.mw ? ' ' + Math.round(e.mw).toLocaleString() : ''}</b>`
        : '') +
      `<span class="eq-mmi">${e.mmi.toFixed(1)}</span>` +
      `<span class="eq-km">${Math.round(e.km)} km</span></li>`).join('');
    eqOnly.hidden = !shaken.length;
  }
  eqRows.addEventListener('click', (e) => {
    const row = e.target.closest('.eq-row');
    if (!row) return;
    const k = row.dataset.kind;
    if (k === 'plant') window.open('/maps/plant/' + encodeURIComponent(row.dataset.id), '_blank', 'noopener');
    else if (k === 'fab') window.open('/maps/fab/' + encodeURIComponent(row.dataset.id), '_blank', 'noopener');
    else openSite(row.dataset.id);
  });
  eqRows.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.eq-row');
    if (!row) return hideTip();
    if (row.dataset.kind && row.dataset.kind !== 'dc') return hideTip();
    const s = sites.find(x => x.id === row.dataset.id);
    if (s) showTip(e.clientX, e.clientY, siteTip(s));
  });
  eqRows.addEventListener('mouseleave', hideTip);

  // Filtering to the shaken set reuses the same chip the search facets use,
  // so there is one mechanism for "the map is showing a subset", not two.
  eqOnly.addEventListener('click', () => {
    const on = eqOnly.getAttribute('aria-pressed') !== 'true';
    eqOnly.setAttribute('aria-pressed', String(on));
    // This chip filters the data-centre dots, so it counts data centres. It
    // used to be handed the whole exposed list, which after plants and fabs
    // joined would have claimed a count it cannot filter to.
    const dcShaken = shaken.filter(e => (e.kind || 'dc') === 'dc');
    shakenIds = on ? new Set(dcShaken.map(e => e.site_id)) : null;
    setFilter(on ? { key: 'mmi', value: '__shaken__',
                     label: `Shaken by M${openEvent.mag}`,
                     count: dcShaken.length, unmapped: 0 } : null);
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
    // three-globe's ambient light is 0xcccccc, not white. That is a flat 20%
    // off everything the globe renders, and it is why the drawn map came out
    // greyer than the colours it was painted in - PI is the right intensity
    // only if the light carrying it is white.
    //
    // Set white for the drawn map, and left grey for imagery: the satellite
    // values were tuned against 0xcccccc and whitening the light would
    // brighten photographs nobody asked to change.
    const lit = currentBasemap
      ? { ambient: c.ambient, sun: c.sun, lift: c.globeLift, ambientColor: 0xcccccc }
      : { ambient: Math.PI, sun: 0, lift: 0x000000, ambientColor: 0xffffff };

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
      lights[0].color?.setHex(lit.ambientColor);
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

  // Two versions of the same map, and which one you get depends on what else is
  // on the globe.
  //
  // POLITICAL is the default: every country its own pastel, the way a printed
  // atlas does it, which is what makes a drawn map read as a drawn map at a
  // glance. The colours are not invented and not hashed - Natural Earth ships
  // MAPCOLOR9, an index computed so that no two countries sharing a border
  // share a value. Nine classes, all 177 features carry one.
  //
  // PLAIN is the same map with one land colour, and it exists because the
  // "Data Centres by Country" layer paints a purple choropleth over the globe
  // at 18-78% opacity. Purple over nine pastels is nine different muddy
  // purples, i.e. a colour scale you cannot read. So when that layer is on the
  // basemap gets out of its way. A basemap and a data layer competing for the
  // same channel is a choice between them, not a thing to split the difference
  // on.
  function globeMapTexture() {
    const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day';
    const plain = !!state.layers.countries;
    const key = theme + (plain ? ':plain' : ':political');
    const hit = globeTexCache.get(key);
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

    g.strokeStyle = c.globeBorder;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    for (const f of basemap.features) {
      const geom = f.geometry;
      if (!geom) continue;
      const mc = +f.properties?.MAPCOLOR9;
      g.fillStyle = plain || !(mc >= 1) ? c.globeLand
                                        : c.globeCountry[(mc - 1) % c.globeCountry.length];
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
    globeTexCache.set(key, url);
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
      // The hexagon heatmap: globe.gl bins the points itself, with H3 at the
      // resolution applyHeat chose, so the prisms here are the cells the 2D
      // map draws. Set here and not in drawDots, which runs on every camera
      // step - re-binning 6,000 sites is cheap, rebuilding 1,500 prisms is
      // not, and neither changes with the altitude until the resolution does.
      globe.hexBinResolution(hexRes()).hexBinPointsData(hexOn() ? hexRecords() : []);
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

  // The globe's DOM-marker slot is shared and unbatched, so the plant layer
  // gets the same treatment as close-range sites: cull to the view, order by
  // what matters, cap. Ordering is by capacity rather than by distance to the
  // view centre - `plants` arrives biggest-first from the ingest - because at
  // orbital altitude "the whole country is in view" and the only useful 300
  // are the largest, where for site markers the useful ones are the nearest.
  const PLANT_CAP = 300;
  const plantWrap = new Map();

  function visiblePlants() {
    if (!state.layers.plants) return [];
    const p = globe.pointOfView();
    const reach = halfViewDeg() * 1.3;
    const cosLat = Math.cos(p.lat * Math.PI / 180);
    const out = [];
    for (const d of plants) {
      if (!fuelOn(d.f)) continue;
      const dy = d.lat - p.lat;
      if (Math.abs(dy) > reach) continue;
      let dx = d.lon - p.lng;
      if (dx > 180) dx -= 360; else if (dx < -180) dx += 360;
      dx *= cosLat;
      if (dx * dx + dy * dy > reach * reach) continue;
      let w = plantWrap.get(d.id);
      if (!w) plantWrap.set(d.id, w = { lat: d.lat, lng: d.lon, plant: d });
      out.push(w);
      if (out.length >= PLANT_CAP) break;
    }
    return out;
  }

  function plantMarker(d) {
    const p = d.plant;
    const el = document.createElement('div');
    el.className = 'plant-marker plant-' + p.k;
    // Same sqrt-of-capacity law as the 2D rings, damped at altitude so 300 of
    // them seen from orbit stay readable instead of merging into a smear.
    const cap = Math.sqrt(Math.max(1, p.smw) / 100);
    const near = Math.min(1, 0.6 / Math.max(globeAlt, 0.02));
    const px = Math.max(6, Math.min(30, 3.2 * cap * (0.5 + 0.5 * near)));
    el.style.width = el.style.height = `${px.toFixed(1)}px`;
    // Same rule as 2D: the fuel colour normally, the shared ramp while the
    // heatmap is painting a measure a plant also has.
    const hm = heatSpec();
    const heat = state.heat.on && heatDomain && hm.pk;
    const v = heat ? heatVal(p, hm.pk, hm) : null;
    const col = heat ? (v == null ? HEAT_NONE : heatColour(v))
      : (FUEL_COLOUR[p.f] || FUEL_COLOUR.other);
    el.style.borderColor = col;
    el.style.background = p.ax ? 'transparent'
      : col + (heat ? '9e' : p.k === 'op' ? '44' : p.k === 'plan' ? '24' : '10');
    el.title = [p.n, `${FUEL_LABEL[p.f]} · ${mwText(p.smw)}`,
      p.inv ? usdText(p.inv) + ' announced/reported cost' : '',
      STATUS_LABEL[p.k] + (p.ry ? ` ${p.ry}` : ''),
      (p.src === 'gem' ? [p.st, p.cyn || p.cy] : [p.st, BA_ISO[p.ba] || p.ba]).filter(Boolean).join(' · '),
      p.ax ? 'approximate location' : ''].filter(Boolean).join('\n');
    return el;
  }

  function fabMarker(d) {
    const f = d.fab;
    const el = document.createElement('div');
    el.className = 'fab-marker' + (f.k === 'operating' ? '' : ' fab-plan');
    const px = f.mw ? Math.max(9, Math.min(26, 3.2 * Math.sqrt(f.mw / 100) * 2)) : 9;
    el.style.width = el.style.height = px.toFixed(1) + 'px';
    // Same rule as the plant markers and the 2D fab dots: fab pink normally,
    // the shared ramp while the heatmap paints a measure a fab also has - and
    // full opacity then, because on the ramp the colour is the reading.
    const hm = heatSpec();
    if (state.heat.on && heatDomain && hm.fk) {
      const v = heatVal(f, hm.fk, hm);
      el.style.background = v == null ? HEAT_NONE : heatColour(v);
      el.style.opacity = 1;
    }
    el.title = [f.n, f.op,
      f.inv ? usdText(f.inv) + ' announced investment' : '',
      f.mw ? '~' + f.mw.toLocaleString() + ' MW estimated' : 'power not estimated',
      [FAB_STATUS[f.k] || f.k, f.pl].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    return el;
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
    // In hexagon form the cells stand in for the records they aggregate, DOM
    // markers included: a marker on a roof under a 350 m prism is the dot the
    // form exists to aggregate away. Only the SUBJECT's, exactly as 2D hides
    // only the subject's dot layers - the other two still mark the ground
    // the cells cover.
    close = aggregated('site') ? [] : (close || closeSites());
    closeKey = close.map(w => w.site.id).join(',');
    const promoted = new Set(close.map(w => w.site.id));
    // Same rule the 2D layers get from circle-sort-key: while the ramp is
    // painting, low values draw first and high values draw last, so the dot
    // the ramp exists to surface is never buried under its grey neighbours.
    // Points render in array order; HTML markers stack in DOM order, which IS
    // array order here. Missing values sort as -1 and go to the bottom.
    const hm = heatSpec();
    const heated = state.heat.on && heatDomain;
    const byVal = (key) => (a, b) =>
      (heatVal(a, key, hm) ?? -1) - (heatVal(b, key, hm) ?? -1);
    let pts = promoted.size ? shown().filter(d => !promoted.has(d.id)) : shown();
    if (heated) pts = [...pts].sort(byVal(hm.k));
    globe.pointsData(aggregated('site') ? [] : pts);
    // shown() already applies the hide-no-value filter for sites; the plant
    // and fab wrappers apply the same rule here, so the globe and the 2D
    // filters can never disagree about which markers exist.
    const hideGrey = hideMissingActive();
    let plantWraps = aggregated('plant') ? [] : visiblePlants();
    if (hideGrey && hm.pk) plantWraps = plantWraps.filter(w => heatVal(w.plant, hm.pk, hm) != null);
    if (heated && hm.pk) plantWraps.sort((a, b) => byVal(hm.pk)(a.plant, b.plant));
    let fabWraps = state.layers.fabs && !aggregated('fab')
      ? fabs.map(f => ({ lat: f.lat, lng: f.lon, fab: f })) : [];
    if (hideGrey && hm.fk) fabWraps = fabWraps.filter(w => heatVal(w.fab, hm.fk, hm) != null);
    if (heated && hm.fk) fabWraps = fabWraps.sort((a, b) => byVal(hm.fk)(a.fab, b.fab));
    globe.htmlElementsData([
      ...(state.layers.quake ? quakes.map(q => ({ lat: q.lat, lng: q.lon, q })) : []),
      ...plantWraps,
      ...fabWraps,
      ...close,
    ]);
  }

  // Solid at every altitude. These used to fade towards transparent as the
  // camera came down, so you could read the roof through the marker - which
  // was worth it back when the marker was kilometres wide and covered the
  // building. It is not any more: the dot is sized to the building and, below
  // CLOSE_ALT, is a DOM marker anyway. All the fade did was make the dot hard
  // to find over bright imagery, which is the opposite of a marker's job.
  const pointColour = (d) => {
    if (state.heat.on && heatDomain) {
      return heatHas(d) ? heatColour(+d[state.heat.k]) : HEAT_NONE;
    }
    return d.ft === 'ai' ? pal().ai3d : pal().fac3d;
  };

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
      // Plants sit on the surface like site markers. Only the epicentres float:
      // 0.009 is 57 km, which is right for something seen from orbit and wrong
      // for a switchyard you are looking down at.
      .htmlAltitude(d => (d.site || d.plant || d.fab ? 0 : 0.009))
      .htmlElement(d => {
        if (d.site) return closeMarker(d);
        if (d.plant) return plantMarker(d);
        if (d.fab) return fabMarker(d);
        const el = document.createElement('div');
        el.className = 'epi-marker' + (d.q.exposed ? ' epi-hit' : '');
        // Same log scaling as 2D, so an M7 reads as an M7 in both renderers.
        const r = Math.round(4 + Math.pow(1.9, d.q.mag - 5) * 2);
        el.style.width = el.style.height = `${Math.min(r, 22)}px`;
        el.title = `M${d.q.mag} — ${d.q.place}`
          + (d.q.exposed ? ` · ${kindList(d.q)} shaken, max MMI ${d.q.maxMmi}` : '');
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
      .onPointClick(d => openSite(d.id))
      // The hexagon heatmap as prisms: the cell's colour is the 2D fill's,
      // and its height is the same position on the ramp, so a tall dark
      // cell and a red one on the flat map are one fact told twice. The
      // accessors read the live heat state, and applyHeat re-assigns them
      // when the domain moves so globe.gl re-evaluates. No transition: the
      // cells re-bin on every resolution step, and a second of prisms
      // growing out of the ground each time is motion carrying no meaning.
      .hexBinPointLat(w => w.lat).hexBinPointLng(w => w.lon)
      .hexBinPointWeight(hexWeight)
      .hexBinResolution(2)
      .hexMargin(0.12)
      .hexTopColor(hexTopColour)
      .hexSideColor(hexSideColour)
      .hexAltitude(hexAltitude)
      .hexTransitionDuration(0)
      .hexLabel(b => hexTip(b.points, b.sumWeight, hexRes()));
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
          // The cells follow the camera the way the 2D ones follow the
          // zoom: a step in resolution is a new set of cells, a new domain
          // and a new legend, and all three are applyHeat's to rebuild.
          if (hexOn() && hexRes() !== hexResPainted) applyHeat();
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
  const modeBtn = document.getElementById('modeBtn');
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
    ['fp-fill', 'fill-color', c => c.fp],
    ['fp-line', 'line-color', c => c.fp],
    ['fp-line-campus', 'line-color', c => c.fp],
    ['fp-line-case', 'line-color', c => c.fpCase],
    ['fp-line-campus-case', 'line-color', c => c.fpCase],
    ['hex-none', 'fill-pattern', c => c.hatch],
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
    // Labels take their ink from the theme too - but only when imagery is
    // off, which is why this is a call and not five more rows above.
    paintLabels();
  }

  function setMode(mode) {
    state.mode = mode;
    // The label is the state you are IN. Two buttons would spend half the
    // control saying what the map already shows.
    modeBtn.textContent = mode === '2d' ? '2D' : '3D';
    modeBtn.title = mode === '2d' ? 'Switch to 3D' : 'Switch to 2D';
    // Zoom buttons drive MapLibre, which is not on screen in 3D - the globe
    // has its own wheel and its own limits.
    document.getElementById('mapctl').classList.toggle('is3d', mode === '3d');
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
    // Each renderer sizes the hexagons from its own camera, so the cells
    // that fit one view are re-chosen for the other. (The globe's altitude
    // is read a frame later by watchCamera, which re-bins again if the
    // fly-in lands on a different step - this covers the switch itself.)
    if (hexOn()) applyHeat();
  }
  modeBtn.addEventListener('click', () => setMode(state.mode === '2d' ? '3d' : '2d'));
  document.getElementById('zoomIn').addEventListener('click', () => {
    if (state.mode === '2d') map.zoomIn();
    else if (globe) globe.pointOfView({ altitude: globe.pointOfView().altitude / 1.7 }, 260);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    if (state.mode === '2d') map.zoomOut();
    else if (globe) globe.pointOfView({ altitude: globe.pointOfView().altitude * 1.7 }, 260);
  });

  // ---- the layers pane folds into its corner ---------------------------------
  const layersPane = document.getElementById('layers');
  const layersBtn = document.getElementById('layersBtn');
  // One button, both directions. It used to hide itself on open and hand the
  // closing to a ✕ inside the pane, which meant two controls for one piece of
  // state and a corner that changed what it did depending on what was already
  // there. The button stays put and toggles; the pane rises above it.
  function setLayersOpen(on) {
    layersPane.hidden = !on;
    layersBtn.setAttribute('aria-expanded', String(on));
    // The heatmap bar rides with the pane: both answer "what am I looking
    // at", so one button governs them and the bottom edge holds one control.
    document.getElementById('heatbar').hidden = !on;
    // And the timeline is the OTHER thing the bottom edge can hold - the two
    // are exclusive in both directions, so opening either closes the other.
    const tb = document.getElementById('timebar');
    if (on && tb && !tb.hidden) setTimelineOpen(false);
  }
  layersBtn.addEventListener('click', () => setLayersOpen(layersPane.hidden));

  // Built from the data rather than written out, so the counts stay true and a
  // fuel that stops appearing stops having a chip. Ordered by how plausible a
  // co-location host the class is - nuclear, gas, coal - not by how many there
  // are, which would put 968 solar farms first.
  const fuelKey = document.getElementById('fuelkey');
  const plNote = document.getElementById('pl-note');
  const fbNote = document.getElementById('fb-note');
  const FUEL_ORDER = ['nuclear', 'gas', 'coal', 'hydro', 'oil', 'wind', 'solar', 'storage', 'other'];
  {
    const n = {};
    for (const p of plants) n[p.f] = (n[p.f] || 0) + 1;
    const shownFuels = FUEL_ORDER.filter(f => n[f]);
    // Nine fuels means nine clicks to see one of them, and nine more to get
    // back. The all/none chip is one click either way, and it labels the move
    // it will make rather than its own state - "None" while everything is on,
    // "All" as soon as anything is off.
    const allNone = '<button type="button" class="fk fk-all" data-all>' +
      '<span class="fk-allw">None</span></button>';
    fuelKey.innerHTML = shownFuels.map(f =>
      `<button type="button" class="fk" data-f="${f}" aria-pressed="true">` +
      `<i style="background:${FUEL_COLOUR[f]}"></i>${esc(FUEL_LABEL[f])}` +
      `<span class="fk-n">${n[f].toLocaleString()}</span></button>`).join('') + allNone;
    const syncAllNone = () => {
      const live = fuelKey.querySelectorAll('[data-f][aria-pressed="true"]').length;
      const w = fuelKey.querySelector('.fk-allw');
      if (w) w.textContent = live === shownFuels.length ? 'None' : 'All';
    };
    fuelKey.addEventListener('click', (e) => {
      const all = e.target.closest('[data-all]');
      if (all) {
        // Turning everything off would leave the layer on and empty, which
        // reads as broken; "None" therefore means none SELECTED, and the
        // filter that produces is an empty set, not a hidden layer.
        const turnOn = fuelKey.querySelector('.fk-allw').textContent === 'All';
        for (const b of fuelKey.querySelectorAll('[data-f]')) {
          b.setAttribute('aria-pressed', String(turnOn));
        }
        state.fuels = turnOn ? null : new Set();
        syncAllNone();
        refreshView();
        return;
      }
      const b = e.target.closest('[data-f]');
      if (!b) return;
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      const live = [...fuelKey.querySelectorAll('[data-f][aria-pressed="true"]')]
        .map(x => x.dataset.f);
      // null when nothing is deselected, not a set of everything: setFilter
      // takes null as "no filter", and an all-inclusive `in` would still be
      // evaluated per feature on every frame to reach the same answer.
      state.fuels = live.length === shownFuels.length ? null : new Set(live);
      syncAllNone();
      refreshView();
    });
  }

  // The same control for the two kinds of data centre. Counts come from the
  // registry rather than being written down, so they follow the data.
  {
    const dcKey = document.getElementById('dckey');
    const KINDS = [
      { k: 'ai', label: 'AI', colour: 'var(--ai)' },
      { k: 'traditional', label: 'Traditional', colour: 'var(--fac)' },
    ];
    const n = { ai: 0, traditional: 0 };
    for (const s of drawable) n[s.ft === 'ai' ? 'ai' : 'traditional']++;
    dcKey.innerHTML = KINDS.map(({ k, label, colour }) =>
      `<button type="button" class="fk" data-k="${k}" aria-pressed="true">` +
      `<i style="background:${colour}"></i>${label}` +
      `<span class="fk-n">${n[k].toLocaleString()}</span></button>`).join('');
    dcKey.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
      const live = [...dcKey.querySelectorAll('[data-k][aria-pressed="true"]')]
        .map(x => x.dataset.k);
      state.dcKinds = live.length === KINDS.length ? null : new Set(live);
      refreshView();
    });
    // Switching the layer off greys the chips: they still describe the colours
    // but they are no longer filtering anything.
    window.__syncDcKey = () => dcKey.classList.toggle('fk-off', !state.layers.facilities);
  }

  // The layers folded into "More layers". Listed here rather than read from
  // the DOM so the count cannot drift if the markup is reordered again.
  // The quake layer's magnitude floor is an argument to src/quakes.py, so the
  // label reads it off the events rather than stating a number that goes stale
  // the next time the ingest is run with a different one.
  {
    const note = document.getElementById('quakenote');
    if (note && quakes.length) {
      const lo = Math.min(...quakes.map(q => q.mag));
      note.textContent = `USGS M${lo.toFixed(1)}+, last 90 days — `
                       + `${quakes.length.toLocaleString()} events, click one for its ShakeMap`;
    }
  }

  // The fab labels read their counts off the payload for the same reason: the
  // layer regrows whenever src/fabs.py is re-run, and a written-out "90 fabs"
  // had already gone stale once.
  {
    const est = fabs.filter(f => f.mw).length;
    document.getElementById('fabnote').textContent =
      `${fabs.length.toLocaleString()} fabs — power is estimated, never measured`;
    document.getElementById('fb-est').textContent =
      `${est} of ${fabs.length.toLocaleString()}`;
  }

  // The unmapped-only toggle: filters every visible dot layer to assets
  // with no footprint. Lives under the footprints entry because the rings
  // and this filter are two views of the same coverage question.
  // The chip in the top bar is the filter's conscience: the toggle lives in
  // a panel that scrolls away, and an invisible active filter reads as
  // missing dots - which is exactly how it was reported.
  const fpUnmapped = document.getElementById('fp-unmapped');
  const fpChip = document.getElementById('fpchip');
  function setFpOnly(on) {
    state.fpOnly = on;
    if (fpUnmapped) fpUnmapped.setAttribute('aria-pressed', String(on));
    if (fpChip) fpChip.hidden = !on;
    refreshView();
  }
  if (fpUnmapped) fpUnmapped.addEventListener('click', () => setFpOnly(!state.fpOnly));
  if (fpChip) fpChip.addEventListener('click', () => setFpOnly(false));

  const MORE_LAYERS = ['ercot', 'pjm', 'nyiso', 'countries'];
  const moreCount = document.getElementById('morecount');
  function updateMoreCount() {
    if (!moreCount) return;
    const n = MORE_LAYERS.filter(k => state.layers[k]).length;
    moreCount.textContent = n ? `${n} on` : '';
    moreCount.classList.toggle('on', n > 0);
  }
  updateMoreCount();

  for (const key of Object.keys(state.layers)) {
    document.getElementById(`lyr-${key}`).addEventListener('change', (e) => {
      state.layers[key] = e.target.checked;
      if (key === 'plants') fuelKey.hidden = plNote.hidden = !e.target.checked;
      if (key === 'fabs') fbNote.hidden = !e.target.checked;
      // Footprints are fetched for the current view rather than held whole, so
      // switching the layer on is a request for them, not just a repaint.
      if (key === 'footprints' && window.__loadFootprints) window.__loadFootprints(false);
      if (key === 'facilities' && window.__syncDcKey) window.__syncDcKey();
      updateMoreCount();
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
    // The hexagon ramp is anchored to the surface, so a new surface is a new
    // ramp - and that expression is applyHeat's to build, not a paint row.
    if (hexOn()) applyHeat();
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
  // Set by the list once it exists, so a filter change repaints it too. The
  // status chips live in the list now and drive this same state, so without it
  // the chips would filter the map and leave the rows they sit above alone.
  let refreshList = () => {};

  function setFilter(f) {
    state.filter = f;
    chip.hidden = !f;
    if (f) {
      chip.innerHTML = `<b>${esc(f.label)}</b> <span>${f.count.toLocaleString()} sites` +
        (f.unmapped ? ` · ${f.unmapped} without coordinates` : '') + '</span>';
    }
    refreshView();
    refreshList();
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
    const cb = document.getElementById('lyr-facilities');
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    // The kind chips can hide a dot just as effectively as the layer toggle,
    // so flying to an AI site with the AI chip off would land on nothing.
    if (state.dcKinds && !state.dcKinds.has(site.ft === 'ai' ? 'ai' : 'traditional')) {
      state.dcKinds = null;
      for (const b of document.querySelectorAll('#dckey [data-k]')) {
        b.setAttribute('aria-pressed', 'true');
      }
      refreshView();
    }
  }

  function goTo(lon, lat, site) {
    preferSatellite();
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
    // The map controls share the bottom edge with the timeline bar now, so
    // they have to get out of its way.
    document.body.classList.toggle('timeline-open', !!on);
    // Exclusive with the layers pane (and the heatmap bar that rides with
    // it): see setLayersOpen, which closes this one in the other direction.
    if (on && !layersPane.hidden) setLayersOpen(false);
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
      `<a href="/maps/site/${encodeURIComponent(e.t.id)}" target="_blank" rel="noopener">View data centre →</a>`;
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

  // ---- footprints: view, draw, edit -------------------------------------------
  // The fp layers above draw what src/footprints.py derived. This section is
  // everything a PERSON does with a shape: read its facts, draw a missing one,
  // drag a wrong one straight. Edits go to POST /api/footprint, which appends
  // to data/footprint_overrides.geojsonl - a source the pipeline never
  // rewrites - so a correction outlives every rebuild.
  //
  // Hand-rolled rather than a draw library, deliberately. The app is offline-
  // first with two vendored dependencies, and the whole requirement is one
  // editable ring: box, polygon, drag a corner, add one, remove one. That is
  // ~200 lines against terra-draw's however-many, and it draws through the
  // same sources-and-layers idiom as everything else on this map.
  {
    const fpBtn = document.getElementById('fpBtn');
    const fpbar = document.getElementById('fpbar');
    const fpMsg = document.getElementById('fp-msg');
    const fpAttach = document.getElementById('fp-attach');
    const fpEditRow = document.getElementById('fp-editrow');
    const fpName = document.getElementById('fp-name');
    const fpBoxBtn = document.getElementById('fp-box');
    const fpPolyBtn = document.getElementById('fp-poly');
    const fpSaveBtn = document.getElementById('fp-save');
    const fpCancelBtn = document.getElementById('fp-cancel');
    const fpDeleteBtn = document.getElementById('fp-delete');
    const kindBtns = {
      building: document.getElementById('fp-kind-building'),
      campus: document.getElementById('fp-kind-campus'),
    };

    const EMPTY_FC = { type: 'FeatureCollection', features: [] };
    const EDIT_C = '#3B82C4';   // the PJM blue: visible over imagery and both themes,
                                // and unclaimed by any state a footprint can be in
    const READY_MSG = 'Click a footprint to edit it, or draw a new one.';

    // One shape is in hand at a time. `polys` is MultiPolygon-shaped even for
    // a single ring, so every edit path below works on one representation.
    const ed = {
      id: null,       // editing this existing footprint, or null = drawing new
      polys: null,    // [[outer, hole...], ...] - rings closed at all times
      kind: 'campus',
      drag: null,     // {p, r, i} while a corner follows the mouse
      draw: null,     // 'box' | 'poly'
      boxStart: null, // first corner, while draw === 'box'
      path: null,     // open ring, while draw === 'poly'
      confirm: false, // Delete pressed once, waiting for the second press
      sites: [],      // attachments the shape ARRIVED with - see attachedSites()
      saving: false,  // a POST is in flight; a second Enter must not repeat it
      dirty: false,   // geometry or fields changed since it was loaded
      confirmSwitch: null,  // a shape clicked while this one has unsaved work
    };

    const msg = (text, err) => {
      fpMsg.textContent = text;
      fpMsg.classList.toggle('err', !!err);
    };
    const fmtInt = (v) => Math.round(v).toLocaleString();
    // What the shape is a claim ABOUT, which is not the same for every source.
    // osm and im3 mean somebody labelled this building a data centre. osm-site
    // means only that it is a large building standing on a site the registry
    // already knew about - an inference this project made, not a fact anyone
    // recorded - so it says so rather than borrowing the others' authority.
    const SRC_LABEL = { osm: 'OpenStreetMap', im3: 'IM3 atlas (PNNL/DOE)',
                        'osm-site': 'OpenStreetMap — a large building on this site, '
                                  + 'not labelled a data centre',
                        derived: 'derived — the hull of the halls on this site, '
                               + 'not a surveyed boundary',
                        parcel: 'county parcel record — the recorded boundary',
                        'osm-plant': 'OpenStreetMap — the plant site’s mapped '
                                   + 'perimeter, not a building',
                        // Overture merges OSM with Microsoft's and Google's
                        // ML-extracted buildings; the shape is a model's read
                        // of a roof, standing on a site the registry located.
                        overture: 'Overture Maps (ODbL) — the building at this '
                                + 'site’s coordinate, largely ML-extracted',
                        manual: 'drawn by hand' };
    const KIND_LABEL = { building: 'building footprint', campus: 'campus boundary' };
    // MapLibre stringifies nested feature properties on the way through its
    // worker, so arrays come back as JSON text.
    const arr = (v) => (typeof v === 'string' ? JSON.parse(v) : v) || [];

    const toPolys = (geom) => JSON.parse(JSON.stringify(
      geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates));
    const toGeom = (polys) => (polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys });

    // Same even-odd rule the server and pipeline use, so "attaches to" here
    // is the same answer footprints.py would give.
    const inRing = (x, y, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    };
    function containedSites() {
      if (!ed.polys) return [];
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const poly of ed.polys) {
        for (const pt of poly[0]) {
          if (pt[0] < w) w = pt[0]; if (pt[0] > e) e = pt[0];
          if (pt[1] < s) s = pt[1]; if (pt[1] > n) n = pt[1];
        }
      }
      const out = [];
      for (const d of drawable) {
        if (d.lon < w || d.lon > e || d.lat < s || d.lat > n) continue;
        let hits = 0;
        for (const poly of ed.polys) {
          for (const ring of poly) if (inRing(d.lon, d.lat, ring)) hits++;
        }
        if (hits % 2 === 1) out.push(d);
      }
      return out;
    }
    // What gets SAVED: everything the shape already had, plus whatever it now
    // contains. A union rather than a replacement, because containment is not
    // the only way a footprint earns a site. footprints.py also attaches by
    // osm_id - an identity match between the very OSM way this outline came
    // from and a registry row - and by nearest-within-250 m, and neither
    // survives a containment test: 1,286 of the layer's attachments are to a
    // dot that falls outside its own polygon (a geocoded address beside the
    // building, not in it). Sending containment alone meant that renaming a
    // footprint, or nudging one corner, silently cut those sites loose.
    const attachedSites = () => {
      const ids = new Set(ed.sites);
      for (const d of containedSites()) ids.add(d.id);
      return [...ids];
    };
    function updateAttach() {
      if (!ed.polys) { fpAttach.textContent = ''; return; }
      const ids = attachedSites();
      if (!ids.length) { fpAttach.textContent = 'contains no registry dots'; return; }
      const byId = new Map(drawable.map(d => [d.id, d]));
      const names = ids.slice(0, 2)
        .map(id => (byId.get(id)?.n || byId.get(id)?.o || id)).join(', ');
      fpAttach.textContent = `attaches to ${ids.length} site${ids.length === 1 ? '' : 's'}: `
        + names + (ids.length > 2 ? `, +${ids.length - 2}` : '');
    }

    // ---- editor sources and layers, added on first use --------------------
    // Handles go on top of the dots: while a corner is being dragged it is
    // the subject, and everything else is context.
    let editLayersOk = false;
    function ensureEditLayers() {
      if (editLayersOk && map.getSource('fp-edit')) return true;
      try {
        map.addSource('fp-edit', { type: 'geojson', data: EMPTY_FC });
        map.addSource('fp-handles', { type: 'geojson', data: EMPTY_FC });
        map.addLayer({ id: 'fp-edit-fill', type: 'fill', source: 'fp-edit',
          paint: { 'fill-color': EDIT_C, 'fill-opacity': 0.10 } });
        map.addLayer({ id: 'fp-edit-line', type: 'line', source: 'fp-edit',
          paint: { 'line-color': EDIT_C, 'line-width': 2 } });
        map.addLayer({ id: 'fp-mids', type: 'circle', source: 'fp-handles',
          filter: ['==', ['get', 'mid'], 1],
          paint: { 'circle-radius': 3.5, 'circle-color': '#FFFFFF',
            'circle-stroke-color': EDIT_C, 'circle-stroke-width': 1.2,
            'circle-opacity': 0.85 } });
        map.addLayer({ id: 'fp-handles', type: 'circle', source: 'fp-handles',
          filter: ['==', ['get', 'mid'], 0],
          paint: { 'circle-radius': 5.5, 'circle-color': EDIT_C,
            'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.5 } });
        editLayersOk = true;
        return true;
      } catch {
        // "Style is not done loading" - the same race setBasemap documents.
        // The button is user-pressed, so the retry is the user's next press.
        return false;
      }
    }

    // The derived layers keep drawing everything except the shape in hand;
    // its own fp-* rendering would sit under the editable copy and lie about
    // where the edge currently is.
    function applyFpFilters(excludeId) {
      const ex = excludeId ? ['!=', ['get', 'id'], excludeId] : null;
      // Every layer the shape is drawn in, casings included - miss one and the
      // shape being edited leaves its own dark outline behind on the ground it
      // used to occupy.
      const base = {
        'fp-fill': null,
        'fp-line': ['!=', ['get', 'kind'], 'campus'],
        'fp-line-case': ['!=', ['get', 'kind'], 'campus'],
        'fp-line-campus': ['==', ['get', 'kind'], 'campus'],
        'fp-line-campus-case': ['==', ['get', 'kind'], 'campus'],
      };
      for (const [id, f] of Object.entries(base)) {
        if (!map.getLayer(id)) continue;
        const parts = [f, ex].filter(Boolean);
        map.setFilter(id, parts.length > 1 ? ['all', ...parts] : (parts[0] || null));
      }
    }

    function renderEdit() {
      if (!editLayersOk) return;
      const feats = ed.polys
        ? [{ type: 'Feature', geometry: toGeom(ed.polys), properties: {} }] : [];
      map.getSource('fp-edit').setData({ type: 'FeatureCollection', features: feats });
      const pts = [];
      if (ed.polys) {
        ed.polys.forEach((poly, p) => poly.forEach((ring, r) => {
          for (let i = 0; i < ring.length - 1; i++) {
            pts.push({ type: 'Feature', properties: { p, r, i, mid: 0 },
              geometry: { type: 'Point', coordinates: ring[i] } });
            const j = i + 1;   // ring is closed, so i+1 always exists
            pts.push({ type: 'Feature', properties: { p, r, i, mid: 1 },
              geometry: { type: 'Point', coordinates:
                [(ring[i][0] + ring[j][0]) / 2, (ring[i][1] + ring[j][1]) / 2] } });
          }
        }));
      }
      map.getSource('fp-handles').setData({ type: 'FeatureCollection', features: pts });
      updateAttach();
    }
    // The open ring while a polygon is being clicked out: a line, not a fill,
    // because it is not a shape yet and must not claim to be one.
    function renderPath(cursor) {
      if (!editLayersOk) return;
      const line = cursor ? [...ed.path, cursor] : ed.path;
      map.getSource('fp-edit').setData({ type: 'FeatureCollection',
        features: line.length > 1
          ? [{ type: 'Feature', properties: {},
               geometry: { type: 'LineString', coordinates: line } }] : [] });
      map.getSource('fp-handles').setData({ type: 'FeatureCollection',
        features: ed.path.map((c, i) => ({ type: 'Feature',
          properties: { p: -1, r: -1, i, mid: 0 },
          geometry: { type: 'Point', coordinates: c } })) });
    }

    function setKind(k) {
      ed.kind = k;
      for (const [key, btn] of Object.entries(kindBtns)) {
        btn.setAttribute('aria-selected', String(key === k));
      }
    }
    function showEditRow(existing) {
      fpEditRow.hidden = false;
      fpDeleteBtn.hidden = !existing;
      fpDeleteBtn.textContent = 'Delete';
      ed.confirm = false;
      fpSaveBtn.disabled = false;
    }

    function loadFootprint(id) {
      const f = footprints.features.find(x => x.properties.id === id);
      if (!f) return;
      // The editor's own layers may still be missing: setFpEdit runs before
      // the style is necessarily ready, and its one attempt is not retried by
      // anything else. Without this, the shape loads into state, the derived
      // copy is filtered out to make way for it, and nothing is drawn in its
      // place - the footprint simply disappears.
      if (!ensureEditLayers()) { msg('the map is still loading — try again', true); return; }
      // From the source data, never from the clicked feature: MapLibre hands
      // back geometry clipped to the tile the click landed in.
      ed.id = id;
      ed.polys = toPolys(f.geometry);
      ed.sites = Array.isArray(f.properties.sites) ? [...f.properties.sites] : [];
      ed.dirty = false;
      ed.confirmSwitch = null;
      setKind(f.properties.kind === 'building' ? 'building' : 'campus');
      fpName.value = f.properties.name || '';
      applyFpFilters(id);
      showEditRow(true);
      renderEdit();
      msg('Drag a corner to move it, a small dot to add one; right-click removes.');
    }

    function clearShape() {
      ed.id = null; ed.polys = null; ed.path = null; ed.sites = [];
      ed.dirty = false; ed.confirmSwitch = null;
      // The in-flight corner has to go with the shape it belonged to. Left
      // set, the next mousemove would index into a null ed.polys and throw on
      // every pointer move across the map - the editor dead, the console
      // filling, and no way back except a reload.
      ed.drag = null;
      fpName.value = '';
      fpEditRow.hidden = true;
      applyFpFilters(null);
      renderEdit();
    }
    function cancelEdit() {
      exitDraw();
      clearShape();
      msg(READY_MSG);
    }

    function exitDraw() {
      ed.draw = null; ed.boxStart = null; ed.path = null; ed.drag = null;
      fpBoxBtn.setAttribute('aria-selected', 'false');
      fpPolyBtn.setAttribute('aria-selected', 'false');
      map.getCanvas().style.cursor = '';
      map.dragPan.enable();
      map.doubleClickZoom.enable();
    }
    function startDraw(kind) {
      if (!ensureEditLayers()) { msg('the map is still loading — try again', true); return; }
      cancelEdit();
      ed.draw = kind;
      (kind === 'box' ? fpBoxBtn : fpPolyBtn).setAttribute('aria-selected', 'true');
      map.getCanvas().style.cursor = 'crosshair';
      if (kind === 'box') map.dragPan.disable();
      else map.doubleClickZoom.disable();
      msg(kind === 'box' ? 'Press and drag the two corners of the box.'
        : 'Click each corner; double-click or Enter closes the shape.');
    }
    function finishDraw() {
      exitDraw();
      setKind('campus');   // most drawn shapes are the boundary no source has
      fpName.value = '';
      ed.id = null;
      ed.sites = [];       // a new shape has only what it contains
      showEditRow(false);
      renderEdit();
      msg('Adjust the corners if needed, then Save.');
    }
    const boxRing = (a, b) => {
      const w = Math.min(a.lng, b.lng), e = Math.max(a.lng, b.lng);
      const s = Math.min(a.lat, b.lat), n = Math.max(a.lat, b.lat);
      return [[w, s], [e, s], [e, n], [w, n], [w, s]];
    };
    function closePath() {
      // The two clicks under a double-click land twice; fold near-duplicates.
      const pts = ed.path.filter((c, i, all) => !i
        || Math.abs(c[0] - all[i - 1][0]) + Math.abs(c[1] - all[i - 1][1]) > 1e-9);
      if (pts.length < 3) { msg('a polygon needs at least 3 corners', true); return; }
      ed.polys = [[[...pts, [...pts[0]]]]];
      finishDraw();
    }

    // ---- loading the layer by viewport ------------------------------------
    // Below this the shapes are sub-pixel and the whole country is in frame,
    // so there is nothing to draw and no point asking for it. A data centre
    // hall is ~150 m across, which is one pixel at z11.
    const FP_MIN_ZOOM = 11;
    let fpLoadedFor = null;    // the bbox we last asked for
    let fpSeq = 0;             // drops answers to superseded requests

    const bboxOfView = () => {
      const b = map.getBounds();
      // A margin the width of the view again, so a short pan does not refetch.
      const dx = (b.getEast() - b.getWest()) / 2, dy = (b.getNorth() - b.getSouth()) / 2;
      return [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
    };
    const covered = (view, had) => had
      && view[0] >= had[0] && view[1] >= had[1] && view[2] <= had[2] && view[3] <= had[3];

    async function loadFootprints(force) {
      if (!state.layers.footprints || map.getZoom() < FP_MIN_ZOOM) {
        if (footprints.features.length) {
          footprints.features = [];
          fpLoadedFor = null;
          if (map.getSource('fp')) map.getSource('fp').setData(footprints);
        }
        return;
      }
      const b = map.getBounds();
      const view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      if (!force && covered(view, fpLoadedFor)) return;
      const want = bboxOfView();
      const seq = ++fpSeq;
      try {
        const r = await fetch(`/api/footprints?w=${want[0]}&s=${want[1]}`
                            + `&e=${want[2]}&n=${want[3]}`);
        const fc = await r.json();
        if (seq !== fpSeq) return;          // a later move already answered
        footprints.features = fc.features || [];
        fpLoadedFor = fc.clipped ? null : want;   // a clipped answer is not a cache
        if (map.getSource('fp')) map.getSource('fp').setData(footprints);
      } catch { /* a failed fetch leaves the last good shapes on screen */ }
    }
    map.on('moveend', () => loadFootprints(false));
    map.on('load', () => loadFootprints(false));
    window.__loadFootprints = loadFootprints;   // test hook + layer toggle

    async function refreshFootprints() {
      await loadFootprints(true);
    }
    async function saveEdit() {
      // `saving` and not just the disabled button: Enter reaches saveEdit()
      // through the key handler without going near the button, so a second
      // press while the first POST was in flight appended a second shape.
      // For a NEW shape the server mints a fresh fp-man-<id> each time, so
      // that produced duplicate footprints stacked on the same ground.
      if (!ed.polys || ed.saving) return;
      const body = {
        geometry: toGeom(ed.polys),
        sites: attachedSites(),
        name: fpName.value.trim(),
        kind: ed.kind,
      };
      if (ed.id) body.id = ed.id;
      ed.saving = true;
      fpSaveBtn.disabled = true;
      try {
        const r = await fetch('/api/footprint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        await refreshFootprints();
        clearShape();
        msg('Saved.');
      } catch (err) {
        msg(`Could not save: ${err.message}`, true);
        fpSaveBtn.disabled = false;
      } finally {
        ed.saving = false;
      }
    }
    async function deleteEdit() {
      if (!ed.id) return;
      // Two presses, no dialog: the first re-labels the button to say what
      // the second will do. (The override log keeps the shape recoverable.)
      if (!ed.confirm) {
        ed.confirm = true;
        fpDeleteBtn.textContent = 'Really delete?';
        return;
      }
      try {
        const r = await fetch('/api/footprint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: ed.id, delete: true }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        await refreshFootprints();
        clearShape();
        msg('Deleted. (Recoverable from data/footprint_overrides.geojsonl.)');
      } catch (err) {
        msg(`Could not delete: ${err.message}`, true);
      }
    }

    function setFpEdit(on) {
      state.fpEdit = on;
      fpBtn.setAttribute('aria-pressed', String(on));
      fpbar.hidden = !on;
      if (on) {
        if (!ensureEditLayers()) msg('the map is still loading — try again', true);
        else msg(READY_MSG);
        // Editing a layer you cannot see is guesswork; switch it on.
        if (!state.layers.footprints) {
          state.layers.footprints = true;
          document.getElementById('lyr-footprints').checked = true;
          refreshView();
        }
        loadFootprints(false);
      } else {
        cancelEdit();
        hideTip();
      }
    }
    fpBtn.addEventListener('click', () => setFpEdit(!state.fpEdit));
    document.getElementById('fp-close').addEventListener('click', () => setFpEdit(false));
    fpBoxBtn.addEventListener('click', () => startDraw('box'));
    fpPolyBtn.addEventListener('click', () => startDraw('poly'));
    fpSaveBtn.addEventListener('click', saveEdit);
    fpCancelBtn.addEventListener('click', cancelEdit);
    fpDeleteBtn.addEventListener('click', deleteEdit);
    // Marked dirty from the handlers rather than inside setKind, because
    // loadFootprint calls setKind itself and a freshly loaded shape has not
    // been edited by anybody.
    kindBtns.building.addEventListener('click', () => { setKind('building'); ed.dirty = true; });
    kindBtns.campus.addEventListener('click', () => { setKind('campus'); ed.dirty = true; });
    fpName.addEventListener('input', () => { ed.dirty = true; });
    // The globe has no draw surface; leaving 2D closes the editor.
    modeBtn.addEventListener('click', () => {
      if (state.mode === '3d' && state.fpEdit) setFpEdit(false);
    });

    // ---- drawing and dragging, on the map's own events ---------------------
    map.on('mousedown', (e) => {
      if (ed.draw === 'box') ed.boxStart = e.lngLat;
    });
    map.on('mousemove', (e) => {
      if (ed.draw === 'box' && ed.boxStart) {
        ed.polys = [[boxRing(ed.boxStart, e.lngLat)]];
        renderEdit();
      } else if (ed.drag) {
        const { p, r, i } = ed.drag;
        const ring = ed.polys[p][r];
        ring[i] = [e.lngLat.lng, e.lngLat.lat];
        if (i === 0) ring[ring.length - 1] = [...ring[0]];
        ed.dirty = true;
        renderEdit();
      } else if (ed.draw === 'poly' && ed.path && ed.path.length) {
        renderPath([e.lngLat.lng, e.lngLat.lat]);
      }
    });
    // Bound to the WINDOW, not the map. MapLibre's 'mouseup' comes off the
    // canvas container, so releasing the button over the edit bar, the layers
    // pane or outside the window never fired it - and the corner stayed glued
    // to the cursor, moving on a pointer that was no longer pressed. The last
    // mousemove has already written the live geometry into ed.polys, so this
    // needs no coordinate of its own and works wherever the release lands.
    function endPointer() {
      if (ed.draw === 'box' && ed.boxStart) {
        ed.boxStart = null;
        const ring = ed.polys && ed.polys[0] && ed.polys[0][0];
        // A click, not a drag: nothing to keep, stay in box mode.
        if (!ring || Math.abs(ring[0][0] - ring[1][0]) < 1e-7
            || Math.abs(ring[1][1] - ring[2][1]) < 1e-7) {
          ed.polys = null;
          renderEdit();
          return;
        }
        finishDraw();
      }
      if (ed.drag) {
        ed.drag = null;
        map.getCanvas().style.cursor = '';
      }
    }
    window.addEventListener('mouseup', endPointer);
    map.on('click', (e) => {
      if (ed.draw !== 'poly') return;
      ed.path = ed.path || [];
      ed.path.push([e.lngLat.lng, e.lngLat.lat]);
      renderPath();
    });
    map.on('dblclick', (e) => {
      if (ed.draw === 'poly' && ed.path && ed.path.length >= 3) {
        e.preventDefault();
        closePath();
      }
    });
    map.on('mousedown', 'fp-handles', (e) => {
      if (!ed.polys || ed.draw) return;
      e.preventDefault();   // the corner moves, not the map
      const { p, r, i } = e.features[0].properties;
      ed.drag = { p, r, i };
      map.getCanvas().style.cursor = 'grabbing';
    });
    map.on('mousedown', 'fp-mids', (e) => {
      if (!ed.polys || ed.draw) return;
      e.preventDefault();
      const { p, r, i } = e.features[0].properties;
      ed.polys[p][r].splice(i + 1, 0, [e.lngLat.lng, e.lngLat.lat]);
      ed.drag = { p, r, i: i + 1 };
      ed.dirty = true;
      renderEdit();
    });
    map.on('contextmenu', 'fp-handles', (e) => {
      if (!ed.polys) return;
      e.preventDefault();
      const { p, r, i } = e.features[0].properties;
      const ring = ed.polys[p][r];
      if (ring.length - 1 <= 3) { msg('a shape needs at least 3 corners', true); return; }
      ring.splice(i, 1);
      if (i === 0) ring[ring.length - 1] = [...ring[0]];
      ed.dirty = true;
      renderEdit();
    });
    window.addEventListener('keydown', (e) => {
      if (!state.fpEdit) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape') {
        if (ed.draw || ed.polys) cancelEdit();
        else setFpEdit(false);
      } else if (e.key === 'Enter') {
        if (ed.draw === 'poly' && ed.path && ed.path.length >= 3) closePath();
        else if (ed.polys && !ed.draw) saveEdit();
      }
    });

    // ---- which shape did you mean? -----------------------------------------
    // Footprints overlap by design: a campus boundary is drawn over the halls
    // standing on it, and MapLibre hands back whichever renders on top, which
    // is the campus. So clicking a building inside a campus selected the
    // campus, every time, and the buildings could not be edited at all.
    //
    // THE SMALLEST SHAPE WINS, which is the same rule already applied one
    // level up - a site dot beats the footprint under it because it is the
    // finer target. A building is always smaller than the campus containing
    // it, and a campus stays reachable through its own open ground.
    //
    // Except when it has none. A parcel drawn tight around a single hall is
    // entirely covered by it, so clicking the SAME SPOT again steps outward to
    // the next shape up. That makes every overlapping shape reachable without
    // a modifier key or a list to read.
    let lastPick = null;      // {x, y, ids: [...], i}
    function pickAt(point) {
      const hits = map.queryRenderedFeatures(point, { layers: ['fp-fill'] });
      if (!hits.length) return null;
      // Smallest first, deduped - a feature crossing a tile boundary comes
      // back once per tile.
      const byId = new Map();
      for (const f of hits) {
        if (!byId.has(f.properties.id)) byId.set(f.properties.id, f.properties);
      }
      const ranked = [...byId.values()].sort((a, b) => (+a.m2 || 0) - (+b.m2 || 0));
      const ids = ranked.map(p => p.id).join(',');
      const near = lastPick && Math.abs(lastPick.x - point.x) < 6
                            && Math.abs(lastPick.y - point.y) < 6
                            && lastPick.ids === ids;
      const i = near ? (lastPick.i + 1) % ranked.length : 0;
      lastPick = { x: point.x, y: point.y, ids, i };
      if (ranked.length > 1 && state.fpEdit) {
        const p = ranked[i];
        msg(`${p.kind === 'campus' ? 'Boundary' : 'Building'} `
          + `${i + 1} of ${ranked.length} here — click again for the next.`);
      }
      return ranked[i];
    }

    // ---- reading a footprint: hover and click ------------------------------
    const fpFacts = (p) => {
      const bbox = arr(p.bbox);
      const m2 = +p.m2 || 0;
      return `<div class="t">${esc(p.name || p.op || (p.kind === 'campus' ? 'Campus' : 'Building'))}</div>` +
        `<div class="d">${esc(KIND_LABEL[p.kind] || p.kind)} · ${esc(SRC_LABEL[p.src] || p.src)}</div>` +
        // A parcel grown from the seed lot - the same owner's touching lot -
        // is a weaker claim than the lot under the dot, and says so.
        (p.expanded ? '<div class="d">a touching lot of the same owner — the holding, '
                    + 'not necessarily the campus</div>' : '') +
        // The owner is the parcel record's own answer to "whose site is this",
        // and it is a different claim from the operator on the dot: county
        // records name the title holder, usually an SPV.
        (p.op && p.op !== p.name ? `<div class="d">${esc(p.op)}${
          p.locality ? ` · ${esc(p.locality)}` : ''}</div>` : '') +
        (p.ref || p.acres ? `<div class="d">${[p.ref ? 'parcel ' + esc(String(p.ref)) : '',
          p.acres ? esc(String(p.acres)) + ' ac' : ''].filter(Boolean).join(' · ')}</div>` : '') +
        (m2 ? `<div class="d">${fmtInt(m2 * 10.7639)} sq ft · ${fmtInt(m2)} m²</div>` : '') +
        (p.buildings ? `<div class="d">${p.buildings} buildings · ${
          Math.round((+p.built_ratio || 0) * 100)}% built</div>` : '') +
        `<div class="d mono">bbox ${bbox.map(v => (+v).toFixed(5)).join(', ')}</div>`;
    };
    map.on('mousemove', 'fp-fill', (e) => {
      if (ed.drag || ed.draw) return;
      // Any dot beats the shape under it - and that now includes plants and
      // fabs, whose own perimeters sit beneath them since the osm-plant and
      // Overture passes landed.
      if (map.queryRenderedFeatures(e.point,
          { layers: ['sites', 'sites-ai', 'plant', 'fab'] }).length) return;
      map.getCanvas().style.cursor = 'pointer';
      // The SAME shape a click would take, not the topmost one - a tip
      // describing the campus while the click selects the building inside it
      // is worse than no tip.
      const hits = map.queryRenderedFeatures(e.point, { layers: ['fp-fill'] });
      const byId = new Map();
      for (const f of hits) if (!byId.has(f.properties.id)) byId.set(f.properties.id, f.properties);
      const ranked = [...byId.values()].sort((a, b) => (+a.m2 || 0) - (+b.m2 || 0));
      const p = ranked[0] || e.features[0].properties;
      showTip(e.originalEvent.clientX, e.originalEvent.clientY, fpFacts(p) +
        (ranked.length > 1
          ? `<div class="d">${ranked.length} shapes here — click again to step out</div>` : '') +
        `<div class="d">${state.fpEdit ? 'click to edit this shape' : 'click for details'}</div>`);
    });
    map.on('mouseleave', 'fp-fill', () => {
      // Not while drawing: the crosshair belongs to the draw, and leaving a
      // polygon on the way to the empty ground you are about to click is the
      // normal path through a draw, not the end of a hover.
      if (!ed.drag && !ed.draw) map.getCanvas().style.cursor = '';
      hideTip();
    });
    map.on('click', 'fp-fill', (e) => {
      // A dot on top of the shape wins the click - it is the finer target.
      // Plant and fab dots included: a plant dot inside its own perimeter
      // must open the plant, not the perimeter.
      if (map.queryRenderedFeatures(e.point,
          { layers: ['sites', 'sites-ai', 'plant', 'fab'] }).length) return;
      const p = pickAt(e.point);
      if (!p) return;
      if (state.fpEdit) {
        if (ed.draw) return;                 // mid-draw, a click is a corner
        if (p.id === ed.id) return;          // already the one being edited
        // Switching away from unsaved work asks once, the same way Delete
        // does, rather than silently discarding a dozen dragged corners.
        if (ed.polys && ed.dirty && !ed.confirmSwitch) {
          ed.confirmSwitch = p.id;
          msg('Unsaved changes here — click that shape again to discard them.', true);
          return;
        }
        loadFootprint(p.id);
        return;
      }
      hideTip();
      const siteIds = arr(p.sites);
      const links = siteIds.slice(0, 3).map(id =>
        `<a href="/maps/site/${encodeURIComponent(id)}" target="_blank" rel="noopener">${esc(id)}</a>`)
        .join(' · ') + (siteIds.length > 3 ? ` · +${siteIds.length - 3}` : '');
      pop.innerHTML = `<button class="x" aria-label="Close">✕</button>` +
        fpFacts(p) +
        (siteIds.length ? `<div class="d">${links}</div>` : '') +
        `<button class="tb-btn" id="fp-copybbox">Copy bbox</button>`;
      pop.hidden = false;
      const pad = 14;
      const x = e.originalEvent.clientX, y = e.originalEvent.clientY;
      pop.style.left = Math.min(x + pad, innerWidth - pop.offsetWidth - pad) + 'px';
      pop.style.top = Math.min(y + pad, innerHeight - pop.offsetHeight - pad) + 'px';
      pop.querySelector('.x').onclick = hidePop;
      const copy = pop.querySelector('#fp-copybbox');
      copy.onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(arr(p.bbox)))
          .then(() => { copy.textContent = 'Copied'; })
          .catch(() => { copy.textContent = 'Copy failed'; });
      };
    });
  }

  // ---- place names and political boundaries ----------------------------------
  // This map had no city names, no state lines and no country borders, and
  // could not have had any: its only geometry was Natural Earth admin-0 - 177
  // country polygons, a coastline and nothing inside it - and the style
  // carried zero symbol layers, so there was no text anywhere in it by
  // construction. src/basemap_tiles.py fetches a global OpenStreetMap vector
  // tileset as one PMTiles file plus the glyph ranges to letter it with, and
  // server.mjs serves both.
  //
  // Added at RUNTIME rather than declared in buildStyle() because that archive
  // is 1.6 GB and untracked - a fresh clone does not have it. A source
  // declared up front would have every such clone loading a style that 404s on
  // every tile it asks for. Probing first costs seven bytes and degrades to
  // precisely the map that existed before this.
  const PLACE_NAME = ['coalesce', ['get', 'name:en'], ['get', 'name']];
  // Clamped, because interpolate EXTRAPOLATES past its outermost stop: an
  // unclamped population_rank lets whichever city ranks highest choose its own
  // type size, and the ramp below stops being a ramp at both ends.
  const PLACE_RANK = ['min', 14, ['max', 6,
    ['to-number', ['coalesce', ['get', 'population_rank'], 8]]]];
  let labelsReady = false;

  function labelInk() {
    const c = pal();
    // Over imagery the background is a photograph - a white roof, wet asphalt,
    // a wheat field - and no single ink reads against all of it. White on a
    // dark halo does, which is the argument the footprint casings already make.
    // Over the drawn map it is ink on paper and the theme decides.
    return currentBasemap
      ? { text: '#FFFFFF', halo: 'rgba(0,0,0,0.78)', bnd: 'rgba(255,255,255,0.5)' }
      : { text: c.lbl, halo: c.lblHalo, bnd: c.bnd };
  }

  // One definition of these layers, read twice: once to add them and once per
  // repaint to re-read their colours. Listing the paint properties separately
  // in a theme table is how the footprint casings would have drifted from the
  // lines they case - see THEME_PAINT's note about the dots.
  function labelLayers(ink) {
    const halo = (w) => ({ 'text-color': ink.text, 'text-halo-color': ink.halo,
                           'text-halo-width': w, 'text-halo-blur': 0.3 });
    return [
      { id: 'bnd-country', type: 'line', source: 'pm', 'source-layer': 'boundaries',
        filter: ['match', ['get', 'kind'], ['country', 'map_unit'], true, false],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': ink.bnd, 'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 6, 1.3, 12, 2.2] } },
      // A line somebody disputes is drawn as a line somebody disputes. Dropping
      // these leaves a gap in the border of every country that has one;
      // drawing them solid is this map taking a side in a question it has no
      // business answering. Dashed is the convention and it is the honest one.
      { id: 'bnd-disputed', type: 'line', source: 'pm', 'source-layer': 'boundaries',
        filter: ['match', ['get', 'kind'],
                 ['unrecognized_country', 'unrecognized_region', 'overlay_limit'], true, false],
        paint: { 'line-color': ink.bnd, 'line-opacity': 0.7,
          'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 12, 1.8],
          'line-dasharray': [2.5, 2] } },
      // States and provinces. Counties are in the data too and are left out:
      // at the zoom this registry is read at they are a mesh, not a landmark.
      { id: 'bnd-region', type: 'line', source: 'pm', 'source-layer': 'boundaries',
        filter: ['match', ['get', 'kind'], ['region', 'macroregion'], true, false],
        minzoom: 3,
        paint: { 'line-color': ink.bnd, 'line-opacity': 0.5,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 12, 1.4],
          'line-dasharray': [4, 2.5] } },
      // Once you are inside a country its name is not telling you anything you
      // do not already know, so it stops at 8 and leaves the room to the
      // cities. Same reasoning one level down for regions.
      { id: 'place-country', type: 'symbol', source: 'pm', 'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'country'], maxzoom: 8,
        layout: { 'text-field': PLACE_NAME, 'text-font': ['Noto Sans Medium'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 12],
          'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
          'text-max-width': 7, 'text-padding': 6, 'text-allow-overlap': false },
        paint: halo(1.5) },
      { id: 'place-region', type: 'symbol', source: 'pm', 'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'region'], minzoom: 3.5, maxzoom: 11,
        layout: { 'text-field': PLACE_NAME, 'text-font': ['Noto Sans Medium'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 9, 11],
          'text-transform': 'uppercase', 'text-letter-spacing': 0.08,
          'text-max-width': 8, 'text-padding': 5 },
        paint: { ...halo(1.4), 'text-opacity': 0.85 } },
      // Cities and towns. Nothing here filters by zoom: the tiler already
      // decided which places belong at each level, and where two labels still
      // collide MapLibre drops one - so the only thing left to say is WHICH one
      // it should drop, which is what sort_key is for. Filtering by population
      // on top of that would throw away the tiler's judgement and keep a county
      // seat over the town the data centre is actually in.
      { id: 'place-locality', type: 'symbol', source: 'pm', 'source-layer': 'places',
        filter: ['==', ['get', 'kind'], 'locality'],
        layout: { 'text-field': PLACE_NAME, 'text-font': ['Noto Sans Regular'],
          // Tops out at zoom 10 on purpose. Past the archive's zoom 9 the tiles
          // are overzoomed and the label set stops changing, so a ramp that
          // kept climbing would just magnify the same handful of names until
          // they were the loudest thing on a map about somewhere else.
          'text-size': ['interpolate', ['linear'], ['zoom'],
            3, ['interpolate', ['linear'], PLACE_RANK, 6, 8, 14, 10.5],
            10, ['interpolate', ['linear'], PLACE_RANK, 6, 9.5, 14, 13]],
          'text-max-width': 8, 'text-padding': 4,
          'symbol-sort-key': ['to-number', ['coalesce', ['get', 'sort_key'], 0]] },
        paint: halo(1.4) },
    ];
  }

  function paintLabels() {
    if (!labelsReady) return;
    for (const l of labelLayers(labelInk())) {
      if (!map.getLayer(l.id)) continue;
      for (const [prop, val] of Object.entries(l.paint)) {
        map.setPaintProperty(l.id, prop, val);
      }
    }
  }

  // The transmission layer's spec, in one place, because it is added by two
  // paths - tiles or the GeoJSON fallback - and the only thing that differs
  // between them is the source. `source-layer` is set only for tiles.
  const powerLineLayer = () => ({
    id: 'power-line', type: 'line',
    layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': '#6B7A88',
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 9, 0.9, 14, 2.2],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 9, 0.55, 13, 0.75] },
  });

  // One registration, however many archives use it. MapLibre tolerates a
  // repeat call, but a flag says what happened without leaning on that.
  let pmRegistered = false;
  const registerPmtiles = () => {
    if (pmRegistered) return true;
    if (!window.pmtiles || !maplibregl.addProtocol) return false;
    maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
    pmRegistered = true;
    return true;
  };
  // The basemap's own probe, reused: a 7-byte range read that takes a 200 as
  // a yes rather than consuming a body that might be the whole archive.
  async function pmtilesPresent(url) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-6' } });
      if (!r.ok) return false;
      if (r.status === 206) {
        return new TextDecoder().decode(await r.arrayBuffer()) === 'PMTiles';
      }
      r.body?.cancel();
      return true;
    } catch { return false; }
  }

  // A tiled layer: tiles when the archive is there and the protocol is
  // available, a GeoJSON fallback when one is offered and either is not.
  // The layers land in the same place in the stack whichever path fed them,
  // and the layer toggle finds them by id. Attempt-and-retry on a timer, for
  // the reason initLabels gives.
  async function initTiled({ archive, source, sourceLayer, layers, before, fallbackUrl, onMissing }) {
    const tiled = await pmtilesPresent(archive) && registerPmtiles();
    let fallback = null;
    if (!tiled) {
      if (!fallbackUrl) { if (onMissing) onMissing(); return; }
      try { fallback = await fetch(fallbackUrl).then(r => r.json()); }
      catch { if (onMissing) onMissing(); return; }
    }
    const add = () => {
      if (map.getLayer(layers[0].id)) return true;
      try {
        map.addSource(source, tiled
          ? { type: 'vector', url: `pmtiles://${location.origin}${archive}` }
          : { type: 'geojson', data: fallback });
        const beforeId = map.getLayer(before) ? before : undefined;
        for (const spec of layers) {
          map.addLayer({ ...spec, source, ...(tiled ? { 'source-layer': sourceLayer } : {}) },
                       beforeId);
        }
        applyVisibility();           // honour the layer toggle's current state
        return true;
      } catch { return false; }
    };
    if (add()) return;
    let tries = 0;
    const retry = setInterval(() => {
      if (add() || ++tries > 40) clearInterval(retry);
    }, 400);
  }

  // Transmission corridors: under the dropped-point dots, for the reason
  // buildStyle gives. Falls back to the whole GeoJSON.
  initTiled({
    archive: '/transmission.pmtiles', source: 'powerline', sourceLayer: 'transmission',
    layers: [powerLineLayer()], before: 'pt-dot', fallbackUrl: '/data/power_lines.json',
  });

  // Water service areas: the 577 community water systems that registry sites
  // sit inside (src/water_service.py names them, src/tiles.py draws them).
  // Context, so they go UNDER everything that is a site - below the parcel
  // layers, the footprints and every dot - and under the place labels, which
  // are inserted above regrid-fill. No GeoJSON fallback: raw, these polygons
  // are 121 MB, and a layer that costs that much is worse than a disabled
  // checkbox that says why.
  initTiled({
    archive: '/water.pmtiles', source: 'water', sourceLayer: 'water',
    layers: [
      { id: 'water-fill', type: 'fill', layout: { visibility: 'none' },
        paint: { 'fill-color': '#0369A1',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.10, 8, 0.14, 12, 0.10] } },
      { id: 'water-line', type: 'line', layout: { visibility: 'none', 'line-join': 'round' },
        paint: { 'line-color': '#0369A1',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 0.9, 12, 1.6],
          'line-opacity': 0.7 } },
    ],
    before: 'regrid-fill',
    onMissing: () => {
      const cb = document.getElementById('lyr-water');
      if (cb) {
        cb.disabled = true;
        cb.closest('label')?.setAttribute('title',
          'No water tiles on this server — run src/tiles.py after water_service.py');
      }
    },
  });

  async function initLabels() {
    if (!window.pmtiles || !maplibregl.addProtocol) return;
    try {
      const r = await fetch('/basemap.pmtiles', { headers: { Range: 'bytes=0-6' } });
      if (!r.ok) return;
      // Read the body ONLY if the server honoured the range. If something in
      // front of it strips Range and answers 200, that body is the whole 1.6 GB
      // archive, and consuming it to check a seven-byte magic number would be
      // the worst thing this app does to anyone. Take the 200 as a yes instead.
      if (r.status === 206) {
        if (new TextDecoder().decode(await r.arrayBuffer()) !== 'PMTiles') return;
      } else {
        r.body?.cancel();
      }
    } catch {
      return;             // no archive, no labels, same map as before
    }
    if (!registerPmtiles()) return;

    const add = () => {
      if (map.getSource('pm')) return true;
      try {
        map.addSource('pm', {
          type: 'vector',
          url: `pmtiles://${location.origin}/basemap.pmtiles`,
          attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
        });
        // Above the zone choropleths and below the footprints. A place name is
        // context for the sites, so nothing that IS a site may hide behind one,
        // and nothing that merely tints a region may sit on top of one.
        const before = map.getLayer('fp-fill') ? 'fp-fill' : undefined;
        for (const l of labelLayers(labelInk())) map.addLayer(l, before);
        labelsReady = true;
        // The note was already drawn, before there was anything to credit.
        showBasemapNote(currentBasemap);
        return true;
      } catch {
        return false;
      }
    };
    // Attempt-and-retry on a TIMER, for the reason setBasemap spells out: the
    // one error MapLibre raises here is "Style is not done loading", and
    // hanging the retry off map.once('load') is the trap a throttled tab never
    // comes back from.
    if (add()) return;
    let tries = 0;
    const retry = setInterval(() => {
      if (add() || ++tries > 40) clearInterval(retry);
    }, 400);
  }
  initLabels();

  // ---- satellite basemap -----------------------------------------------------
  // The server decides which providers exist, because only it knows whether a
  // Google key is configured. Asking it means the UI never offers an option
  // that would fail on click.
  const bmBtn = document.getElementById('bmBtn');

  // Each provider gets its OWN source and layer, added the first time it is
  // chosen. The first version used one shared source created empty and swapped
  // its URL with setTiles - which silently did nothing: a raster source built
  // with `tiles: []` never initialises, so there was nothing for setTiles to
  // update. serialize() reported the new URL while the source stayed dead and
  // not one tile was ever requested.
  let pendingBasemap = null, bmRetry = null;

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
    const p = providers.find(x => x.id === id);
    // Same one-button rule as the mode switch. With a single satellite
    // provider this is a plain toggle; with two it cycles, and the title says
    // where the next press goes rather than leaving you to find out.
    const ring = ['', ...providers.map(q => q.id)];
    const next = ring[(ring.indexOf(id) + 1) % ring.length];
    const nameOf = (k) => (k ? (providers.find(q => q.id === k)?.label || k) : 'Map');
    bmBtn.textContent = nameOf(id);
    bmBtn.title = 'Switch to ' + nameOf(next);

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
      // Retried on a TIMER, not on map.once('idle'). 'idle' is a one-shot that
      // a background or throttled tab may never reach - the same trap the
      // deep link fell into with 'load' - and the symptom is the nastiest
      // kind: the button relabels to Satellite and no imagery ever arrives,
      // because the relabel is above this line and the layer never got made.
      // setTimeout is throttled in a background tab but it still fires.
      pendingBasemap = id;
      if (!bmRetry) {
        bmRetry = setInterval(() => {
          const q = pendingBasemap;
          if (q === null) { clearInterval(bmRetry); bmRetry = null; return; }
          pendingBasemap = null;
          setBasemap(q);
        }, 400);
      }
      return;
    }
    currentBasemap = id;
    // Must follow the assignment: labelInk() reads currentBasemap to decide
    // between white-on-photograph and ink-on-paper.
    paintLabels();
    showBasemapNote(id);
    applyGlobeBasemap();
  }

  const bmNote = document.getElementById('bm-note');

  fetch('/api/basemaps').then(r => r.json()).then(list => {
    providers = list;
    setBasemap(currentBasemap);       // relabels now that the ring is known
    showBasemapNote(currentBasemap);
    if (wantSat) { wantSat = false; preferSatellite(); }
  }).catch(() => {});

  // Imagery is licensed, not free, and which licence applies depends on the
  // provider. Saying so where the switch is beats burying it in a comment.
  function showBasemapNote(id) {
    if (!bmNote) return;
    const p = providers.find(x => x.id === id);
    const parts = [];
    if (p) parts.push(`${p.attribution.replace(/&copy;/g, '©')} · ${p.licence || ''}`);
    // Not a clause bolted onto the imagery credit - a credit that OUTLIVES it.
    // The map is built with attributionControl:false, so a source's own
    // attribution string is never rendered and this note is the only place a
    // credit can appear. The labels and borders are ODbL and are drawn in BOTH
    // basemap modes, so switching imagery off must not switch their credit off
    // with it, which is what a single `hidden = !p` did.
    if (labelsReady) parts.push('Labels & borders © OpenStreetMap contributors (ODbL)');
    bmNote.textContent = parts.join('  ·  ');
    bmNote.hidden = !parts.length;
  }

  bmBtn.addEventListener('click', () => {
    bmChosen = true;
    const ring = ['', ...providers.map(q => q.id)];
    setBasemap(ring[(ring.indexOf(currentBasemap) + 1) % ring.length]);
  });

  // Flying to ONE building wants imagery. The drawn basemap is an overview -
  // 110m coastlines, one land colour, a 4096px texture for the whole planet -
  // and past about zoom 9 it has nothing left to show, so landing on a single
  // site with it on is landing on a blank.
  //
  // Only where the user has not said otherwise. Picking the basemap is an
  // instruction; overriding it because they then searched for something would
  // be the app arguing with them. One explicit press and it never does this
  // again for the rest of the session.
  let bmChosen = false, wantSat = false;
  function preferSatellite() {
    if (bmChosen || currentBasemap) return;
    const p = providers[0];
    // Providers arrive over the network, so a deep link can get here first.
    if (p) setBasemap(p.id); else wantSat = true;
  }

  // ---- heatmap ---------------------------------------------------------------
  // Colour the dots by a measure instead of by what kind of facility they are.
  //
  // The domain is computed over what is CURRENTLY SHOWN, not over the registry,
  // so the ramp answers "how do these compare with each other" rather than
  // "how do these compare with a maximum that is filtered out of view". Filter
  // to one country and the scale rescales to it.
  //
  // Sites with no figure stay grey rather than taking the bottom of the ramp.
  // Power is known for 57 sites and floor area for 101, so the overwhelming
  // majority of dots have no value at all - painting those deep green would
  // read as "lowest", which is a claim, where grey reads as "not measured",
  // which is the truth.
  const HEAT_STOPS = ['#2E9E6B', '#8DC63F', '#F2C744', '#F08A24', '#D7263D'];
  const HEAT_NONE = '#9AA7B2';
  // `pk` is the same quantity on a PLANT record. Where a measure has one, the
  // plant layer joins the identical ramp over the identical domain instead of
  // keeping its fuel colours - which is the entire point of a shared scale. A
  // data centre's draw and a plant's nameplate are both megawatts, and a green
  // plant beside a red data centre is a site asking for more than the
  // generation next to it can supply. Two scales cannot show that; one can.
  //
  // `log` because capacity is log-distributed. There are thousands of 100 MW
  // plants and a handful above 5 GW, so on a linear ramp the top percent eats
  // the whole scale and everything else is one shade of green. Log also makes
  // the comparison a RATIO, which is what "draws more than it supplies" means.
  //
  // `sum` marks a measure the hexagon form can add up per cell: megawatts,
  // dollars and square feet total; a build year or a longitude does not, and
  // those drop out of the menu while hexagons are showing.
  const HEAT_MEASURES = [
    { k: 'mw',  pk: 'mw',  log: true, sum: true, label: 'Power (MW)', unit: 'MW' },
    // `fk` is the same quantity on a FAB record, the way `pk` is on a plant -
    // this measure is the first where all three layers carry the figure, so
    // fabs join the shared ramp here for the first time. US$ MILLIONS on every
    // layer. The figure means a slightly different thing per layer and each
    // surface says which: a data centre's is Epoch's ESTIMATED capex at
    // projected peak, a fab's and a plant's are the ANNOUNCED investment from
    // the operator or the press, URL kept per record. `log` because value is
    // log-distributed exactly like capacity: a $300M solar farm and a $165bn
    // fab campus on a linear ramp is one red dot on a green planet.
    { k: 'inv', pk: 'inv', fk: 'inv', log: true, money: true, sum: true,
      label: 'Project value (US$)', unit: 'US$' },
    // Generation ≤25 km used to be here and is a list column now. Once plants
    // joined this ramp it stopped earning a slot: the generation near a site
    // IS the plant rings, in the same colours, already on the screen. Floor
    // area is site-only too, but nobody expects a power station to have one -
    // where a measure that is explicitly ABOUT nearby generation, sitting in a
    // list beside a generation layer that ignored it, only invited the
    // question of why the plants had not changed colour.
    { k: 'ft2', log: true, sum: true, label: 'Floor area (sq ft)', unit: 'sq ft' },
    // Zero is a legitimate longitude and latitude but never a legitimate build
    // year or capacity, so "has a value" is not the same test for all of them.
    { k: 'by',  pk: 'y',   label: 'Year built', unit: 'year' },
    { k: 'lon', pk: 'lon', label: 'Longitude', zeroIsReal: true, unit: '°' },
    { k: 'lat', pk: 'lat', label: 'Latitude',  zeroIsReal: true, unit: '°' },
    // Hexagons only: how many records fall in the cell. Every one counts one,
    // so nothing is ever grey on this measure, and it is the one measure
    // every subject can be aggregated on. `log` because the counts are as
    // skewed as the capacities - Northern Virginia in one cell against a
    // thousand cells holding one site - and a linear ramp would paint the
    // planet the palest shade with one dark cell in Loudoun County. Not a
    // property of the record, hence `count` rather than a key to read.
    { k: 'count', count: true, log: true, sum: true, hexOnly: true, label: 'Count' },
  ];
  const HEAT_COUNT = HEAT_MEASURES.find(m => m.count);
  const heatSpec = () => {
    const m = HEAT_MEASURES.find(x => x.k === state.heat.k) || HEAT_MEASURES[0];
    // The count means nothing on a dot; if the form and the measure have
    // come apart, the dots fall back to the first real measure.
    return m.hexOnly && !state.heat.hex ? HEAT_MEASURES[0] : m;
  };
  const heatVal = (d, key, m) => {
    if (m.count) return 1;
    const v = d[key];
    if (v == null) return null;
    return (m.zeroIsReal ? Number.isFinite(+v) : +v > 0) ? +v : null;
  };
  const heatHas = (d) => heatVal(d, heatSpec().k, heatSpec()) != null;
  // True when the plant layer is on AND the current measure means something on
  // a plant. Both halves matter: plants off means they must not stretch the
  // domain, and a site-only measure means they must keep their fuel colours.
  // Never while hexagons are showing: the cells aggregate data centres, and
  // a plant ring coloured on the cells' scale would claim to be one of them.
  const plantsInHeat = () => !!(heatSpec().pk && state.layers.plants && !hexOn());
  // And the same gate for fabs: on the ramp only when the fab layer is on AND
  // the measure has a fab key, for the same two reasons.
  const fabsInHeat = () => !!(heatSpec().fk && state.layers.fabs && !hexOn());

  const hbBtn = document.getElementById('hb-btn');
  const hbMenu = document.getElementById('hb-menu');
  const hbSw = document.getElementById('hb-sw');
  const hbLbl = document.getElementById('hb-lbl');
  const hbMin = document.getElementById('hb-min');
  const hbMax = document.getElementById('hb-max');
  const hbRamp = document.getElementById('hb-ramp');
  const hbDist = document.getElementById('hb-dist');
  const hbHex = document.getElementById('hb-hex');
  const hbSizePick = document.getElementById('hb-size-pick');
  const hbSize = document.getElementById('hb-size');
  const hbSizeLbl = document.getElementById('hb-size-lbl');
  const hbSizeMenu = document.getElementById('hb-size-menu');

  let heatDomain = null;              // [lo, hi] over the visible set, or null
  let heatSig = '';                   // last painted heat state, for the globe

  // Position of a value on the ramp, 0..1. Log where the measure says so, and
  // the JS and the MapLibre expression below have to agree exactly or the
  // globe and the 2D map disagree about the same plant.
  function heatT(v) {
    if (!heatDomain) return 0;
    const [lo, hi] = heatDomain;
    if (hi === lo) return 1;
    if (heatSpec().log && lo > 0) {
      return Math.max(0, Math.min(1,
        Math.log10(Math.max(lo, v) / lo) / Math.log10(hi / lo)));
    }
    return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  }

  // The hexagon form has its own ramp: one hue, because a green-to-red
  // scale over AREAS reads as a verdict where over dots it reads as a rank.
  // OKLCH hue 45 throughout, warm so the low end survives satellite imagery.
  // The ramp is anchored to the SURFACE: on the day map it runs light to
  // dark (L 0.88 -> 0.41), on the night map dark to light (L 0.50 -> 0.90),
  // so the sparsest cell is the one nearest the ground colour in both and
  // the densest is the one that stands furthest off it. Reversing the day
  // ramp would not do: its darkest step is 1.85:1 against the night land,
  // an invisible floor. The CSS gradients on .hb-ramp.is-hex are these.
  const HEX_STOPS = {
    day: ['#FFCAB3', '#FF9462', '#E36927', '#B44901', '#7B3002'],
    night: ['#A24102', '#CF5604', '#F27636', '#FFA47A', '#FED4C1'],
  };
  const rampStops = () => (hexOn()
    ? HEX_STOPS[document.documentElement.dataset.theme === 'night' ? 'night' : 'day']
    : HEAT_STOPS);

  function heatColour(v) {
    if (!heatDomain) return HEAT_NONE;
    const st = rampStops();
    return st[Math.round(heatT(v) * (st.length - 1))];
  }

  // Every value the current measure has on the currently painted set. The ONE
  // list both the domain and the distribution chart are computed from, so the
  // chart can never disagree with the ramp about what is on it.
  function heatValues() {
    const m = heatSpec();
    // In hexagon form the population on the ramp is the CELLS, not the sites:
    // the domain, the readouts and the distribution chart all describe what
    // is painted, and what is painted is a sum per cell. Cells whose sites
    // all lack the measure sum to zero and are grey, like a dot with no value.
    if (hexOn()) return hexCells().map(c => c.v).filter(v => v > 0);
    const out = [];
    for (const d of shown()) {
      const v = heatVal(d, m.k, m);
      if (v != null) out.push(v);
    }
    // Plants stretch the SAME domain when they are on the same ramp. If they
    // had their own the colours would not be comparable, and comparing them
    // is the reason both are painted.
    if (plantsInHeat()) {
      for (const p of plants) {
        if (!fuelOn(p.f)) continue;
        const v = heatVal(p, m.pk, m);
        if (v != null) out.push(v);
      }
    }
    if (fabsInHeat()) {
      for (const f of fabs) {
        const v = heatVal(f, m.fk, m);
        if (v != null) out.push(v);
      }
    }
    return out;
  }

  // ---- hexagons --------------------------------------------------------------
  // The heatmap's other form: every shown site is dropped into an H3 cell
  // (Uber's hexagonal grid) and the cell is painted by the sum of the measure
  // over what landed in it. H3 rather than a pixel grid because a cell is
  // then a fixed piece of GROUND - ~316 km across at resolution 2, ~45 km at
  // 4 - and "how much capacity sits within 300 km of here" is a question
  // about the ground, not the screen. globe.gl bins its own hex layer with
  // the same library, so at the same resolution the sphere shows the
  // identical cells.
  //
  // Everything else about the heatmap is unchanged by the form: the cells
  // are built from shown(), so the search facet, the timeline cursor, the
  // kind chips and the hide-no-value filter all narrow them exactly as they
  // narrow the dots; the domain is computed over the cells; the ramp, the
  // readouts, the distribution chart and the brush all read that domain.
  //
  // Which resolution: the finest whose cells are still HEX_MIN_PX wide on
  // screen, from the renderer's own metres-per-pixel. Each step of
  // resolution is a factor of ~2.65 in width, so cells grow from 16 to ~42
  // px as you zoom in and snap down a step when they would pass it. A
  // hand-picked size holds the resolution fixed instead.
  //
  // Never coarser than resolution 2, ~316 km across. At world zoom the
  // 16 px rule reached for resolution 1, whose ~837 km cells swallowed
  // Ashburn and Chicago in one tile and read as a continent painted, not a
  // place counted. Below the floor the cells shrink on screen instead - a
  // dozen pixels at the world view - which is the honest picture.
  //
  // WHICH RECORDS. Every facility layer that is SWITCHED ON, together in one
  // set of cells. The layer pane is the control for what a cell contains -
  // turn Power Plants off and the cells stop counting plants - so the measure
  // menu never has to ask the same question twice. Count is one measure, not
  // three: a record is a record whichever layer it came from.
  //
  // A measure reads whichever key its layer carries - `k` on a site, `pk` on
  // a plant, `fk` on a fab, the same resolution the dot ramp already does.
  // A layer with no key for the current measure still puts its records IN the
  // cell, contributing nothing to the sum: a fab has no published demand, so
  // on Power it is one of the records the tip counts as being without a
  // figure, exactly like an unmeasured data centre beside it.
  //
  // WHAT A MIXED SUM MEANS. On Power a cell adds a data centre's draw to a
  // plant's nameplate, which are opposite quantities. The tip therefore
  // always breaks the cell down by layer, so the composition of any number
  // the map paints can be read off the cell itself.
  const HEX_KINDS = [
    { kind: 'site', one: 'data centre', many: 'data centres', layer: 'facilities',
      dots: ['sites', 'sites-ai'], note: 'dotcount',
      key: (m) => m.k, place: (d) => d.ci || d.c,
      // shown() is the registry's own answer to "what is painted" - the
      // search facet, the timeline, the kind chips, the worklist filter and
      // hide-no-value are all already in it.
      records: () => shown() },
    { kind: 'fab', one: 'fab', many: 'fabs', layer: 'fabs', dots: ['fab'],
      note: 'fabnote', key: (m) => m.fk,
      // `pl` is a full civic address, and the shapes vary: "Wuxi, Jiangsu (30
      // Xinzhou Road)", "Sinshih (Xinshi) District, Tainan", "Hsinchu Science
      // Park (Xinzhu (Zhubei), Keji 7th Road)". Drop the parentheses, keep
      // what is before the first comma: that is the locality in every one of
      // the 214, where the last part is a street as often as a city - and a
      // nested parenthesis left "Keji 7th Road)" standing in for Hsinchu.
      place: (d) => ((d.pl || '').replace(/\([^)]*\)/g, ' ').split(',')[0]
        .replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim() || d.cy),
      records: (K) => (state.layers.fabs ? fabs.filter(d => hexKeeps(d, K)) : []) },
    { kind: 'plant', one: 'power plant', many: 'power plants', layer: 'plants',
      dots: ['plant'], note: 'plantnote', key: (m) => m.pk,
      // A plant has no city in the payload; the province is the finest place
      // it carries, and "Texas x34" is the right grain beside a 300 km cell.
      place: (d) => d.st || d.cyn,
      // The fuel chips are this layer's kind filter, the way the AI and
      // traditional chips are the site layer's, so they narrow the cells too.
      records: (K) => (state.layers.plants
        ? plants.filter(d => fuelOn(d.f) && hexKeeps(d, K)) : []) },
  ];
  // The union, wrapped so a binned record still knows which layer it came
  // from: the weight, the tip's breakdown and the place name all need that
  // and the three payloads share no field that could tell them apart.
  const hexRecords = () => {
    const out = [];
    for (const K of HEX_KINDS) {
      if (!state.layers[K.layer]) continue;
      for (const r of K.records(K)) {
        if (r.lat != null && r.lon != null) out.push({ lat: r.lat, lon: r.lon, r, K });
      }
    }
    return out;
  };
  // The measures the hexagons offer: count, then everything that can be
  // added up. The list does not change with the layers - a measure no
  // visible layer carries paints an honestly empty map rather than
  // disappearing from the menu while you are reading it.
  const hexMeasures = () => [HEAT_COUNT, ...HEAT_MEASURES.filter(m => !m.count && m.sum)];
  // The two filters a layer's records must pass that its own visible set
  // does not already apply.
  //
  // Hide-no-value: shown() does this for sites already; the other two layers
  // get it here, so the button means the same thing whichever layers are on.
  //
  // And the footprint worklist, which sites already get from shown() - this
  // is where the fab and plant records pick it up.
  const hexKeeps = (d, K) => {
    if (!unmapped(d)) return false;
    if (!hideMissingActive()) return true;
    const m = heatSpec(), k = K.key(m);
    return !k || heatVal(d, k, m) != null;
  };

  // What the bar and the distribution panel call the thing being painted.
  // One name for one measure: which layers are in it is the layer pane's
  // statement to make, not this label's.
  const heatLabel = () => heatSpec().label;
  // Count has no unit of its own, so it borrows the noun of whatever is
  // actually being counted - "sites" while only data centres are on, the
  // neutral "assets" once a cell can hold more than one kind of thing.
  const hexNoun = (n, kinds) => {
    const list = kinds || HEX_KINDS.filter(K => state.layers[K.layer]);
    const one = list.length === 1 ? list[0] : null;
    return one ? (n === 1 ? one.one : one.many) : (n === 1 ? 'asset' : 'assets');
  };
  const heatUnit = () => {
    const m = heatSpec();
    return m.count ? hexNoun(2) : (m.unit || '');
  };

  // The hatch worn by a cell with nothing to sum, one image per theme. Drawn
  // rather than shipped as a file: it is twenty lines of canvas against a
  // sprite sheet and a build step, and the two strokes are picked against
  // their own land colour so the texture reads at about the same strength in
  // both - ~2.4:1, present but recessive, since it marks an absence.
  const HEX_HATCH = { 'hex-hatch-day': '#8A97A3', 'hex-hatch-night': '#5A6773' };
  // 20 px at pixelRatio 2 is a 10 px tile carrying two stripes, so even a
  // cell at the HEX_MIN_PX floor shows the texture as a texture. The stripes
  // run at 45 degrees on x + y = c, and c stepping by half the tile is what
  // makes the tile seamless against its neighbours.
  function hatchImage(colour) {
    const N = 20, cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.strokeStyle = colour;
    g.lineWidth = 2.5;
    g.lineCap = 'square';
    g.beginPath();
    for (let o = -N; o <= N; o += N / 2) { g.moveTo(o, N); g.lineTo(o + N, 0); }
    g.stroke();
    return g.getImageData(0, 0, N, N);
  }
  // Registered once the style is up - a style has no images before it loads,
  // and a fill-pattern naming one that is not there draws nothing at all.
  function addHatches() {
    for (const [id, colour] of Object.entries(HEX_HATCH)) {
      if (map.hasImage(id)) continue;
      const img = hatchImage(colour);
      if (img) map.addImage(id, img, { pixelRatio: 2 });
    }
  }
  map.on('style.load', addHatches);
  if (map.isStyleLoaded()) addHatches();

  const HEX_MIN_PX = 16;
  const HEX_MAX_RES = 9;        // 350 m cells: finer than a campus is not aggregation
  const HEX_MIN_RES = 2;        // ~316 km cells: coarser is a continent, not a place
  const HEX_SIZES = [2, 3, 4, 5, 6, 7];      // the hand-pickable resolutions
  const hexWidthKm = (res) => h3.getHexagonEdgeLengthAvg(res, h3.UNITS.km) * Math.sqrt(3);
  const hexKmText = (res) => {
    const km = hexWidthKm(res);
    return (km >= 10 ? Math.round(km).toLocaleString() : km.toFixed(1)) + ' km';
  };
  function fitRes(mPerPx) {
    for (let r = HEX_MAX_RES; r > HEX_MIN_RES; r--) {
      if (hexWidthKm(r) * 1000 / mPerPx >= HEX_MIN_PX) return r;
    }
    return HEX_MIN_RES;
  }
  // 2D: the web-mercator ground resolution at the equator - MapLibre's 512 px
  // tiles put the whole equator across 512 * 2^z pixels, which is half the
  // 256-tile GROUND figure the URL uses. A cell at 60° north draws twice as
  // wide as the same cell on the equator, which is Mercator being honest
  // about itself, not a reason to re-bin on every pan.
  // 3D: globe.gl draws ~12.5 / altitude px per degree of arc (see
  // pointRadius), and a degree is 111 km.
  const EQUATOR_M = 40075016.686;
  const hexRes = () => (state.heat.res != null ? Math.max(HEX_MIN_RES, state.heat.res)
    : state.mode === '3d' ? fitRes(111000 * globeAlt / 12.5)
    : fitRes(EQUATOR_M / (512 * Math.pow(2, map.getZoom()))));
  let hexResPainted = null;     // the resolution the cells on screen were built at
  // Test hook, the same one window.__map and window.__globe are: the cells
  // are derived from four moving parts (subject, measure, zoom, filters) and
  // nothing else on the page reports which one produced what is drawn.
  window.__hex = { res: hexRes, cells: hexCells, fit: fitRes, kinds: HEX_KINDS,
    tip: (c) => hexTip(c.recs, c.v, c.res) };

  // The cells of the painted set at the current resolution, memoised on the
  // measure and the resolution. Dropped by applyHeat, the one place the
  // painted set is known to have moved; between two applyHeats the readouts,
  // the chart and the hover tip all ask and get the same answer.
  let hexMemo = null;
  function hexCells() {
    const m = heatSpec(), res = hexRes();
    const on = HEX_KINDS.filter(K => state.layers[K.layer]).map(K => K.kind).join('+');
    const key = `${on}|${m.k}|${res}`;
    if (hexMemo && hexMemo.key === key) return hexMemo.cells;
    const byId = new Map();
    for (const w of hexRecords()) {
      const id = h3.latLngToCell(w.lat, w.lon, res);
      let c = byId.get(id);
      if (!c) byId.set(id, c = { id, res, v: 0, recs: [] });
      c.recs.push(w);
      c.v += hexWeight(w);
    }
    hexMemo = { key, byId, cells: [...byId.values()] };
    return hexMemo.cells;
  }

  // A cell's outline as a GeoJSON ring. h3 hands back raw longitudes, so a
  // cell straddling the antimeridian arrives as 179 -> -179 and would draw
  // as a sliver right round the world; unwrapped onto one side, MapLibre
  // draws it across the seam on the neighbouring world copy.
  function hexRing(id) {
    const ring = h3.cellToBoundary(id, true);
    let lo = Infinity, hi = -Infinity;
    for (const p of ring) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0]; }
    if (hi - lo > 180) for (const p of ring) if (p[0] < 0) p[0] += 360;
    return ring;
  }

  // What a cell holds, for the hover tip in both renderers (globe.gl hands
  // over the binned wrappers, the 2D layer the cell they were memoised in).
  //
  // Always broken down by layer when it holds more than one kind, because on
  // a mixed measure the total alone does not say what went into it: 13,694 MW
  // over a cell holding both is some draw and some nameplate, and the split
  // is the reader's only way to tell which. The places inside it too, because
  // "23 assets" is half an answer and "23, 12 of them in Ashburn" is the fact.
  function hexTip(recs, v, res) {
    const m = heatSpec();
    const n = recs.length;
    let has = 0;
    const places = new Map();
    const kinds = new Map();
    for (const w of recs) {
      if (heatVal(w.r, w.K.key(m), m) != null) has++;
      kinds.set(w.K, (kinds.get(w.K) || 0) + 1);
      const k = w.K.place(w.r);
      if (k) places.set(k, (places.get(k) || 0) + 1);
    }
    // Three names, each clipped: a handful of fabs sit in places called
    // "West Zone of the Chengdu Hi-Tech Industrial Development Zone", and
    // three of those is a paragraph in a tooltip.
    const short = (k) => (k.length > 26 ? k.slice(0, 25).trimEnd() + '…' : k);
    const top = [...places].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, c]) => esc(short(k)) + (c > 1 ? ' ×' + c : '')).join(', ')
      + (places.size > 3 ? ` +${places.size - 3} more` : '');
    // In HEX_KINDS order rather than by size, so the same cell reads the same
    // way every time you come back to it.
    const mix = HEX_KINDS.filter(K => kinds.has(K))
      .map(K => `${kinds.get(K).toLocaleString()} ${kinds.get(K) === 1 ? K.one : K.many}`);
    const count = `${n.toLocaleString()} ${hexNoun(n, [...kinds.keys()])}`;
    const head = m.count ? count
      : v > 0 ? (m.money ? fmtHeat(v) : `${fmtHeat(v)} ${m.unit}`)
      : `${count}, none with a figure`;
    const parts = [];
    // The composition, unless the head already is it - any head that counts
    // rather than measures ("23 data centres", "23 assets, none with a
    // figure") has already said what a single-kind cell holds.
    if (mix.length > 1 || (!m.count && v > 0)) parts.push(mix.join(' · '));
    if (!m.count && v > 0) {
      parts.push(`${has === n ? 'all' : has + ' of ' + n.toLocaleString()} with a figure`);
    }
    if (top) parts.push(top);
    return `<div class="t">${head}</div>` +
      parts.filter(Boolean).map(x => `<div class="d">${x}</div>`).join('') +
      `<div class="d">hexagon ≈ ${hexKmText(res)} across</div>`;
  }

  // globe.gl's accessors for the prisms. Declared as functions so initGlobe,
  // which sits above this block in the file, can name them; they only ever
  // run once the globe exists, long after everything here is defined. `b`
  // is globe.gl's bin: { points, sumWeight, center }.
  function hexWeight(w) {
    const m = heatSpec();
    return heatVal(w.r, w.K.key(m), m) || 0;
  }
  function hexTopColour(b) {
    return heatDomain && b.sumWeight > 0 ? heatColour(b.sumWeight) : HEAT_NONE;
  }
  function hexSideColour(b) { return hexA(hexTopColour(b), 0.55); }
  // Height is the ramp position again - the 2D colour, told a second way -
  // with a floor so a grey cell still stands off the imagery as a cell. 0.08
  // is ~500 km for the top of the ramp: enough to read from orbit, not so
  // much that Ashburn's prism hides Ohio.
  function hexAltitude(b) {
    return heatDomain && b.sumWeight > 0 ? 0.003 + 0.08 * heatT(b.sumWeight) : 0.002;
  }

  // Each layer's sub-label says what that layer is drawing, so the one being
  // aggregated says so there rather than in the bar: "6,289 shown" is no
  // longer true of a layer drawing 225 hexagons, and the hollow-dot note it
  // replaces is about markers that are not on the map. The other two layers
  // are restored to whatever they say for themselves - captured on the first
  // overwrite, because the fab note is written from the payload at startup
  // and a copy written out here would go stale with it.
  const noteBase = new Map();
  function hexNotes(hex) {
    // Per layer rather than once in the bar: each line counts its OWN
    // records, which is the number that layer's entry is there to report,
    // and together they say what went into the cells.
    const cells = hex ? hexCells() : null;
    for (const K of HEX_KINDS) {
      const el = document.getElementById(K.note);
      if (!el) continue;
      if (!noteBase.has(K.note)) noteBase.set(K.note, el.textContent);
      if (hex && state.layers[K.layer]) {
        let n = 0;
        for (const c of cells) for (const w of c.recs) if (w.K === K) n++;
        el.textContent = `${n.toLocaleString()} shown — aggregated into the hexagons`;
      } else if (K.kind === 'site') {
        updateCount();          // its base text moves with every filter
      } else {
        el.textContent = noteBase.get(K.note);
      }
    }
  }

  // The measure's own number format - shared by the bar's end readouts and
  // every label on the distribution chart, so the two can never disagree
  // about what $12,400 is called.
  const fmtHeat = (v) => {
    const m = heatSpec();
    return m.k === 'by' ? String(Math.round(v))
      : m.money ? usdText(v) : Math.round(v).toLocaleString();
  };

  // Recomputed whenever the visible set changes, which is why it hangs off
  // applyVisibility rather than off the switch.
  function applyHeat() {
    const m = heatSpec();
    hbLbl.textContent = heatLabel();
    hbSw.setAttribute('aria-checked', String(state.heat.on));
    // The form's controls: the toggle shows the form that is actually
    // painting (off with the switch, whatever the flag says), the ramp wears
    // the form's own colours, and the size picker exists only for cells.
    const hex = hexOn();
    hexMemo = null;                  // the painted set may have moved
    hbHex.setAttribute('aria-pressed', String(hex));
    hbRamp.classList.toggle('is-hex', hex);
    hbSizePick.hidden = !hex;
    if (hex) {
      hbSizeLbl.textContent = state.heat.res == null
        ? `auto · ~${hexKmText(hexRes())}` : `~${hexKmText(state.heat.res)}`;
    }

    heatDomain = null;
    if (state.heat.on) {
      let lo = Infinity, hi = -Infinity;
      for (const v of heatValues()) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo <= hi) heatDomain = [lo, hi];
      // A hand-narrowed range REPLACES the computed domain rather than
      // clipping it: the ramp stretches over the chosen band, and everything
      // outside saturates at the end colours. Nothing is hidden - the filter
      // refines the scale so the middle of the data can use the whole ramp,
      // which one $168bn outlier otherwise denies it. Only when something is
      // painted at all, so "none shown" keeps meaning none.
      if (heatDomain && state.heat.range) heatDomain = state.heat.range.slice();
    }
    // Say when the readouts are a hand choice, not the data's extremes - and
    // only when the choice is actually APPLIED: with nothing painted carrying
    // the measure the stored range is inert, and a ring around a bar reading
    // "none shown" would be the indicator contradicting its own readouts.
    hbRamp.classList.toggle('hb-narrowed', !!(state.heat.on && state.heat.range && heatDomain));
    const fmt = fmtHeat;
    // Switched on over a set where nothing carries the measure, every dot goes
    // grey and blank ends read as a broken control rather than as an answer.
    hbMin.textContent = heatDomain ? fmt(heatDomain[0]) : (state.heat.on ? 'none shown' : '');
    hbMax.textContent = heatDomain ? fmt(heatDomain[1]) : '';

    // The ramp for one property name. Built per key rather than once, because
    // the site layers read `mw` and the plant layer reads its own `pk`, and
    // both have to resolve against the one shared domain.
    const rampFor = (key) => {
      const [lo, hi] = heatDomain;
      // hi === lo would make interpolate throw on non-ascending stops, so a
      // single-valued domain is painted flat.
      const st = rampStops();
      if (hi === lo) return st[st.length - 1];
      const useLog = m.log && lo > 0;
      const val = ['to-number', ['get', key], lo];
      const ramp = [];
      st.forEach((c, i) => {
        const t = i / (st.length - 1);
        ramp.push(useLog ? Math.log10(lo * Math.pow(hi / lo, t)) : lo + (hi - lo) * t, c);
      });
      // Clamped at lo before the log so a value under the domain floor cannot
      // reach log10(0). Missing values never get here - the case below catches
      // them first - but the ramp must be total anyway.
      return ['interpolate', ['linear'],
        useLog ? ['log10', ['max', lo, val]] : val, ...ramp];
    };
    const missingFor = (key) => (m.zeroIsReal
      ? ['==', ['has', key], false]
      : ['<=', ['to-number', ['get', key], 0], 0]);
    // Draw order follows the value while the ramp is painting: MapLibre sorts
    // a layer's circles ascending by this key, so the red dot renders ON TOP
    // of the green and grey ones around it. Without it, feature order decides
    // - and in Ashburn or Tainan that buried exactly the dot the ramp exists
    // to surface. Missing values coerce to 0 and sink to the bottom. Cleared
    // (null) when the heat is off, so the layers keep their native order.
    const sortFor = (key) => ['to-number', ['get', key], 0];

    // Rebuild the two dot layers' colour. Everything else dotPaint sets - the
    // radius, the hollow town ring, the halo - is left alone.
    const town = ['==', ['get', 'gp'], 'town'];
    for (const [id, key] of [['sites', 'fac'], ['sites-ai', 'ai']]) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, 'circle-sort-key', heatDomain ? sortFor(m.k) : null);
      if (!heatDomain) {
        map.setPaintProperty(id, 'circle-color', ['case', town, 'rgba(0,0,0,0)', pal()[key]]);
        continue;
      }
      map.setPaintProperty(id, 'circle-color',
        ['case', town, 'rgba(0,0,0,0)', missingFor(m.k), HEAT_NONE, rampFor(m.k)]);
    }

    // The cells. Rebuilt whole on every call in hexagon form - the painted
    // set, the measure or the resolution may each have moved, and 1,500
    // seven-point polygons through setData is a few milliseconds. A cell
    // whose sites all lack the measure sums to zero: grey and fainter, the
    // dots' "not measured" said the same way.
    if (map.getLayer('hex-fill') && map.getLayer('hex-none')) {
      if (hex) {
        const cells = hexCells();
        hexFC.features = cells.map(c => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [hexRing(c.id)] },
          properties: { h: c.id, v: c.v, n: c.recs.length },
        }));
        map.getSource('hex').setData(hexFC);
        // Only the cells with something to sum are painted from the ramp;
        // the rest are the hatched layer's, by the filters the two carry.
        // With no domain at all nothing is on the ramp, so every cell falls
        // to the hatch - "none shown" drawn rather than stated.
        if (heatDomain) map.setPaintProperty('hex-fill', 'fill-color', rampFor('v'));
        map.setPaintProperty('hex-none', 'fill-pattern', pal().hatch);
      }
      for (const id of ['hex-fill', 'hex-none']) {
        map.setLayoutProperty(id, 'visibility', hex ? 'visible' : 'none');
      }
    }
    hexNotes(hex);
    hexResPainted = hex ? hexRes() : null;
    if (globe) globe.hexTopColor(hexTopColour).hexSideColor(hexSideColour).hexAltitude(hexAltitude);

    // And the plant layer, onto the same ramp when the measure applies to it.
    if (map.getLayer('plant')) {
      const base = plantPaint();
      const on = heatDomain && m.pk;
      const colour = on
        ? ['case', missingFor(m.pk), HEAT_NONE, rampFor(m.pk)]
        : base['circle-color'];
      map.setPaintProperty('plant', 'circle-color', colour);
      map.setPaintProperty('plant', 'circle-stroke-color', colour);
      map.setLayoutProperty('plant', 'circle-sort-key', on ? sortFor(m.pk) : null);
      // Fuel rings are deliberately faint because they are context. On the
      // shared ramp they are the subject, and a 26%-opacity fill cannot be
      // compared by eye against a 92%-opacity dot. Approximate locations stay
      // hollow either way - the stroke still carries the colour.
      map.setPaintProperty('plant', 'circle-opacity', on
        ? ['case', ['==', ['get', 'ax'], 1], 0, 0.62]
        : base['circle-opacity']);
    }

    // Fabs, same deal, when the measure carries a fab key. The fill takes the
    // ramp; the dark rim stays, because the rim - not the hue - is what tells
    // a fab from a data centre dot once both are painted from one palette.
    // Announced fabs drop their half-transparency on the ramp for the same
    // reason the plant rings drop their faintness: normally they are context,
    // here they are the subject, and Terafab at 45% opacity cannot be read
    // against an operating fab at 90%.
    if (map.getLayer('fab')) {
      const base = fabPaint();
      const on = heatDomain && m.fk;
      map.setPaintProperty('fab', 'circle-color', on
        ? ['case', missingFor(m.fk), HEAT_NONE, rampFor(m.fk)]
        : base['circle-color']);
      map.setPaintProperty('fab', 'circle-opacity', on ? 0.92 : base['circle-opacity']);
      map.setLayoutProperty('fab', 'circle-sort-key', on ? sortFor(m.fk) : null);
    }
    if (globe) globe.pointColor(pointColour);

    // globe.gl keys HTML markers on datum IDENTITY, and visiblePlants memoises
    // its wrappers so panning does not rebuild 300 elements every frame. That
    // memo also means a colour change alone would never reach the DOM. So the
    // cache is dropped when - and only when - the heat state actually moves;
    // clearing it on every applyHeat would undo the memo entirely.
    const sig = state.heat.on
      ? `${m.k}|${heatDomain ? heatDomain.join(',') : 'none'}|`
        + (hex ? `hex${hexResPainted}${HEX_KINDS.filter(K => state.layers[K.layer])
            .map(K => K.kind).join('')}` : 'dots')
      : 'off';
    if (sig !== heatSig) {
      heatSig = sig;
      plantWrap.clear();
      if (globe) refreshGlobe();
    }

    // The chart bins over the domain this function just set, so it re-renders
    // here - after every repaint, not only after its own brush - or a layer
    // toggle would leave it drawing a population the map no longer paints.
    if (!hbDist.hidden) renderDist();
  }
  window.__applyHeat = applyHeat;   // called from applyVisibility

  // Repaint after a heat-state change. Mostly applyHeat alone - but with the
  // hide-no-value filter armed, switching the measure or the toggle changes
  // WHICH dots exist, and that is applyVisibility's jurisdiction (the 2D
  // filters, the count, the globe), which then calls applyHeat itself.
  // The same goes for the hexagon form, which hides the dots outright.
  const reheat = () => (state.heat.hideMissing || state.heat.hex ? refreshView() : applyHeat());

  hbBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = hbMenu.hidden;
    if (open) {
      // One flat list of measures in either form. Hexagons add Count and
      // drop the measures that cannot be added up; nothing here picks which
      // layers are painted, because the layer pane already does.
      const list = state.heat.hex
        ? hexMeasures() : HEAT_MEASURES.filter(m => !m.hexOnly);
      hbMenu.innerHTML = list.map(m =>
        '<button type="button" data-m="' + m.k + '"><span class="tick">'
        + (m.k === heatSpec().k ? '✓' : '') + '</span>' + esc(m.label) + '</button>').join('');
      // One popover at a time: the menu and the distribution panel share the
      // strip above the bar, and both open meant the panel painting over the
      // menu. Defined later in this block, hence the window hook.
      if (window.__closeDist) window.__closeDist();
    }
    hbMenu.hidden = !open;
    hbBtn.setAttribute('aria-expanded', String(open));
  });
  hbMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    // A narrowed range belongs to the measure it was drawn on - $14M-$40bn
    // means nothing in megawatts - so switching measures resets it.
    if (state.heat.k !== b.dataset.m) state.heat.range = null;
    state.heat.k = b.dataset.m;
    // Choosing a measure means you want to see it. Switching on for you is
    // less surprising than showing the name of a measure that is not painted.
    state.heat.on = true;
    hbMenu.hidden = true;
    hbBtn.setAttribute('aria-expanded', 'false');
    reheat();
  });
  document.addEventListener('click', (e) => {
    if (!hbMenu.hidden && !hbBtn.closest('.hb-pick').contains(e.target)) {
      hbMenu.hidden = true;
      hbBtn.setAttribute('aria-expanded', 'false');
    }
  });
  hbSw.addEventListener('click', () => { state.heat.on = !state.heat.on; reheat(); });

  // The form toggle. Choosing hexagons switches the heat on, like choosing a
  // measure does; and it lands on the count unless a summable measure was
  // already painting - "how many are here" is the question hexagons answer
  // first, and a build year cannot be added up. Back to dots, the count
  // hands over to the first real measure. Either way the brushed range goes:
  // a band drawn on per-site megawatts means nothing on per-cell totals.
  function setHex(on) {
    state.heat.hex = on;
    const m = HEAT_MEASURES.find(x => x.k === state.heat.k) || HEAT_MEASURES[0];
    if (on) {
      if (!state.heat.on || !m.sum) state.heat.k = 'count';
      state.heat.on = true;
    } else if (m.hexOnly) {
      state.heat.k = HEAT_MEASURES[0].k;
    }
    state.heat.range = null;
    refreshView();
  }
  hbHex.addEventListener('click', () => setHex(!state.heat.hex));

  // Cell size: automatic, or one of the H3 resolutions by its width on the
  // ground, since "320 km cells" is what an underwriter would ask for.
  hbSize.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = hbSizeMenu.hidden;
    if (open) {
      const row = (v, label) => '<button type="button" data-r="' + v + '"><span class="tick">'
        + (String(state.heat.res ?? '') === v ? '✓' : '') + '</span>' + label + '</button>';
      hbSizeMenu.innerHTML = row('', 'Automatic — follows the zoom')
        + HEX_SIZES.map(r => row(String(r), `~${hexKmText(r)} across`)).join('');
      hbMenu.hidden = true;
      hbBtn.setAttribute('aria-expanded', 'false');
      if (window.__closeDist) window.__closeDist();
    }
    hbSizeMenu.hidden = !open;
    hbSize.setAttribute('aria-expanded', String(open));
  });
  hbSizeMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    state.heat.res = b.dataset.r === '' ? null : +b.dataset.r;
    hbSizeMenu.hidden = true;
    hbSize.setAttribute('aria-expanded', 'false');
    applyHeat();
  });
  document.addEventListener('click', (e) => {
    if (!hbSizeMenu.hidden && !hbSizePick.contains(e.target)) {
      hbSizeMenu.hidden = true;
      hbSize.setAttribute('aria-expanded', 'false');
    }
  });

  // Zooming across a resolution step is a new set of cells. Checked on every
  // zoom frame, but the check is ten multiplications and the rebuild only
  // happens at the crossing - the same shape as the footprint handoff.
  map.on('zoom', () => {
    if (hexOn() && state.heat.res == null && hexRes() !== hexResPainted) applyHeat();
  });

  // Hovering a cell. Yields to the marker layers drawn ABOVE the fill - a
  // plant ring sitting on a cell is the thing under the cursor, and its own
  // tip should say so. The layers under the fill (footprint rings,
  // substations, dropped pins) keep their clicks but lose the hover to the
  // cell: they are drawn through 70% of orange, and the picture says the
  // cell is on top. Yielding to those too left Europe, which is carpeted in
  // footprint rings, with no reachable cell tip at all.
  const HEX_YIELDS = ['plant', 'fab', 'epicentre'];
  // Both cell layers, because which of the two a cell landed in is a fact
  // about its data and not about what the cursor is pointing at.
  for (const id of ['hex-fill', 'hex-none']) {
    map.on('mousemove', id, (e) => {
      const layers = HEX_YIELDS.filter(l => map.getLayer(l));
      if (map.queryRenderedFeatures(e.point, { layers }).length) return;
      const c = hexMemo && hexMemo.byId.get(e.features[0].properties.h);
      if (c) showTip(e.originalEvent.clientX, e.originalEvent.clientY, hexTip(c.recs, c.v, c.res));
    });
    // The two cell layers are ONE surface to the cursor, and MapLibre raises
    // each layer's events independently: crossing from a hatched cell to a
    // painted one fires this alongside the other layer's mousemove, in no
    // guaranteed order, and hiding unconditionally blanked the tip while the
    // pointer was still over a cell. Leave only when it has left both.
    map.on('mouseleave', id, (e) => {
      const other = id === 'hex-fill' ? 'hex-none' : 'hex-fill';
      if (e && e.point && map.getLayer(other)
          && map.queryRenderedFeatures(e.point, { layers: [other] }).length) return;
      hideTip();
    });
  }

  // ---- distribution panel ----------------------------------------------------
  // The ramp compresses a shape into a gradient; this panel shows the shape.
  // Clicking the ramp opens a histogram of the painted measure over exactly
  // the set applyHeat computed its domain from, each bar wearing the colour
  // its values are painted. Dragging across it narrows the domain to the
  // selection: the ramp stretches over the chosen band, outliers saturate at
  // the end colours, and the chart re-bins over the new domain so a second
  // drag narrows further. That is the whole point - one $168bn project
  // otherwise owns the top of a log ramp and flattens everything else into
  // green, and the only way to compare the middle is to take the scale back.
  //
  // Narrowing refines the SCALE, it never hides a dot: excluded values stay
  // on the map at the end colours, and the two dim bars flanking the chart
  // say how many sit outside. Hiding them would turn a legend control into a
  // silent data filter, which is a different and more dangerous tool.
  const hbdTitle = document.getElementById('hbd-title');
  const hbdChart = document.getElementById('hbd-chart');
  const hbdReset = document.getElementById('hbd-reset');
  const hbdNote = document.getElementById('hbd-note');
  const hbdLo = document.getElementById('hbd-lo');
  const hbdHi = document.getElementById('hbd-hi');
  const hbdUnit = document.getElementById('hbd-unit');

  const DIST_BINS = 36;
  const DIST_TOTAL = 446;          // viewBox width = panel's content width
  const DIST_SLOT = 10;            // the out-of-range bar at each end
  const DIST_X0 = DIST_SLOT + 2;   // plot area
  const DIST_W = DIST_TOTAL - 2 * DIST_X0;
  const DIST_H = 84;

  // Inverse of heatT: the value at position t on the current domain. The two
  // must stay the same curve or the brush selects a different band than the
  // one the user drew over.
  function distValueAt(t) {
    const [lo, hi] = heatDomain;
    if (heatSpec().log && lo > 0) return lo * Math.pow(hi / lo, t);
    return lo + (hi - lo) * t;
  }

  function renderDist() {
    // A rebuild means the domain or the population moved (a layer toggle, a
    // timeline tick, a measure switch). Any drag in flight was drawn against
    // the OLD chart, so it is abandoned rather than committed against a scale
    // the user never saw.
    cancelBrush();
    const m = heatSpec();
    hbdTitle.innerHTML = '<b>' + esc(heatLabel()) + '</b> — distribution';
    hbdReset.hidden = !state.heat.range;
    if (!state.heat.on || !heatDomain) {
      hbdChart.innerHTML = '';
      hbdNote.textContent = state.heat.on
        ? 'Nothing currently shown carries this measure.'
        : 'Switch the heatmap on to see the distribution.';
      syncInputs();
      return;
    }
    const [lo, hi] = heatDomain;
    const vals = heatValues();
    const bins = new Array(DIST_BINS).fill(0);
    let below = 0, above = 0;
    for (const v of vals) {
      if (v < lo) { below++; continue; }
      if (v > hi) { above++; continue; }
      // heatT clamps, so v === hi lands on t = 1; keep it in the last bin.
      bins[Math.min(DIST_BINS - 1, Math.floor(heatT(v) * DIST_BINS))]++;
    }
    // The scale is the IN-RANGE peak, deliberately. After a couple of drills
    // most values sit outside the band, and letting the 152-outside bar set
    // the scale flattened the in-band shape to slivers - the very shape the
    // panel exists to show. The overflow bars saturate at full height instead
    // and carry their true count on hover; "a wall at the edge" is the right
    // message at any magnitude.
    const peak = Math.max(1, ...bins);
    const bw = DIST_W / DIST_BINS;
    // Height is linear in count with a floor: the one-project bin is exactly
    // the anomaly this panel exists to spot, and at 1/peak of 84px it would
    // otherwise be invisible.
    const hOf = (count) => (count
      ? Math.max(2, Math.min(DIST_H - 4, (count / peak) * (DIST_H - 4))) : 0);
    const rect = (x, w, count, fill, cls, label) => {
      const h = hOf(count);
      if (!h) return '';
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${(DIST_H - h).toFixed(1)}"` +
        ` width="${w.toFixed(1)}" height="${h.toFixed(1)}"${fill ? ` fill="${fill}"` : ''}>` +
        `<title>${esc(label)}</title></rect>`;
    };
    const parts = [];
    for (let i = 0; i < DIST_BINS; i++) {
      const a = distValueAt(i / DIST_BINS), b = distValueAt((i + 1) / DIST_BINS);
      parts.push(rect(DIST_X0 + i * bw, bw - 0.6, bins[i],
        heatColour(distValueAt((i + 0.5) / DIST_BINS)), 'hbd-bar',
        `${fmtHeat(a)} – ${fmtHeat(b)} · ${bins[i]}`));
    }
    parts.push(rect(0, DIST_SLOT, below, '', 'hbd-out',
      `${below} below ${fmtHeat(lo)} — clamped to the low colour`));
    parts.push(rect(DIST_TOTAL - DIST_SLOT, DIST_SLOT, above, '', 'hbd-out',
      `${above} above ${fmtHeat(hi)} — clamped to the high colour`));

    // The y axis: count gridlines at the in-range peak and its midpoint,
    // labelled inside the plot's top-left. Drawn UNDER the bars (pushed to
    // the front of parts) so a tall bar is never sliced by its own gridline's
    // label. Only two lines - the min-height floor on tiny bars already makes
    // an exact reading impossible below ~2 counts, and pretending finer
    // precision with a denser grid would be a lie drawn in ink.
    const grid = [];
    for (const c of peak > 1 ? [peak, Math.round(peak / 2)] : [peak]) {
      if (!c || (grid.length && c === peak)) continue;
      const y = DIST_H - (c / peak) * (DIST_H - 4);
      grid.push(`<line class="hbd-grid" x1="${DIST_X0}" y1="${y.toFixed(1)}"` +
        ` x2="${DIST_X0 + DIST_W}" y2="${y.toFixed(1)}"/>` +
        `<text class="hbd-lbl" x="${DIST_X0 + 3}" y="${(y - 2).toFixed(1)}">${c}</text>`);
    }
    parts.unshift(...grid);

    // The x axis: the domain's values at five even positions of the SCALE -
    // even in t, not in value, so on a log ramp the ticks land log-spaced,
    // which is the truth about where the colours change. First and last stick
    // to their ends so the extremes never clip.
    const AXIS_H = 14;
    const ticks = [];
    const tickTs = hi > lo ? [0, 0.25, 0.5, 0.75, 1] : [0.5];
    for (const t of tickTs) {
      const x = DIST_X0 + t * DIST_W;
      const anchor = t === 0 ? 'start' : t === 1 ? 'end' : 'middle';
      ticks.push(`<line class="hbd-tick" x1="${x.toFixed(1)}" y1="${DIST_H + 1}"` +
        ` x2="${x.toFixed(1)}" y2="${DIST_H + 4}"/>` +
        `<text class="hbd-lbl" x="${x.toFixed(1)}" y="${DIST_H + 12}"` +
        ` text-anchor="${anchor}">${esc(fmtHeat(distValueAt(t)))}</text>`);
    }

    hbdChart.innerHTML =
      `<svg viewBox="0 0 ${DIST_TOTAL} ${DIST_H + AXIS_H}" role="img"` +
      ` aria-label="Histogram of ${esc(m.label)}">` +
      parts.join('') +
      `<line class="hbd-axis" x1="0" y1="${DIST_H + 0.5}" x2="${DIST_TOTAL}" y2="${DIST_H + 0.5}"/>` +
      ticks.join('') +
      `<rect id="hbd-brush" class="hbd-brush" x="0" y="0" width="0" height="${DIST_H}"/>` +
      // The hover crosshair: where a drag would start, before it starts.
      // Positioned by the chart's own pointermove, hidden the moment a drag
      // begins - the selection readout owns the chart from then on.
      `<line id="hbd-cur" class="hbd-cur" x1="-9" x2="-9" y1="0" y2="${DIST_H}"/>` +
      `<text id="hbd-curlbl" class="hbd-sel-lbl" y="11"></text>` +
      // The live readout: the drag's start and end values, filled in by
      // pointermove and emptied whenever the brush ends or dies.
      `<text id="hbd-selA" class="hbd-sel-lbl" y="11"></text>` +
      `<text id="hbd-selB" class="hbd-sel-lbl" y="11"></text>` +
      '</svg>';
    syncInputs();
    hbdNote.textContent = `${vals.length.toLocaleString()} values on the ramp`
      + (below || above
        ? ` · ${below ? `${below} below` : ''}${below && above ? ', ' : ''}` +
          `${above ? `${above} above` : ''} the range, clamped to the end colours`
        : '')
      + (hi > lo ? ' · drag across the chart to narrow the range' : ' · every value is the same');
  }

  // The brush. Down starts a selection, move stretches the highlight, up
  // narrows the domain to it - unless the drag was too small to be one, which
  // is a click and does nothing. Listeners on window, not the svg: the svg is
  // rebuilt on every render and a drag routinely leaves the panel.
  //
  // A brush is a fragile thing and every way it can be interrupted must
  // CANCEL it, not half-apply it. The failure the review pass found: Escape
  // mid-drag hid the panel but left the drag armed, and the next release
  // committed a range computed against a display:none chart whose zero-width
  // rect turned the pixel maths into Infinity - a filter the user never drew,
  // applied silently. So: the gesture is bound to one pointerId; the domain
  // it maps through is CAPTURED at pointerdown (never the live one, which a
  // timeline tick can move mid-drag); pointercancel, window blur, a panel
  // close and a chart re-render all abandon it; and a dead rect abandons it
  // too rather than dividing by it.
  let brush = null;   // { id, xA, xB, dom, log } - viewBox units + frozen scale
  const valIn = (dom, useLog, t) => (useLog
    ? dom[0] * Math.pow(dom[1] / dom[0], t)
    : dom[0] + (dom[1] - dom[0]) * t);
  const brushX = (clientX) => {
    const svg = hbdChart.querySelector('svg');
    const r = svg && svg.getBoundingClientRect();
    return r && r.width > 0 ? (clientX - r.left) / r.width * DIST_TOTAL : null;
  };
  const cancelBrush = () => {
    if (!brush) return;
    brush = null;
    const el = hbdChart.querySelector('#hbd-brush');
    if (el) el.setAttribute('width', '0');
    for (const id of ['hbd-selA', 'hbd-selB']) {
      const t = hbdChart.querySelector('#' + id);
      if (t) t.textContent = '';
    }
    syncInputs();   // the boxes tracked the drag; put the real domain back
  };

  // ---- the typed twin of the brush -------------------------------------------
  // Two boxes holding the domain's exact bounds in the measure's OWN unit
  // (hbd-unit says which), because a drag is precise to about a bin and
  // "everything from exactly $10bn" is not. Enter or leaving an EDITED field
  // applies; garbage, a reversed pair typed as equal, or a non-positive
  // bound on a log measure quietly reverts to what the domain really is -
  // the boxes never show a range the map is not painting.
  //
  // WHAT COUNTS AS AN EDIT IS TRACKED EXPLICITLY, never inferred from the
  // browser's change event. The review pass proved change-on-blur is the
  // wrong oracle three different ways: it fires a second apply after Enter,
  // it fires an apply for an edit Escape had just abandoned (Blink compares
  // against the value before the FIRST user edit, so restoring a moved
  // domain's bound still reads as changed), and it converts a drag the user
  // walked away from into a committed range. An `input` event - which only
  // real keystrokes fire, never assignments to .value - marks a box dirty;
  // apply consumes the mark; every programmatic write clears it.
  const dirty = new Set();
  const setBox = (el, text) => { el.value = text; dirty.delete(el); };
  // Numbers for the boxes: exact enough to round-trip - a bound the user did
  // NOT edit is never re-parsed from this text anyway (applyTyped keeps its
  // true value), so display rounding can no longer shift a committed range.
  // Years skip the thousands separator: "2,026" is a number, not a year.
  // MONEY IS SHOWN AND TYPED IN FULL DOLLARS - "85,730,000,000", not the
  // internal US$-millions unit - because a box captioned US$ that means
  // millions is a thousand-fold trap. inputNum multiplies out, parseTyped
  // divides back; the internal unit never leaks past these two functions.
  const inputNum = (v) => (heatSpec().k === 'by' ? String(Math.round(v))
    : heatSpec().money ? Math.round(v * 1e6).toLocaleString('en-US')
      : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US')
        : String(Math.round(v * 100) / 100));
  function syncInputs() {
    const m = heatSpec();
    hbdUnit.textContent = heatUnit();
    const live = state.heat.on && heatDomain;
    hbdLo.disabled = hbdHi.disabled = !live;
    // Never overwrite a field the user is typing in - a timeline tick
    // re-rendering the chart mid-edit must not eat their number.
    if (document.activeElement !== hbdLo) setBox(hbdLo, live ? inputNum(heatDomain[0]) : '');
    if (document.activeElement !== hbdHi) setBox(hbdHi, live ? inputNum(heatDomain[1]) : '');
  }
  // "27bn" is how the money figures are said everywhere else on this map, so
  // the boxes accept it - k/m/bn/tn as plain dollar magnitudes now that the
  // boxes hold full dollars ("27bn" and "27,000,000,000" are the same entry).
  // Other measures take plain numbers only - "k" is ambiguous the moment the
  // unit is not money. Money returns converted to the internal US$ millions.
  const parseTyped = (s) => {
    s = String(s || '').trim().toLowerCase().replace(/[\s,$]/g, '');
    const mm = s.match(/^(-?\d*\.?\d+)(k|m|b|bn|t|tn)?$/);
    if (!mm) return NaN;
    const v = parseFloat(mm[1]);
    if (!heatSpec().money) return mm[2] ? NaN : v;
    const dollars = v * (mm[2] ? { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, t: 1e12, tn: 1e12 }[mm[2]] : 1);
    return dollars / 1e6;
  };
  function applyTyped() {
    if (!state.heat.on || !heatDomain || !dirty.size) return;
    // Only an EDITED bound goes through the parser; the other keeps the
    // domain's exact value rather than a re-parse of its rounded display
    // text, so committing one bound can never quietly shift the other.
    let lo = dirty.has(hbdLo) ? parseTyped(hbdLo.value) : heatDomain[0];
    let hi = dirty.has(hbdHi) ? parseTyped(hbdHi.value) : heatDomain[1];
    dirty.clear();
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { syncInputs(); return; }
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo === hi || (heatSpec().log && lo <= 0)) { syncInputs(); return; }
    state.heat.range = [lo, hi];
    applyHeat();
  }
  for (const el of [hbdLo, hbdHi]) {
    el.addEventListener('input', () => dirty.add(el));
    el.addEventListener('blur', () => { applyTyped(); syncInputs(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); });
  }
  hbdChart.addEventListener('pointerdown', (e) => {
    // Primary button and primary pointer only: a right-click opens a context
    // menu (its release never reaches us) and a second finger must not steal
    // or corrupt the first finger's drag.
    if (e.button !== 0 || !e.isPrimary) return;
    if (!state.heat.on || !heatDomain || heatDomain[0] === heatDomain[1]) return;
    const x = brushX(e.clientX);
    if (x == null) return;
    // Starting a drag supersedes a half-typed edit. preventDefault below
    // keeps the browser from moving focus, so without this a box focused
    // before the drag would STAY focused while the mirror writes into it -
    // and the abandoned text, or the mirrored value, could later be applied
    // by its blur. Restore, unmark, blur: the blur then applies nothing.
    for (const el of [hbdLo, hbdHi]) {
      if (document.activeElement === el) { dirty.delete(el); el.blur(); }
    }
    syncInputs();
    brush = { id: e.pointerId, xA: x, xB: x, dom: heatDomain.slice(),
              log: !!(heatSpec().log && heatDomain[0] > 0) };
    hideCursor();   // the drag readout owns the chart now
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!brush || e.pointerId !== brush.id) return;
    const x = brushX(e.clientX);
    if (x == null) { cancelBrush(); return; }
    brush.xB = x;
    const el = hbdChart.querySelector('#hbd-brush');
    if (!el) return;
    const a = Math.max(DIST_X0, Math.min(brush.xA, brush.xB));
    const b = Math.min(DIST_X0 + DIST_W, Math.max(brush.xA, brush.xB));
    el.setAttribute('x', String(a));
    el.setAttribute('width', String(Math.max(0, b - a)));
    // The values under the drag's edges, live - through the FROZEN scale, so
    // the readout is exactly what release will commit. One combined label
    // while the selection is too narrow for two, else one per edge, each
    // flipped inward when its end nears the border so nothing clips.
    const selA = hbdChart.querySelector('#hbd-selA');
    const selB = hbdChart.querySelector('#hbd-selB');
    if (selA && selB) {
      const vA = valIn(brush.dom, brush.log, (a - DIST_X0) / DIST_W);
      const vB = valIn(brush.dom, brush.log, (b - DIST_X0) / DIST_W);
      // Flip thresholds sized to the WIDEST label (~62px for a ten-character
      // value at 10px monospace), not a guess: the svg clips at its border,
      // so a threshold narrower than the text is a readout that vanishes
      // exactly at the extremes, where it is needed most.
      if (b - a < 90) {
        const mid = Math.min(DIST_TOTAL - 2, Math.max(2, (a + b) / 2));
        selA.textContent = `${fmtHeat(vA)} – ${fmtHeat(vB)}`;
        selA.setAttribute('x', String(mid));
        selA.setAttribute('text-anchor',
          mid < 70 ? 'start' : mid > DIST_TOTAL - 70 ? 'end' : 'middle');
        selB.textContent = '';
      } else {
        selA.textContent = fmtHeat(vA);
        selA.setAttribute('x', String(a));
        selA.setAttribute('text-anchor', a < 66 ? 'start' : 'end');
        selB.textContent = fmtHeat(vB);
        selB.setAttribute('x', String(b));
        selB.setAttribute('text-anchor', b > DIST_TOTAL - 66 ? 'end' : 'start');
      }
      // And in the boxes below, so the drag and the typed range read as one
      // control. pointerdown blurred the boxes, so nothing here fights
      // syncInputs' dont-overwrite-while-typing rule - and setBox keeps them
      // unmarked, so a voided drag's mirrored text can never be applied.
      setBox(hbdLo, inputNum(vA));
      setBox(hbdHi, inputNum(vB));
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (!brush || e.pointerId !== brush.id) return;
    const { xA, xB, dom, log } = brush;
    brush = null;
    if (hbDist.hidden) return;   // closed mid-drag: the gesture is void
    const a = Math.max(DIST_X0, Math.min(xA, xB));
    const b = Math.min(DIST_X0 + DIST_W, Math.max(xA, xB));
    if (b - a >= 5) {
      state.heat.range = [valIn(dom, log, (a - DIST_X0) / DIST_W),
                          valIn(dom, log, (b - DIST_X0) / DIST_W)];
      applyHeat();
    } else {
      renderDist();          // clear the stray highlight
    }
  });
  // A cancelled touch (system gesture, orientation change) fires pointercancel
  // and never pointerup; without this the stale anchor waited around to pair
  // with some unrelated press minutes later. Blur is the same story for a
  // mouse that alt-tabs away mid-drag.
  window.addEventListener('pointercancel', cancelBrush);
  window.addEventListener('blur', cancelBrush);

  hbdReset.addEventListener('click', () => {
    state.heat.range = null;
    applyHeat();
  });

  // Hide the greys. A FILTER, so it goes through refreshView - the 2D layer
  // filters, the live title count, the globe arrays and this chart all move
  // together; the panel's own note then reports the smaller population.
  const hbdHide = document.getElementById('hbd-hide');
  hbdHide.addEventListener('click', () => {
    state.heat.hideMissing = !state.heat.hideMissing;
    hbdHide.setAttribute('aria-pressed', String(state.heat.hideMissing));
    refreshView();
  });

  // The crosshair: hovering the chart shows the value under the cursor, so
  // the starting point of a drag is known BEFORE the button goes down.
  // Chart-local listeners - this is a hover affordance, not a gesture - and
  // the drag readout owns the chart from the moment a brush starts.
  const hideCursor = () => {
    const cur = hbdChart.querySelector('#hbd-cur');
    const lbl = hbdChart.querySelector('#hbd-curlbl');
    if (cur) { cur.setAttribute('x1', '-9'); cur.setAttribute('x2', '-9'); }
    if (lbl) lbl.textContent = '';
  };
  hbdChart.addEventListener('pointermove', (e) => {
    if (brush || !state.heat.on || !heatDomain) return;
    const cur = hbdChart.querySelector('#hbd-cur');
    const lbl = hbdChart.querySelector('#hbd-curlbl');
    if (!cur || !lbl) return;
    const x = brushX(e.clientX);
    if (x == null) return;
    const cx = Math.max(DIST_X0, Math.min(DIST_X0 + DIST_W, x));
    cur.setAttribute('x1', String(cx));
    cur.setAttribute('x2', String(cx));
    lbl.textContent = fmtHeat(distValueAt((cx - DIST_X0) / DIST_W));
    lbl.setAttribute('x', String(cx));
    lbl.setAttribute('text-anchor',
      cx < 70 ? 'start' : cx > DIST_TOTAL - 70 ? 'end' : 'middle');
  });
  hbdChart.addEventListener('pointerleave', hideCursor);

  const closeDist = () => {
    if (hbDist.hidden) return;
    hbDist.hidden = true;
    hbRamp.setAttribute('aria-expanded', 'false');
    cancelBrush();
  };
  window.__closeDist = closeDist;  // the measure menu closes the panel; see hbBtn

  hbRamp.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = hbDist.hidden;
    if (open) {
      // The two popovers share the strip above the bar and would overlap, so
      // opening one closes the other.
      hbMenu.hidden = true;
      hbBtn.setAttribute('aria-expanded', 'false');
      hbDist.hidden = false;
      hbRamp.setAttribute('aria-expanded', 'true');
      // Clicking the ramp means you want to see the measure, same contract as
      // picking one from the menu. applyHeat re-renders the chart itself.
      if (!state.heat.on) { state.heat.on = true; reheat(); } else renderDist();
    } else {
      closeDist();
    }
  });
  // Which click is allowed to close the panel is decided by where the PRESS
  // landed, not where the click's target ends up: a drag that starts on the
  // chart (or anywhere on the panel) and releases over the map fires its
  // click at the common ancestor - body - and closing on that would shut the
  // panel the moment a range was chosen. A flag consumed by the click, and
  // reset by every new press, also cannot latch the way the old
  // swallow-one-click flag did on touch drags that fire no click at all.
  let pressInPanel = false;
  window.addEventListener('pointerdown', (e) => {
    pressInPanel = hbDist.contains(e.target);
  }, true);
  document.addEventListener('click', (e) => {
    if (pressInPanel) { pressInPanel = false; return; }
    if (!hbDist.hidden && !document.getElementById('heatbar').contains(e.target)) {
      closeDist();
    }
  });
  document.addEventListener('keydown', (e) => {
    // defaultPrevented is the layering signal: an overlay that already
    // consumed this Escape (the search dialog closes itself) keeps it.
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // Escape in a range box abandons the EDIT, not the panel: restore the
    // field and drop its dirty mark, so the blur that follows applies
    // nothing. The restore is direct because syncInputs deliberately
    // refuses to touch a focused field.
    if (e.target === hbdLo || e.target === hbdHi) {
      const live = state.heat.on && heatDomain;
      setBox(e.target, live
        ? inputNum(e.target === hbdLo ? heatDomain[0] : heatDomain[1]) : '');
      e.target.blur();
      return;
    }
    closeDist();
  });

  // applyVisibility may well have run before this block existed - it guards on
  // window.__applyHeat - so paint the bar once now that it does.
  applyHeat();

  // ---- lifecycle status ------------------------------------------------------
  // This was a row of chips in the layers pane: Operational / Under
  // construction / Status unknown, each a one-key filter on the map.
  //
  // It is gone, because status is not a layer and never was, and because as a
  // filter it was the odd one out - one column with a bespoke widget while the
  // other eight had nothing. Status is now a Status column in the list, with
  // the same include/exclude value picker every other column gets, and the
  // unknown 97% is still visible there as a value with a count rather than as
  // a special case that needed explaining in a footnote.
  //
  // What went with it: filtering the MAP by status. The list filters the list.
  // Nothing else read state.filter with key 'st'.

  // ---- operator directory ---  // ---- operator directory -----------------------------------------------------
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
    // Both kinds must be on or the filter looks broken: an operator with only
    // AI sites shows nothing when the AI chip happens to be off.
    const cb = document.getElementById('lyr-facilities');
    if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
    if (state.dcKinds) {
      state.dcKinds = null;
      for (const b of document.querySelectorAll('#dckey [data-k]')) {
        b.setAttribute('aria-pressed', 'true');
      }
      refreshView();
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

  // ---- every site, as a list -------------------------------------------------
  // A small pivot over the registry: filter, group and sort, each multi-column.
  //
  // Virtualised over the DISPLAY array, not the rows. With grouping on, the
  // display is a mix of group headers and rows, and a collapsed group
  // contributes exactly one header - so collapsing is free rather than merely
  // hidden, which is what makes grouping 6,263 rows usable at all.
  (() => {
    const view = document.getElementById('listview');
    const scroll = document.getElementById('lv-scroll');
    const sizer = document.getElementById('lv-sizer');
    const rowsEl = document.getElementById('lv-rows');
    const headEl = document.getElementById('lv-head');
    const headWrap = document.querySelector('.lv-headwrap');
    const countEl = document.getElementById('lv-count');
    const qEl = document.getElementById('lv-q');
    const bar = document.querySelector('.lv-bar');
    const listBtn = document.getElementById('listBtn');
    const applyBtn = document.getElementById('lv-apply');
    const ROW_H = 34, OVERSCAN = 8;
    const CARET_OPEN = '▾', CARET_SHUT = '▸';
    const UP = ' ▲', DOWN = ' ▼', MINUS = '−', DASH = '—';

    const ST_LABEL = { op: 'Operational', uc: 'Under construction', '': 'Unknown' };
    const COLS = [
      { k: 'n',  label: 'Name',        w: 260, get: (d) => d.n || d.en || '' },
      { k: 'o',  label: 'Operator',    w: 200, get: (d) => d.o || '' },
      { k: 'u',  label: 'Utility',     w: 170, get: (d) => d.u || '' },
      { k: 'c',  label: 'Country',     w: 92,  get: (d) => d.c || '' },
      { k: 'ci', label: 'City',        w: 150, get: (d) => d.ci || '' },
      { k: 'ft', label: 'Type',        w: 112, get: (d) => (d.ft === 'ai' ? 'AI' : 'Traditional') },
      { k: 'st', label: 'Status',      w: 150, get: (d) => ST_LABEL[d.st || ''] || 'Unknown' },
      // Sum/avg/min/max make sense of megawatts. They do not make sense of a
      // year - the sum of a set of build years is not a number about anything -
      // so Built offers only the two that do.
      { k: 'mw', label: 'Power (MW)',  w: 110, num: true, aggs: ['sum', 'avg', 'min', 'max'],
                 get: (d) => (d.mw ? String(d.mw) : ''),
                 fmt: (d) => (d.mw ? d.mw.toLocaleString() : '') },
      // fmt is separate from get on purpose. get() feeds parseFloat, in the
      // comparator and in every aggregate, so it must stay unpunctuated -
      // parseFloat('2,603,391') is 2. fmt() is what a person reads.
      { k: 'ft2', label: 'Floor area (sq ft)', w: 150, num: true,
                 aggs: ['sum', 'avg', 'min', 'max'],
                 get: (d) => (d.ft2 ? String(d.ft2) : ''),
                 fmt: (d) => (d.ft2 ? d.ft2.toLocaleString() : '') },
      // Moved here from the heatmap dropdown once plants joined the shared MW
      // ramp, which made it redundant AS A COLOUR - generation near a site is
      // now visible as the plant rings themselves. As a NUMBER it is not
      // redundant at all: no amount of looking at 28,152 rings tells you which
      // of 6,263 sites sits in the most generation-rich place, and sum/avg by
      // country is a question the map cannot answer at any zoom.
      { k: 'gen', label: 'Generation ≤25 km (MW)', w: 168, num: true,
                 aggs: ['sum', 'avg', 'min', 'max'],
                 get: (d) => (d.gen ? String(d.gen) : ''),
                 fmt: (d) => (d.gen ? d.gen.toLocaleString() : '') },
      { k: 'by', label: 'Built',       w: 84,  num: true, aggs: ['min', 'max'],
                 get: (d) => (d.by ? String(d.by) : '') },
      { k: 'lon', label: 'Longitude', w: 118, mono: true, num: true,
                 get: (d) => (d.lon == null ? '' : d.lon.toFixed(5)) },
      { k: 'lat', label: 'Latitude',  w: 118, mono: true, num: true,
                 get: (d) => (d.lat == null ? '' : d.lat.toFixed(5)) },
      // Calculated, and it belongs to a GROUP rather than to a site: it is the
      // number beside each group heading. So it is sortable but not a table
      // column, not filterable, and not something you can group by - there is
      // nothing to put in the cell of a row that is one site, and "count" of
      // one thing is not a fact about it.
      { k: 'cnt', label: 'Count', groupOnly: true, get: () => '' },
    ];
    const TABLE = COLS.filter(c => !c.groupOnly);
    // Every column on by default. Hiding is for narrowing a wide table down to
    // the few columns a particular question needs, not a thing anyone should
    // have to undo before they can read anything.
    const visible = new Set(TABLE.map(c => c.k));
    const byKey = Object.fromEntries(COLS.map(c => [c.k, c]));

    let rows = [];
    let sort = [{ k: 'n', dir: 1 }];
    let groupOn = [];
    let filterOn = [];                   // ordered: the position IS the scope order
    const filters = {};                  // k -> { mode, sel:Set, q, open }
    // EXPANDED, not collapsed. The default has to be the empty set, and the
    // default state has to be shut: group 6,263 rows by operator with
    // everything open and the first heading is followed by 762 rows, which is
    // the ungrouped list with a caption. Tracking the exceptions the other way
    // round was a bug - an earlier commit claimed collapsed-by-default and the
    // code cleared a `collapsed` set, which means precisely the opposite.
    const expanded = new Set();
    let display = [];
    // A draft per picker, kept whether or not its panel is open. The three
    // pickers used to commit separately, so setting up a filter AND a grouping
    // AND a sort meant three Applies and three full rebuilds of 6,263 rows -
    // and two of them showed you a list nobody asked to see. Now they stage
    // together and one Apply in the bar commits the lot.
    const pending = { filter: null, group: null, sort: null };
    let draft = null;                    // whichever panel is open right now

    function fstate(k) {
      if (!filters[k]) filters[k] = { mode: 'inc', sel: new Set(), q: '', open: false };
      return filters[k];
    }
    function passes(d, k, table) {
      const f = (table || filters)[k];
      if (!f || !f.sel.size) return true;     // nothing ticked is not a filter
      const has = f.sel.has(byKey[k].get(d));
      return f.mode === 'inc' ? has : !has;
    }

    // The values available to the filter at position `upto`, counted against
    // the rows that already satisfy every filter ABOVE it. This is the whole
    // point of the ordering: choose Country US and the City list is US cities,
    // not four thousand cities of which all but a few match nothing.
    function valuesFor(cols, table, upto) {
      const k = cols[upto];
      const n = new Map();
      for (const d of rows) {
        let ok = true;
        for (let i = 0; i < upto; i++) { if (!passes(d, cols[i], table)) { ok = false; break; } }
        if (!ok) continue;
        const v = byKey[k].get(d);
        n.set(v, (n.get(v) || 0) + 1);
      }
      return [...n.entries()].sort((a, b) =>
        a[0] === '' ? 1 : b[0] === '' ? -1
        : a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
    }

    const AGG_SIGN = { sum: '\u03A3', avg: '\u00D8', min: 'min', max: 'max' };

    // Computed from the group's LEAF rows at every level. Averaging the child
    // averages would weight a city holding one site the same as one holding
    // forty; recomputing from the leaves is the only version that is right at
    // depth, and it is free because each bucket already holds its members.
    //
    // Returns null, not 0, when nothing in the group carries a figure. 57 of
    // 6,263 sites have a power number, so "no data" is the common case and
    // "zero megawatts" the rare one - a column that renders them the same is
    // not reporting, it is guessing.
    function stat(list, k, agg) {
      const v = [];
      for (const d of list) {
        const x = parseFloat(byKey[k].get(d));
        if (Number.isFinite(x)) v.push(x);
      }
      if (!v.length) return null;
      const total = v.reduce((a, b) => a + b, 0);
      const value = agg === 'sum' ? total
                  : agg === 'avg' ? total / v.length
                  : agg === 'min' ? Math.min(...v)
                  : Math.max(...v);
      return { value: value, n: v.length, of: list.length };
    }

    // A sort entry carrying an aggregate orders the GROUPS, exactly as Count
    // does, so it must not also try to order the rows inside them.
    const groupSorts = () => sort.filter(x => x.k === 'cnt' || x.agg);

    function compare(a, b) {
      for (const s of sort) {
        const col = byKey[s.k];
        if (col.groupOnly || s.agg) continue;   // these order groups, not rows
        const x = col.get(a), y = col.get(b);
        if (!x && !y) continue;
        if (!x) return 1;                // blanks last, whichever way it points
        if (!y) return -1;
        const r = col.num ? (parseFloat(x) - parseFloat(y))
          : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
        if (r) return r * s.dir;
      }
      return 0;
    }

    // Grouped columns move to the front and freeze there; the rest follow in
    // their own order.
    function order() {
      return groupOn.concat(
        TABLE.map(c => c.k).filter(k => groupOn.indexOf(k) < 0 && visible.has(k)));
    }
    function offsets() {
      const o = {}; let x = 0;
      for (const k of order()) { o[k] = x; x += byKey[k].w; }
      return { o, total: x };
    }

    // What a cell shows. Sorting, filtering, searching and the aggregates all
    // go through get() instead, which is the raw value.
    const disp = (k, d) => (byKey[k].fmt ? byKey[k].fmt(d) : byKey[k].get(d));

    function cell(k, text, frozen, left) {
      const c = byKey[k];
      return '<div class="cell' + (c.mono ? ' mono' : '') + (c.num ? ' num' : '')
        + (frozen ? ' frz' : '') + '" style="width:' + c.w + 'px'
        + (frozen ? ';left:' + left + 'px' : '') + '">' + esc(text) + '</div>';
    }

    function build() {
      const q = qEl.value.trim().toLowerCase();
      let out = rows.filter(d => filterOn.every(k => passes(d, k)));
      if (q) out = out.filter(d => TABLE.some(c => c.get(d).toLowerCase().indexOf(q) >= 0));
      out.sort(compare);

      display = [];
      if (!groupOn.length) {
        for (const d of out) display.push({ t: 'r', d });
      } else {
        const walk = (list, depth, path) => {
          if (depth === groupOn.length) {
            for (const d of list) display.push({ t: 'r', d });
            return;
          }
          const k = groupOn[depth];
          const buckets = new Map();
          for (const d of list) {
            const v = byKey[k].get(d) || DASH;
            if (!buckets.has(v)) buckets.set(v, []);
            buckets.get(v).push(d);
          }
          // Count sorts the GROUPS. It applies at every level of the
          // grouping, and falls through to the label when two groups are the
          // same size, so the order is stable rather than arbitrary.
          const gs = groupSorts();
          const keys = [...buckets.keys()].sort((a, b) => {
            for (const x of gs) {
              if (x.k === 'cnt') {
                const d = (buckets.get(a).length - buckets.get(b).length) * x.dir;
                if (d) return d;
                continue;
              }
              const sa = stat(buckets.get(a), x.k, x.agg);
              const sb = stat(buckets.get(b), x.k, x.agg);
              if (!sa && !sb) continue;
              if (!sa) return 1;                // no figure sorts last either way
              if (!sb) return -1;
              const d = (sa.value - sb.value) * x.dir;
              if (d) return d;
            }
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
          });
          for (const v of keys) {
            const kids = buckets.get(v);
            // \u001f, the ASCII unit separator, because a group path is
            // built from values and any printable joiner could occur inside
            // one. Written as an escape: it arrived here as a literal control
            // character once, which is invisible in every editor and matches
            // nothing you search for.
            const key = path + '\u001f' + v;
            // Coverage travels with the number: "12 of 118" is the difference
            // between a total and a total of whatever happened to be recorded.
            const aggs = gs.filter(x => x.agg).map(x => {
              const r = stat(kids, x.k, x.agg);
              return AGG_SIGN[x.agg] + ' ' + (r
                ? Math.round(r.value).toLocaleString() + ' \u00B7 ' + r.n + ' of ' + r.of
                : '\u2014');
            });
            display.push({ t: 'g', depth, label: v, n: kids.length, key, aggs: aggs });
            if (expanded.has(key)) walk(kids, depth + 1, key);
          }
        };
        walk(out, 0, '');
      }

      countEl.textContent = 'Showing ' + out.length.toLocaleString() + ' of '
        + rows.length.toLocaleString() + ' sites';

      // The map shows what the list shows. Null when nothing is filtering, so
      // the usual case adds no id set to the layer expression at all.
      const filtering = filterOn.some(k => fstate(k).sel.size) || !!q;
      listIds = filtering ? new Set(out.map(d => d.id)) : null;
      // Straight to the repaint, NOT through refreshView: the map's own filter
      // changes call back into the list, and going through it here would be a
      // loop.
      applyVisibility();
      refreshGlobe();
      const geo = offsets();
      sizer.style.height = (display.length * ROW_H) + 'px';
      sizer.style.width = geo.total + 'px';
      rowsEl.style.width = geo.total + 'px';
      headEl.style.width = geo.total + 'px';
      drawHead();
      paint();
    }

    function drawHead() {
      const geo = offsets(), ord = order();
      headEl.innerHTML = ord.map((k, i) => {
        const frozen = i < groupOn.length;
        const c = byKey[k];
        const s = sort.find(x => x.k === k);
        const arrow = s ? (s.dir > 0 ? UP : DOWN) : '';
        return '<div class="cell' + (c.num ? ' num' : '') + (frozen ? ' frz' : '')
          + '" style="width:' + c.w + 'px' + (frozen ? ';left:' + geo.o[k] + 'px' : '') + '">'
          + '<button data-k="' + k + '">' + esc(c.label) + arrow + '</button></div>';
      }).join('');
    }

    function paint() {
      const first = Math.max(0, Math.floor(scroll.scrollTop / ROW_H) - OVERSCAN);
      const n = Math.ceil(scroll.clientHeight / ROW_H) + OVERSCAN * 2;
      rowsEl.style.transform = 'translateY(' + (first * ROW_H) + 'px)';
      headWrap.scrollLeft = scroll.scrollLeft;
      if (!order().length) {
        rowsEl.innerHTML = '<p class="lv-empty">No columns selected.</p>';
        return;
      }
      if (!display.length) {
        rowsEl.innerHTML = '<p class="lv-empty">Nothing matches those filters.</p>';
        return;
      }
      const geo = offsets(), ord = order();
      rowsEl.innerHTML = display.slice(first, first + n).map(e => {
        if (e.t === 'g') {
          return '<div class="lv-grp" data-g="' + esc(e.key) + '" style="padding-left:'
            + (14 + e.depth * 18) + 'px"><span class="tw">'
            + (expanded.has(e.key) ? MINUS : '+') + '</span>' + esc(e.label)
            + '<span class="gn">' + e.n + '</span>'
            + (e.aggs || []).map(a => '<span class="ga">' + esc(a) + '</span>').join('')
            + '</div>';
        }
        // The grouped columns are blank on a leaf row: every one of them is
        // already spelled out in the headers directly above it, and repeating
        // "Arminco Ltd / AM" under a group called Arminco Ltd / AM is noise.
        // The cells stay, empty, because they are the frozen ones and the
        // group headers indent into the width they hold.
        return '<div class="lv-row" data-id="' + esc(e.d.id) + '">'
          + ord.map((k, i) => cell(k, i < groupOn.length ? '' : disp(k, e.d),
                                   i < groupOn.length, geo.o[k])).join('')
          + '</div>';
      }).join('');
    }

    // ---- the three pickers ------------------------------------------------------
    // One shape for all three: the chosen columns in order at the top, the full
    // column list beneath, Apply at the bottom. Filter alone adds an expandable
    // value panel per chosen column, because it is the only one that needs to
    // ask WHICH values rather than just which column.
    function menuHtml(kind) {
      const chosen = draft.cols.map((k, i) => {
        let head = '<button class="lv-chosen" data-x="' + k + '"><span class="num">'
          + (i + 1) + '.</span><span class="grow">' + esc(byKey[k].label) + '</span>';
        if (kind === 'filter') {
          const f = draft.f[k], vals = draft.vals[k] || [];
          head += '<span class="sum">' + (f.sel.size
            ? (f.mode === 'inc' ? f.sel.size + ' of ' + vals.length : 'not ' + f.sel.size)
            : 'all ' + vals.length) + '</span>'
            + '<span class="caret">' + (f.open ? CARET_OPEN : CARET_SHUT) + '</span>';
        } else if (kind === 'sort') {
          // Only where it can mean something: an aggregate with nothing
          // grouped is a total of one row, which is the row.
          const spec = byKey[k];
          if (spec.aggs && effGroup().length) {
            const a = draft.agg[k];
            head += '<span class="sum agg" data-agg="' + k + '">'
              + (a ? a[0].toUpperCase() + a.slice(1) : 'Per row') + '</span>';
          }
          head += '<span class="sum" data-dir="' + k + '">'
            + (draft.dir[k] > 0 ? 'Asc' + UP : 'Desc' + DOWN) + '</span>';
        }
        head += '</button>';
        if (kind === 'filter' && draft.f[k].open) head += valuePanel(k);
        return head;
      }).join('');

      // Count is offered in Sort only, and disabled there until something is
      // grouped - a total of nothing is not a sort order, and a checkbox that
      // silently does nothing is worse than one that says why it cannot.
      const boxes = COLS.filter(c => !c.groupOnly || kind === 'sort').map(c => {
        const dead = c.groupOnly && !effGroup().length;
        return '<label class="lv-opt"' + (dead
            ? ' title="Count is a group total - switch Group by on first"' : '')
          + '><input type="checkbox" data-pick="' + c.k + '"'
          + (draft.cols.indexOf(c.k) >= 0 ? ' checked' : '')
          + (dead ? ' disabled' : '') + '><span>' + esc(c.label) + '</span></label>';
      }).join('');

      return '<div class="lv-body">' + chosen + (chosen ? '<hr>' : '') + boxes + '</div>'
        + '<div class="lv-foot"><button class="tb-btn clear" data-clear="1">'
        + 'Clear ' + esc(kind === 'filter' ? 'filters' : kind === 'group' ? 'grouping' : 'sort')
        + '</button></div>';
    }

    function valuePanel(k) {
      const f = draft.f[k];
      const all = draft.vals[k] || [];
      const q = (f.q || '').toLowerCase();
      const shown = q ? all.filter(v => v[0].toLowerCase().indexOf(q) >= 0) : all;
      return '<div class="lv-vals">'
        + '<input class="lv-q" data-vq="' + k + '" value="' + esc(f.q || '')
        + '" placeholder="Search ' + esc(byKey[k].label) + ' values">'
        + '<div class="lv-tools"><a data-all="' + k + '">All</a><a data-none="' + k + '">None</a>'
        + '<button class="lv-mode ' + (f.mode === 'inc' ? 'inc' : 'exc') + '" data-mode="'
        + k + '">' + (f.mode === 'inc' ? 'Include' : 'Exclude') + '</button></div>'
        + '<div class="lv-vlist">' + shown.map(v =>
            '<label class="lv-vrow"><input type="checkbox" data-v="' + k + '" value="'
            + esc(v[0]) + '"' + (f.sel.has(v[0]) ? ' checked' : '') + '>'
            + '<span class="grow">' + esc(v[0] || '(blank)') + '</span>'
            + '<span class="n">' + v[1] + '</span></label>').join('')
        + '</div></div>';
    }

    // Recomputed on every draft change, because the scope a value list is
    // counted against depends on every filter above it in the order.
    function refreshVals() {
      if (!draft || draft.kind !== 'filter') return;
      draft.vals = {};
      draft.cols.forEach((k, i) => { draft.vals[k] = valuesFor(draft.cols, draft.f, i); });
    }

    function openMenu(kind, on) {
      for (const w of document.querySelectorAll('.lv-pick')) {
        // The columns panel is a .lv-pick for styling but not a draft menu -
        // it has no [data-open] button and manages its own open state. Walking
        // it here threw on the missing button, and because the loop had
        // already hidden its menu by then, it aborted before opening the one
        // that was asked for: every draft menu stopped opening at all.
        const b = w.querySelector('button[data-open]');
        if (!b) continue;
        const isIt = w.dataset.kind === kind && on;
        w.querySelector('.lv-menu').hidden = !isIt;
        b.setAttribute('aria-expanded', String(isIt));
      }
      // Closing a panel does NOT throw away what is in it. That is the whole
      // point of staging across all three.
      if (!on) { draft = null; return; }
      if (!pending[kind]) pending[kind] = seedDraft(kind);
      draft = pending[kind];
      if (kind === 'filter') refreshVals();
      redrawMenu();
    }

    function seedDraft(kind) {
      const d = { kind: kind, cols: [], f: {}, dir: {}, agg: {}, vals: {} };
      if (kind === 'filter') {
        d.cols = filterOn.slice();
        for (const k of d.cols) {
          const f = fstate(k);
          d.f[k] = { mode: f.mode, sel: new Set(f.sel), q: '', open: f.open };
        }
      } else if (kind === 'group') {
        d.cols = groupOn.slice();
      } else {
        d.cols = sort.map(s => s.k);
        for (const s of sort) { d.dir[s.k] = s.dir; d.agg[s.k] = s.agg || null; }
      }
      return d;
    }

    // Signatures rather than deep-equality: a draft is dirty when it says
    // something different from what the list is currently doing, and comparing
    // the two as strings is both shorter and harder to get subtly wrong.
    const sigFilter = (cols, f) => cols.map(k =>
      k + ':' + f[k].mode + ':' + [...f[k].sel].sort().join('|')).join(',');
    const sigSort = (list) => list.map(x =>
      x.k + ':' + x.dir + ':' + (x.agg || '')).join(',');
    function sigOf(kind, d) {
      if (kind === 'filter') return d ? sigFilter(d.cols, d.f) : sigFilter(filterOn, filters);
      if (kind === 'group') return (d ? d.cols : groupOn).join(',');
      return sigSort(d ? d.cols.map(k => ({ k: k, dir: d.dir[k] || 1, agg: d.agg[k] || null }))
                       : sort);
    }
    // What the grouping WILL be once Apply is pressed. Count and the
    // aggregates are only meaningful with a grouping, and now that the pickers
    // stage together the answer to "is anything grouped" has to include what
    // is staged - otherwise you group by Operator, open Sort to order those
    // groups by size, and find Count greyed out because the grouping you just
    // set up has not happened yet.
    const effGroup = () => (pending.group ? pending.group.cols : groupOn);

    const isDirty = (kind) => !!pending[kind] && sigOf(kind, pending[kind]) !== sigOf(kind, null);
    const anyDirty = () => ['filter', 'group', 'sort'].some(isDirty);
    function redrawMenu() {
      const w = document.querySelector('.lv-pick[data-kind="' + draft.kind + '"]');
      w.querySelector('.lv-menu').innerHTML = menuHtml(draft.kind);
    }

    // The count and the Apply share a slot, because they are answers to the
    // same question: the count says what the list holds, and while something
    // is staged the honest answer is "not what you asked for yet".
    function syncBar() {
      const dirty = anyDirty();
      applyBtn.hidden = !dirty;
      countEl.hidden = dirty;
      for (const w of document.querySelectorAll('.lv-pick[data-kind]')) {
        const b = w.querySelector('button[data-open]');
        if (b) b.classList.toggle('dirty', isDirty(w.dataset.kind));
      }
    }

    function labels() {
      for (const w of document.querySelectorAll('.lv-pick')) {
        const b = w.querySelector('button[data-open] b');
        if (!b) continue;                       // the columns panel, again
        const kind = w.dataset.kind;
        // Reads the STAGED state where there is one. The button is what you
        // are building; the Apply beside it is what says you have not built it
        // yet. Showing the committed value here instead would mean staging a
        // filter, closing the panel, and being told you had filtered by
        // nothing.
        const d = pending[kind];
        let list;
        if (kind === 'filter') {
          const cols = d ? d.cols : filterOn, table = d ? d.f : filters;
          list = [];
          for (const k of cols) for (const v of (table[k] || fstate(k)).sel) list.push(v || '(blank)');
          if (list.length > 6) list = list.slice(0, 6).concat([list.length - 6 + ' more']);
        } else if (kind === 'group') {
          list = (d ? d.cols : groupOn).map(k => byKey[k].label);
        } else {
          list = d
            ? d.cols.map(k => byKey[k].label + (d.agg[k] ? ' (' + d.agg[k] + ')' : ''))
            : sort.map(x => byKey[x.k].label + (x.agg ? ' (' + x.agg + ')' : ''));
        }
        b.textContent = list.length ? list.join(', ') : 'nothing';
      }
    }

    // Columns is its own small panel rather than a fourth draft menu: there is
    // nothing to stage. Ticking a column shows it, and you can see immediately
    // whether that was what you wanted, which is the opposite of the
    // multi-column choices next to it where the intermediate states are not
    // choices anybody made.
    const colsBtn = document.getElementById('lv-colsbtn');
    const colsMenu = document.getElementById('lv-colsmenu');
    function drawCols() {
      colsMenu.innerHTML = '<div class="lv-body">'
        + '<div class="lv-tools"><a data-cols-all>All</a><a data-cols-none>None</a></div>'
        + TABLE.map(c => {
            const grouped = groupOn.indexOf(c.k) >= 0;
            return '<label class="lv-opt"' + (grouped
                ? ' title="Grouped columns always show - they carry the headings"' : '')
              + '><input type="checkbox" data-col="' + c.k + '"'
              + (grouped || visible.has(c.k) ? ' checked' : '')
              + (grouped ? ' disabled' : '') + '><span>' + esc(c.label) + '</span></label>';
          }).join('')
        + '</div>';
    }
    function openCols(on) {
      if (on && draft) openMenu(draft.kind, false);   // one panel at a time
      if (on) drawCols();
      colsMenu.hidden = !on;
      colsBtn.setAttribute('aria-expanded', String(on));
    }
    colsBtn.addEventListener('click', (e) => { e.stopPropagation(); openCols(colsMenu.hidden); });
    colsMenu.addEventListener('click', (e) => {
      if (e.target.closest('[data-cols-all]')) {
        for (const c of TABLE) visible.add(c.k);
        drawCols(); build(); return;
      }
      if (e.target.closest('[data-cols-none]')) {
        visible.clear();
        drawCols(); build();
      }
    });
    colsMenu.addEventListener('change', (e) => {
      const c = e.target.closest('[data-col]');
      if (!c) return;
      if (c.checked) visible.add(c.dataset.col); else visible.delete(c.dataset.col);
      build();
    });
    document.addEventListener('click', (e) => {
      if (colsMenu.hidden) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
      const w = colsBtn.closest('.lv-pick');
      const inside = path && path.length ? path.indexOf(w) >= 0 : w.contains(e.target);
      if (!inside) openCols(false);
    });

    bar.addEventListener('click', (e) => {
      const open = e.target.closest('button[data-open]');
      if (open) openCols(false);                      // one panel at a time
      if (open) {
        const kind = open.dataset.open;
        const isOpen = !open.closest('.lv-pick').querySelector('.lv-menu').hidden;
        openMenu(kind, !isOpen);
        return;
      }
      if (!draft) return;

      if (e.target.closest('[data-clear]')) {
        // Empties this picker, staged like anything else - so it shows up as
        // pending and you can change your mind before it takes effect.
        draft.cols = []; draft.f = {}; draft.dir = {}; draft.agg = {}; draft.vals = {};
        redrawMenu(); labels(); syncBar();
        return;
      }
      const agg = e.target.closest('[data-agg]');
      if (agg) {
        // Cycles the column's own aggregates and then "per row", which is the
        // way out: sorting the rows inside each group rather than the groups.
        const k = agg.dataset.agg, ring = byKey[k].aggs.concat([null]);
        draft.agg[k] = ring[(ring.indexOf(draft.agg[k]) + 1) % ring.length];
        redrawMenu(); labels(); syncBar(); return;
      }
      const dir = e.target.closest('[data-dir]');
      if (dir) { draft.dir[dir.dataset.dir] *= -1; redrawMenu(); labels(); syncBar(); return; }
      const x = e.target.closest('[data-x]');
      if (x) {
        if (draft.kind === 'filter') {
          const f = draft.f[x.dataset.x];
          f.open = !f.open;
          redrawMenu();
        }
        return;
      }
      const all = e.target.closest('[data-all]');
      if (all) {
        const k = all.dataset.all;
        draft.f[k].sel = new Set((draft.vals[k] || []).map(v => v[0]));
        refreshVals(); redrawMenu(); labels(); syncBar(); return;
      }
      const none = e.target.closest('[data-none]');
      if (none) { draft.f[none.dataset.none].sel = new Set(); refreshVals(); redrawMenu(); labels(); syncBar(); return; }
      const mode = e.target.closest('[data-mode]');
      if (mode) {
        const f = draft.f[mode.dataset.mode];
        f.mode = f.mode === 'inc' ? 'exc' : 'inc';
        refreshVals(); redrawMenu(); labels(); syncBar();
      }
    });

    // Commits every staged picker at once. Grouping resets what is expanded
    // because the group keys it holds belong to the old grouping.
    applyBtn.addEventListener('click', () => {
      if (pending.filter) {
        filterOn = pending.filter.cols;
        for (const k of filterOn) filters[k] = pending.filter.f[k];
      }
      if (pending.group) { groupOn = pending.group.cols; expanded.clear(); }
      if (pending.sort) {
        const d = pending.sort;
        sort = d.cols.length
          ? d.cols.map(k => ({ k: k, dir: d.dir[k] || 1, agg: d.agg[k] || null }))
          : [{ k: 'n', dir: 1 }];
      }
      pending.filter = pending.group = pending.sort = null;
      if (draft) openMenu(draft.kind, false);
      labels(); build(); syncBar();
    });

    bar.addEventListener('change', (e) => {
      if (!draft) return;
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        const k = pick.dataset.pick, at = draft.cols.indexOf(k);
        if (at >= 0) draft.cols.splice(at, 1);
        else {
          draft.cols.push(k);
          // Closed. Choosing WHICH columns to filter and choosing WHICH values
          // are two passes, and expanding on selection forces them together:
          // pick Country and a 159-row value list shoves City off the bottom
          // before you have said you want to filter by City at all.
          if (draft.kind === 'filter') {
            draft.f[k] = { mode: 'inc', sel: new Set(), q: '', open: false };
          }
          if (draft.kind === 'sort') {
            // Grouped and aggregatable, so the useful default is the first
            // aggregate and largest first - "sort by power" means the big ones.
            const spec = byKey[k];
            draft.agg[k] = spec.aggs && effGroup().length ? spec.aggs[0] : null;
            draft.dir[k] = (k === 'cnt' || draft.agg[k]) ? -1 : 1;
          }
        }
        refreshVals(); redrawMenu(); labels(); syncBar(); return;
      }
      const v = e.target.closest('[data-v]');
      if (v) {
        const f = draft.f[v.dataset.v];
        if (v.checked) f.sel.add(v.value); else f.sel.delete(v.value);
        refreshVals(); redrawMenu(); labels(); syncBar();
      }
    });

    bar.addEventListener('input', (e) => {
      const vq = e.target.closest('[data-vq]');
      if (!vq || !draft) return;
      draft.f[vq.dataset.vq].q = vq.value;
      const at = vq.selectionStart;
      redrawMenu();
      const again = document.querySelector('[data-vq="' + vq.dataset.vq + '"]');
      if (again) { again.focus(); again.setSelectionRange(at, at); }
    });

    // composedPath(), not contains(). Every control in these menus redraws the
    // menu, which replaces its innerHTML and DETACHES the node that was just
    // clicked - so by the time this outside-click handler runs, contains() is
    // asked about an element that is no longer in the document and answers
    // false. Expanding a filter column closed the whole panel.
    //
    // composedPath() is captured when the event is dispatched and does not
    // care what happened to the DOM since, which is exactly the question being
    // asked: did this click come from inside the panel.
    document.addEventListener('click', (e) => {
      if (!draft) return;
      const w = document.querySelector('.lv-pick[data-kind="' + draft.kind + '"]');
      if (!w) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
      const inside = path && path.length ? path.indexOf(w) >= 0 : w.contains(e.target);
      if (!inside) openMenu(draft.kind, false);
    });

    // ---- the table --------------------------------------------------------------
    headEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const k = b.dataset.k, at = sort.findIndex(s => s.k === k);
      if (e.shiftKey) { if (at < 0) sort.push({ k: k, dir: 1 }); else sort[at].dir *= -1; }
      else sort = [{ k: k, dir: at === 0 ? -sort[0].dir : 1 }];
      // A header click is immediate, so a sort staged in the panel would now
      // be stale advice about a state that has moved on.
      pending.sort = null;
      labels(); build(); syncBar();
    });
    rowsEl.addEventListener('click', (e) => {
      const g = e.target.closest('.lv-grp');
      if (g) {
        const key = g.dataset.g;
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        build();
        return;
      }
      const r = e.target.closest('.lv-row');
      if (r) openSite(r.dataset.id);
    });
    scroll.addEventListener('scroll', paint, { passive: true });
    window.addEventListener('resize', () => { if (!view.hidden) paint(); });
    qEl.addEventListener('input', () => { scroll.scrollTop = 0; build(); });

    function setOpen(on) {
      view.hidden = !on;
      listBtn.setAttribute('aria-pressed', String(on));
      if (!on) return;
      if (!rows.length) rows = sites.slice();
      labels(); build(); syncBar();
      qEl.focus();
    }
    refreshList = () => { if (!view.hidden && rows.length) build(); };
    listBtn.addEventListener('click', () => setOpen(view.hidden));
    document.getElementById('lv-close').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !view.hidden) setOpen(false);
    });
  })();

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

  // ---- deep link: /?search=1 opens the command palette ------------------------
  // The magnifier in the top bar of every server-rendered page is a plain link
  // back here, because those pages have no palette of their own.
  if (qs.has('search')) openPalette();

  // ---- deep link: /?plant=<id>, /?fab=<id>, /?fabs=1 --------------------------
  // Both dot layers start switched off, so flying to one without turning its
  // layer on lands the camera on an empty map. Toggle through the checkbox
  // rather than state.layers directly: the change handler above is what
  // unhides the fuel legend and the licence notes, and setting state alone
  // shows the dots while leaving the panel and legend out of sync.
  const showLayer = (key) => {
    const cb = document.getElementById(`lyr-${key}`);
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
  };
  if (qs.has('fabs')) showLayer('fabs');
  for (const [param, key, list, tip] of [
    ['plant', 'plants', plants, plantTip],
    ['fab', 'fabs', fabs, fabTip],
  ]) {
    const id = qs.get(param);
    if (!id) continue;
    const x = list.find(r => r.id === id);
    if (!x || x.lat == null) continue;
    showLayer(key);
    map.flyTo({ center: [+x.lon, +x.lat], zoom: SITE_ZOOM, duration: 1200 });
    new maplibregl.Popup({ closeOnClick: true, offset: 10 })
      .setLngLat([+x.lon, +x.lat]).setHTML(tip(x)).addTo(map);
  }

  // ---- deep link: /?site=<id> flies to the site -------------------------------
  const focusId = new URLSearchParams(location.search).get('site');
  if (focusId) {
    const s = sites.find(x => x.id === focusId);
    if (s && s.lat != null) {
      // Not inside map.once('load'). flyTo and Popup both work on a map that
      // has not finished loading - verified - and 'load' is a one-shot that
      // does not fire if it has already passed, and can take a very long time
      // in a background tab. A shareable URL that silently does nothing when
      // the map is slow is worse than one that jumps a frame early.
      preferSatellite();
      map.flyTo({ center: [s.lon, s.lat], zoom: SITE_ZOOM, duration: 1200 });
      new maplibregl.Popup({ closeOnClick: true, offset: 10 })
        .setLngLat([s.lon, s.lat]).setHTML(sitePopup(s)).addTo(map);
    }
  }
})();
