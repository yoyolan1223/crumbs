// 麵包屑 Crumbs — shared logic (service worker, side panel, content script, dev mock)
// Pure functions only: no chrome.* calls in this file.
(function (root) {
  const MIN = 60e3;
  const HOUR = 60 * MIN;

  // ── Language ───────────────────────────────────────────────────
  // settings.lang: 'auto' | 'zh' | 'en'. 'auto' follows the browser / system language.
  let LANG = 'zh';
  function resolveLang(pref) {
    if (pref === 'zh' || pref === 'en') return pref;
    // The Mac app hands over the system language (a web view's navigator.language can't be trusted there).
    const nav = root.__CRUMBS_SYSLANG__ ||
      (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'zh';
    return /^zh/i.test(nav) ? 'zh' : 'en';
  }
  function setLang(pref) { LANG = resolveLang(pref); return LANG; }
  const lang = () => LANG;
  /** Inline pair: L('今天', 'Today'). */
  const L = (zh, en) => (LANG === 'en' ? en : zh);

  // Strings that were saved in Chinese (verbs, site names, generated titles) → English at display time,
  // so switching language also translates history.
  const TR = {
    寫文件: 'Writing', 整理表格: 'Spreadsheets', 做簡報: 'Slides', 弄表單: 'Forms', 看行程: 'Calendar',
    開發測試: 'Testing', 寫程式: 'Coding', 做設計: 'Designing', 寫筆記: 'Notes', 排任務: 'Planning',
    '問 AI': 'Asking AI', 搜尋: 'Searching', 看影片: 'Watching', 找影片: 'Browsing videos', 回訊息: 'Messages',
    滑社群: 'Social media', 逛購物: 'Shopping', 看資料: 'Reading', 處理信件: 'Email', 下指令: 'Terminal',
    找檔案: 'Files', 看文件: 'Reading docs', 開會: 'Meeting', 聽音樂: 'Music', 瀏覽: 'Browsing', 使用: 'Using',
    改設定: 'Settings', 待辦: 'To-do',
    'Google 文件': 'Google Docs', 'Google 雲端': 'Google Drive', 'Google 日曆': 'Google Calendar',
    'Google 試算表': 'Google Sheets', 'Google 簡報': 'Google Slides', 'Google 表單': 'Google Forms',
    蝦皮: 'Shopee', 維基百科: 'Wikipedia', 其他: 'Other', '清信件、回信': 'Inbox & replies', 排行程: 'Scheduling',
  };
  const TR_RE = [
    [/^搜尋「(.*)」$/, (m) => `Search “${m[1]}”`],
    [/^「(.*)」$/, (m) => `“${m[1]}”`],
    [/^回 (.+) 訊息$/, (m) => `Messages on ${m[1]}`],
    [/^逛 (.+)$/, (m) => `Browsing ${m[1]}`],
    [/^滑 (.+)$/, (m) => `Scrolling ${m[1]}`],
    [/^測試 (.+)$/, (m) => `Testing ${m[1]}`],
  ];
  function tr(s) {
    if (LANG !== 'en' || !s) return s;
    if (TR[s]) return TR[s];
    for (const [re, f] of TR_RE) { const m = s.match(re); if (m) return f(m); }
    return s;
  }

  // ── Kinds of work ──────────────────────────────────────────────
  // desc: what falls into each kind, in words people recognise.
  const kind = (w, zh, en, dzh, den) => ({ w, get label() { return L(zh, en); }, get desc() { return L(dzh, den); } });
  const KIND = {
    create: kind(3.0, '創作', 'Create', '寫文件、做簡報、做設計、寫筆記', 'Docs, slides, design, notes'),
    work:   kind(3.0, '工作', 'Work', '寫程式、整理表格、排任務、問 AI、看行程', 'Coding, spreadsheets, planning, asking AI, calendar'),
    todo:   kind(2.8, '待辦', 'To-do', '你自己加進清單的事', 'Things you added to the list yourself'),
    comm:   kind(2.4, '溝通', 'Talk', '處理信件、回訊息、開會', 'Email, messages, meetings'),
    learn:  kind(2.0, '學習', 'Learn', '看資料、讀文件、上課', 'Reading, docs, classes'),
    search: kind(1.6, '查資料', 'Search', 'Google 搜尋', 'Google searches'),
    browse: kind(1.2, '瀏覽', 'Browse', '其他還沒歸類的網站和 App（例如 Finder、一般網頁）', 'Other sites and apps not sorted yet (e.g. Finder, general web pages)'),
    shop:   kind(0.6, '購物', 'Shop', '蝦皮、momo、Amazon 等購物網站', 'Shopping sites like Amazon, Shopee, momo'),
    social: kind(0.4, '社群', 'Social', 'Facebook、Instagram、Threads、Dcard 等', 'Facebook, Instagram, Threads, Reddit…'),
    fun:    kind(0.4, '娛樂', 'Fun', 'YouTube、Netflix、聽音樂', 'YouTube, Netflix, music'),
  };

  const SITES = {
    'mail.google.com': 'Gmail', 'docs.google.com': 'Google 文件', 'drive.google.com': 'Google 雲端',
    'calendar.google.com': 'Google 日曆', 'github.com': 'GitHub', 'youtube.com': 'YouTube',
    'notion.so': 'Notion', 'figma.com': 'Figma', 'chatgpt.com': 'ChatGPT', 'claude.ai': 'Claude',
    'gemini.google.com': 'Gemini', 'facebook.com': 'Facebook', 'instagram.com': 'Instagram',
    'x.com': 'X', 'twitter.com': 'X', 'threads.net': 'Threads', 'threads.com': 'Threads',
    'linkedin.com': 'LinkedIn', 'shopee.tw': '蝦皮', 'momoshop.com.tw': 'momo', 'pchome.com.tw': 'PChome',
    'amazon.com': 'Amazon', 'netflix.com': 'Netflix', 'slack.com': 'Slack', 'whatsapp.com': 'WhatsApp',
    'messenger.com': 'Messenger', 'line.me': 'LINE', 'discord.com': 'Discord', 'medium.com': 'Medium',
    'stackoverflow.com': 'Stack Overflow', 'google.com': 'Google', 'canva.com': 'Canva',
    'trello.com': 'Trello', 'linear.app': 'Linear', 'outlook.office.com': 'Outlook',
    'reddit.com': 'Reddit', 'dcard.tw': 'Dcard', 'ptt.cc': 'PTT', 'wikipedia.org': '維基百科',
  };

  function siteName(host) {
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const h = parts.slice(i).join('.');
      if (SITES[h]) return SITES[h];
    }
    return host;
  }

  const seg = (u, n) => u.pathname.split('/').filter(Boolean).slice(0, n).join('/');
  const docKey = (u) => u.hostname + u.pathname.split('/').slice(0, 4).join('/');
  const re = (list) => new RegExp('(^|\\.)(' + list.join('|').replace(/\./g, '\\.') + ')$');

  // First match wins. key/title/subject receive (url, site, cleanedTitle).
  const RULES = [
    { m: (h) => h === 'mail.google.com' || /outlook\.(office|live)\.com$/.test(h),
      kind: 'comm', verb: '處理信件', key: () => 'mail', title: () => '清信件、回信' },
    { m: (h, p) => h === 'docs.google.com' && p.startsWith('/document'), kind: 'create', verb: '寫文件', key: docKey },
    { m: (h, p) => h === 'docs.google.com' && p.startsWith('/spreadsheets'), kind: 'work', verb: '整理表格', key: docKey, site: 'Google 試算表' },
    { m: (h, p) => h === 'docs.google.com' && p.startsWith('/presentation'), kind: 'create', verb: '做簡報', key: docKey, site: 'Google 簡報' },
    { m: (h, p) => h === 'docs.google.com' && p.startsWith('/forms'), kind: 'work', verb: '弄表單', key: docKey, site: 'Google 表單' },
    { m: (h) => h === 'calendar.google.com', kind: 'work', verb: '看行程', key: () => 'calendar', title: () => '排行程' },
    { m: (h) => h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost'),
      kind: 'work', verb: '開發測試', key: (u) => 'dev:' + u.host, title: (u) => '測試 ' + u.host },
    { m: (h) => /(^|\.)(github|gitlab)\.com$/.test(h), kind: 'work', verb: '寫程式', key: (u) => u.hostname + '/' + seg(u, 2) },
    { m: (h) => re(['figma.com', 'canva.com']).test(h), kind: 'create', verb: '做設計' },
    { m: (h) => re(['notion.so', 'notion.site']).test(h), kind: 'create', verb: '寫筆記' },
    { m: (h) => re(['trello.com', 'linear.app', 'asana.com', 'clickup.com']).test(h), kind: 'work', verb: '排任務' },
    { m: (h) => re(['chatgpt.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai']).test(h), kind: 'work', verb: '問 AI' },
    { m: (h, p) => /(^|\.)google\.[a-z.]+$/.test(h) && p === '/search',
      kind: 'search', verb: '搜尋',
      key: (u) => 'q:' + (u.searchParams.get('q') || ''),
      title: (u) => `搜尋「${u.searchParams.get('q') || ''}」`,
      subject: (u) => `「${u.searchParams.get('q') || ''}」` },
    { m: (h, p) => /(^|\.)youtube\.com$/.test(h) && p === '/watch', kind: 'fun', verb: '看影片',
      key: (u) => 'yt:' + u.searchParams.get('v') },
    { m: (h) => re(['youtube.com', 'netflix.com', 'twitch.tv', 'bilibili.com', 'disneyplus.com']).test(h),
      kind: 'fun', verb: '找影片', key: (u, s) => 'site:' + s, title: (u, s) => '逛 ' + s },
    { m: (h) => re(['slack.com', 'messenger.com', 'whatsapp.com', 'line.me', 'discord.com', 'teams.microsoft.com']).test(h),
      kind: 'comm', verb: '回訊息', key: (u, s) => 'site:' + s, title: (u, s) => `回 ${s} 訊息` },
    { m: (h) => re(['facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'threads.net', 'threads.com',
      'reddit.com', 'dcard.tw', 'ptt.cc', 'linkedin.com']).test(h),
      kind: 'social', verb: '滑社群', key: (u, s) => 'site:' + s, title: (u, s) => '滑 ' + s },
    { m: (h) => re(['shopee.tw', 'momoshop.com.tw', 'pchome.com.tw', 'amazon.com', 'taobao.com', 'books.com.tw']).test(h),
      kind: 'shop', verb: '逛購物', key: (u, s) => 'site:' + s, title: (u, s) => '逛 ' + s },
    { m: (h) => re(['stackoverflow.com', 'developer.mozilla.org', 'medium.com', 'wikipedia.org',
      'coursera.org', 'udemy.com', 'hahow.in', 'arxiv.org', 'scholar.google.com']).test(h),
      kind: 'learn', verb: '看資料' },
  ];

  function cleanTitle(title, site) {
    let t = (title || '').trim().replace(/^\(\d+\)\s*/, '');
    const parts = t.split(/\s+[-|–—·•]\s+/);
    while (parts.length > 1 && parts[parts.length - 1].length <= 30) parts.pop();
    t = parts.join(' - ').trim() || site;
    return t.length > 48 ? t.slice(0, 47) + '…' : t;
  }

  // url + title → what you're doing there
  // Mac app (麵包屑 for Mac): app://<bundle id>/<subject>?app=<app name>
  const MAC_APPS = [
    ['com.microsoft.Word', 'create', '寫文件'], ['com.apple.iWork.Pages', 'create', '寫文件'],
    ['com.microsoft.Powerpoint', 'create', '做簡報'], ['com.apple.iWork.Keynote', 'create', '做簡報'],
    ['com.microsoft.Excel', 'work', '整理表格'], ['com.apple.iWork.Numbers', 'work', '整理表格'],
    ['com.figma.Desktop', 'create', '做設計'], ['com.bohemiancoding.sketch3', 'create', '做設計'], ['com.adobe', 'create', '做設計'],
    ['com.canva', 'create', '做設計'], ['com.tinyspeck.slackmacgap', 'comm', '回訊息'], ['jp.naver.line.mac', 'comm', '回訊息'],
    ['net.whatsapp.WhatsApp', 'comm', '回訊息'], ['com.facebook.archon', 'comm', '回訊息'], ['ru.keepcoder.Telegram', 'comm', '回訊息'],
    ['com.hnc.Discord', 'comm', '回訊息'], ['com.apple.MobileSMS', 'comm', '回訊息'], ['com.microsoft.teams', 'comm', '回訊息'],
    ['com.apple.mail', 'comm', '處理信件'], ['com.microsoft.Outlook', 'comm', '處理信件'],
    ['com.apple.dt.Xcode', 'work', '寫程式'], ['com.microsoft.VSCode', 'work', '寫程式'], ['dev.zed.Zed', 'work', '寫程式'],
    ['com.todesktop.230313mzl4w4u92', 'work', '寫程式'], ['com.jetbrains', 'work', '寫程式'],
    ['com.apple.Terminal', 'work', '下指令'], ['com.googlecode.iterm2', 'work', '下指令'], ['dev.warp', 'work', '下指令'],
    ['notion.id', 'create', '寫筆記'], ['com.apple.Notes', 'create', '寫筆記'], ['md.obsidian', 'create', '寫筆記'],
    ['com.anthropic.claudefordesktop', 'work', '問 AI'], ['com.openai.chat', 'work', '問 AI'],
    ['com.apple.finder', 'browse', '找檔案'], ['com.apple.Preview', 'learn', '看文件'], ['us.zoom.xos', 'comm', '開會'],
    ['com.spotify.client', 'fun', '聽音樂'], ['com.apple.Music', 'fun', '聽音樂'], ['com.apple.iCal', 'work', '看行程'],
    ['com.apple.reminders', 'work', '排任務'],
    ['com.google.Chrome', 'browse', '瀏覽'], ['com.apple.Safari', 'browse', '瀏覽'], ['com.brave.Browser', 'browse', '瀏覽'],
    ['com.microsoft.edgemac', 'browse', '瀏覽'], ['company.thebrowser.Browser', 'browse', '瀏覽'],
  ];

  function describeApp(u) {
    const bid = u.hostname;
    const app = u.searchParams.get('app') || bid;
    const subject = decodeURIComponent(u.pathname.replace(/^\//, '')) || app;
    const r = MAC_APPS.find(([p]) => bid.startsWith(p)) || [bid, 'browse', '使用'];
    return {
      host: bid, site: app, kind: r[1], verb: r[2],
      taskKey: 'app:' + bid + '|' + (subject === app ? '' : subject),
      taskTitle: subject === app ? app : subject,
      subject,
    };
  }

  function describe(url, title) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol === 'app:') return describeApp(u);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, '');
    const rule = RULES.find((r) => r.m(host, u.pathname, u)) || {
      kind: 'browse', verb: '瀏覽', key: (u) => host + '/' + seg(u, 1),
    };
    const site = rule.site || siteName(host);
    const clean = cleanTitle(title, site);
    const key = rule.key ? rule.key(u, site) : host + '/' + seg(u, 1);
    return {
      host, site, kind: rule.kind, verb: rule.verb,
      taskKey: key,
      taskTitle: rule.title ? rule.title(u, site, clean) : clean,
      subject: rule.subject ? rule.subject(u, site, clean) : clean,
    };
  }

  // ── State ──────────────────────────────────────────────────────
  const emptyState = () => migrate({});

  // Older saved states get the new fields filled in.
  function migrate(st) {
    st.v = 2;
    st.crumbs = st.crumbs || [];
    st.tasks = st.tasks || {};
    st.current = st.current || null;
    st.settings = { toast: false, notch: true, lang: 'auto', ...(st.settings || {}) };
    setLang(st.settings.lang); // every context loads state through here
    if (st.settings.v2 !== true) { st.settings.toast = false; st.settings.v2 = true; } // no more auto pop-ups by default
    st.jar = st.jar || emptyJar();
    st.days = st.days || {};       // { 'YYYY-M-D': { t: { taskKey: ms } } }
    st.meta = st.meta || {};       // taskKey → { title, kind, site, host } (outlives the task itself)
    st.assign = st.assign || {};   // taskKey → projectId | 'none'
    st.projects = st.projects || [];
    return st;
  }
  const uid = (now) => now.toString(36) + Math.random().toString(36).slice(2, 6);

  // ── 麵包屑罐 ────────────────────────────────────────────────────
  // Crumbs only ever go *into* the jar. Getting distracted never costs you anything.
  const JAR_GOAL = 24;
  const DISTRACTING = ['fun', 'social', 'shop'];
  const emptyJar = () => ({ log: [], goal: JAR_GOAL, lastComeback: 0 });
  const jarOf = (st) => (st.jar = st.jar || emptyJar());
  const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  function jarDay(st, ts) {
    const k = dayKey(ts);
    return jarOf(st).log.filter((x) => dayKey(x.at) === k).reduce((s, x) => s + x.n, 0);
  }

  function award(st, now, kind, n, title, extra = {}) {
    const jar = jarOf(st);
    const before = jarDay(st, now);
    const entry = { at: now, kind, n, title, ...extra };
    if (before === 0) entry.first = true;
    if (before < jar.goal && before + n >= jar.goal) entry.full = true;
    jar.log.push(entry);
    jar.log = jar.log.filter((x) => now - x.at < 15 * 24 * HOUR);
    return entry;
  }

  // Consecutive days (ending today, or yesterday if today hasn't started) with at least one thing finished.
  function streak(st, now) {
    const days = new Set(jarOf(st).log.filter((x) => x.kind === 'done').map((x) => dayKey(x.at)));
    let d = new Date(now);
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return { days: n, today: days.has(dayKey(now)) };
  }

  const CHEERS = {
    done: [
      ['「{t}」完成！我幫你收進罐子裡了。下一件慢慢來就好。', '“{t}” done! Into the jar it goes. Take the next one slowly.'],
      ['做完「{t}」了！你的大腦剛剛完成一件不容易的事，給它一點掌聲。', 'Finished “{t}”! Your brain just did something hard — give it a round of applause.'],
      ['「{t}」收好了。你看，開始了就會結束。', '“{t}” is wrapped up. See? Things you start do end.'],
      ['又一件！「{t}」搞定。要不要先站起來伸個懶腰？', 'Another one! “{t}” is done. Time to stand up and stretch?'],
      ['「{t}」完成。記得：做完比做到完美重要。', '“{t}” done. Remember: done beats perfect.'],
    ],
    step: [
      ['往前一格！「{t}」到 {p}% 了。', 'One step forward! “{t}” is at {p}%.'],
      ['{p}%！一小步也是一步，我都看到了。', '{p}%! A small step is still a step. I saw it.'],
      ['「{t}」的進度條動了。慢慢推，推得動就好。', 'The progress bar on “{t}” moved. Slow pushes still count.'],
    ],
    comeback: [
      ['歡迎回來！能自己把注意力拉回來，本身就是一種超能力。', 'Welcome back! Pulling your own attention back is a superpower.'],
      ['你回來「{t}」了～分心不是失敗，回來才是重點。', 'You came back to “{t}”. Drifting isn\'t failing — coming back is what counts.'],
      ['繞了一圈又回到「{t}」，很好，這就是在練習。', 'Took the scenic route back to “{t}”. That\'s exactly the practice.'],
    ],
    focus: [
      ['在「{t}」專心了 25 分鐘以上！注意力肌肉又練壯了一點。', '25+ focused minutes on “{t}”! Your attention muscle just got stronger.'],
      ['一口氣待在「{t}」超過 25 分鐘，好厲害。喝口水吧。', 'Over 25 minutes straight on “{t}” — impressive. Have some water.'],
    ],
    first: [['今天的第一粒麵包屑！起步最難，你已經做到了。', 'First crumb of the day! Starting is the hardest part, and you did it.']],
    full: [['罐子滿了！今天的你很努力，剩下的時間可以對自己好一點。', 'The jar is full! You worked hard today — be kind to yourself for the rest of it.']],
  };

  function cheerLine(e) {
    const pool = e.full ? CHEERS.full : e.first && e.kind !== 'comeback' ? CHEERS.first : CHEERS[e.kind] || CHEERS.done;
    const line = L(...pool[Math.floor(e.at / 1000) % pool.length]);
    return line.replace('{t}', tr(e.title) || '').replace('{p}', e.p || '');
  }

  // Stop the clock on the current crumb (window blur, tab switch). Returns the crumb.
  function closeCurrent(st, now) {
    const c = st.current;
    if (!c) return null;
    const cr = st.crumbs.find((x) => x.id === c.crumbId);
    if (!cr) { st.current = null; return null; }
    if (c.since != null) {
      const dt = Math.max(0, Math.min(now - c.since, 2 * HOUR));
      cr.activeMs += dt;
      if (st.tasks[cr.taskKey]) st.tasks[cr.taskKey].totalMs += dt;
      const day = (st.days[dayKey(now)] = st.days[dayKey(now)] || { t: {} });
      day.t[cr.taskKey] = (day.t[cr.taskKey] || 0) + dt;
      c.since = null;
      if (cr.activeMs >= 25 * MIN && !cr.focusPaid && !DISTRACTING.includes(cr.kind)) {
        cr.focusPaid = true;
        award(st, now, 'focus', 2, st.tasks[cr.taskKey]?.title || cr.subject);
      }
    }
    cr.endedAt = now;
    return cr;
  }

  // You landed on `tab`. Returns { crumb, prev, isNew } or null when the page isn't trackable.
  function visit(st, tab, now) {
    const d = describe(tab.url, tab.title);
    if (!d) { closeCurrent(st, now); return null; }

    const cur = st.current && st.crumbs.find((x) => x.id === st.current.crumbId);
    if (cur && cur.tabId === tab.id && cur.taskKey === d.taskKey) {
      // Same place — just refresh details / resume the clock.
      cur.url = tab.url; cur.subject = d.subject; cur.title = tab.title || cur.title;
      if (st.current.since == null) st.current.since = now;
      const t = st.tasks[d.taskKey];
      if (t && !t.custom) t.title = d.taskTitle;
      return { crumb: cur, prev: null, isNew: false };
    }

    const closed = closeCurrent(st, now);
    // A tab you only flicked through (<1.5s) isn't a real step.
    if (closed && closed.activeMs < 1500 && !closed.note) closed.flick = true;

    const crumb = {
      id: uid(now), tabId: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title || '',
      site: d.site, host: d.host, kind: d.kind, verb: d.verb, subject: d.subject, taskKey: d.taskKey,
      startedAt: now, endedAt: null, activeMs: 0, note: '', flick: false, closed: false,
    };
    st.crumbs.push(crumb);
    st.current = { crumbId: crumb.id, since: now };

    let t = st.tasks[d.taskKey];
    if (!t) {
      t = st.tasks[d.taskKey] = {
        key: d.taskKey, title: d.taskTitle, verb: d.verb, kind: d.kind, site: d.site,
        url: tab.url, tabId: tab.id, firstSeen: now, lastSeen: now, totalMs: 0, visits: 0,
        progress: 0, prevProgress: 0, done: false, doneAt: null, pinned: false, hidden: false, note: '',
      };
    }
    t.visits += 1; t.lastSeen = now; t.url = tab.url; t.tabId = tab.id;
    if (!t.custom) t.title = d.taskTitle;
    st.meta[d.taskKey] = { title: t.title, kind: d.kind, site: d.site, host: d.host };

    prune(st, now);
    const prev = lastReal(st, crumb.id);

    // Came back from a distraction to something you're actually working on? That deserves a crumb.
    let cheer = null;
    const jar = jarOf(st);
    const working = !t.done && ((t.progress > 0 && t.progress < 100) || t.pinned || t.note);
    if (prev && DISTRACTING.includes(prev.kind) && prev.activeMs >= 30e3 && working &&
        now - (jar.lastComeback || 0) > 20 * MIN) {
      jar.lastComeback = now;
      cheer = award(st, now, 'comeback', 1, t.title);
    }
    return { crumb, prev, isNew: true, cheer };
  }

  // Recent distinct places (newest first), skipping where you are now — for the toast drop-down.
  function recentPlaces(st, current, n = 6) {
    const seen = new Set([current.taskKey]);
    const out = [];
    for (let i = st.crumbs.length - 1; i >= 0 && out.length < n; i--) {
      const c = st.crumbs[i];
      if (c.flick || seen.has(c.taskKey)) continue;
      seen.add(c.taskKey);
      out.push(c);
    }
    return out;
  }

  // Which "site" a footprint belongs to, for merging the trail:
  // known products keep their own name (Gmail ≠ Google 搜尋), other sites merge by main domain
  // (app.example.com + www.example.com), Mac apps merge by app.
  const SLD = new Set(['com', 'co', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);
  function siteGroup(c) {
    if ((c.url || '').startsWith('app:')) return 'app:' + (c.host || c.site);
    const host = c.host || '';
    if (c.site && c.site !== host) return 'site:' + c.site;
    const p = host.split('.');
    const n = p.length >= 3 && SLD.has(p[p.length - 2]) && p[p.length - 1].length === 2 ? 3 : 2;
    return 'dom:' + p.slice(-n).join('.');
  }

  /** Consecutive footprints on the same site become one group. Input newest-first. */
  function groupTrail(crumbs) {
    const out = [];
    for (const c of crumbs) {
      const g = siteGroup(c);
      const last = out[out.length - 1];
      if (last && last.group === g) last.items.push(c);
      else out.push({ group: g, items: [c] });
    }
    return out;
  }

  function lastReal(st, exceptId) {
    for (let i = st.crumbs.length - 1; i >= 0; i--) {
      const c = st.crumbs[i];
      if (c.id !== exceptId && !c.flick) return c;
    }
    return null;
  }

  function prune(st, now) {
    for (const k of Object.keys(st.days)) {
      if (now - new Date(k.replace(/-/g, '/')).getTime() > 60 * 24 * HOUR) delete st.days[k];
    }
    const used = new Set(Object.keys(st.tasks));
    for (const d of Object.values(st.days)) for (const k of Object.keys(d.t)) used.add(k);
    for (const k of Object.keys(st.meta)) if (!used.has(k)) delete st.meta[k];
    const keep = st.current && st.current.crumbId;
    st.crumbs = st.crumbs.filter((c) => c.id === keep || now - c.startedAt < 48 * HOUR).slice(-600);
    for (const [k, t] of Object.entries(st.tasks)) {
      const inFlight = t.progress > 0 && !t.done;
      if (t.pinned || t.manual || inFlight) continue;
      if (t.done ? now - (t.doneAt || 0) > 24 * HOUR : now - t.lastSeen > 48 * HOUR) delete st.tasks[k];
    }
  }

  function setProgress(t, p, now) {
    if (p >= 100) {
      if (!t.done) t.prevProgress = t.progress < 100 ? t.progress : t.prevProgress;
      t.progress = 100; t.done = true; t.doneAt = now;
    } else {
      t.progress = Math.max(0, p); t.done = false; t.doneAt = null;
    }
  }

  // All user edits go through here so the worker can apply them in order.
  function reduce(st, msg, now) {
    switch (msg.type) {
      case 'task': {
        const t = st.tasks[msg.key];
        if (!t) break;
        const p = msg.patch || {};
        const was = t.progress;
        if ('done' in p) setProgress(t, p.done ? 100 : t.prevProgress || 0, now);
        if ('progress' in p) setProgress(t, p.progress, now);
        // Each step forward pays once (no farming by clicking back and forth).
        for (const step of [25, 50, 75]) {
          if (t.progress >= step && was < step && (t.paidStep || 0) < step && t.progress < 100) {
            t.paidStep = step;
            award(st, now, 'step', 1, t.title, { p: step });
          }
        }
        if (t.done && !t.paidDone) {
          t.paidDone = true;
          const bonus = Math.min(3, Math.floor(t.totalMs / (10 * MIN)));
          award(st, now, 'done', 3 + bonus, t.title, { bonus });
        }
        if ('pinned' in p) t.pinned = !!p.pinned;
        if ('hidden' in p) t.hidden = !!p.hidden;
        if ('title' in p && p.title.trim()) { t.title = p.title.trim(); t.custom = true; }
        break;
      }
      case 'reorder': {
        (msg.keys || []).forEach((k, i) => { if (st.tasks[k]) st.tasks[k].pos = i + 1; });
        break;
      }
      case 'addTask': {
        const title = (msg.title || '').trim();
        if (!title) break;
        const key = 'manual:' + uid(now);
        st.tasks[key] = {
          key, title, verb: '待辦', kind: 'todo', site: '', url: msg.url || '', tabId: null, manual: true, custom: true, later: !!msg.later,
          firstSeen: now, lastSeen: now, totalMs: 0, visits: 0, progress: 0, prevProgress: 0,
          done: false, doneAt: null, pinned: false, hidden: false, note: '',
        };
        break;
      }
      case 'note': {
        const c = st.crumbs.find((x) => x.id === msg.crumbId);
        if (!c) break;
        c.note = (msg.note || '').trim();
        if (c.note) c.flick = false;
        if (st.tasks[c.taskKey]) st.tasks[c.taskKey].note = c.note;
        break;
      }
      case 'clearDay': {
        const keep = st.current && st.current.crumbId;
        st.crumbs = st.crumbs.filter((c) => c.id === keep);
        for (const [k, t] of Object.entries(st.tasks)) {
          if (!(t.pinned || (t.manual && !t.done) || (t.progress > 0 && !t.done))) delete st.tasks[k];
        }
        const cur = st.crumbs[0];
        if (cur && !st.tasks[cur.taskKey]) {
          st.tasks[cur.taskKey] = {
            key: cur.taskKey, title: cur.subject, verb: cur.verb, kind: cur.kind, site: cur.site, url: cur.url,
            tabId: cur.tabId, firstSeen: now, lastSeen: now, totalMs: 0, visits: 1, progress: 0, prevProgress: 0,
            done: false, doneAt: null, pinned: false, hidden: false, note: '',
          };
        }
        break;
      }
      case 'settings':
        Object.assign(st.settings, msg.patch || {});
        setLang(st.settings.lang);
        break;
      case 'sync': {
        // What is still open? Tasks whose page / window / app is gone leave the list
        // (kept: pinned, in progress, done, hand-written, and wherever you are right now).
        const openWeb = new Set((msg.openUrls || []).map((u) => (describe(u, '') || {}).taskKey).filter(Boolean));
        const running = new Set(msg.runningApps || []);
        const wins = msg.windows || {};
        const isOpen = (key) => {
          if (key.startsWith('app:')) {
            const bar = key.indexOf('|');
            const bid = key.slice(4, bar), subj = key.slice(bar + 1);
            if (!running.has(bid)) return false;
            if (!subj || !wins[bid]) return true; // whole-app task, or windows unknown
            return wins[bid].includes(subj);
          }
          return msg.webKnown ? openWeb.has(key) : true;
        };
        const cur = currentCrumb(st);
        const removed = [];
        for (const [k, t] of Object.entries(st.tasks)) {
          if (t.manual || t.pinned || t.done || t.progress > 0 || (cur && cur.taskKey === k)) continue;
          if (!isOpen(k)) { delete st.tasks[k]; removed.push(k); }
        }
        for (const c of st.crumbs) if (!c.closed && (!cur || c.id !== cur.id) && !isOpen(c.taskKey)) c.closed = true;
        st.lastRemoved = removed;
        break;
      }
      case 'deleteTask': {
        // Remove a task and its footprints (time already spent stays in the weekly history).
        delete st.tasks[msg.key];
        const keep = st.current && st.current.crumbId;
        st.crumbs = st.crumbs.filter((c) => c.taskKey !== msg.key || c.id === keep);
        break;
      }
      case 'deleteCrumb': {
        const keep = st.current && st.current.crumbId;
        if (msg.crumbId !== keep) st.crumbs = st.crumbs.filter((c) => c.id !== msg.crumbId);
        break;
      }
      case 'addProject': {
        const name = (msg.name || '').trim();
        if (!name) break;
        const used = new Set(st.projects.map((x) => x.color));
        const color = PALETTE.light.findIndex((_, i) => !used.has(i));
        st.projects.push({ id: 'p' + uid(now), name, rules: parseRules(msg.rules), color: color < 0 ? 0 : color });
        break;
      }
      case 'updateProject': {
        const p = st.projects.find((x) => x.id === msg.id);
        if (!p) break;
        if ('name' in msg && msg.name.trim()) p.name = msg.name.trim();
        if ('rules' in msg) p.rules = parseRules(msg.rules);
        break;
      }
      case 'deleteProject':
        st.projects = st.projects.filter((x) => x.id !== msg.id);
        for (const [k, v] of Object.entries(st.assign)) if (v === msg.id) delete st.assign[k];
        break;
      case 'assign':
        if (msg.projectId) st.assign[msg.key] = msg.projectId; else delete st.assign[msg.key];
        break;
    }
    return st;
  }

  // ── Projects & weekly view ─────────────────────────────────────
  // Validated categorical palette (dataviz reference instance). A project keeps its slot for life.
  const PALETTE = {
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  };
  const parseRules = (r) => (Array.isArray(r) ? r : String(r || '').split(/[,，、\n]/))
    .map((x) => x.trim().toLowerCase()).filter(Boolean);

  // Manual assignment wins; otherwise the first project whose keyword appears in the title, site or address.
  function projectOf(st, key) {
    const a = st.assign && st.assign[key];
    if (a === 'none') return null;
    if (a) return st.projects.find((p) => p.id === a) || null;
    const m = st.meta[key] || st.tasks[key] || {};
    const hay = [m.title, m.host, m.site, key].join(' ').toLowerCase();
    return st.projects.find((p) => p.rules.some((r) => hay.includes(r))) || null;
  }

  // 7 days ending today (offset 1 = the week before).
  function weekStats(st, now, offset = 0) {
    const W = L('日一二三四五六', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    const days = [];
    const proj = {};
    const kinds = {};
    let total = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i - offset * 7);
      const k = dayKey(d.getTime());
      const rec = (st.days[k] || { t: {} }).t;
      const by = {};
      let dayTotal = 0;
      for (const [key, ms] of Object.entries(rec)) {
        const p = projectOf(st, key);
        const pid = p ? p.id : 'none';
        by[pid] = (by[pid] || 0) + ms;
        dayTotal += ms;
        const pr = (proj[pid] = proj[pid] || { id: pid, ms: 0, tasks: {} });
        pr.ms += ms;
        pr.tasks[key] = (pr.tasks[key] || 0) + ms;
        const kind = (st.meta[key] || st.tasks[key] || {}).kind || 'browse';
        kinds[kind] = (kinds[kind] || 0) + ms;
      }
      total += dayTotal;
      days.push({ key: k, date: d, label: i === 0 && offset === 0 ? L('今天', 'Today') : W[d.getDay()], md: `${d.getMonth() + 1}/${d.getDate()}`, by, rec: { ...rec }, total: dayTotal });
    }
    return { days, projects: proj, kinds, total };
  }

  // ── Suggested order ────────────────────────────────────────────
  function liveMs(st, now) {
    const c = st.current;
    return c && c.since != null ? Math.max(0, now - c.since) : 0;
  }
  function currentCrumb(st) {
    return st.current ? st.crumbs.find((c) => c.id === st.current.crumbId) || null : null;
  }

  function reasonFor(t, ms, now) {
    if (t.pinned) return L('你把它釘在最上面', 'You pinned it to the top');
    if (t.progress >= 50 && t.progress < 100) return L(`做到 ${t.progress}% 了，收尾最划算`, `${t.progress}% done — finishing it pays off most`);
    if (t.progress > 0 && t.progress < 50) return L('已經起頭了，趁熱接著做', 'You\'ve started — keep going while it\'s warm');
    if (t.manual) return L('你親手寫下的事', 'You wrote this one down yourself');
    if (t.visits >= 4) return L(`回來看了 ${t.visits} 次，它一直掛在你心上`, `You came back ${t.visits} times — it\'s on your mind`);
    if (ms >= 20 * MIN) return L(`已經投入 ${fmtDur(ms)}，別讓它涼掉`, `${fmtDur(ms)} in already — don\'t let it go cold`);
    if (t.kind === 'comm') return L('回完就不用一直惦記', 'Reply and stop carrying it around');
    if (t.kind === 'fun' || t.kind === 'social' || t.kind === 'shop') return L('放後面，當作完成後的獎勵', 'Saved for later, as a reward');
    if (now - t.lastSeen < 15 * MIN) return L('剛剛才碰過，記憶還熱熱的', 'You were just there — it\'s still fresh');
    return L('之前開過，還沒結束', 'Opened earlier, not finished yet');
  }

  // Tasks you dragged keep your order; new ones slot in before the first dragged task they outscore.
  function mergeManualOrder(tasks) {
    const ordered = tasks.filter((t) => t.pos).sort((a, b) => a.pos - b.pos);
    const loose = tasks.filter((t) => !t.pos).sort((a, b) => b.score - a.score);
    for (const t of loose) {
      const i = ordered.findIndex((o) => o.score < t.score);
      ordered.splice(i < 0 ? ordered.length : i, 0, t);
    }
    return ordered;
  }

  function rankTasks(st, now) {
    const cur = currentCrumb(st);
    const live = liveMs(st, now);
    const list = Object.values(st.tasks)
      .filter((t) => !t.hidden)
      .map((t) => {
        const ms = t.totalMs + (cur && cur.taskKey === t.key ? live : 0);
        return { ...t, ms, isCurrent: !!(cur && cur.taskKey === t.key) };
      })
      // A page you merely passed by isn't a task yet: stay a few seconds, or come back to it.
      .filter((t) => t.manual || t.pinned || t.progress > 0 || t.note || t.pos || t.isCurrent ||
        t.ms >= 8e3 || t.visits >= 2);

    for (const t of list) {
      let s = (KIND[t.kind] || KIND.browse).w * 10;
      if (t.progress > 0 && t.progress < 100) s += 25;
      if (t.manual) s += 8;
      s += Math.min(t.ms / MIN, 60) * 0.5;
      s += Math.min(t.visits, 8) * 2;
      const age = now - t.lastSeen;
      s += age < 15 * MIN ? 10 : age < HOUR ? 5 : 0;
      if (t.pinned) s += 1000;
      t.score = s;
      t.reason = reasonFor(t, t.ms, now);
    }
    const open = mergeManualOrder(list.filter((t) => !t.done));
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return { open, done };
  }

  // ── Formatting ─────────────────────────────────────────────────
  function fmtDur(ms) {
    const m = Math.round(ms / MIN);
    if (m < 1) return L('不到 1 分', '<1 min');
    if (m < 60) return m + L(' 分', ' min');
    const h = Math.floor(m / 60), r = m % 60;
    return L(r ? `${h} 小時 ${r} 分` : `${h} 小時`, r ? `${h} hr ${r} min` : `${h} hr`);
  }
  function fmtClock(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function fmtAgo(ts, now) {
    const m = Math.round((now - ts) / MIN);
    if (m < 1) return L('剛剛', 'just now');
    if (m < 60) return m + L(' 分鐘前', ' min ago');
    return Math.round(m / 60) + L(' 小時前', ' hr ago');
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function hue(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  // ── 啾啾 the sparrow ───────────────────────────────────────────
  // mood: happy | peek | sleepy | dizzy | proud
  function sparrow(mood = 'happy', size = 56) {
    const ink = '#2B1D14';
    const eyes = {
      happy: `<circle cx="46" cy="22" r="2.7" fill="${ink}"/><circle cx="46.9" cy="21.1" r=".9" fill="#fff"/>`,
      peek: `<circle cx="47" cy="22.5" r="2.7" fill="${ink}"/><circle cx="47.9" cy="21.6" r=".9" fill="#fff"/>`,
      sleepy: `<path d="M43.2 22.4q2.8 2.4 5.6 0" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      proud: `<path d="M43.2 23.4q2.8-3 5.6 0" stroke="${ink}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
      dizzy: `<path d="M46 22.5m-2.6 0a2.6 2.6 0 1 1 5.2 0a1.7 1.7 0 1 1-3.4 0a.8.8 0 1 1 1.6 0" stroke="${ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
    };
    const extra = {
      happy: `<path d="M53 57.5l4.6-1.4 1.2 3.9-4.6 1.4z" fill="#E0A55B"/><circle cx="58.5" cy="54.5" r="1" fill="#E0A55B"/>`,
      peek: '',
      sleepy: `<text x="52" y="11" font-size="9" font-family="Georgia,serif" fill="#AD9E8C">z</text><text x="58" y="5.5" font-size="6.5" font-family="Georgia,serif" fill="#AD9E8C">z</text>`,
      proud: `<path d="M56 6l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="#E8A23A"/><path d="M22 7l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="#E8A23A"/>`,
      dizzy: `<path d="M34 8q4-4 8 0t8 0" stroke="#AD9E8C" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
    };
    return `<svg class="sparrow sparrow-${mood}" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
<path d="M13 41 1 34.5l2.6 12.5z" fill="#8A5A3B"/>
<ellipse cx="30" cy="40" rx="20" ry="16.5" fill="#B5724A"/>
<ellipse cx="36.5" cy="45.5" rx="11.5" ry="9.5" fill="#F3DFC1"/>
<path d="M15.5 37.5q12-8.5 22.5 2q-8.5 9.5-22.5-2z" fill="#8A5A3B"/>
<path d="M18 38.5q4 1.6 8 .6M20 41q4 1.2 8 .2" stroke="#6E452D" stroke-width="1" fill="none" stroke-linecap="round"/>
<circle cx="40" cy="24" r="13" fill="#B5724A"/>
<path d="M28.2 20.5A13 13 0 0 1 52.6 19.4Q40.5 14.2 28.2 20.5z" fill="#6E452D"/>
<circle cx="44.5" cy="29.5" r="3.2" fill="#E98A6A" opacity=".55"/>
<path d="M52.2 23.2l8.3 2.2-8.2 3.2z" fill="#E8A23A"/>
${eyes[mood] || eyes.happy}
<path d="M26 55.5v5.5m-2.5 0h5M35 55.5v5.5m-2.5 0h5" stroke="#8A5A3B" stroke-width="1.8" stroke-linecap="round"/>
${extra[mood] || ''}
</svg>`;
  }

  // A glass jar that fills up with crumbs. `count` crumbs, `goal` = full.
  function jarSVG(count, goal = JAR_GOAL, size = 120, uidSuffix = '') {
    const cols = 4, rows = Math.ceil(goal / cols);
    const bottom = 104, top = 40, rowH = (bottom - top) / rows;
    const shown = Math.min(count, goal + 3);
    const colors = ['#E0A55B', '#D9772B', '#C98A4B', '#F0C27B', '#B96A2E'];
    const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
    let inside = '', heap = '';
    for (let i = 0; i < shown; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      const over = i >= goal;
      const cx = over ? 38 + rnd(i, 1) * 24 : 27 + col * 15.5 + (row % 2 ? 4 : -2) + (rnd(i, 1) - .5) * 5;
      const cy = over ? 13 - (i - goal) * 3.5 : bottom - rowH / 2 - row * rowH + (rnd(i, 2) - .5) * 3;
      const w = 10 + rnd(i, 3) * 5, h = 7 + rnd(i, 4) * 4, r = Math.round(rnd(i, 5) * 80 - 40);
      const piece = `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2.4).toFixed(1)}" fill="${colors[i % colors.length]}" transform="rotate(${r} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
      if (over) heap += piece; else inside += piece;
    }
    const id = 'jarclip' + uidSuffix;
    const body = 'M24 30h52v6q10 4 10 16v46q0 14-14 14H28q-14 0-14-14V52q0-12 10-16z';
    return `<svg class="jar" viewBox="0 0 100 120" width="${size}" height="${size * 1.2}" aria-hidden="true">
<defs><clipPath id="${id}"><path d="${body}"/></clipPath></defs>
<path d="${body}" fill="var(--jar-glass, rgba(255,255,255,.55))"/>
<g clip-path="url(#${id})">${inside}</g>
<path d="${body}" fill="none" stroke="var(--jar-line, #CDBBA2)" stroke-width="2.4"/>
<path d="M22 50q-2 18 0 44" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/>
<rect x="19" y="20" width="62" height="12" rx="4" fill="#B5724A"/>
<rect x="19" y="20" width="62" height="4" rx="2" fill="#C98A5E"/>
${heap}
</svg>`;
  }

  root.Crumbs = {
    L, tr, setLang, resolveLang, lang,
    award, jarDay, jarOf, streak, cheerLine, jarSVG, dayKey, JAR_GOAL,
    migrate, projectOf, weekStats, PALETTE, parseRules,
    KIND, describe, cleanTitle, recentPlaces, siteGroup, groupTrail, siteName, emptyState, visit, closeCurrent, reduce,
    rankTasks, currentCrumb, liveMs, fmtDur, fmtClock, fmtAgo, esc, hue, sparrow, MIN, HOUR,
  };
})(typeof self !== 'undefined' ? self : window);
