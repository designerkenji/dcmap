// Expand / collapse every link in the accumulation chain at once.
//
// The individual links are native <details>, so they already open on click and
// on Enter without any of this. All that is missing is the "show me the whole
// thing" gesture, which is one button rather than a reimplementation of the
// accordion.
(() => {
  const btn = document.getElementById('chain-all');
  if (!btn) return;
  const links = () => [...document.querySelectorAll('details.chainlink')];
  // A page whose links are all plain rows has nothing to expand; the button
  // would be a control that does nothing.
  if (!links().length) { btn.hidden = true; return; }
  const sync = () => {
    const all = links();
    const open = all.filter(d => d.open).length;
    const expanded = all.length > 0 && open === all.length;
    btn.textContent = expanded ? 'Collapse all' : 'Expand all';
    btn.setAttribute('aria-expanded', String(expanded));
  };
  btn.addEventListener('click', () => {
    const all = links();
    const shouldOpen = all.some(d => !d.open);
    for (const d of all) d.open = shouldOpen;
    sync();
  });
  // Opening one by hand should keep the button honest about what it will do.
  for (const d of links()) d.addEventListener('toggle', sync);
  sync();
})();
