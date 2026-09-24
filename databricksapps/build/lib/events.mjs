// Simulated events: the earthquake layer's shape, pointed the other way.
//
// A quake in this registry is a thing that HAPPENED - USGS says so, and the
// page reports it. An event here is a thing somebody is asking about: put a
// failure at this coordinate, reaching this far, and tell me what is behind
// it. Same geometry, opposite epistemic direction, and the difference is
// stated everywhere it could be mistaken - an event page never reads as a
// report of anything real.
//
// What makes it worth having is that the answer is not a map query. Asking
// "which mega-loads lose their supply" means walking the dependency ledger:
// the substations inside the radius, the loads filed behind THOSE substations,
// physical edges only, deduplicated across queue positions. That is links one
// to four of the accumulation chain, computed live for an arbitrary failure.

export const EVENT_ID_RE = /^ev-[a-z0-9][\w-]{0,40}$/;

// Deliberately few, and none of them a peril model. This layer answers "what
// is behind the thing that failed", so the kinds are shapes of failure, not
// causes of it - a substation fire and a flood that reaches the same
// switchyard produce the same dependency answer.
export const EVENT_KINDS = {
  outage: {
    label: 'Supply outage',
    blurb: 'Everything inside the radius stops delivering. The bluntest and most '
         + 'useful shape: it asks what depends on this ground, not why it failed.',
  },
  substation: {
    label: 'Substation failure',
    blurb: 'Only substations inside the radius fail. Generation keeps running and '
         + 'the grid keeps carrying — the loss is the switchyard, which is the '
         + 'correlation this registry can actually evidence.',
  },
  generation: {
    label: 'Generation loss',
    blurb: 'Only generators inside the radius stop. On an interconnected grid this '
         + 'is usually a market event rather than an outage, so the exposure it '
         + 'reports is contractual and behind-the-meter load, not everyone nearby.',
  },
};

export const DEFAULT_RADIUS_KM = 25;
export const MAX_RADIUS_KM = 400;

export function eventErrors(e) {
  const bad = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  if (!EVENT_ID_RE.test(e.id || '')) bad.push(`id ${JSON.stringify(e.id)} is not an event id`);
  for (const k of ['lat', 'lon']) {
    const v = e[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) { bad.push(`${k} must be a number`); continue; }
    if (k === 'lat' && (v < -90 || v > 90)) bad.push('latitude out of range');
    if (k === 'lon' && (v < -180 || v > 180)) bad.push('longitude out of range');
  }
  if (!EVENT_KINDS[e.kind]) bad.push(`kind ${JSON.stringify(e.kind)}`);
  const r = e.radius_km;
  if (typeof r !== 'number' || !(r > 0) || r > MAX_RADIUS_KM) {
    bad.push(`radius_km must be a number between 0 and ${MAX_RADIUS_KM}`);
  }
  return bad;
}

// Which dependency points the event takes out, given its kind.
const takes = (kind, a) => (
  kind === 'outage' ? true
  : kind === 'substation' ? a.kind === 'substation'
  : a.kind === 'plant');

// The accumulation, computed against the ledger rather than against geometry.
//
// Two deduplications matter and both were bugs before they were rules: an
// asset behind TWO substations inside the radius is one exposed asset, not
// two; and one asset holding two queue positions into one substation is one
// asset whose megawatts add. Get either wrong and the headline number is
// inflated in a way that reads as precision.
export function eventExposure({ ev, accumulation, kmBetween }) {
  const hits = [];
  for (const a of accumulation) {
    if (a.lat == null || a.lon == null) continue;
    if (!takes(ev.kind, a)) continue;
    const km = kmBetween(ev.lon, ev.lat, a.lon, a.lat);
    if (km > ev.radius_km) continue;
    hits.push({ ...a, km: +km.toFixed(2) });
  }
  hits.sort((x, y) => x.km - y.km);

  const byAsset = new Map();
  let minConf = 1;
  // Chain links 5 and 6: how many touched edges have their resilience fields
  // ESTABLISHED rather than defaulted. Counted here so the event page reports
  // what the ledger holds instead of a hard-coded "set on none of them".
  const resil = { edges: 0, feedSet: 0, feedNone: 0, backupSet: 0, hoursSet: 0 };
  for (const h of hits) {
    for (const e of h.edges) {
      resil.edges++;
      if (e.secondary_feed != null) {
        resil.feedSet++;
        if (e.secondary_feed === 'none') resil.feedNone++;
      }
      if (e.backup_power && e.backup_power !== 'unknown') resil.backupSet++;
      if (e.backup_hours != null) resil.hoursSet++;
      const cur = byAsset.get(e.asset_id) || {
        id: e.asset_id,
        name: e.load ? e.load.name : (e.assetName || e.asset_id),
        registry: !e.asset_id.startsWith('load-'),
        mw: 0, via: new Set(), rels: new Set(), seenRefs: new Set(),
      };
      // Megawatts belong to the FILING, not to each point it names. One
      // queue position listing three substations is 50 MW of exposure, not
      // 150 - and the same asset holding two distinct queue positions into
      // one substation genuinely adds. Keying on the filing gets both right;
      // summing edges got the first one wrong by a factor of three.
      const ref = e.src_ref || (e.asset_id + ':' + h.id);
      if (!cur.seenRefs.has(ref)) {
        cur.seenRefs.add(ref);
        cur.mw += e.mw || 0;
      }
      cur.via.add(h.name);
      cur.rels.add(e.relationship);
      byAsset.set(e.asset_id, cur);
      if (e.confidence != null && e.confidence < minConf) minConf = e.confidence;
    }
  }
  const loads = [...byAsset.values()]
    .map(({ seenRefs, ...l }) => ({ ...l, via: [...l.via], rels: [...l.rels],
                                    filings: seenRefs.size }))
    .sort((a, b) => b.mw - a.mw);

  return {
    points: hits,
    loads,
    mw: loads.reduce((t, l) => t + l.mw, 0),
    registryLoads: loads.filter(l => l.registry).length,
    filedLoads: loads.filter(l => !l.registry).length,
    minConfidence: hits.length ? minConf : null,
    resil,
  };
}
