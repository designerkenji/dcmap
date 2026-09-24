// The PowerDependency layer: what a mega-asset depends on to stay powered.
//
// WHY THIS IS NOT "which plant powers this data centre". On an interconnected
// AC grid, generation is pooled. Losing one plant does not black out one
// campus - the market redispatches and the lights stay on. Anyone who draws a
// line from a plant to a data centre and calls it supply has drawn a picture,
// not a dependency.
//
// What DOES concentrate risk, and what this layer records:
//
//   1. A shared SUBSTATION. Two campuses behind the same substation share a
//      real single point of failure - a transformer bank, a bus, a switchyard
//      fire. This is the edge that matters most and the hardest to source.
//   2. A shared IMPORT PATH into a constrained load pocket. The pool argument
//      stops at the transfer limit: inside a pocket, the lines in are the
//      supply.
//   3. A DEDICATED arrangement - behind-the-meter or a direct connection -
//      where one generator genuinely is the supply.
//   4. Shared FUEL. Gas plants on one pipeline lateral fail together in a
//      freeze, however many separate substations sit downstream.
//
// A front-of-meter contract (a PPA) is NONE of these. It is a financial
// hedge; the electrons do not follow the paperwork. It is recorded here
// because people cite it as supply, and the layer's job is to say plainly
// that it is not.
//
// The ledger is data/power_dependencies.json, one entry per dependency edge,
// hand-researched or machine-proposed but always evidence-bearing. Nothing
// enters it without a source that a reader can check.

// What flows along the edge. Electricity is the layer's reason to exist; the
// others are here because a fab that loses process water or a campus that
// loses its fibre ring is down just as hard, and the graph should be able to
// say so when someone does that research.
export const DEP_TYPE = {
  electricity: { label: 'Electricity' },
  gas:         { label: 'Natural gas' },
  water:       { label: 'Water' },
  fibre:       { label: 'Fibre' },
};

// How the two ends stand to each other. The split that matters is PHYSICAL
// (a path the power actually takes) versus CONTRACTUAL (an accounting
// relationship), because only the first one fails when equipment fails.
export const DEP_RELATION = {
  primary_feed: {
    label: 'Primary feed', physical: true,
    blurb: 'The path the load is normally served from. Losing it drops the '
         + 'load unless a second feed or on-site generation carries it.',
  },
  secondary_feed: {
    label: 'Secondary feed', physical: true,
    blurb: 'A redundant path. Its value depends on being independent of the '
         + 'primary - two feeds off one substation share the substation.',
  },
  behind_meter: {
    label: 'Behind the meter', physical: true,
    blurb: 'The load sits on the generator’s side of the point of '
         + 'interconnection. Here the generator really is the supply.',
  },
  net_metered: {
    label: 'Net-metered co-location', physical: true,
    blurb: 'Paired with the generator and settled net of its output, but '
         + 'still grid-connected and curtailable.',
  },
  generation_source: {
    label: 'Injects into', physical: true,
    blurb: 'A plant delivering into a substation or switchyard. Generation '
         + 'side of the graph, not a claim about any particular load.',
  },
  transmission_path: {
    label: 'Transmission path', physical: true,
    blurb: 'A line between two substations. Carries a voltage and a limit; '
         + 'inside a constrained pocket it is the supply.',
  },
  contract: {
    label: 'Front-of-meter contract', physical: false,
    blurb: 'The plant sells to the grid and the load buys from it on paper. '
         + 'Contractual, not physical — the electrons do not follow, and '
         + 'this edge carries NO outage correlation.',
  },
  announced: {
    label: 'Announced only', physical: false,
    blurb: 'Reported or filed, not operating. The structure may still change '
         + 'and the pairing may never be built.',
  },
};

