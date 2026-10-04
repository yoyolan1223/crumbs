// 麵包屑 Crumbs — service worker: follows you around and picks up the crumbs.
importScripts('shared.js');
const C = self.Crumbs;

// Every read-modify-write goes through one queue so events never clobber each other.
let chain = Promise.resolve();
const enqueue = (fn) => (chain = chain.then(fn).catch((e) => console.error('[crumbs]', e)));

async function load() {
  const { state } = await chrome.storage.local.get('state');
  return C.migrate(state || {});
}
const save = (st) => chrome.storage.local.set({ state: st });

function toastPayload(st, crumb, prev, expanded = false, cheer = null) {
  const trail = C.recentPlaces(st, crumb).map(slim);
  return {
    type: 'crumbs:toast', prev: prev && slim(prev), trail, current: slim(crumb), expanded,
    cheer: cheer && { n: cheer.n, text: C.cheerLine(cheer) },
  };
}
const slim = (c) => ({
  id: c.id, taskKey: c.taskKey, url: c.url, verb: c.verb, subject: c.subject, site: c.site,
  activeMs: c.activeMs, note: c.note, startedAt: c.startedAt,
});

function tell(tabId, msg) {
  // Small delay: on a fresh navigation the content script may still be booting.
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, msg).catch(() => { /* page without content script (chrome://, store…) */ });
  }, 350);
}

function onTab(tab) {
  if (!tab || !tab.url) return;
  enqueue(async () => {
    const st = await load();
    const now = Date.now();
    const res = C.visit(st, tab, now);
    await save(st);
    if (res && res.isNew && res.prev && st.settings.toast) tell(tab.id, toastPayload(st, res.crumb, res.prev, false, res.cheer));
    else if (res && res.cheer) tell(tab.id, { type: 'crumbs:cheer', n: res.cheer.n, text: C.cheerLine(res.cheer) });
  });
}

async function onActiveIn(windowId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  onTab(tab);
}

chrome.tabs.onActivated.addListener(({ tabId }) => chrome.tabs.get(tabId).then(onTab, () => {}));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!tab.active) return;
  if (info.status === 'complete' || info.title || info.url) onTab(tab);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // You left Chrome — pause the clock, keep the crumb.
    enqueue(async () => {
      const st = await load();
      C.closeCurrent(st, Date.now());
      await save(st);
    });
  } else {
    onActiveIn(windowId);
  }
});

// Closing a tab removes its task too (unless another open tab is doing the same thing).
chrome.tabs.onRemoved.addListener(() => {
  enqueue(async () => {
    const st = await load();
    const tabs = await chrome.tabs.query({});
    C.reduce(st, { type: 'sync', openUrls: tabs.map((t) => t.url).filter(Boolean), webKnown: true }, Date.now());
    await save(st);
  });
});

// ── Messages from the side panel and the in-page toast ──────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'trail') {
    // The little sparrow on the page asks for the trail when you open it.
    enqueue(async () => {
      const st = await load();
      const cur = C.currentCrumb(st);
      if (!cur) return null;
      const prev = st.crumbs.filter((c) => !c.flick && c.id !== cur.id).pop();
      return toastPayload(st, cur, prev, true);
    }).then(reply);
    return true;
  }
  if (msg.type === 'openDashboard') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    return;
  }
  if (msg.type === 'jump') {
    enqueue(() => jump(msg)).then(() => reply({ ok: true }));
    return true;
  }
  enqueue(async () => {
    const st = await load();
    C.reduce(st, msg, Date.now());
    await save(st);
  }).then(() => reply({ ok: true }));
  return true;
});

async function jump({ crumbId, taskKey }) {
  const st = await load();
  const target = crumbId
    ? st.crumbs.find((c) => c.id === crumbId)
    : st.tasks[taskKey];
  if (!target || !target.url) return;
  const tabId = target.tabId;
  if (tabId != null) {
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch { /* tab is gone — reopen below */ }
  }
  await chrome.tabs.create({ url: target.url });
}

chrome.commands.onCommand.addListener((cmd) => {
  if (cmd !== 'show-trail') return;
  enqueue(async () => {
    const st = await load();
    const cur = C.currentCrumb(st);
    if (!cur) return;
    const prev = st.crumbs.filter((c) => !c.flick && c.id !== cur.id).pop();
    tell(cur.tabId, toastPayload(st, cur, prev, true));
  });
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // Tabs opened before install don't have the content script yet.
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['shared.js', 'content.js'] }).catch(() => {});
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  onTab(active);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
