// The site, year by year - for the pages whose dots are not registry sites.
//
// The fab and plant pages want the same thing the site pages have: Esri's
// World Imagery WAYBACK archive over one coordinate, a slider through the
// captures, and the known outlines drawn on top. The site page's viewer is
// ~900 lines interwoven with site-only machinery - correction forms, kind
// chips, the nearby-dots picker, vendor parcel pulls - and extracting it
// would put the flagship page at risk for a feature that needs a tenth of
// it. So this is the tenth, written down: tiles, slider, drag, zoom,
// fullscreen, footprints. THE DUPLICATION IS ACKNOWLEDGED DEBT - if a third
// viewer is ever needed, extract the engine instead of writing it again.
//
// One deliberate simplification: the site page sieves the release list per
// tile (195 tilemap probes) so its slider only carries frames that actually
// differ here. This one shows the full archive - the slider is denser and
// some neighbouring frames are identical, which costs patience, not truth.
(() => {
  const host = document.getElementById('wbl');
  if (!host) return;
  const LAT = +host.dataset.lat, LON = +host.dataset.lon;
  let Z = +host.dataset.zoom || 15;
  const CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com'
                   + '/waybackconfig.json';
  const TILE = 256;

  const frame = host.querySelector('.wbl-frame');
  const slider = host.querySelector('.wbl-slider');
  const label = host.querySelector('.wbl-date');
  const playBtn = host.querySelector('.wbl-play');
  const fpBtn = host.querySelector('.wbl-fp');

  // Web-mercator, the same arithmetic every tile consumer here uses.
  const world = () => TILE * Math.pow(2, Z);
  const xOf = (lon) => (lon + 180) / 360 * world();
  const yOf = (lat) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * world();
  };
  let cx = 0, cy = 0;              // pan offset in px from the site, at Z
  const centre = () => ({ x: xOf(LON) + cx, y: yOf(LAT) + cy });

  let releases = [];               // [{num, date, url}] oldest first
  let ri = 0;

  // The frame is "loading" until a tile has actually rendered in it. Asking
  // the images themselves means the indicator cannot lie: it is up while the
  // Wayback config is still in flight, up while the first tiles of a newly
  // chosen year download, and gone the moment there is something to look at.
  const loadingEl = document.getElementById('wbl-loading');
  function syncLoading() {
    if (!loadingEl) return;
    const painted = [...frame.querySelectorAll('img')]
      .some((i) => i.complete && i.naturalWidth > 0);
    loadingEl.hidden = releases.length > 0 && painted;
  }

  function tileUrl(rel, z, ty, tx) {
    return rel.url.replace('{level}', z).replace('{row}', ty).replace('{col}', tx);
  }

  function draw() {
    const w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !releases.length) return;
    const c = centre();
    const x0 = c.x - w / 2, y0 = c.y - h / 2;
    const tx0 = Math.floor(x0 / TILE), ty0 = Math.floor(y0 / TILE);
    const tx1 = Math.floor((x0 + w) / TILE), ty1 = Math.floor((y0 + h) / TILE);
    const rel = releases[ri];
    const want = new Set();
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = `${rel.num}/${Z}/${ty}/${tx}`;
        want.add(key);
        let img = frame.querySelector(`img[data-k="${key}"]`);
        if (!img) {
          img = document.createElement('img');
          img.dataset.k = key;
          img.width = TILE; img.height = TILE;
          img.draggable = false;
          img.alt = '';
          img.src = tileUrl(rel, Z, ty, tx);
          // Re-check when each tile resolves, either way: a frame of nothing
          // but 404s must not sit under a spinner for ever.
          img.addEventListener('load', syncLoading, { once: true });
          img.addEventListener('error', syncLoading, { once: true });
          frame.appendChild(img);
        }
        img.style.left = (tx * TILE - x0) + 'px';
        img.style.top = (ty * TILE - y0) + 'px';
      }
    }
    for (const img of [...frame.querySelectorAll('img')]) {
      if (!want.has(img.dataset.k)) img.remove();
    }
    label.textContent = rel.date + `  ${ri + 1} of ${releases.length}`;
    syncLoading();
    // Imagery only. The archive used to carry the dot, the footprints, the
    // supply threads and a drawing tool - a second, weaker copy of the live
    // map's editing rig on top of pictures whose whole value is being
    // untouched. Every one of those tools lives on the Live map tab, where
    // there is one implementation of each instead of two.
  }

  // The archive used to draw the supply threads itself; it draws no overlays
  // at all now. The live map keeps them as a real 'sup' line layer built from
  // this array, so the feature moved rather than went - which is why the
  // declaration stays here even though the archive's drawLinks() is gone.
  const LINKS = (() => {
    try { return JSON.parse(host.dataset.links || '[]'); } catch { return []; }
  })();

  // The dot: where the record says the thing is, same convention as the map.
  function drawDot() {
    let dot = frame.querySelector('.wbl-dot');
    if (!dot) {
      dot = document.createElement('i');
      dot.className = 'wbl-dot';
      frame.appendChild(dot);
    }
    const c = centre();
    dot.style.left = (xOf(LON) - (c.x - frame.clientWidth / 2)) + 'px';
    dot.style.top = (yOf(LAT) - (c.y - frame.clientHeight / 2)) + 'px';
  }

  // Footprints from the merged layer - the fab's own Overture shape, a plant
  // perimeter, anything the registry knows inside the frame.
  const SVGNS = 'http://www.w3.org/2000/svg';
  let fps = null, fpOn = true;
  async function loadFp() {
    const d = 0.012;
    const r = await fetch(`/api/footprints?w=${LON - d}&s=${LAT - d}&e=${LON + d}&n=${LAT + d}&max=200`);
    const fc = await r.json();
    fps = (fc.features || []).map(f => ({
      id: f.properties.id,
      rings: f.geometry.type === 'Polygon' ? f.geometry.coordinates
        : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [],
      kind: f.properties.kind, src: f.properties.src,
      name: f.properties.name || f.properties.op || '',
      // Which assets this shape is attached to. The footprint fetch covers a
      // box around the dot, so it routinely returns the NEIGHBOURS' shapes
      // too; without this the map would frame somebody else's campus.
      sites: f.properties.sites || [],
      m2: f.properties.m2 || 0,
      // A parcel's own facts, when the shape is one: the assessor's id and
      // acreage, and whether it is the lot under the dot or a same-owner lot
      // grown from it (a weaker claim, and the label says so).
      ref: f.properties.ref || '', acres: f.properties.acres || '',
      expanded: !!f.properties.expanded,
    })).filter(f => f.rings.length);
    // fpBtn only existed on the archive bar, which no longer has one. loadFp
    // still runs because syncShp() feeds the LIVE map's shapes from `fps`.
    if (fpBtn) {
      fpBtn.hidden = !fps.length;
      fpBtn.textContent = `Footprints (${fps.length})`;
      fpBtn.setAttribute('aria-pressed', 'true');
    }
  }
  function drawFp() {
    // Scoped: the supply-link layer is also an svg in this frame now.
    let svg = frame.querySelector('svg.wbl-fp');
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'wbl-fp');
      frame.appendChild(svg);
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!fps || !fpOn) return;
    const w = frame.clientWidth, h = frame.clientHeight;
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    const c = centre();
    const px = (lon, lat) =>
      `${(xOf(lon) - (c.x - w / 2)).toFixed(1)},${(yOf(lat) - (c.y - h / 2)).toFixed(1)}`;
    for (const f of fps) {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', f.rings.map(r =>
        'M' + r.map(([lo, la]) => px(lo, la)).join('L') + 'Z').join(' '));
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('class', 'wb-fp k-' + (f.kind || 'building'));
      path.appendChild(document.createElementNS(SVGNS, 'title'))
        .textContent = (f.name ? f.name + ' — ' : '')
          + (f.kind === 'campus' ? 'campus boundary' : 'building footprint')
          + ' (' + f.src + ')'
          + (f.src === 'parcel' ? [f.ref ? ' · parcel ' + f.ref : '',
                                   f.acres ? ' · ' + f.acres + ' ac' : '',
                                   f.expanded ? ' · same-owner lot grown from the seed, not necessarily the campus' : '']
                                    .join('') : '');
      svg.appendChild(path);
    }
  }

  // ---- footprint create / reshape / delete ----------------------------------
  // The site pages' editor, ported to the lean viewer: the plant and fab
  // pages are where perimeters get compared against imagery too. Shapes are
  // picked on POINTERUP with a geometric hit-test - never on click, and
  // never per-path: a press that starts on a shape retargets its release
  // and the browser dispatches no click at all (learned the hard way on the
  // site pages). Drawn and reshaped rings save through /api/footprint
  // attached to THIS page's asset id (a plant or fab id; the endpoint
  // accepts all three flavours).
  const ASSET = host.dataset.asset || '';
  const selBar = host.querySelector('.wbl-sel');
  const drawBtn = host.querySelector('.wbl-draw');
  const edSvg = document.createElementNS(SVGNS, 'svg');
  edSvg.setAttribute('class', 'wbl-suplayer wb-edlayer');
  let sketch = null;      // { mode:'draw'|'edit', pts:[{lat,lon}], id, kind, sel }
  let picked = null;      // picked shape id
  let dragIdx = null, dragMoved = false, downAt = null;

  const llAtClient = (cxs, cys) => {
    const r = frame.getBoundingClientRect();
    const c = centre();
    const wx = (c.x - r.width / 2) + (cxs - r.left);
    const wy = (c.y - r.height / 2) + (cys - r.top);
    const lon = wx / world() * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * wy / world()))) * 180 / Math.PI;
    return { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
  };
  const fpx = (lon, lat) => {
    const c = centre();
    return { x: xOf(lon) - (c.x - frame.clientWidth / 2),
             y: yOf(lat) - (c.y - frame.clientHeight / 2) };
  };

  function renderSketch() {
    if (edSvg.parentNode !== frame) frame.appendChild(edSvg);
    while (edSvg.firstChild) edSvg.removeChild(edSvg.firstChild);
    if (!sketch || !sketch.pts.length) { edSvg.style.display = 'none'; return; }
    edSvg.style.display = '';
    edSvg.setAttribute('width', frame.clientWidth);
    edSvg.setAttribute('height', frame.clientHeight);
    const qs = sketch.pts.map(p => fpx(p.lon, p.lat));
    if (qs.length > 1) {
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', 'M' + qs.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join('L')
        + (qs.length > 2 ? 'Z' : ''));
      path.setAttribute('class', 'wb-drawpath');
      edSvg.appendChild(path);
    }
    if (sketch.mode === 'edit') {
      for (let i = 0; i < qs.length; i++) {
        const j = (i + 1) % qs.length;
        const mid = document.createElementNS(SVGNS, 'circle');
        mid.setAttribute('cx', ((qs[i].x + qs[j].x) / 2).toFixed(1));
        mid.setAttribute('cy', ((qs[i].y + qs[j].y) / 2).toFixed(1));
        mid.setAttribute('r', 3);
        mid.setAttribute('class', 'wb-edmid');
        mid.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault();
          const at = j === 0 ? sketch.pts.length : j;
          sketch.pts.splice(at, 0, llAtClient(e.clientX, e.clientY));
          sketch.sel = null;
          dragIdx = at; dragMoved = true;
          renderSketch(); sketchBar();
        });
        edSvg.appendChild(mid);
      }
    }
    qs.forEach((q, i) => {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', q.x.toFixed(1));
      c.setAttribute('cy', q.y.toFixed(1));
      c.setAttribute('r', sketch.mode === 'edit' ? 4.5 : 3.5);
      c.setAttribute('class', sketch.mode === 'edit'
        ? 'wb-edpt' + (sketch.sel === i ? ' on' : '') : 'wb-drawpt');
      if (sketch.mode === 'edit') {
        c.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault();
          dragIdx = i; dragMoved = false;
        });
      }
      edSvg.appendChild(c);
    });
  }

  window.addEventListener('pointermove', (e) => {
    if (dragIdx == null || !sketch) return;
    dragMoved = true;
    sketch.pts[dragIdx] = llAtClient(e.clientX, e.clientY);
    renderSketch();
  });
  window.addEventListener('pointerup', () => {
    if (dragIdx == null || !sketch) return;
    if (!dragMoved && sketch.mode === 'edit') {
      sketch.sel = sketch.sel === dragIdx ? null : dragIdx;
      renderSketch(); sketchBar();
    }
    dragIdx = null;
  });

  const btn = (label, fn, disabled, title) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tb-btn'; b.textContent = label;
    if (disabled) { b.disabled = true; if (title) b.title = title; }
    else b.addEventListener('click', fn);
    return b;
  };

  function sketchBar() {
    if (!selBar || !sketch) return;
    selBar.hidden = false;
    selBar.textContent = '';
    const info = document.createElement('span');
    info.className = 'grow';
    info.textContent = (sketch.mode === 'edit' ? 'Editing the shape — ' : 'Drawing — ')
      + sketch.pts.length + ' corner' + (sketch.pts.length === 1 ? '' : 's')
      + (sketch.pts.length < 3 ? ' (need at least 3)' : '')
      + (sketch.sel != null ? ', corner ' + (sketch.sel + 1) + ' selected' : '');
    selBar.appendChild(info);
    if (sketch.mode === 'draw') {
      for (const kind of ['building', 'campus']) {
        selBar.appendChild(btn('Save as ' + kind, () => saveSketch(kind), sketch.pts.length < 3));
      }
      selBar.appendChild(btn('Undo corner', () => {
        sketch.pts.pop(); renderSketch(); sketchBar();
      }, !sketch.pts.length));
    } else {
      selBar.appendChild(btn('Save shape', () => saveSketch(sketch.kind)));
      selBar.appendChild(btn('Delete corner', () => {
        sketch.pts.splice(sketch.sel, 1); sketch.sel = null;
        renderSketch(); sketchBar();
      }, sketch.sel == null || sketch.pts.length <= 3,
        sketch.pts.length <= 3 ? 'a ring needs at least 3 corners' : ''));
    }
    selBar.appendChild(btn('Cancel', exitSketch));
  }

  function exitSketch() {
    sketch = null; dragIdx = null; picked = null;
    if (drawBtn) drawBtn.setAttribute('aria-pressed', 'false');
    frame.classList.remove('wb-moving');
    renderSketch();
    if (selBar) { selBar.hidden = true; selBar.textContent = ''; }
  }

  async function saveSketch(kind) {
    const ring = sketch.pts.map(p => [p.lon, p.lat]);
    ring.push(ring[0]);
    const body = sketch.mode === 'edit'
      ? { id: sketch.id, geometry: { type: 'Polygon', coordinates: [ring] },
          note: 'reshaped on the archive viewer' }
      : { geometry: { type: 'Polygon', coordinates: [ring] }, kind,
          sites: [ASSET], note: 'traced on the archive viewer against reference imagery' };
    try {
      const r = await fetch('/api/footprint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (!r.ok) { label.textContent = 'not saved: ' + (out.error || r.status); return; }
      exitSketch();
      await loadFp();
      draw();
      syncShp();     // the live map tab shares the shapes
    } catch (err) { label.textContent = 'not saved: ' + err.message; }
  }

  function pickBar(f) {
    if (!selBar) return;
    picked = f.id;
    selBar.hidden = false;
    selBar.textContent = '';
    const info = document.createElement('span');
    info.className = 'grow';
    info.textContent = (f.name || (f.kind === 'campus' ? 'campus boundary' : 'building'))
      + ' · ' + f.kind + ' · ' + f.src
      + (f.ref ? ' · parcel ' + f.ref : '')
      + (f.acres ? ' · ' + f.acres + ' ac' : '')
      + (f.m2 ? ' · ' + Math.round(f.m2).toLocaleString() + ' m²' : '')
      + (f.expanded ? ' · grown from the seed lot (same owner, touching)' : '');
    selBar.appendChild(info);
    selBar.appendChild(btn('Edit shape', () => {
      const pts = (f.rings[0] || []).map(c => ({ lon: c[0], lat: c[1] }));
      if (pts.length > 1 && pts[0].lon === pts[pts.length - 1].lon
          && pts[0].lat === pts[pts.length - 1].lat) pts.pop();
      sketch = { mode: 'edit', id: f.id, kind: f.kind, pts, sel: null };
      renderSketch(); sketchBar();
    }, f.rings.length !== 1, 'this shape has more than one ring — edit it on the map'));
    const db = btn('Delete shape', async () => {
      if (db.dataset.armed !== '1') {
        db.dataset.armed = '1'; db.textContent = 'Really delete?'; return;
      }
      db.disabled = true;
      try {
        const r = await fetch('/api/footprint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: f.id, delete: true }),
        });
        if (!r.ok) { label.textContent = 'not deleted'; return; }
        exitSketch();
        await loadFp();
        draw();
        syncShp();   // the live map tab shares the shapes
      } catch (err) { label.textContent = 'not deleted: ' + err.message; }
    });
    selBar.appendChild(db);
    selBar.appendChild(btn('Close', exitSketch));
  }

  const ringHas = (ring, lo, la) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  frame.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; }, true);
  frame.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || dragIdx != null) return;
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    if (e.target.closest && e.target.closest('.wbl-tools, .wb-suplbl, .wbl-bar')) return;
    if (sketch && sketch.mode === 'draw') {
      sketch.pts.push(llAtClient(e.clientX, e.clientY));
      renderSketch(); sketchBar();
      return;
    }
    // Nothing to pick: the archive draws no shapes. Selecting a footprint is
    // a Live map action, where the shape you click is the one you can then
    // reshape or delete.
  });

  if (drawBtn) {
    drawBtn.addEventListener('click', () => {
      if (sketch && sketch.mode === 'draw') { exitSketch(); return; }
      sketch = { mode: 'draw', pts: [], sel: null };
      drawBtn.setAttribute('aria-pressed', 'true');
      frame.classList.add('wb-moving');
      renderSketch(); sketchBar();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (sketch || picked)) exitSketch();
  });

  // Drag to pan; the buttons zoom; the slider is time.
  let drag = null;
  frame.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wb-suplbl')) return;   // the pill is a link, not a drag
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY };
    frame.setPointerCapture(e.pointerId);
  });
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cx -= e.clientX - drag.x; cy -= e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    draw();
  });
  frame.addEventListener('pointerup', () => { drag = null; });
  frame.addEventListener('pointercancel', () => { drag = null; });

  // A frame that had no width when the page loaded (a hidden pane, a
  // collapsed panel) draws itself the moment it gets one - draw() bails
  // harmlessly at zero, so this is the retry.
  new ResizeObserver(() => { if (frame.clientWidth) draw(); }).observe(frame);

  host.querySelector('.wbl-in').addEventListener('click', () => {
    if (Z >= 19) return;
    cx *= 2; cy *= 2; Z++; frame.textContent = ''; draw();
  });
  host.querySelector('.wbl-out').addEventListener('click', () => {
    if (Z <= 12) return;
    cx /= 2; cy /= 2; Z--; frame.textContent = ''; draw();
  });
  host.querySelector('.wbl-home').addEventListener('click', () => {
    cx = cy = 0; draw();
  });
  host.querySelector('.wbl-fs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else host.requestFullscreen && host.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', draw);

  slider.addEventListener('input', () => { ri = +slider.value; draw(); });
  let timer = null;
  playBtn.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; playBtn.textContent = '▶'; return; }
    playBtn.textContent = '⏸';
    if (ri >= releases.length - 1) ri = 0;
    timer = setInterval(() => {
      if (ri >= releases.length - 1) { clearInterval(timer); timer = null; playBtn.textContent = '▶'; return; }
      ri++; slider.value = ri; draw();
    }, 700);
  });
  if (fpBtn) {
    fpBtn.addEventListener('click', () => {
      fpOn = !fpOn;
      fpBtn.setAttribute('aria-pressed', String(fpOn));
      drawFp();
    });
  }

  fetch(CONFIG_URL).then(r => r.json()).then(cfg => {
    releases = Object.entries(cfg).map(([num, v]) => {
      const m = (v.itemTitle || '').match(/(\d{4}-\d{2}-\d{2})/);
      return { num, date: m ? m[1] : v.itemTitle || num, url: v.itemURL };
    }).filter(r => r.url).sort((a, b) => a.date < b.date ? -1 : 1);
    ri = releases.length - 1;                 // land on today, like the site page
    slider.max = String(releases.length - 1);
    slider.value = String(ri);
    draw();
  }).catch(() => {
    label.textContent = 'imagery archive unreachable';
    if (loadingEl) {
      loadingEl.querySelector('span').textContent = 'imagery archive unreachable';
      loadingEl.classList.add('wbl-loading-failed');
    }
  });

  // Footprints load on their own, NOT inside the Wayback config fetch above.
  // They used to hang off it, which quietly made the LIVE map's shapes depend
  // on a third-party config request for the archive it no longer draws on: a
  // slow or failed Esri response left the live map with no outlines and no
  // fitted view, on the tab that opens by default.
  loadFp().then(() => { syncShp(); fitAsset({ duration: 0 }); }).catch(() => {});

  new ResizeObserver(draw).observe(frame);

  // ---- the Live map tab ------------------------------------------------------
  // The site page's second tab, ported: MapLibre's pan, zoom and click handling
  // are better ergonomics for footprint work than the hand-rolled archive rig,
  // which stays the tool for TIME. Same division as the site pages: the pen
  // chip splits looking from changing - select mode reads a shape (or the
  // dot), edit mode adds reshape and delete. Both viewers share `fps`, and
  // every save funnels through loadFp + syncShp so neither goes stale.
  const tabs = document.getElementById('wbl-tabs');
  const liveWrap = document.getElementById('wbl-live');
  const lvSel = document.getElementById('lv-sel');
  const lvStatus = document.getElementById('lv-status');
  const lvDraw = document.getElementById('lv-draw');
  const lvPen = document.getElementById('lv-pen');
  let lm = null, lvSelId = null;
  // Which LAYER the user has said they mean to edit: null | 'dot' | 'building'
  // | 'campus'. This replaces a single global pen. Editing is a statement
  // about one kind of thing, so the selection bar can only ever offer to
  // change the kind that is armed - clicking a building while the campus
  // layer is armed reads it, and says nothing about changing it.
  let armed = null;
  // True only while setArmed is running. exitLive() puts the coordinate
  // pencil out with its mode, but setArmed calls exitLive on its way INTO a
  // layer - without this the arm would clear itself the moment it was set.
  let arming = false;

  // ---- the layer panel -------------------------------------------------
  // Visibility per layer, and one pencil per layer saying "I mean to change
  // this one". Arming a layer disarms the others: the selection bar has to
  // be unambiguous about what it is about to reshape or delete.
  const LAYER_TOOLS = {
    // Listed so syncTools keeps managing them, never shown - see HIDDEN.
    dot: ['lv-move', 'lv-place'],
    // The same billed Regrid pull answers both footprint layers: the parcel
    // is the campus candidate and the matched buildings are the building
    // candidates, one response for both. So the pull button appears under
    // either pencil; only the adopts are layer-specific, because adopting
    // states which KIND the shape is.
    building: ['lv-draw', 'lv-pull-regrid', 'lv-adopt-bldgs'],
    campus: ['lv-draw', 'lv-pull-regrid', 'lv-pull-precisely', 'lv-pull-cadastre',
             'lv-adopt-regrid', 'lv-adopt-precisely', 'lv-adopt-cadastre',
             'lv-again-regrid'],
  };
  // Nothing is shown regardless of arming any more: Nearby dots became its
  // own layer row, and every remaining tool belongs to exactly one layer.
  const ALWAYS = [];
  // These reveal themselves when there is something to reveal; arming a
  // layer must not force them on.
  const SELF_MANAGED = new Set(['lv-adopt-regrid', 'lv-adopt-precisely',
    'lv-adopt-cadastre', 'lv-adopt-bldgs', 'lv-again-regrid']);

  // The coordinate layer has exactly one thing you can do to it, and the
  // pencil already said you meant to do it - a button repeating "fix the
  // dot's position" asks the same question twice. These two stay in the DOM
  // because their handlers hold the mode logic, and setArmed clicks the one
  // the page rendered; they are simply never put on screen.
  const HIDDEN = new Set(['lv-move', 'lv-place']);

  function syncTools() {
    const want = new Set([...(LAYER_TOOLS[armed] || []), ...ALWAYS]
      .filter((id) => !HIDDEN.has(id)));
    for (const ids of Object.values(LAYER_TOOLS)) {
      for (const id of ids) {
        const b = document.getElementById(id);
        if (!b) continue;
        b.hidden = SELF_MANAGED.has(id)
          ? !(want.has(id) && b.dataset.ready === '1')
          : !want.has(id);
      }
    }
  }
  // "There is something for this button to act on" - a pulled parcel, the
  // buildings that rode with it, a cached record worth re-asking about.
  // Set by the pull handlers, cleared by a successful adopt; syncTools
  // shows the button only while its layer is armed AS WELL.
  function readyTool(id, on) {
    const b = document.getElementById(id);
    if (b) b.dataset.ready = on ? '1' : '';
  }
  let lvDotMarker = null;
  const editingKind = () => (armed === 'building' ? 'building'
                           : armed === 'campus' ? 'campus' : null);
  let lvMode = null;      // null | 'draw' | 'edit' | 'move' | 'place'
  let lvPts = [], lvEditId = null, lvEditKind = null, lvVtx = null;
  let lvDragI = null, lvDragMoved = false;
  let lvGhost = null;     // move mode's proposed-position marker
  const vendorShapes = { regrid: null, precisely: null, cadastre: null };
  const VENDOR_NAME = { regrid: 'Regrid', precisely: 'Precisely',
                        cadastre: 'French cadastre' };
  // Parcel text is third-party: owner names, addresses and free-text notes
  // straight from a county record, going into innerHTML. Escaped, always.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // A notification, so it leaves on its own. The one exception is an armed
  // mode: "click each corner" vanishing halfway through a drawing would be
  // worse than never showing it, so while a mode is pressed the message is
  // held and the timer simply re-checks.
  // lv-pen retired with the single global pencil; the per-layer ones are not
  // listed because arming a LAYER is not an instruction waiting to be obeyed.
  const MODE_BTNS = ['lv-draw', 'lv-move', 'lv-place',
    'lv-pull-regrid', 'lv-pull-precisely', 'lv-pull-cadastre'];
  let pullVend = null;   // which vendor the armed pull-pick will ask
  const modeArmed = () => MODE_BTNS.some((id) => {
    const b = document.getElementById(id);
    return b && b.getAttribute('aria-pressed') === 'true';
  });
  let sayTimer = null;
  const say = (t) => {
    if (!lvStatus) return;
    lvStatus.textContent = t;
    clearTimeout(sayTimer);
    if (!t) return;
    const tick = () => {
      if (modeArmed()) { sayTimer = setTimeout(tick, 1500); return; }
      lvStatus.textContent = '';
    };
    sayTimer = setTimeout(tick, 4000);
  };
  const idleMsg = () => (armed && armed !== 'dot'
    ? 'edit mode — click a shape, then reshape or delete it'
    : 'click a shape to see it · scroll to zoom, drag to pan');

  // The frame this asset actually wants. A fixed zoom is wrong in both
  // directions: a single building at z15.2 is a speck, and a 200-acre campus
  // runs off the edges. If a shape belongs to THIS asset - a footprint, or a
  // parcel just pulled - the map is fitted to it; otherwise the dot keeps the
  // default zoom, which is the honest answer when there is no extent to show.
  function assetBounds() {
    const rings = [];
    for (const f of (fps || [])) {
      if (ASSET && !(f.sites || []).includes(ASSET)) continue;
      for (const r of f.rings) rings.push(r);
    }
    for (const v of ['regrid', 'precisely', 'cadastre']) {
      const s = vendorShapes[v];
      if (!s || !s.geom) continue;
      const c = s.geom.coordinates || [];
      for (const r of (s.geom.type === 'MultiPolygon' ? c.flat() : c)) rings.push(r);
    }
    if (!rings.length) return null;
    let w = 180, s2 = 90, e = -180, n = -90;
    for (const r of rings) {
      for (const [lo, la] of r) {
        if (lo < w) w = lo; if (lo > e) e = lo;
        if (la < s2) s2 = la; if (la > n) n = la;
      }
    }
    if (!(e > w) || !(n > s2)) return null;
    return [[w, s2], [e, n]];
  }

  // Fit, but never past the point of usefulness: a tiny shed should not slam
  // the camera to z22 where the imagery is a blur, and a shape spanning a
  // county should not be honoured at the cost of seeing anything.
  function fitAsset(opts = {}) {
    if (!lm) return false;
    const b = assetBounds();
    if (!b) return false;
    lm.fitBounds(b, { padding: 40, maxZoom: 18, duration: opts.duration ?? 600 });
    return true;
  }

  // Which kinds are drawn. Filtering the SOURCE rather than adding a second
  // set of map layers keeps shp-fill, shp-line, shp-hl and the click picker
  // working exactly as they did - a hidden layer is simply a shape the picker
  // never sees, which is the behaviour you want from a visibility switch.
  const shpShow = { building: true, campus: true };

  function syncShp() {
    if (!lm || !lm.getSource('shp')) return;
    lm.getSource('shp').setData({ type: 'FeatureCollection',
      features: (fps || []).filter(f => shpShow[f.kind] !== false).map(f => ({ type: 'Feature',
        geometry: { type: 'Polygon', coordinates: f.rings.map(rg =>
          (rg[0][0] === rg[rg.length - 1][0] && rg[0][1] === rg[rg.length - 1][1])
            ? rg : rg.concat([rg[0]])) },
        properties: { id: f.id, kind: f.kind, src: f.src, m2: f.m2 || 0 } })) });
  }

  function setLvHl() {
    if (lm && lm.getLayer('shp-hl')) lm.setFilter('shp-hl', ['==', ['get', 'id'], lvSelId || '']);
  }

  function lvDraftData() {
    const ring = lvPts.map(p => [p.lon, p.lat]);
    lm.getSource('draft').setData(lvPts.length < 2
      ? { type: 'FeatureCollection', features: lvPts.map(p => ({ type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} })) }
      : { type: 'Feature', properties: {},
          geometry: lvPts.length > 2
            ? { type: 'Polygon', coordinates: [ring.concat([ring[0]])] }
            : { type: 'LineString', coordinates: ring } });
    const hs = [];
    lvPts.forEach((p, i) => hs.push({ type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { h: 'vtx', i, on: lvVtx === i } }));
    if (lvMode === 'edit') {
      for (let i = 0; i < lvPts.length; i++) {
        const j = (i + 1) % lvPts.length;
        hs.push({ type: 'Feature', geometry: { type: 'Point',
          coordinates: [(lvPts[i].lon + lvPts[j].lon) / 2, (lvPts[i].lat + lvPts[j].lat) / 2] },
          properties: { h: 'mid', i: j === 0 ? lvPts.length : j } });
      }
    }
    lm.getSource('handles').setData({ type: 'FeatureCollection', features: hs });
  }

  function lvBar() {
    lvSel.hidden = false;
    lvSel.textContent = '';
    const info = document.createElement('span');
    info.className = 'grow';
    info.textContent = (lvMode === 'edit' ? 'Editing — ' : 'Drawing — ')
      + lvPts.length + ' corner' + (lvPts.length === 1 ? '' : 's')
      + (lvPts.length < 3 ? ' (need at least 3)' : '')
      + (lvVtx != null ? ', corner ' + (lvVtx + 1) + ' selected' : '');
    lvSel.appendChild(info);
    if (lvMode === 'draw') {
      // You reached this bar through one layer's pencil, so the kind is already
      // decided - offering "save as campus" inside the building layer is asking
      // a question the armed layer answered. Fall back to both only if drawing
      // somehow began with no layer armed, which no current path does.
      for (const kind of (armed === 'building' || armed === 'campus' ? [armed] : ['building', 'campus'])) {
        lvSel.appendChild(btn('Save as ' + kind, () => saveLive(kind), lvPts.length < 3));
      }
      lvSel.appendChild(btn('Undo corner', () => {
        lvPts.pop(); lvDraftData(); lvBar();
      }, !lvPts.length));
    } else {
      lvSel.appendChild(btn('Save shape', () => saveLive(lvEditKind)));
      lvSel.appendChild(btn('Delete corner', () => {
        lvPts.splice(lvVtx, 1); lvVtx = null; lvDraftData(); lvBar();
      }, lvVtx == null || lvPts.length <= 3,
        lvPts.length <= 3 ? 'a ring needs at least 3 corners' : ''));
    }
    lvSel.appendChild(btn('Cancel', exitLive));
  }

  function exitLive() {
    lvMode = null; lvPts = []; lvEditId = null; lvVtx = null; lvDragI = null;
    if (lvDraw) lvDraw.setAttribute('aria-pressed', 'false');
    const mv = document.getElementById('lv-move');
    if (mv) mv.setAttribute('aria-pressed', 'false');
    const pb = document.getElementById('lv-place');
    if (pb) pb.setAttribute('aria-pressed', 'false');
    for (const v of ['regrid', 'precisely', 'cadastre']) {
      const el = document.getElementById('lv-pull-' + v);
      if (el) el.setAttribute('aria-pressed', 'false');
    }
    pullVend = null;
    // The placement ghost survives leaving the mode on purpose: the form below
    // the map is still open and still refers to that point, so clearing the
    // marker would leave a coordinate in the form with nothing showing where
    // it is. Cancel is what removes both.
    if (lvGhost && !pfAt) { lvGhost.remove(); lvGhost = null; }
    lm.getCanvas().style.cursor = '';
    lm.doubleClickZoom.enable();
    lvDraftData();
    lvSel.hidden = true;
    // The coordinate pencil is the mode's only indicator, so it goes out with
    // the mode however the mode ended - saved, cancelled or switched away.
    if (armed === 'dot' && !arming) {
      armed = null;
      const pen = document.getElementById('lv-edit-dot');
      if (pen) pen.setAttribute('aria-pressed', 'false');
    }
    say(idleMsg());
  }

  async function saveLive(kind) {
    const ring = lvPts.map(p => [p.lon, p.lat]);
    ring.push(ring[0]);
    const body = lvMode === 'edit'
      ? { id: lvEditId, geometry: { type: 'Polygon', coordinates: [ring] },
          note: 'reshaped on the live map' }
      : { geometry: { type: 'Polygon', coordinates: [ring] }, kind,
          sites: [ASSET], note: 'traced on the live map' };
    say('saving…');
    try {
      const r = await fetch('/api/footprint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await r.json();
      if (!r.ok) { say('not saved: ' + (out.error || r.status)); return; }
      exitLive();
      lvSelId = null; setLvHl();
      await loadFp();
      syncShp();
      if (window.__lvRevealKind) window.__lvRevealKind(kind === 'campus' ? 'campus' : 'building');
      say('saved');
    } catch (err) { say('not saved: ' + err.message); }
  }

  function lvPick(f) {
    lvSelId = f.id;
    setLvHl();
    lvSel.hidden = false;
    lvSel.textContent = '';
    const info = document.createElement('span');
    info.className = 'grow';
    info.textContent = (f.name ? f.name + ' · ' : '') + f.id + ' · ' + f.kind + ' · ' + f.src
      + (f.ref ? ' · parcel ' + f.ref : '')
      + (f.acres ? ' · ' + f.acres + ' ac' : '')
      + (f.m2 ? ' · ' + Math.round(f.m2).toLocaleString() + ' m²' : '')
      // A lot grown from the seed - same owner, touching - is the holding,
      // not necessarily the campus, and the bar says so before anyone edits
      // it as if it were.
      + (f.expanded ? ' · grown from the seed lot (same owner, touching)' : '');
    lvSel.appendChild(info);
    // Select mode stops here: the bar reads, it does not offer to change.
    // And it only offers for the layer that is armed: a campus pencil must not
    // put a Delete button under a building.
    if (editingKind() === f.kind && ASSET) {
      lvSel.appendChild(btn('Edit shape', () => {
        lvMode = 'edit'; lvEditId = f.id; lvEditKind = f.kind;
        lvPts = (f.rings[0] || []).map(c => ({ lon: c[0], lat: c[1] }));
        if (lvPts.length > 1 && lvPts[0].lon === lvPts[lvPts.length - 1].lon
            && lvPts[0].lat === lvPts[lvPts.length - 1].lat) lvPts.pop();
        lvVtx = null;
        lvDraftData(); lvBar();
      }, f.rings.length !== 1, 'multi-ring shape — edit it on the main map'));
      const db = btn('Delete shape', async () => {
        if (db.dataset.armed !== '1') { db.dataset.armed = '1'; db.textContent = 'Really delete?'; return; }
        db.disabled = true;
        const r = await fetch('/api/footprint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: f.id, delete: true }),
        });
        if (r.ok) {
          lvSelId = null; setLvHl(); lvSel.hidden = true;
          await loadFp();
          drawFp(); syncShp();
          say('deleted');
        } else { const out = await r.json(); say('not deleted: ' + (out.error || r.status)); }
      });
      lvSel.appendChild(db);
    }
    lvSel.appendChild(btn('Close', () => { lvSelId = null; setLvHl(); lvSel.hidden = true; }));
  }

  // Placing an UNLOCATED substation. Deliberately not the 'move' flow: there
  // is no previous position to measure a distance from, and the thing that
  // makes the placement trustworthy is not a small delta but the note saying
  // how it was identified - so the form below the map, not the transient bar,
  // is where the commitment happens, and Save stays disabled until it is
  // written.
  const pfForm = document.getElementById('place-form');
  const pfCoord = document.getElementById('pf-coord');
  const pfNote = document.getElementById('pf-note');
  const pfBasis = document.getElementById('pf-basis');
  const pfSave = document.getElementById('pf-save');
  const pfStatus = document.getElementById('pf-status');
  let pfAt = null;

  const pfSync = () => {
    if (!pfSave) return;
    pfSave.disabled = !pfAt || !pfNote.value.trim();
  };
  if (pfNote) pfNote.addEventListener('input', pfSync);

  const pfIdle = document.getElementById('pf-idle');

  function placeAt(lat, lon) {
    pfAt = { lat, lon };
    if (!lvGhost) {
      lvGhost = new maplibregl.Marker({ color: '#c2410c' }).setLngLat([lon, lat]).addTo(lm);
    } else lvGhost.setLngLat([lon, lat]);
    if (pfForm) pfForm.hidden = false;
    if (pfIdle) pfIdle.hidden = true;
    if (pfCoord) pfCoord.textContent = lat + ', ' + lon;
    pfSync();
    say('point set — the form below the map asks how you know');
    // Focus lands on the note rather than scrolling the page: the map has to
    // stay in view, because the note is written by looking at it.
    if (pfNote && !pfNote.value.trim()) pfNote.focus({ preventScroll: true });
  }

  if (pfSave) {
    pfSave.addEventListener('click', async () => {
      if (!pfAt) return;
      pfStatus.textContent = 'saving…';
      try {
        const r = await fetch('/api/substation/' + encodeURIComponent(ASSET) + '/place', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: pfAt.lat, lon: pfAt.lon,
                                 basis: pfBasis ? pfBasis.value : '',
                                 note: pfNote ? pfNote.value.trim() : '' }),
        });
        const out = await r.json();
        if (!r.ok) { pfStatus.textContent = 'not saved: ' + (out.error || r.status); return; }
        pfStatus.textContent = 'saved — reloading';
        location.reload();
      } catch (err) { pfStatus.textContent = 'not saved: ' + err.message; }
    });
  }
  const pfCancel = document.getElementById('pf-cancel');
  if (pfCancel) {
    pfCancel.addEventListener('click', () => {
      pfAt = null;
      if (pfForm) pfForm.hidden = true;
      if (pfIdle) pfIdle.hidden = false;
      if (pfStatus) pfStatus.textContent = '';
      if (lvGhost) { lvGhost.remove(); lvGhost = null; }
      exitLive();
    });
  }

  function wireLive() {
    // The county chips above the map: each re-centres on a county the filings
    // name. More than one means the filings disagree, which is worth seeing.
    for (const chip of document.querySelectorAll('.co-chip[data-lat]')) {
      chip.addEventListener('click', () => {
        for (const c of document.querySelectorAll('.co-chip')) {
          c.setAttribute('aria-pressed', String(c === chip));
        }
        let bb = null;
        try { bb = JSON.parse(chip.getAttribute('data-bbox') || 'null'); } catch (err) { bb = null; }
        if (bb && bb.length === 4) lm.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 24 });
        else lm.jumpTo({ center: [+chip.dataset.lon, +chip.dataset.lat], zoom: 10 });
      });
    }

    lm.on('click', (e) => {
      if (lvMode === 'pull') {
        // The aimed ask. The server serves the held parcel for free when the
        // spot lands inside it, and never lets an empty answer erase it.
        const v = pullVend;
        const at = { lat: +e.lngLat.lat.toFixed(6), lon: +e.lngLat.lng.toFixed(6) };
        exitLive();
        pullVendor(v, false, at);
        return;
      }
      if (lvMode === 'place') {
        placeAt(+e.lngLat.lat.toFixed(6), +e.lngLat.lng.toFixed(6));
        return;
      }
      if (lvMode === 'move') {
        // Click proposes; the bar shows the distance and asks. Same flow as
        // the site pages, landing in asset_overrides.csv instead.
        const lat = +e.lngLat.lat.toFixed(6), lon = +e.lngLat.lng.toFixed(6);
        if (!lvGhost) {
          lvGhost = new maplibregl.Marker({ color: '#c2410c' })
            .setLngLat([lon, lat]).addTo(lm);
        } else lvGhost.setLngLat([lon, lat]);
        const r0 = LAT * Math.PI / 180;
        const d = Math.hypot((lon - LON) * 111320 * Math.cos(r0),
                             (lat - LAT) * 111320);
        const dTxt = d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km';
        lvSel.hidden = false;
        lvSel.textContent = '';
        const info = document.createElement('span');
        info.className = 'grow';
        info.textContent = 'Move the dot ' + dTxt + ' to ' + lat + ', ' + lon
          + (d > 25000 ? ' — that is a long way; is this still the same thing?' : '');
        lvSel.appendChild(info);
        lvSel.appendChild(btn('Save new position', async () => {
          say('saving…');
          try {
            // Same body, two ledgers: a site's correction lands in
            // site_overrides.csv, a plant's or fab's in asset_overrides.csv.
            // The id says which page this is; the server routes match.
            const ep = ASSET.indexOf('site-') === 0 ? '/api/site/' : '/api/asset/';
            const r = await fetch(ep + encodeURIComponent(ASSET), {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { lat: String(lat), lon: String(lon) },
                note: 'moved on the live map onto the building' }),
            });
            const out = await r.json();
            if (!r.ok) { say('not saved: ' + (out.error || r.status)); return; }
            say('saved — reloading');
            location.reload();
          } catch (err) { say('not saved: ' + err.message); }
        }));
        lvSel.appendChild(btn('Cancel', exitLive));
        return;
      }
      if (lvMode === 'draw') {
        lvPts.push({ lon: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6) });
        lvDraftData(); lvBar();
        return;
      }
      if (lvMode === 'edit') return;
      const hits = lm.queryRenderedFeatures(e.point, { layers: ['shp-fill'] })
        .map(x => (fps || []).find(s => s.id === x.properties.id)).filter(Boolean)
        .sort((a, b) => (a.m2 || Infinity) - (b.m2 || Infinity));
      if (!hits.length) return;
      const at = hits.findIndex(h => h.id === lvSelId);
      lvPick(at >= 0 ? hits[(at + 1) % hits.length] : hits[0]);
    });
    lm.on('mouseenter', 'shp-fill', () => { if (!lvMode) lm.getCanvas().style.cursor = 'pointer'; });
    lm.on('mouseleave', 'shp-fill', () => { if (!lvMode) lm.getCanvas().style.cursor = ''; });
    const grab = (e, insert) => {
      e.preventDefault();
      const p = e.features[0].properties;
      if (insert) {
        lvPts.splice(p.i, 0, { lon: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6) });
        lvDragI = p.i;
        lvVtx = null;
      } else {
        lvDragI = p.i;
      }
      lvDragMoved = insert;
      lm.dragPan.disable();
      lvDraftData();
    };
    lm.on('mousedown', 'hnd-vtx', (e) => { if (lvMode === 'edit') grab(e, false); });
    lm.on('mousedown', 'hnd-mid', (e) => { if (lvMode === 'edit') grab(e, true); });
    lm.on('mousemove', (e) => {
      if (lvDragI == null) return;
      lvDragMoved = true;
      lvPts[lvDragI] = { lon: +e.lngLat.lng.toFixed(6), lat: +e.lngLat.lat.toFixed(6) };
      lvDraftData();
    });
    lm.on('mouseup', () => {
      if (lvDragI == null) return;
      if (!lvDragMoved) {
        lvVtx = lvVtx === lvDragI ? null : lvDragI;
        lvBar();
      }
      lvDragI = null;
      lm.dragPan.enable();
      lvDraftData();
    });
    if (lvDraw) {
      lvDraw.addEventListener('click', () => {
        if (lvMode === 'draw') { exitLive(); return; }
        if (lvMode === 'edit') exitLive();
        lvMode = 'draw'; lvPts = []; lvVtx = null;
        lvSelId = null; setLvHl();
        lvDraw.setAttribute('aria-pressed', 'true');
        lm.getCanvas().style.cursor = 'crosshair';
        lm.doubleClickZoom.disable();
        lvDraftData(); lvBar();
        say('click each corner · pan and zoom still work');
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lvMode) exitLive();
    });

    // Fix the dot's position - the correction the edit form's number boxes
    // make blind, done where it is safe: with the building on screen.
    const lvMove = document.getElementById('lv-move');
    if (lvMove) {
      lvMove.addEventListener('click', () => {
        if (lvMode === 'move') { exitLive(); return; }
        if (lvMode) exitLive();
        lvMode = 'move';
        lvMove.setAttribute('aria-pressed', 'true');
        lm.getCanvas().style.cursor = 'crosshair';
        say('click the building this dot should stand on');
      });
    }

    const lvPlace = document.getElementById('lv-place');
    if (lvPlace) {
      lvPlace.addEventListener('click', () => {
        if (lvMode === 'place') { exitLive(); return; }
        if (lvMode) exitLive();
        lvMode = 'place';
        lvPlace.setAttribute('aria-pressed', 'true');
        lm.getCanvas().style.cursor = 'crosshair';
        say('click the switchyard — zoom in until you can see the equipment');
      });
    }

    // Nearby registry dots around this coordinate - same feed the site pages
    // use, read-only here: info and a way to the site's own page.
    // Nearby dots is a LAYER now, not a verb: it draws other assets near this
    // one, which is exactly what a layer checkbox means everywhere else in
    // this app. The fetch is lazy - the box starts unchecked, so a page that
    // nobody asks this of never makes the request.
    const lvNear = document.getElementById('lyr-near');
    let nearOn = false, nearRows = [];
    const KCOL = { point: '#8fa3b0', building: '#2E9E83', campus: '#7C3AED' };
    if (lvNear) {
      lvNear.addEventListener('change', async () => {
        nearOn = lvNear.checked;
        if (!nearOn) {
          lm.getSource('near').setData({ type: 'FeatureCollection', features: [] });
          return;
        }
        say('looking…');
        try {
          const r = await fetch('/api/nearby/' + encodeURIComponent(ASSET) + '?km=3');
          const out = await r.json();
          nearRows = out.near || [];
          lm.getSource('near').setData({ type: 'FeatureCollection',
            features: nearRows.map(n => ({ type: 'Feature',
              geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
              properties: { id: n.id, col: KCOL[n.kind] || KCOL.point } })) });
          say(nearRows.length
            ? nearRows.length + ' within 3 km — click one'
            : 'no registry site within 3 km');
        } catch (err) { say('failed: ' + err.message); }
      });
      lm.on('click', 'near-lyr', (e) => {
        if (lvMode) return;
        const n = nearRows.find(x => x.id === e.features[0].properties.id);
        if (!n) return;
        lvSel.hidden = false;
        lvSel.textContent = '';
        const info = document.createElement('span');
        info.className = 'grow';
        info.textContent = (n.name || n.id) + ' · ' + n.kind + ' · ' + n.km + ' km away';
        lvSel.appendChild(info);
        const a = document.createElement('a');
        a.className = 'tb-btn';
        a.href = '/maps/site/' + encodeURIComponent(n.id);
        a.textContent = 'Open page';
        lvSel.appendChild(a);
        lvSel.appendChild(btn('Close', () => { lvSel.hidden = true; }));
      });
      lm.on('mouseenter', 'near-lyr', () => { if (!lvMode) lm.getCanvas().style.cursor = 'pointer'; });
      lm.on('mouseleave', 'near-lyr', () => { if (!lvMode) lm.getCanvas().style.cursor = ''; });
    }

    // Vendor parcels, pulled one dot at a time - the site pages' aimed-spend
    // flow, cached server-side forever under this page's asset id. Adopting
    // one is a HAND edit: the person who held the lot against the imagery is
    // the verifier, and the ledger note records vendor and APN.
    const vendSync = () => {
      if (!lm.getSource('vend')) return;
      const feats = [];
      for (const v of ['regrid', 'precisely', 'cadastre']) {
        const s = vendorShapes[v];
        if (s && s.geom) feats.push({ type: 'Feature', geometry: s.geom, properties: { v } });
      // The field groups stay in vendorShapes rather than riding on the
      // feature: MapLibre flattens nested properties to strings, and a
      // click can read them from the closure by vendor just as easily.
      }
      // Matched buildings ride the same source under their own v, each
      // carrying its index so a click can find its record in the closure.
      const rb = vendorShapes.regrid;
      if (rb && rb.buildings) {
        rb.buildings.forEach((b, i) => feats.push(
          { type: 'Feature', geometry: b.geometry, properties: { v: 'bldg', i } }));
      }
      lm.getSource('vend').setData({ type: 'FeatureCollection', features: feats });
    };
    async function pullVendor(v, force, at) {
      const b = document.getElementById('lv-pull-' + v);
      b.disabled = true;
      say('asking ' + VENDOR_NAME[v] + '…');
      try {
        const q = [];
        if (force) q.push('force=1');
        if (at) q.push('lat=' + at.lat, 'lon=' + at.lon);
        const r = await fetch('/api/pull-parcel/' + v + '/' + encodeURIComponent(ASSET)
                              + (q.length ? '?' + q.join('&') : ''), { method: 'POST' });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error || ('HTTP ' + r.status));
        if (!out.parcel) {
          b.disabled = false;      // an empty answer is an answer; the button lives
          // Empties are never served from cache any more, so this is always a
          // fresh answer — and it costs nothing, which is why it is re-asked.
          say(VENDOR_NAME[v] + ': no parcel contains this point (asked just now'
            + (out.county && out.county.last_refresh
               ? '; ' + out.county.county + ' Co. data refreshed ' + out.county.last_refresh
               : '') + ')');
          return;
        }
        const props = out.parcel.properties || {};
        vendorShapes[v] = { geom: out.parcel.geometry, p: props,
                            groups: out.groups || [], facts: out.facts || 0,
                            buildings: (v === 'regrid' && out.buildings
                                        && out.buildings.length) ? out.buildings : null,
                            thin: !!out.thin, county: out.county || null };
        readyTool('lv-adopt-' + v, true);
        if (v === 'regrid') readyTool('lv-adopt-bldgs', !!vendorShapes.regrid.buildings);
        readyTool('lv-again-' + v, out.cached);
        syncTools();
        const nb = vendorShapes[v].buildings ? vendorShapes[v].buildings.length : 0;
        say(VENDOR_NAME[v] + ': parcel' + (props.ref ? ' ' + props.ref : '')
          + (out.facts ? ' · ' + out.facts + ' fields — click the parcel' : '')
          + (nb ? ' · ' + nb + ' matched building' + (nb === 1 ? '' : 's') : '')
          + (out.cached ? ' (held, not re-asked — no charge)' : ' (fetched)')
          + (out.county && out.county.last_refresh
             ? ' · ' + out.county.county + ' Co. data refreshed ' + out.county.last_refresh
             : '')
          + (out.stale ? ' — the county has been refreshed since; “Ask again” to re-fetch' : ''));
        vendSync();
        fitAsset();          // the parcel is the extent worth seeing now
      } catch (err) { say(VENDOR_NAME[v] + ' failed: ' + err.message); }
      b.disabled = false;
    }
    async function adoptVendor(v) {
      const shape = vendorShapes[v];
      if (!shape) return;
      const ab = document.getElementById('lv-adopt-' + v);
      ab.disabled = true;
      say('saving…');
      try {
        const r = await fetch('/api/footprint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geometry: shape.geom, kind: 'campus', sites: [ASSET],
            note: 'adopted from ' + VENDOR_NAME[v] + ' parcel'
              + (shape.p.ref ? ' ' + shape.p.ref : '')
              + (shape.p.acres ? ' (' + shape.p.acres + ' ac)' : '')
              + ' after checking it against the imagery',
          }),
        });
        const out = await r.json();
        if (!r.ok) { say('not saved: ' + (out.error || r.status)); return; }
        await loadFp();
        syncShp();
        say('saved — the parcel is this page’s campus boundary now');
        // Done: the parcel IS the boundary now, so offering to save it again
        // is offering to write a duplicate of what was just written.
        readyTool('lv-adopt-' + v, false);
        syncTools();
        return;
      } catch (err) { say('not saved: ' + err.message); }
      ab.disabled = false;
    }
    // The buildings adopt: same hand-edit contract as the parcel adopts, a
    // different kind. All the matched outlines land as ONE building feature -
    // the person vouched for the set they saw, and one ledger line records it.
    async function adoptBuildings() {
      const s = vendorShapes.regrid;
      if (!s || !s.buildings) return;
      const ab = document.getElementById('lv-adopt-bldgs');
      ab.disabled = true;
      say('saving…');
      const polys = [];
      for (const b of s.buildings) {
        const g = b.geometry || {};
        if (g.type === 'Polygon') polys.push(g.coordinates);
        else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
      }
      try {
        const r = await fetch('/api/footprint', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geometry: { type: 'MultiPolygon', coordinates: polys },
            kind: 'building', sites: [ASSET],
            note: 'adopted ' + s.buildings.length + ' Regrid matched building footprint'
              + (s.buildings.length === 1 ? '' : 's')
              + (s.p.ref ? ' on parcel ' + s.p.ref : '')
              + ' after checking them against the imagery',
          }),
        });
        const out = await r.json();
        if (!r.ok) { say('not saved: ' + (out.error || r.status)); return; }
        await loadFp();
        syncShp();
        say('saved — the matched outlines are this page’s building footprint now');
        readyTool('lv-adopt-bldgs', false);
        syncTools();
        return;
      } catch (err) { say('not saved: ' + err.message); }
      ab.disabled = false;
    }
    const bb = document.getElementById('lv-adopt-bldgs');
    if (bb) bb.addEventListener('click', adoptBuildings);
    for (const v of ['regrid', 'precisely', 'cadastre']) {
      const pb = document.getElementById('lv-pull-' + v);
      // The button arms a pick, it does not fire the ask: the dot is often on
      // a road or a gap (Quincy proved it), so the person chooses the spot.
      // Same toggle contract as draw and move.
      if (pb) pb.addEventListener('click', () => {
        if (lvMode === 'pull' && pullVend === v) { exitLive(); return; }
        if (lvMode) exitLive();
        lvMode = 'pull';
        pullVend = v;
        pb.setAttribute('aria-pressed', 'true');
        lm.getCanvas().style.cursor = 'crosshair';
        say('click the spot to ask ' + VENDOR_NAME[v] + ' about — '
          + (v === 'cadastre' ? 'free' : 'a spot inside the held parcel is free; a new spot is billed if answered')
          + ' · drag still pans');
      });
      // Re-asking for a parcel already on disk is billed, so it confirms.
      const gb = document.getElementById('lv-again-' + v);
      if (gb) {
        gb.addEventListener('click', () => {
          const s = vendorShapes[v];
          const c = s && s.county;
          if (!confirm('Fetch this parcel from ' + VENDOR_NAME[v] + ' again?\n\n'
            + 'It is already held, so this is billed as a new record.\n'
            + (c && c.last_refresh
                ? c.county + ' County data was last refreshed ' + c.last_refresh + '.'
                : ''))) return;
          pullVendor(v, true);
        });
      }
      const ab = document.getElementById('lv-adopt-' + v);
      if (ab) ab.addEventListener('click', () => adoptVendor(v));
    }
  }

  function initLive() {
    lm = new maplibregl.Map({
      container: 'dotmap',
      style: { version: 8, sources: {
        sat: { type: 'raster', tileSize: 256,
               attribution: 'Esri World Imagery',
               tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
      }, layers: [{ id: 'sat', type: 'raster', source: 'sat' }] },
      center: [LON, LAT], zoom: Z + 0.2,
      // No attribution control. The homepage has never drawn one either;
      // the credit is a line of text under the map (ESRI_CREDIT), which
      // is readable without being clicked and cannot be mistaken for a
      // tool in a toolbar full of them.
      attributionControl: false,
    });
    // North stays up, same as every 2D map here: accidental rotation with
    // no compass to undo it is all a rotatable 2D map ever delivers.
    lm.dragRotate.disable();
    lm.touchZoomRotate.disableRotation();
    lm.touchPitch.disable();
    if (lm.keyboard && lm.keyboard.disableRotation) lm.keyboard.disableRotation();
    window.__lvMap = lm;      // a console handle, same spirit as __nearRows
    // Readiness for automation, and the hidden-tab trap named out loud. See
    // the long note on window.__mapReady in public/app.js: a hidden pane
    // suspends requestAnimationFrame, MapLibre's style load is wrapped in a
    // frame promise that then never settles, and every layer read comes back
    // empty as though the layer were broken.
    window.__lvMapReady = (timeoutMs = 20000) => new Promise((resolve) => {
      const t0 = Date.now();
      // Three states, because they license different assertions:
      //   parsed  - getStyle()/getLayer() are meaningful. Layer existence and
      //             querySourceFeatures() can be trusted.
      //   settled - tiles have actually rendered, so queryRenderedFeatures()
      //             is meaningful too. Needs CONTINUOUS frames.
      // A hidden pane gets neither until something composites it; one
      // screenshot buys 'parsed', sustained visibility buys 'settled'.
      const parsed = () => { try { return !!lm.getStyle(); } catch { return false; } };
      const st = () => ({ hidden: document.hidden, ms: Date.now() - t0,
        parsed: parsed(), settled: lm.isStyleLoaded() && lm.loaded() });
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

    const dotMk = new maplibregl.Marker({ color: '#0E8A7C' }).setLngLat([LON, LAT]).addTo(lm);
    lvDotMarker = dotMk;          // the Site coordinate row toggles this
    // The dot answers a click with its own facts - select mode reads.
    const dotEl = dotMk.getElement();
    dotEl.style.cursor = 'pointer';
    dotEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lvMode) return;   // an armed flow owns the bar
      lvSelId = null; setLvHl();
      lvSel.hidden = false;
      lvSel.textContent = '';
      const info = document.createElement('span');
      info.className = 'grow';
      const h1 = document.querySelector('h1');
      info.textContent = 'This dot · ' + ((h1 && h1.textContent.trim()) || ASSET)
        + ' · ' + LAT + ', ' + LON;
      lvSel.appendChild(info);
      lvSel.appendChild(btn('Close', () => { lvSel.hidden = true; }));
    });
    // The supply threads the archive frame draws, MapLibre-native: a green
    // line to each linked campus, and the same pill as a Marker there.
    for (const l of LINKS) {
      const wrap = document.createElement('div');
      const a = document.createElement('a');
      a.className = 'wb-suplbl';
      a.href = l.href;
      a.textContent = '⇆ ' + l.label + (l.km ? ' · ' + l.km + ' km' : '');
      wrap.appendChild(a);
      new maplibregl.Marker({ element: wrap }).setLngLat([l.lon, l.lat]).addTo(lm);
    }
    document.getElementById('lv-in').addEventListener('click', () => lm.zoomIn());
    document.getElementById('lv-out').addEventListener('click', () => lm.zoomOut());
    // Home is "show me this thing", which is its shape when it has one.
    document.getElementById('lv-home').addEventListener('click', () => {
      if (!fitAsset()) lm.easeTo({ center: [LON, LAT], zoom: Z + 0.2 });
    });
    const lvFs = document.getElementById('lv-fs');
    lvFs.addEventListener('click', () => {
      if (document.fullscreenElement === liveWrap) document.exitFullscreen();
      else if (liveWrap.requestFullscreen) liveWrap.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', () => {
      lvFs.textContent = document.fullscreenElement === liveWrap ? '✕' : '⛶';
      lm.resize();
    });
    // ---- the layer panel -------------------------------------------------
    // Visibility per layer, and one pencil per layer saying "I mean to change
    // this one". Arming a layer disarms the others: the selection bar has to
    // be unambiguous about what it is about to reshape or delete.
    // (LAYER_TOOLS, syncTools and readyTool live at module scope, above: the
    // pull handlers in wireLive() need them too, and wireLive and initLive
    // are siblings.)
    function setArmed(next) {
      arming = true;
      armed = armed === next ? null : next;
      for (const [key, id] of [['dot', 'lv-edit-dot'], ['building', 'lv-edit-bldg'],
                               ['campus', 'lv-edit-campus']]) {
        const b = document.getElementById(id);
        if (b) b.setAttribute('aria-pressed', String(armed === key));
      }
      // Leaving a layer abandons any half-finished gesture that belonged to it.
      if (lvMode) exitLive();
      syncTools();
      // The coordinate layer's pencil IS its tool. Placing beats moving when
      // both exist: an unplaced substation is offered 'place', everything else
      // 'move', and the page only ever renders one of them.
      if (armed === 'dot') {
        const b = document.getElementById('lv-place') || document.getElementById('lv-move');
        if (b) b.click();
      }
      // Re-render the selection bar: the same shape offers different things
      // depending on which layer is armed.
      if (lvSelId) {
        const f = (fps || []).find(s => s.id === lvSelId);
        if (f) lvPick(f);
        else { lvSelId = null; setLvHl(); lvSel.hidden = true; }
      }
      arming = false;
      // A mode entered just above set its own prompt ("click the building this
      // dot should stand on"); the idle line would erase the only instruction
      // on screen, since the coordinate layer no longer has a button to read.
      if (!lvMode) say(idleMsg());
    }

    for (const [key, id] of [['dot', 'lv-edit-dot'], ['building', 'lv-edit-bldg'],
                             ['campus', 'lv-edit-campus']]) {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => setArmed(key));
    }
    syncTools();

    // Open/close, copied from the homepage: the pane's own `hidden` IS the
    // state, mirrored into aria-expanded. No boolean, no class, no animation.
    // It starts open here and closed there, because on the homepage the pane
    // is one control among many and on this page it is the only tool surface -
    // hiding every tool behind a click, on a page whose job is editing, would
    // be consistency bought at the cost of the thing being consistent about.
    const layersPane = document.getElementById('lv-layers');
    const layersBtn = document.getElementById('lv-layers-btn');
    if (layersPane && layersBtn) {
      const setOpen = (on) => {
        layersPane.hidden = !on;
        layersBtn.setAttribute('aria-expanded', String(on));
      };
      layersBtn.addEventListener('click', () => setOpen(layersPane.hidden));
    }

    // Visibility. The dot is a MapLibre Marker rather than a layer, so it is
    // toggled through its own element.
    const vis = (on, ids) => ids.forEach((l) => {
      if (lm.getLayer(l)) lm.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
    });
    const bindVis = (boxId, fn) => {
      const cb = document.getElementById(boxId);
      if (cb) cb.addEventListener('change', () => fn(cb.checked));
    };
    bindVis('lyr-dot', (on) => { if (lvDotMarker) lvDotMarker.getElement().style.display = on ? '' : 'none'; });
    const setKindVisible = (kind, on) => {
      shpShow[kind] = on;
      // Drop a selection that has just been hidden. shp-hl filters on id
      // alone, so without this a switched-off campus keeps its highlight and
      // the selection bar keeps offering to reshape something invisible.
      if (!on && lvSelId) {
        const sel = (fps || []).find(s => s.id === lvSelId);
        if (sel && sel.kind === kind) {
          lvSelId = null; setLvHl(); lvSel.hidden = true;
          if (lvMode === 'edit') exitLive();
        }
      }
      syncShp();
    };
    bindVis('lyr-bldg', (on) => setKindVisible('building', on));
    bindVis('lyr-campus', (on) => setKindVisible('campus', on));

    // Saving into a hidden layer would drop the shape into nothing. Turning
    // the layer back on is the only honest outcome: the work happened, so it
    // has to be visible.
    window.__lvRevealKind = (kind) => {
      const box = document.getElementById(kind === 'campus' ? 'lyr-campus' : 'lyr-bldg');
      if (box && !box.checked) { box.checked = true; setKindVisible(kind, true); }
    };

    // The single global pen is gone: each layer row carries its own. The
    // element may still be in older markup, so it is hidden rather than
    // assumed absent.
    if (lvPen) lvPen.hidden = true;
    lm.on('load', () => {
      lm.addSource('sup', { type: 'geojson', data: { type: 'FeatureCollection',
        features: LINKS.map(l => ({ type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: [[LON, LAT], [l.lon, l.lat]] } })) } });
      lm.addSource('shp', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      lm.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      lm.addSource('handles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      lm.addSource('vend', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      lm.addSource('near', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      lm.addLayer({ id: 'sup-line', type: 'line', source: 'sup',
        paint: { 'line-color': '#059669', 'line-width': 2.5, 'line-opacity': 0.9 } });
      lm.addLayer({ id: 'shp-fill', type: 'fill', source: 'shp',
        paint: { 'fill-color': '#E0148C', 'fill-opacity': 0.08 } });
      lm.addLayer({ id: 'shp-line', type: 'line', source: 'shp',
        paint: { 'line-color': '#E0148C', 'line-width': 1.8 } });
      lm.addLayer({ id: 'shp-hl', type: 'line', source: 'shp',
        filter: ['==', ['get', 'id'], ''],
        paint: { 'line-color': '#E0148C', 'line-width': 4 } });
      lm.addLayer({ id: 'draft-line', type: 'line', source: 'draft',
        paint: { 'line-color': '#E0148C', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
      lm.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft',
        paint: { 'fill-color': '#E0148C', 'fill-opacity': 0.06 } });
      const VCOL = ['match', ['get', 'v'], 'regrid', '#2563EB',
                    'precisely', '#7C3AED', 'cadastre', '#0E7490', '#EA580C'];
      lm.addLayer({ id: 'vend-fill', type: 'fill', source: 'vend',
        paint: { 'fill-color': VCOL, 'fill-opacity': 0.07 } });
      lm.addLayer({ id: 'vend-line', type: 'line', source: 'vend',
        paint: { 'line-color': VCOL,
                 'line-width': 2, 'line-dasharray': [2, 1.6] } });
      // Click the parcel, read what the county says about it. The fields come
      // back already grouped and labelled from lib/parcelfields.mjs — the
      // client knows nothing about Regrid's schema and renders what it is
      // handed, so a field added there appears here with no change.
      lm.on('click', 'vend-fill', (e) => {
        if (lvMode) return;                 // drawing or placing takes priority
        const v = e.features[0].properties.v;
        if (v === 'bldg') {
          // A matched building: its record sits on the Regrid shape, found by
          // the index the feature carries. Raw fields under prettified keys -
          // the buildings schema is small and has no curated table yet.
          const rs = vendorShapes.regrid;
          const b = rs && rs.buildings && rs.buildings[e.features[0].properties.i];
          if (!b) return;
          let bh = '<div class="t">Regrid matched building</div><dl class="pf">';
          for (const [k, val] of Object.entries(b.properties || {})) {
            if (val == null || val === '' || typeof val === 'object') continue;
            bh += '<dt>' + esc(String(k).replace(/[_-]+/g, ' ')) + '</dt><dd>'
                + esc(String(val)) + '</dd>';
          }
          bh += '</dl>';
          new maplibregl.Popup({ closeOnClick: true, offset: 8, maxWidth: '340px' })
            .setLngLat(e.lngLat).setHTML(bh).addTo(lm);
          return;
        }
        const s = vendorShapes[v];
        if (!s) return;
        const groups = s.groups || [];
        let html = '<div class="t">' + esc(VENDOR_NAME[v]) + ' parcel</div>';
        if (!groups.length) {
          html += '<div class="d">no fields returned for this parcel</div>';
        }
        for (const g of groups) {
          html += '<div class="pf-g">' + esc(g.label) + '</div><dl class="pf">';
          for (const r of g.rows) {
            html += '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd>';
          }
          html += '</dl>';
        }
        if (s.thin) {
          html += '<div class="d">Only ' + s.facts + ' fields: this parcel was '
                + 'fetched before the app kept the whole record. Re-pull to get '
                + 'the rest — it is billed again.</div>';
        }
        new maplibregl.Popup({ closeOnClick: true, offset: 8, maxWidth: '340px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(lm);
      });
      lm.on('mouseenter', 'vend-fill', () => {
        if (!lvMode) lm.getCanvas().style.cursor = 'pointer';
      });
      lm.on('mouseleave', 'vend-fill', () => {
        if (!lvMode) lm.getCanvas().style.cursor = '';
      });
      lm.addLayer({ id: 'near-lyr', type: 'circle', source: 'near',
        paint: { 'circle-radius': 7, 'circle-color': ['get', 'col'],
                 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      lm.addLayer({ id: 'hnd-mid', type: 'circle', source: 'handles',
        filter: ['==', ['get', 'h'], 'mid'],
        paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-opacity': 0.8,
                 'circle-stroke-color': '#E0148C', 'circle-stroke-width': 1.4 } });
      lm.addLayer({ id: 'hnd-vtx', type: 'circle', source: 'handles',
        filter: ['==', ['get', 'h'], 'vtx'],
        paint: { 'circle-radius': 6,
                 'circle-color': ['case', ['get', 'on'], '#fff', '#E0148C'],
                 'circle-stroke-color': ['case', ['get', 'on'], '#E0148C', '#fff'],
                 'circle-stroke-width': 2 } });
      syncShp();
      // Frame the asset's own shape if it has one. Called here AND from the
      // loadFp() chain because the two race: the map's load event and the
      // footprint fetch finish in either order, and whichever is second is the
      // one that has both the camera and the shapes.
      fitAsset({ duration: 0 });
      wireLive();
      say(idleMsg());
      // Arriving from the placement queue (/power#place): the click meant
      // "place this one", so arrive ready - viewer on screen, coordinate
      // pencil armed, which enters placement directly. Through the pencil's
      // own click so the flow is exactly the hand-operated one.
      if (location.hash === '#place') {
        const pen = document.getElementById('lv-edit-dot');
        if (pen) {
          const sec = document.getElementById('wayback');
          if (sec) sec.scrollIntoView();
          pen.click();
        }
      }
    });
  }

  function bootLive() {
    say('loading the map…');
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/maplibre-gl.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = '/vendor/maplibre-gl.js';
    s.onload = initLive;
    s.onerror = () => say('maplibre failed to load');
    document.head.appendChild(s);
  }

  if (tabs && liveWrap) {
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]');
      if (!b) return;
      for (const x of tabs.querySelectorAll('button')) {
        x.setAttribute('aria-selected', String(x === b));
      }
      const live = b.dataset.t === 'live';
      liveWrap.hidden = !live;
      host.hidden = live;
      if (live && lm) lm.resize();
      if (!live) draw();     // the archive redraws itself at its revealed size
    });
    bootLive();              // the live map is the default tab
  }
})();
