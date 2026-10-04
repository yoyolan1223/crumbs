// Dev-only: a tiny fake `chrome` so the side panel and toast can run as plain web pages.
(function () {
  const C = self.Crumbs;
  const MIN = 60e3;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const tabs = [
    { id: 1, url: 'https://mail.google.com/mail/u/0/#inbox/abc', title: 'Re: Q4 合作報價單確認 - hello@example.com - Gmail' },
    { id: 2, url: 'https://docs.google.com/presentation/d/1AbC/edit', title: 'MindGym 募資簡報 v3 - Google 簡報' },
    { id: 3, url: 'https://www.google.com/search?q=ADHD+工作記憶+介入研究', title: 'ADHD 工作記憶 介入研究 - Google 搜尋' },
    { id: 4, url: 'https://en.wikipedia.org/wiki/Working_memory', title: 'Working memory - Wikipedia' },
    { id: 5, url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', title: 'lofi hip hop radio - beats to relax/study to - YouTube' },
    { id: 6, url: 'https://www.figma.com/design/xyz/Pricing', title: 'Pricing 頁 v2 – Figma' },
    { id: 7, url: 'https://www.instagram.com/', title: 'Instagram' },
    { id: 8, url: 'https://shopee.tw/chair-i.123', title: '【免運】人體工學椅 護腰 辦公椅 | 蝦皮購物' },
    { id: 9, url: 'https://claude.ai/chat/abc', title: '募資簡報結構建議 - Claude' },
    { id: 10, url: 'https://github.com/sparrow-labs/notes/pull/42', title: 'feat: onboarding flow · Pull Request #42 · sparrow-labs/notes' },
    { id: 11, url: 'https://docs.google.com/document/d/9XyZ/edit', title: '實習生面試題目 - Google 文件' },
  ];

  // [tab id, minutes spent]; last one is where you are right now.
  const script = [
    [1, 4], [2, 12], [3, 1], [4, 6], [2, 9], [5, 0.01], [7, 5], [2, 14], [9, 7], [2, 6],
    [1, 3], [8, 4], [10, 11], [6, 8], [11, 0.6], [3, 2], [2, 3], [7, 3],
  ];

  let state = C.emptyState();
  const now = Date.now();
  let t = now - script.reduce((s, [, m]) => s + m, 0) * MIN;
  for (const [id, m] of script) {
    C.visit(state, { ...tabs.find((x) => x.id === id), windowId: 1 }, t);
    t += m * MIN;
  }
  state.current.since = now - 3 * MIN; // still scrolling Instagram…

  const byTab = (id) => state.crumbs.filter((c) => c.tabId === id);
  byTab(2).slice(-2)[0].note = '補完第 8 頁市場規模';
  state.tasks[byTab(2)[0].taskKey].note = '補完第 8 頁市場規模';
  byTab(10)[0].note = '回 reviewer 的兩個 comment';
  state.tasks[byTab(10)[0].taskKey].note = '回 reviewer 的兩個 comment';
  C.reduce(state, { type: 'task', key: byTab(2)[0].taskKey, patch: { progress: 50 } }, now);
  C.reduce(state, { type: 'task', key: byTab(10)[0].taskKey, patch: { progress: 75 } }, now);
  C.reduce(state, { type: 'task', key: byTab(6)[0].taskKey, patch: { progress: 25 } }, now);
  C.reduce(state, { type: 'task', key: 'mail', patch: { done: true } }, now - 40 * MIN);
  C.reduce(state, { type: 'addTask', title: '打給會計師問發票開立' }, now - 50 * MIN);
  byTab(8)[0].closed = true;

  // A few earlier days in the jar, for the week view and streak.
  [[1, [3, 1, 5, 2, 1, 4, 3, 1, 2]], [2, [3, 1, 1, 4, 2]], [3, [5, 3, 1, 3, 2, 1, 4, 3, 1, 2, 1]], [5, [3, 1]]]
    .forEach(([daysAgo, ns]) => ns.forEach((n, i) => {
      const at = now - daysAgo * 24 * 60 * MIN - i * 20 * MIN;
      C.jarOf(state).log.push({ at, kind: n >= 3 ? 'done' : 'step', n, title: '（之前的事）', p: 50 });
    }));
  C.jarOf(state).log.sort((a, b) => a.at - b.at);

  // Two weeks of history + a few projects, so the dashboard has something to show.
  const HIST = [
    ['docs.google.com/presentation/d/1AbC', 'MindGym 募資簡報 v3', 'create', 'Google 簡報', 'docs.google.com', 95],
    ['github.com/sparrow-labs/notes', 'feat: onboarding flow', 'work', 'GitHub', 'github.com', 80],
    ['figma.com/design', 'Pricing 頁 v2', 'create', 'Figma', 'figma.com', 45],
    ['docs.google.com/document/d/9XyZ', '實習生面試題目', 'create', 'Google 文件', 'docs.google.com', 25],
    ['mail', '清信件、回信', 'comm', 'Gmail', 'mail.google.com', 35],
    ['claude.ai/chat', '募資簡報結構建議', 'work', 'Claude', 'claude.ai', 30],
    ['q:ADHD 工作記憶 介入研究', '搜尋「ADHD 工作記憶 介入研究」', 'search', 'Google', 'google.com', 20],
    ['site:Instagram', '滑 Instagram', 'social', 'Instagram', 'instagram.com', 28],
    ['site:YouTube', '逛 YouTube', 'fun', 'YouTube', 'youtube.com', 22],
    ['site:蝦皮', '逛 蝦皮', 'shop', '蝦皮', 'shopee.tw', 10],
  ];
  for (const [key, title, kind, site, host] of HIST) state.meta[key] = state.meta[key] || { title, kind, site, host };
  const seed = (i, k) => { const x = Math.sin(i * 91.7 + k * 13.3) * 1e4; return x - Math.floor(x); };
  for (let d = 1; d <= 13; d++) {
    const day = new Date(now - d * 24 * 36e5);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const rec = {};
    HIST.forEach(([key, , kind, , , avg], k) => {
      const f = weekend ? (kind === 'fun' || kind === 'social' ? 1.8 : 0.3) : 1;
      const ms = Math.round(avg * f * (0.3 + seed(d, k) * 1.4) * (d > 6 ? 0.8 : 1)) * 60e3;
      if (ms > 4 * 60e3) rec[key] = ms;
    });
    state.days[C.dayKey(day.getTime())] = { t: rec };
  }
  C.reduce(state, { type: 'addProject', name: 'MindGym 募資', rules: '募資, deck, pitch' }, now);
  C.reduce(state, { type: 'addProject', name: '產品開發', rules: 'github, figma, pricing, localhost' }, now);
  C.reduce(state, { type: 'addProject', name: '實習招募', rules: '實習, 面試' }, now);
  // A few comebacks this week for the "從分心回來" tile.
  [2, 3, 5].forEach((d) => C.jarOf(state).log.push({ at: now - d * 24 * 36e5, kind: 'comeback', n: 1, title: 'MindGym 募資簡報 v3' }));
  C.jarOf(state).log.sort((a, b) => a.at - b.at);

  const storeListeners = [];
  const msgListeners = [];
  const emit = () => storeListeners.forEach((fn) => fn({ state: { newValue: clone(state) } }, 'local'));

  window.chrome = {
    storage: {
      local: {
        get: async () => ({ state: clone(state) }),
        set: async (o) => { if (o.state) { state = o.state; emit(); } },
      },
      onChanged: { addListener: (fn) => storeListeners.push(fn) },
    },
    runtime: {
      sendMessage: async (msg) => {
        const at = Date.now();
        if (msg.type === 'trail') {
          const cur = C.currentCrumb(state);
          const slim = (c) => c && ({ id: c.id, taskKey: c.taskKey, url: c.url, verb: c.verb, subject: c.subject, site: c.site, activeMs: c.activeMs, note: c.note, startedAt: c.startedAt });
          const prev = state.crumbs.filter((c) => !c.flick && c.id !== cur.id).pop();
          return { type: 'crumbs:toast', prev: slim(prev), trail: C.recentPlaces(state, cur).map(slim), current: slim(cur), expanded: true };
        }
        if (msg.type === 'openDashboard') { window.open(window.__CRUMBS_DASH || new URL('dashboard.html', location.href)); return { ok: true }; }
        if (msg.type === 'jump') {
          const target = msg.crumbId ? state.crumbs.find((c) => c.id === msg.crumbId) : state.tasks[msg.taskKey];
          const tab = target && tabs.find((x) => x.id === target.tabId);
          if (tab) {
            const res = C.visit(state, { ...tab, windowId: 1 }, at);
            if (res && res.isNew && res.prev) window.__crumbsDemoToast?.(state, res);
          }
        } else {
          C.reduce(state, msg, at);
        }
        emit();
        return { ok: true };
      },
      onMessage: { addListener: (fn) => msgListeners.push(fn) },
    },
  };

  window.__mock = {
    get state() { return state; },
    fire: (msg) => msgListeners.forEach((fn) => fn(msg)),
  };
})();