// How we know, and what that class of knowing is worth.
//
// The confidence numbers are DEFAULTS PER EVIDENCE CLASS, not per-edge
// intuitions. An analyst who wants a different number for one edge must say
// why in `confidence_note` - otherwise every number here is reproducible from
// the evidence class alone, which is the only way a confidence column stays
// honest at scale. Two decimals is the most any of this deserves; the bands
// are wide on purpose.
export const DEP_EVIDENCE = {
  interconnection_agreement: {
    label: 'Interconnection agreement', confidence: 0.95,
    blurb: 'An executed agreement naming the point of interconnection. The '
         + 'strongest thing short of standing in the switchyard.',
  },
  utility_filing: {
    label: 'Utility filing', confidence: 0.95,
    blurb: 'A filed document naming both ends — a rate case, a certificate '
         + 'application, a service agreement.',
  },
  regulatory_docket: {
    label: 'Regulatory docket', confidence: 0.90,
    blurb: 'Commission proceedings where the load and its infrastructure are '
         + 'named in evidence.',
  },
  iso_planning: {
    label: 'ISO planning document', confidence: 0.85,
    blurb: 'An RTO planning need or supplemental project naming a substation '
         + 'and the load driving it. Real documents, but loads get restated '
         + 'between meetings and attribution can move.',
  },
  imagery: {
    label: 'Imagery', confidence: 0.80,
    blurb: 'A dedicated line or an on-site substation visible on the '
         + 'imagery, checked by a person against the parcel.',
  },
  operator_statement: {
    label: 'Operator statement', confidence: 0.75,
    blurb: 'The operator or utility says so in its own material. Rarely '
         + 'wrong about the fact, often vague about the structure.',
  },
  osm_topology: {
    label: 'Mapped topology', confidence: 0.65,
    blurb: 'OpenStreetMap power lines and substations. Real surveyed '
         + 'geometry where it exists; completeness varies by country and the '
         + 'absence of a line means nothing.',
  },
  press_report: {
    label: 'Press report', confidence: 0.55,
    blurb: 'Trade or local press. Usually right that something is happening, '
         + 'frequently wrong about which asset and how it is wired.',
  },
  proximity: {
    label: 'Proximity only', confidence: 0.35,
    blurb: 'The nearest substation of a plausible voltage. A hypothesis to '
         + 'be checked, never a finding — the nearest substation is often '
         + 'not the serving one.',
  },
  zonal: {
    label: 'Same zone only', confidence: 0.15,
    blurb: 'Both ends sit in one balancing authority or load zone. Says '
         + 'something about market and scarcity exposure, nothing about '
         + 'shared equipment.',
  },
};

// Backup: the other half of an accumulation answer. A campus behind one
// substation with 72 hours of fuel is a different risk from the same campus
// with none, and the difference is the whole underwriting question.
export const BACKUP_STATE = {
  yes:     { label: 'Yes' },
  no:      { label: 'No' },
  partial: { label: 'Partial', blurb: 'Covers some of the load, or some of the halls.' },
  unknown: { label: 'Unknown', blurb: 'Not researched. The common case — say so rather than assume.' },
};

// A dependency edge is between two things the registry can name. Loads are
// registry sites (site-…), fabs (f…) and plants (e…/g…) when a plant is
// itself the dependent thing; dependency ends add substations (sub-…) and
// corridors (corr-…), which this layer mints.
export const SUB_ID_RE  = /^sub-[a-z0-9][\w.-]{0,60}$/;
export const CORR_ID_RE = /^corr-[a-z0-9][\w.-]{0,60}$/;
// A load that is filed and named but is not a registry asset - a queue
// position for a campus nobody has built yet. Kept as a first-class node
// because accumulation is about what will share the substation, and the
// alternative is throwing away the filings that say so. Same reasoning as
// the announced-campus entries in dc_plant_links.json.
export const LOAD_ID_RE = /^load-[a-z0-9][\w.-]{0,60}$/;

export const isAssetId = (id) => typeof id === 'string'
  && (/^site-[a-z0-9-]+$/.test(id) || /^[efg]\w+$/.test(id) || LOAD_ID_RE.test(id));
