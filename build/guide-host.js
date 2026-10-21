// Runs in the guide's opaque-origin frame. Only guide state and appearance cross the boundary.
(() => {
  const channel = 'hanhua-guide-host';
  const storeKey = 'hanhua-guide-v2';
  const send = (type, extra = {}) => parent.postMessage({ channel, type, ...extra }, '*');
  let started = false;
  let ready = false;
  const values = new Map();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: key => values.get(key) ?? null,
      setItem(key, value) {
        values.set(key, String(value));
        if (key === storeKey) send('save', { value: String(value) });
      },
      removeItem(key) { values.delete(key); if (key === storeKey) send('save', { value: null }); }
    }
  });
  function appearance(data) {
    document.documentElement.dataset.theme = data.theme;
    for (const [key, value] of Object.entries(data.colors ?? {})) {
      document.documentElement.style.setProperty(key, value);
    }
    if (ready) {
      state.theme = data.theme;
      if (typeof updateThemeIcon === 'function') updateThemeIcon();
      const button = document.getElementById('theme');
      button?.setAttribute('aria-label', data.theme === 'dark' ? '切换浅色模式' : '切换深色模式');
    }
  }
  addEventListener('message', async event => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    const data = event.data;
    if (data.type === 'appearance') { appearance(data); return; }
    if (data.type !== 'init' || started) return;
    started = true;
    if (data.saved) values.set(storeKey, data.saved);
    appearance(data);
    try {
      // The provided guide owns its navigation and practice state; scripts keep their original order.
      for (const code of GUIDE_SCRIPTS) {
        const script = document.createElement('script');
        script.textContent = code;
        document.body.append(script);
      }
      ready = true;
      appearance(data);
      send('loaded');
    } catch { send('error'); }
  });
  document.addEventListener('click', event => {
    if (ready && event.target.closest?.('[data-action="start-using"]')) {
      setTimeout(() => { if (flow.courseFinished) send('close'); }, 0);
    }
    if (event.target.closest?.('#theme')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      send('toggle-theme');
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    // Escape first belongs to an open practice modal, menu, editor, or search.
    if (document.querySelector('dialog[open]') || !ready || ui.editor || ui.dutyOpen || ui.dutyMenuOpen || ui.directoryOpen || ui.expanded || ui.addAnchor || event.target.id === 'search' || route.section === 'search') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send('close');
  }, true);
  send('ready');
})();
