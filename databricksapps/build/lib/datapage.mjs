// /data — what changed in the registry, and what to run next.
//
// Every other page here is about the world: data centres, plants, substations,
// what fails together. This one is about the REGISTRY ITSELF - the only page
// whose subject is the repository rather than the ground.
//
// It exists because "what changed today" had no answer short of reading git by
// hand, and because the answer lives in three places at once (see
// lib/datachanges.mjs). The page keeps those three apart on purpose rather
// than blending them into one feed: a commit carries a reason, a ledger row
// carries a timestamp and no reason, and a touched file carries neither. They
// are different strengths of evidence about the same question and a single
// merged list would quietly launder the weakest into looking like the
// strongest - the same discipline the dependency layer runs on.

import { esc, n0, tile, page } from './summary.mjs';
import { STEPS } from './pipeline.mjs';

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

const hhmm = (iso) => (iso || '').slice(11, 16);
const dayOf = (iso) => (iso || '').slice(0, 10);

// +14 −3, in the app's numeric register. Binary files report neither, and say
// so rather than showing 0 which would read as "nothing changed".
const delta = (f) => (f.binary
  ? '<span class="dim">binary</span>'
  : `<span class="add">+${n0(f.added)}</span> <span class="del">−${n0(f.removed)}</span>`);

