// Day/night toggle. Day is the default by requirement — the OS preference is
// deliberately not consulted, so the page looks the same for everyone until
// the user flips it. Shared by the map app and the site pages.
(function () {
  const KEY = 'dcmap-theme';
  const saved = localStorage.getItem(KEY);
  const theme = saved === 'night' ? 'night' : 'day';
  document.documentElement.dataset.theme = theme;

  function apply(next) {
    document.documentElement.dataset.theme = next;
    localStorage.setItem(KEY, next);
    // The map app listens for this to restyle canvases it owns.
    window.dispatchEvent(new CustomEvent('dcmap-theme', { detail: next }));
  }

  window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeBtn');
    if (btn) btn.addEventListener('click', () =>
      apply(document.documentElement.dataset.theme === 'night' ? 'day' : 'night'));
  });
})();
