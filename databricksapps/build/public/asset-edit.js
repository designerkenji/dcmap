// The dot pages' correction form - the site page's pen, aligned: toggle from
// the header, post only what changed, land in data/asset_overrides.csv via
// POST /api/asset/<id>. The form itself is generated server-side from the
// same field tables the server validates against, so the two cannot drift.
(() => {
  const form = document.getElementById('editform');
  const open = document.getElementById('edit-open');
  if (!form || !open) return;
  const msg = document.getElementById('ed-msg');
  const ASSET = form.dataset.asset;
  const toggle = (on) => {
    form.hidden = !on;
    open.setAttribute('aria-pressed', String(on));
    open.title = on ? 'Close the edit form' : 'Correct these details';
  };

  // Existing registry values as type-ahead suggestions, fetched on the pen's
  // first click: fab operators from the fab list, countries with their names.
  // Same contract as the site form - the list nudges toward existing
  // spellings, anything new can still be typed.
  let optsWired = false;
  async function loadOptions() {
    if (optsWired) return;
    if (!form.querySelector('datalist')) return;   // plant forms have no suggest fields
    optsWired = true;
    let opt;
    try { opt = await (await fetch('/data/edit_options.json')).json(); }
    catch { optsWired = false; return; }   // a convenience failed; retry next click
    const dlOp = document.getElementById('dl-op');
    if (dlOp) {
      for (const v of opt.fab_op || []) {
        const o = document.createElement('option');
        o.value = v;
        dlOp.appendChild(o);
      }
    }
    const dlCy = document.getElementById('dl-cy');
    if (dlCy) {
      for (const c of opt.country || []) {
        const o = document.createElement('option');
        o.value = c[0];    // the two-letter code is what saves
        o.label = c[1];    // the English name is what a person recognises
        dlCy.appendChild(o);
      }
    }
  }

  open.addEventListener('click', () => {
    if (form.hidden) loadOptions();
    toggle(form.hidden);
  });
  document.getElementById('edit-cancel').addEventListener('click', () => {
    form.reset(); msg.textContent = ''; toggle(false);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = {};
    for (const el of form.querySelectorAll('input[name]')) fields[el.name] = el.value.trim();
    msg.textContent = 'saving…';
    try {
      const r = await fetch('/api/asset/' + encodeURIComponent(ASSET), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, note: document.getElementById('ed-note').value }),
      });
      const out = await r.json();
      if (!r.ok) { msg.textContent = out.error || ('failed: ' + r.status); return; }
      if (!out.saved) { msg.textContent = 'nothing changed'; return; }
      msg.textContent = 'saved — reloading';
      location.reload();
    } catch (err) { msg.textContent = 'failed: ' + err.message; }
  });
})();