export const isRegistryId = (id) => typeof id === 'string'
  && (/^site-[a-z0-9-]+$/.test(id) || /^[efg]\w+$/.test(id));
export const isDepId = (id) => typeof id === 'string'
  && (isAssetId(id) || SUB_ID_RE.test(id) || CORR_ID_RE.test(id));

// The confidence an entry gets: its own if it argued for one, otherwise the
// evidence class's. Kept in one place so the ledger and the pages can never
// disagree about what a number means.
export function confidenceOf(entry) {
  if (typeof entry.confidence === 'number') return entry.confidence;
  const ev = DEP_EVIDENCE[entry.evidence];
  return ev ? ev.confidence : null;
}

// Validation is a list of complaints, not a throw: one malformed entry must
// never cost the registry the other three hundred. The loader logs these and
// drops the entry.
export function depErrors(e) {
  const bad = [];
  if (!e || typeof e !== 'object') return ['not an object'];
  if (!isAssetId(e.asset_id)) bad.push(`asset_id ${JSON.stringify(e.asset_id)} is not a registry id`);
  if (!isDepId(e.dependency_asset_id)) {
    bad.push(`dependency_asset_id ${JSON.stringify(e.dependency_asset_id)} is not a known id shape`);
  }
  if (e.asset_id === e.dependency_asset_id) bad.push('an asset cannot depend on itself');
  if (!DEP_TYPE[e.dependency_type]) bad.push(`dependency_type ${JSON.stringify(e.dependency_type)}`);
  if (!DEP_RELATION[e.relationship]) bad.push(`relationship ${JSON.stringify(e.relationship)}`);
  if (!DEP_EVIDENCE[e.evidence]) bad.push(`evidence ${JSON.stringify(e.evidence)}`);
  if (e.confidence != null) {
    if (typeof e.confidence !== 'number' || e.confidence < 0 || e.confidence > 1) {
      bad.push('confidence must be a number between 0 and 1');
    } else if (!e.confidence_note) {
      // Overriding the class default without saying why is how a confidence
      // column turns into decoration.
      bad.push('a confidence that differs from the evidence class needs a confidence_note');
    }
  }
  if (e.backup_power != null && !BACKUP_STATE[e.backup_power]) {
    bad.push(`backup_power ${JSON.stringify(e.backup_power)}`);
  }
  if (e.backup_hours != null && !(typeof e.backup_hours === 'number' && e.backup_hours >= 0)) {
    bad.push('backup_hours must be a non-negative number of hours');
  }
  // 'none' is researched absence - a person established there is NO second
  // feed, which is the fact that turns "exposed" into "lost". Null stays
  // "not researched"; an id names the redundant path's dependency (the same
  // substation is a legal answer: it says the two feeds share it).
  if (e.secondary_feed != null && e.secondary_feed !== 'none' && !isDepId(e.secondary_feed)) {
    bad.push(`secondary_feed ${JSON.stringify(e.secondary_feed)} is not 'none' or a known id shape`);
  }
  // Physical edges are the ones that carry outage correlation, so they are
  // the ones that have to be sourced. A contract may cite a press report; a
  // primary feed may not.
  const rel = DEP_RELATION[e.relationship];
  if (rel && rel.physical && !e.url && !e.note) {
    bad.push('a physical dependency needs a url or a note saying how it is known');
  }
  return bad;
}

// Everything the pages need to talk about one edge, resolved once here.
export function describeDep(e) {
  const rel = DEP_RELATION[e.relationship] || null;
  const ev = DEP_EVIDENCE[e.evidence] || null;
  const c = confidenceOf(e);
  return {
    ...e,
    rel, ev,
    confidence: c,
    physical: !!(rel && rel.physical),
    // The one-line reading of the edge, in the register the rest of the
    // registry uses: what it is, how we know, how sure.
    summary: [rel ? rel.label : e.relationship,
              ev ? 'per ' + ev.label.toLowerCase() : null,
              c == null ? null : 'confidence ' + c.toFixed(2)].filter(Boolean).join(' · '),
  };
}
