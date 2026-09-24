// /data — starting a pipeline step and watching it run.
//
// Deliberately small: the page is server-rendered and this only drives the run
// buttons. A step that costs money is confirmed HERE as well as refused by the
// server without an explicit flag, so the guard survives someone poking the
// endpoint directly and the person clicking still gets told first.
(() => {
  const statusEl = document.getElementById('run-status');
  const logEl = document.getElementById('run-log');
  const btns = [...document.querySelectorAll('.run-btn')];
  if (!btns.length) return;

  let pollTimer = null;

  const setBusy = (on) => btns.forEach(b => { b.disabled = on; });

  function say(html) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.innerHTML = html;
  }

  async function poll(id) {
    let r;
    try { r = await fetch('/api/data/run/' + encodeURIComponent(id)); }
    catch { return; }
    if (!r.ok) return;
    const t = await r.json();
    if (logEl) {
      logEl.hidden = false;
      logEl.textContent = t.text || '(no output yet)';
      logEl.scrollTop = logEl.scrollHeight;
    }
    if (t.running) {
      say('<b>Running:</b> ' + esc(t.key) + ' <span class="dim mono">since '
        + esc((t.started || '').slice(11, 16)) + '</span>'
        + ' <button type="button" class="tb-btn" id="run-stop">Stop</button>');
      const stop = document.getElementById('run-stop');
      if (stop) {
        stop.onclick = () => fetch('/api/data/run/' + encodeURIComponent(id), { method: 'POST' });
      }
      return;
    }
    clearInterval(pollTimer); pollTimer = null;
    setBusy(false);
    const ok = t.code === 0;
    say((ok ? '<b>Finished:</b> ' : '<b>Failed:</b> ') + esc(t.key)
      + (ok ? '' : ' <span class="dim">exit ' + esc(String(t.code)) + '</span>')
      + ' — <a href="/data">reload the page</a> to see what changed.');
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  for (const b of btns) {
    b.addEventListener('click', async () => {
      const paid = b.dataset.cost === 'paid';
      const writes = b.dataset.writes || '(nothing recorded)';
      // Two different questions, asked in the right order: what will this
      // overwrite, and — only for the vendor steps — is spending money
      // intended. A free step is not worth a dialog about money it will not
      // spend.
      const msg = paid
        ? 'This step calls a paid vendor API and is billed per record returned.\n\n'
          + b.dataset.label + '\nWrites: ' + writes
          + '\n\nCached items are never re-asked and empty answers are free, but new '
          + 'answers cost. Run it?'
        : b.dataset.label + '\n\nOverwrites: ' + writes + '\n\nRun it?';
      if (!confirm(msg)) return;

      setBusy(true);
      say('starting…');
      let r;
      try {
        r = await fetch('/api/data/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: b.dataset.key, confirm: paid }),
        });
      } catch (err) {
        setBusy(false); say('could not start: ' + esc(err.message)); return;
      }
      const out = await r.json();
      if (!r.ok) {
        setBusy(false);
        say('not started: ' + esc(out.error || r.status));
        return;
      }
      if (logEl) { logEl.hidden = false; logEl.textContent = ''; }
      poll(out.id);
      pollTimer = setInterval(() => poll(out.id), 1500);
    });
  }
})();
