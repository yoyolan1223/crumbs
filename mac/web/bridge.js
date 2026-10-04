// 麵包屑 for Mac — lets the Chrome extension's UI (sidepanel / dashboard) run inside the Mac app.
// It plays the part of `chrome.*`. Two roles:
//   engine — the always-alive main page: owns the state, applies events from Swift, saves via Swift.
//   mirror — the dashboard window: shows the engine's state, sends edits back through Swift.
(function () {
  const C = self.Crumbs;
  const role = document.documentElement.dataset.role || 'engine';
  const post = (m) => window.webkit.messageHandlers.crumbs.postMessage(m);
  let state = C.migrate(window.__CRUMBS_INITIAL__ || {});
  const listeners = [];
  const clone = () => JSON.parse(JSON.stringify(state));
  const emit = () => { const v = clone(); listeners.forEach((f) => f({ state: { newValue: v } }, 'local')); };

  let saveT;
  function changed() {
    emit();
    if (role !== 'engine') return;
    clearTimeout(saveT);
    saveT = setTimeout(() => post({ type: 'save', state: JSON.stringify(state) }), 600);
    post({ type: 'changed', state: JSON.stringify(state) });
  }

  function jumpTarget(msg) {
    const t = msg.crumbId ? state.crumbs.find((c) => c.id === msg.crumbId) : state.tasks[msg.taskKey];
    return t && t.url ? { type: 'jump', url: t.url, title: t.title || '' } : null;
  }

  window.chrome = {
    storage: {
      local: {
        get: async () => ({ state: clone() }),
        set: async (o) => { if (o.state) { state = C.migrate(o.state); changed(); } },
      },
      onChanged: { addListener: (f) => listeners.push(f) },
    },
    runtime: {
      sendMessage: async (msg) => {
        if (msg.type === 'jump') { const j = jumpTarget(msg); if (j) post(j); return { ok: true }; }
        if (msg.type === 'openDashboard') { post({ type: 'dashboard' }); return { ok: true }; }
        if (role === 'mirror') { post({ type: 'reduce', msg }); return { ok: true }; }
        // Deleting here also clears it from the floating bar.
        if (msg.type === 'deleteTask') post({ type: 'forget', urls: state.crumbs.filter((c) => c.taskKey === msg.key).map((c) => c.url) });
        if (msg.type === 'deleteCrumb') { const c = state.crumbs.find((x) => x.id === msg.crumbId); if (c) post({ type: 'forget', urls: [c.url] }); }
        C.reduce(state, msg, Date.now());
        changed();
        return { ok: true };
      },
      onMessage: { addListener() {} },
    },
  };

  // Called from Swift.
  window.__crumbs = {
    visit(e) { C.visit(state, { id: e.tabId, windowId: 1, url: e.url, title: e.title }, e.at); changed(); },
    pause(e) { C.closeCurrent(state, e.at); changed(); },
    sync(info) {
      C.reduce(state, { type: 'sync', ...info }, Date.now());
      if (state.lastRemoved && state.lastRemoved.length) changed();
    },
    forget(url) {
      const d = C.describe(url, '');
      if (d) C.reduce(state, { type: 'deleteTask', key: d.taskKey }, Date.now());
      changed();
    },
    reduce(msg) { C.reduce(state, msg, Date.now()); changed(); },
    setState(json) { state = C.migrate(JSON.parse(json)); emit(); },
  };

  document.documentElement.classList.add('mac');
})();