export function renderDataPage({ days = 1, commits = [], pending = [], ledgers = [],
                                 raw = [], running = null, history = [], sinceDay,
                                 freshness = [], pipelineAvailable = true, blindSpots = [] }) {
  const fileChanges = commits.reduce((t, c) => t + c.files.length, 0);
  const touchedPaths = new Set(commits.flatMap(c => c.files.map(f => f.path)));
  const ledgerRows = ledgers.reduce((t, l) => t + l.recent.length, 0);
  const rangeLabel = (RANGES.find(r => r.days === days) || RANGES[0]).label.toLowerCase();

  const ranges = RANGES.map(r => `<a class="tb-btn${r.days === days ? ' on' : ''}"
    href="/data?days=${r.days}">${esc(r.label)}</a>`).join('');

  // ---- committed changes, grouped by the commit that explains them --------
  const commitBlocks = commits.map(c => `
    <div class="chg">
      <div class="chg-head">
        <span class="chg-when mono">${esc(dayOf(c.when))} ${esc(hhmm(c.when))}</span>
        <span class="chg-subject">${esc(c.subject)}</span>
        <span class="chg-meta mono dim">${esc(c.short)} · ${esc(c.who)}</span>
      </div>
      <table class="chg-files"><tbody>
        ${c.files.map(f => `<tr>
          <td class="mono">${esc(f.path.replace(/^data\//, ''))}</td>
          <td class="num">${delta(f)}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>`).join('');

  const changes = `
  <section class="panel card" id="changes">
    <div class="chain-head">
      <h2>Committed changes — ${n0(fileChanges)}</h2>
      <span class="seg">${ranges}</span>
    </div>
    <p class="note">${commits.length
      ? `${n0(fileChanges)} file change${fileChanges === 1 ? '' : 's'} across
         <b>${n0(commits.length)}</b> commit${commits.length === 1 ? '' : 's'},
         touching ${n0(touchedPaths.size)} distinct file${touchedPaths.size === 1 ? '' : 's'}.
         This is the only record here that also says <em>why</em>: for a derived
         file the commit message is the difference between “footprints changed”
         and “footprints changed because the Epoch release landed”.`
      : `Nothing under <span class="mono">data/</span> was committed in the last
         ${esc(rangeLabel)}. That is not the same as nothing happening — see the
         two sections below.`}</p>
    ${commitBlocks}
  </section>`;

  // ---- live ledger writes -------------------------------------------------
  const ledgerRowsHtml = ledgers.filter(l => l.recent.length).map(l => `
    <div class="chg">
      <div class="chg-head">
        <span class="chg-subject">${esc(l.label)}</span>
        <span class="chg-meta mono dim">${esc(l.file.replace(/^data\//, ''))} ·
          ${n0(l.recent.length)} of ${n0(l.total)}</span>
      </div>
      <table class="chg-files"><tbody>
        ${l.recent.slice(0, 40).map(r => `<tr>
          <td class="mono">${esc(r.id || '—')}</td>
          <td class="dim">${esc((r.note || '').slice(0, 90))}</td>
          <td class="num mono dim">${esc(dayOf(r.when))} ${esc(hhmm(r.when))}</td>
        </tr>`).join('')}
      </tbody></table>
      ${l.recent.length > 40 ? `<p class="note">…and ${n0(l.recent.length - 40)} more.</p>` : ''}
    </div>`).join('');

  const unstamped = ledgers.filter(l => l.unstamped);
  const ledgerSection = `
  <section class="panel card" id="ledgers">
    <h2>Hand edits — ${n0(ledgerRows)}</h2>
    <p class="note">Rows the app appended to a source ledger, by the ledger's own
    timestamp. These are shown separately because they can sit <em>uncommitted</em>
    for days: git would report one dirty file, while the ledger records the
    several separate decisions inside it. A row here and a commit above can be
    the same change seen twice.</p>
    ${ledgerRowsHtml || `<p class="note">No ledger row is stamped in the last
      ${esc(rangeLabel)}.</p>`}
    ${unstamped.length ? `<p class="note"><b>Not covered:</b>
      ${unstamped.map(l => `<span class="mono">${esc(l.file.replace(/^data\//, ''))}</span>`).join(', ')}
      ${unstamped.length === 1 ? 'has' : 'have'} no timestamp column at all, so changes to
      ${unstamped.length === 1 ? 'it' : 'them'} are only ever visible in git. Counted in the
      commits above, invisible here.</p>` : ''}
  </section>

  ${freshness.length ? `<section class="panel card" id="freshness">
    <h2>How fresh is each source</h2>
    <p class="note">One row per pipeline step, dated by the newest file among the
    outputs the step itself declares — there is no second list to drift. Age is
    honest staleness only for the FETCH steps; a derive step is as fresh as its
    last rebuild, however old its inputs. Thirty days is the line only because
    OpenStreetMap moved under this registry twice in six weeks once.</p>
    <div class="tablewrap"><table>
      <tr><th>Step</th><th>Group</th><th>Newest output</th><th>Age</th></tr>
      ${freshness.map(f => `<tr>
        <td><b>${esc(f.label)}</b></td>
        <td class="dim">${esc(f.group)}</td>
        <td class="dim">${f.newest ? new Date(f.newest).toISOString().slice(0, 10) : 'never ran here'}</td>
        <td class="num${f.ageDays != null && f.ageDays > 30 ? ' stale-age' : ''}">${
          f.ageDays == null ? '—'
          : f.ageDays < 1 ? 'today'
          : Math.round(f.ageDays) + 'd'}</td>
      </tr>`).join('')}
    </table></div>
  </section>` : ''}

  <section class="panel card" id="blind">
    <h2>What this page cannot see</h2>
    <p class="note">An empty section is a claim, so these are the writes that leave
    no trace this page could find. Each is a real hole, not a rounding error — if a
    change was made one of these ways, nothing above will show it.</p>
    <table class="chg-files"><tbody>
      ${blindSpots.map(b => `<tr>
        <td><b>${esc(b.what)}</b></td>
        <td class="dim">${esc(b.why)}</td>
      </tr>`).join('')}
    </tbody></table>
  </section>`;

  // ---- uncommitted --------------------------------------------------------
  const pendingSection = `
  <section class="panel card" id="pending">
    <h2>Uncommitted — ${n0(pending.length)}</h2>
    <p class="note">Changed on disk and not yet committed. For a derived file this
    usually means a pipeline step was run and its result has not been looked at
    yet; the change has no stated reason until someone writes one.</p>
    ${pending.length ? `<table class="chg-files"><tbody>
      ${pending.map(p => `<tr>
        <td class="mono">${esc(p.path.replace(/^data\//, ''))}</td>
        <td class="dim">${esc(p.state)}</td>
      </tr>`).join('')}
    </tbody></table>` : '<p class="note">Working tree is clean.</p>'}
  </section>`;

  // ---- gitignored ---------------------------------------------------------
  const rawSection = `
  <section class="panel card" id="raw">
    <h2>Outside git — ${n0(raw.length)}</h2>
    <p class="note">Vendor caches and raw upstream downloads under
    <span class="mono">data/raw/</span>, which is gitignored and must stay so —
    it holds the API tokens. No history and no per-record stamp, so a file
    modification time is the only evidence there is. It is the weakest thing on
    this page and is kept apart for that reason: “the file was touched” is a far
    smaller claim than “this commit changed these lines for this reason”.</p>
    ${raw.length ? `<table class="chg-files"><tbody>
      ${raw.map(r => `<tr>
        <td class="mono">${esc(r.label)}</td>
        <td class="dim">${esc(r.detail)}</td>
        <td class="num mono dim">${esc(dayOf(r.when))} ${esc(hhmm(r.when))}</td>
      </tr>`).join('')}
    </tbody></table>` : `<p class="note">Nothing under data/raw/ touched in the last
      ${esc(rangeLabel)}.</p>`}
  </section>`;

  // ---- run ----------------------------------------------------------------
  const groups = [...new Set(STEPS.map(s => s.group))];
  const runSection = `
  <section class="panel card" id="run">
    <h2>Run a step</h2>
    <p class="note">The pipeline, in the order it runs. Each button says what the
    step overwrites <em>before</em> you press it. One run at a time, because these
    steps write the same derived files and two at once would interleave into a
    file that was never anybody's output.</p>
    <p class="note"><b>Paid steps are marked.</b> Regrid and Precisely bill per
    parcel returned, so they ask twice before spending. Running is available only
    from this machine — the server listens on every interface, and a page that
    starts processes must not be one a stranger on the network can reach.</p>
    <div class="run-status" id="run-status" ${running ? '' : 'hidden'}>
      ${running ? `<b>Running:</b> ${esc(running.label)}
        <span class="mono dim">since ${esc(hhmm(running.started))}</span>` : ''}
    </div>
    ${pipelineAvailable ? '' : `<p class="note"><b>The pipeline is not on this server.</b>
      dcmap/ is the web app and runs on its own; the scripts that regenerate its data
      live beside it (../src, or $DCMAP_PIPELINE) and are not here, so nothing below
      can be run from this page.</p>`}
    <pre class="run-log" id="run-log" hidden></pre>
    ${groups.map(g => `
      <h3 class="run-grp">${esc(g)}</h3>
      <div class="run-row">
        ${STEPS.filter(s => s.group === g).map(s => `
          <button type="button" class="tb-btn run-btn" data-key="${esc(s.key)}"${pipelineAvailable ? '' : ' disabled'}
            data-cost="${esc(s.cost)}" data-label="${esc(s.label)}"
            data-writes="${esc((s.writes || []).join(', '))}"
            title="${esc((s.about || '') + ' Writes: ' + (s.writes || []).join(', '))}">
            ${esc(s.label)}${s.cost === 'paid' ? ' <span class="cost">costs money</span>' : ''}
          </button>`).join('')}
      </div>`).join('')}
    ${history.length ? `<h3 class="run-grp">Recent runs</h3>
      <table class="chg-files"><tbody>
        ${history.map(h => `<tr>
          <td class="mono">${esc(h.key)}</td>
          <td class="dim">${esc(dayOf(h.started))} ${esc(hhmm(h.started))}</td>
          <td class="dim">${h.code === 0 ? 'ok' : 'exit ' + esc(String(h.code))}</td>
          <td><a class="pop-open" href="/api/data/run/${esc(h.id)}">log</a></td>
        </tr>`).join('')}
      </tbody></table>` : ''}
  </section>`;

  const tiles = [
    tile('Committed changes', n0(fileChanges), `${n0(commits.length)} commit${commits.length === 1 ? '' : 's'}`),
    tile('Hand edits', n0(ledgerRows), 'rows stamped by the app'),
    tile('Uncommitted', n0(pending.length), pending.length ? 'no stated reason yet' : 'working tree clean'),
    tile('Outside git', n0(raw.length), 'mtime only — weakest evidence'),
  ].join('');

  const body = `
  <section class="panel card">
    <div class="fabtiles">${tiles}</div>
    <p class="note">Three records of the same question, kept apart because they are
    different strengths of evidence: a commit carries a reason, a ledger row carries
    a timestamp and no reason, and a touched file carries neither. Blending them
    into one feed would let the weakest borrow the authority of the strongest.</p>
  </section>
  ${changes}
  ${ledgerSection}
  ${pendingSection}
  ${rawSection}
  ${runSection}
  <script src="/dataadmin.js" defer></script>`;

  return page({
    title: 'Data',
    crumb: 'Data',
    lede: `Everything that changed since ${esc(sinceDay)}, and the pipeline that changes it`,
    note: '<a href="/footprints">Footprint coverage by source and licence</a>'
        + ' · <a href="/power">The dependency ledger</a>',
    body,
  });
}
