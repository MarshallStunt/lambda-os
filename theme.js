// Applies the saved look (theme, accent, density, text size, glow, motion) before the page paints, so there's no flash.
// The look is mirrored in localStorage for this synchronous first read; chrome.storage settings.look is the source of truth.
(function () {
  const DEFAULT = { theme: 'system', accent: 'cyan', density: 'comfortable', text: 'normal', glow: 'on', motion: 'full' };
  function apply(look) {
    const l = { ...DEFAULT, ...(look || {}) }, html = document.documentElement;
    if (l.theme === 'light' || l.theme === 'dark') html.dataset.theme = l.theme; else delete html.dataset.theme;
    html.dataset.accent = l.accent; html.dataset.density = l.density; html.dataset.text = l.text;
    html.dataset.glow = l.glow; html.dataset.motion = l.motion;
    return l;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('lambdaos-look') || 'null'); } catch { /* per-viewer convenience */ }
  apply(saved);
  window.LambdaLook = {
    DEFAULT, apply,
    current: () => { try { return { ...DEFAULT, ...(JSON.parse(localStorage.getItem('lambdaos-look') || 'null') || {}) }; } catch { return { ...DEFAULT }; } },
    async save(look) {
      const l = apply(look);
      try { localStorage.setItem('lambdaos-look', JSON.stringify(l)); } catch { /* ignore */ }
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const { settings = {} } = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({ settings: { ...settings, look: l } });
      }
      return l;
    },
    // Resolved light/dark for code that needs it (canvas colors etc.).
    isLight: () => document.documentElement.dataset.theme === 'light' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: light)').matches),
  };
  // Keep the fast-path copy in sync if the look was changed on another page (e.g. restored from a backup).
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('settings').then(({ settings }) => {
      if (settings?.look && JSON.stringify(settings.look) !== JSON.stringify(saved)) {
        try { localStorage.setItem('lambdaos-look', JSON.stringify(settings.look)); } catch { /* ignore */ }
        apply(settings.look);
      }
    });
  }
})();
