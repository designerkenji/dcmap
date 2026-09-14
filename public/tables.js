// Filter and sort for every summary table, added at load and entirely
// client-side - the tables are server-rendered HTML and stay that way; this
// only rearranges and hides rows that already exist.
//
// WHY THE FILTER IS TERM-AND SUBSTRING MATCHING. The case that motivated it:
// ctrl-F for "TI DFAB" finds nothing, because the fab column says "DFAB" and
// the operator column says "Texas Instruments" - the words the user knows are
// spread across cells. Split the query into terms and require each term
// somewhere in the ROW, and "ti dfab" works: "dfab" pins the row, "ti" is
// satisfied by Texas Instruments (or, cheerfully, by "operaTIng" - harmless,
// the rarest term does the narrowing).
//
// WHY SORT PARSES THE PRINTED TEXT rather than carrying data attributes: the
// cells already print what the reader compares - "~446", "136,279", "$3.5bn",
// "14 nm" - and one parser that understands those spellings keeps this file
// generic over every table on every page. bn/tn/M suffixes scale relative to
// millions, matching how the money columns are printed.
(() => {
  const parse = (t) => {
    t = t.trim();
    if (!t || t === '—') return null;
    const m = t.replace(/^[~<>≈$]+/, '').replace(/,/g, '')
      .match(/^(-?\d+(?:\.\d+)?)\s*(tn|bn|M(?![a-z])|%)?/i);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (m[2]) {
      const suf = m[2].toLowerCase();
      if (suf === 'bn') v *= 1000;
      else if (suf === 'tn') v *= 1e6;
    }
    return v;
  };

  for (const table of document.querySelectorAll('.tablewrap table')) {
    const head = table.tHead;
    const body = table.tBodies[0];
    if (!head || !body || body.rows.length < 2) continue;
    const rows = () => [...body.rows];

    // ---- sort on header click ----
    let sorted = { i: -1, dir: 1 };
    [...head.rows[0].cells].forEach((th, i) => {
      th.classList.add('tsort');
      th.setAttribute('role', 'button');
      th.tabIndex = 0;
      const go = () => {
        sorted = { i, dir: sorted.i === i ? -sorted.dir : 1 };
        // Numeric column when most non-empty cells parse.
        const vals = rows().map(r => (r.cells[i] ? r.cells[i].textContent : ''));
        const nums = vals.filter(v => parse(v) !== null).length;
        const numeric = nums >= vals.filter(v => v.trim()).length / 2 && nums > 0;
        const key = (r) => {
          const t = r.cells[i] ? r.cells[i].textContent.trim() : '';
          if (numeric) { const v = parse(t); return v === null ? null : v; }
          return t ? t.toLowerCase() : null;
        };
        rows()
          .map(r => [key(r), r])
          .sort((a, b) => {
            // Blanks sink regardless of direction: an empty cell is not the
            // smallest value, it is the absence of one.
            if (a[0] === null) return b[0] === null ? 0 : 1;
            if (b[0] === null) return -1;
            return (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * sorted.dir;
          })
          .forEach(([, r]) => body.appendChild(r));
        for (const h of head.rows[0].cells) {
          h.removeAttribute('aria-sort');
          h.classList.remove('sort-asc', 'sort-desc');
        }
        th.setAttribute('aria-sort', sorted.dir === 1 ? 'ascending' : 'descending');
        th.classList.add(sorted.dir === 1 ? 'sort-asc' : 'sort-desc');
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });

    // ---- filter box, only where there is something to filter ----
    if (body.rows.length <= 10) continue;
    const wrap = table.closest('.tablewrap');
    const bar = document.createElement('div');
    bar.className = 'tfilter';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Filter rows — try an operator, a place, a status…';
    input.setAttribute('aria-label', 'Filter table rows');
    const count = document.createElement('span');
    count.className = 'tcount';
    bar.append(input, count);
    wrap.parentNode.insertBefore(bar, wrap);
    const total = body.rows.length;
    input.addEventListener('input', () => {
      const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const r of rows()) {
        const hay = r.textContent.toLowerCase();
        const hit = terms.every(t => hay.includes(t));
        r.hidden = !hit;
        if (hit) shown++;
      }
      count.textContent = terms.length ? `${shown} of ${total}` : '';
    });
  }
})();
