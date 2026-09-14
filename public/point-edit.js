// The dropped-point page's client half: choose a kind, type the fields, save.
//
// Every write goes to POST /api/point/<id>, which validates against the same
// table that rendered the form — so the two cannot drift about what a kind is
// or which fields it has.
(() => {
  const kinds = document.getElementById('pt-kinds');
  const form = document.getElementById('ptform');
  const id = (form && form.dataset.point)
    || (location.pathname.match(/\/point\/(pt-[\w-]+)/) || [])[1];
  if (!id) return;

  const post = async (body) => {
    const r = await fetch('/api/point/' + encodeURIComponent(id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || ('HTTP ' + r.status));
    return out;
  };

  // Choosing a kind reloads, because the whole page - the form, the heading,
  // the lede - is a function of it. Re-rendering that in the client would be
  // a second copy of the server's template waiting to disagree with it.
  if (kinds) {
    kinds.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      for (const x of kinds.querySelectorAll('button')) x.disabled = true;
      try { await post({ kind: b.dataset.k }); location.reload(); }
      catch (err) {
        for (const x of kinds.querySelectorAll('button')) x.disabled = false;
        alert('could not set the kind: ' + err.message);
      }
    });
  }

  // Suggestions for the boxes that have a datalist, from the same payload the
  // site and asset forms use.
  if (form && form.querySelector('datalist')) {
    fetch('/data/edit_options.json').then(r => r.json()).then((opt) => {
      const fill = (dl, values, labelled) => {
        if (!dl || !values) return;
        for (const v of values) {
          const o = document.createElement('option');
          if (labelled) { o.value = v[0]; o.label = v[1]; } else { o.value = v; }
          dl.appendChild(o);
        }
      };
      fill(document.getElementById('dl-operator'), opt.operator);
      fill(document.getElementById('dl-fab_op'), opt.fab_op);
      fill(document.getElementById('dl-country'), opt.country, true);
      const city = document.getElementById('dl-city');
      if (city && opt.city) {
        const seen = new Set();
        for (const k in opt.city) for (const c of opt.city[k]) seen.add(c);
        fill(city, [...seen].sort((a, b) => a.localeCompare(b)));
      }
    }).catch(() => { /* a convenience; the form works without it */ });
  }

  if (form) {
    const msg = document.getElementById('pt-msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fields = {};
      for (const el of form.querySelectorAll('[name]')) fields[el.name] = el.value.trim();
      msg.textContent = 'saving…';
      try {
        await post({ fields, note: document.getElementById('pt-note').value });
        msg.textContent = 'saved — reloading';
        location.reload();
      } catch (err) { msg.textContent = 'failed: ' + err.message; }
    });
  }

  const del = document.getElementById('pt-del');
  if (del) {
    const dmsg = document.getElementById('pt-delmsg');
    del.addEventListener('click', async () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'Really delete this point?';
        return;
      }
      del.disabled = true;
      try { await post({ delete: true }); location.href = '/'; }
      catch (err) { del.disabled = false; dmsg.textContent = 'failed: ' + err.message; }
    });
  }
})();
