// 麵包屑 Crumbs — side panel
(() => {
  const C = self.Crumbs;
  const e = C.esc;
  const L = C.L, tr = C.tr;
  const app = document.getElementById('app');

  let st = C.emptyState();
  let view = pref('view') || 'next';
  let editingNote = null;   // crumb id whose note is being edited
  let showDone = false;
  let showMore = false;
  const expanded = new Set(); // trail groups opened with 「＋N 頁」
  let pendingRender = false;
  let dragKey = null;       // task being dragged
  let openKeys = [];        // current order of open tasks, for reordering
  let seenLog = null;       // jar log length we've already celebrated
  let pasted = [];          // lines pasted into the add box, waiting for Enter

  function pref(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('crumbs.' + k);
      localStorage.setItem('crumbs.' + k, v);
    } catch { return null; }
  }

  const send = (msg) => chrome.runtime.sendMessage(msg);

  // ── Data in ────────────────────────────────────────────────────
  async function refresh() {
    const { state } = await chrome.storage.local.get('state');
    st = C.migrate(state || {});
    seenLog = C.jarOf(st).log.length;
    render();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.state) { st = C.migrate(changes.state.newValue || {}); render(); }
  });

  // ── Helpers ────────────────────────────────────────────────────
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function favicon(url, site) {
    if (!url) return `<span class="fav hand" aria-hidden="true">${ICON.pen}</span>`;
    const letter = e((site || '?').replace(/^www\./, '').slice(0, 1).toUpperCase());
    const h = C.hue(site || '');
    let img = '';
    if (url && chrome.runtime.getURL) {
      img = `<img src="${e(chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'))}" alt="">`;
    }
    return `<span class="fav" style="--h:${h}">${letter}${img}</span>`;
  }

  const ICON = {
    pin: '<svg viewBox="0 0 20 20" width="15" height="15"><path d="M12.5 2.5l5 5-2.3.6-3.4 3.4.3 3.6-1.6 1.6-3.2-3.2-4 4-.8-.8 4-4-3.2-3.2 1.6-1.6 3.6.3 3.4-3.4z" fill="currentColor"/></svg>',
    hide: '<svg viewBox="0 0 20 20" width="15" height="15"><path d="M3 3l14 14M8.2 5.3A8.6 8.6 0 0 1 10 5c4.5 0 7.5 5 7.5 5a13 13 0 0 1-2.4 2.9M5.4 6.9A12.6 12.6 0 0 0 2.5 10s3 5 7.5 5c1 0 1.9-.2 2.7-.6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    pen: '<svg viewBox="0 0 20 20" width="13" height="13"><path d="M13.6 3.4l3 3L7 16H4v-3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrow: '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M4 10h11m-4-4.5L15.5 10 11 14.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    grip: '<svg viewBox="0 0 20 20" width="14" height="14"><g fill="currentColor"><circle cx="7.5" cy="5" r="1.5"/><circle cx="12.5" cy="5" r="1.5"/><circle cx="7.5" cy="10" r="1.5"/><circle cx="12.5" cy="10" r="1.5"/><circle cx="7.5" cy="15" r="1.5"/><circle cx="12.5" cy="15" r="1.5"/></g></svg>',
    x: '<svg viewBox="0 0 20 20" width="13" height="13"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 20 20" width="14" height="14"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  function progressBar(t, size = '') {
    const segs = [25, 50, 75, 100].map((v) => `
      <button class="seg ${t.progress >= v ? 'on' : ''}" data-act="progress" data-key="${e(t.key)}" data-v="${v}"
        aria-label="${L('完成度', 'Progress')} ${v}%" title="${v}%"></button>`).join('');
    const label = t.progress === 0 ? L('還沒開始', 'Not started') : t.progress === 100 ? L('完成', 'Done') : t.progress + '%';
    return `<div class="progress ${size}" role="group" aria-label="${L('完成度', 'Progress')}">${segs}<span class="p-label">${label}</span></div>`;
  }

  // ── 啾啾 speaks ────────────────────────────────────────────────
  function mood(now, open, done, today) {
    const recent = today.filter((c) => now - c.startedAt < 10 * C.MIN).length;
    const fresh = C.jarOf(st).log.filter((x) => now - x.at < 3 * C.MIN);
    const last = fresh.find((x) => x.full) || fresh[fresh.length - 1];
    if (last)
      return [last.kind === 'comeback' ? 'happy' : 'proud', C.cheerLine(last)];
    if (!open.length && !done.length)
      return ['sleepy', L('還沒撿到麵包屑。去開幾個分頁吧，我會跟在你後面，一粒一粒幫你撿起來。', 'No crumbs yet. Go open a few things — I\'ll follow along and pick them up one by one.')];
    if (!open.length)
      return ['proud', L(`清單清空了！今天完成 ${done.length} 件事。起來喝口水、伸個懶腰吧。`, `List cleared! ${done.length} things done today. Get up, drink some water, stretch.`)];
    if (recent >= 10)
      return ['dizzy', L(`10 分鐘內換了 ${recent} 次分頁，我有點暈……先回到「${tr(open[0].title)}」就好，一次一件。`, `${recent} switches in 10 minutes — I'm a little dizzy… Just go back to “${tr(open[0].title)}”. One thing at a time.`)];
    const t = open[0];
    if (t.isCurrent) return ['happy', L(`你正在「${tr(t.title)}」，很好！其他分頁先別理，我幫你看著。`, `You're on “${tr(t.title)}” — nice! Ignore the other tabs, I'll keep an eye on them.`)];
    return ['happy', L(`要不要先回到「${tr(t.title)}」？${t.reason}。`, `How about going back to “${tr(t.title)}”? ${t.reason}.`)];
  }

  // ── Views ──────────────────────────────────────────────────────
  function render() {
    if (dragKey || (app.contains(document.activeElement) && document.activeElement.matches('input'))) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    document.documentElement.lang = C.lang() === 'en' ? 'en' : 'zh-Hant';
    const now = Date.now();
    const { open, done } = C.rankTasks(st, now);
    openKeys = open.map((t) => t.key);
    const t0 = startOfToday();
    const today = st.crumbs.filter((c) => !c.flick && c.startedAt >= t0);
    const [m, line] = mood(now, open, done, today);

    const longest = open.concat(done).filter((t) => !t.manual).sort((a, b) => b.ms - a.ms)[0];
    const stats = [
      L(`<b>${today.length}</b> 個足跡`, `<b>${today.length}</b> crumbs`),
      longest && longest.ms >= C.MIN ? `${L('最專注：', 'Most focus: ')}<b>${e(trim(tr(longest.title), L(8, 14)))}</b> ${C.fmtDur(longest.ms)}` : null,
    ].filter(Boolean);
    const jar = C.jarOf(st);
    const jarToday = C.jarDay(st, now);

    // New crumbs since last render → little celebration.
    let gained = 0;
    if (seenLog != null && jar.log.length > seenLog) gained = jar.log.slice(seenLog).reduce((s, x) => s + x.n, 0);
    seenLog = jar.log.length;

    app.innerHTML = `
      <header class="hero">
        <div class="bird">${C.sparrow(m, 64)}</div>
        <p class="bubble">${e(line)}</p>
      </header>
      <div class="stats">
        ${stats.map((s) => `<span>${s}</span>`).join('<i>·</i>')}
        <span class="chips-r"><button class="dash-chip" data-act="dashboard" title="${L('一週回顧：每個專案花了多少時間', 'Weekly review: where your time went')}">📊 ${L('一週', 'Week')}</button>
        <button class="jar-chip ${jarToday >= jar.goal ? 'full' : ''}" data-act="view" data-v="jar" title="${L('打開麵包屑罐', 'Open the crumb jar')}">
          ${C.jarSVG(jarToday, jar.goal, 18, 'chip')}<b>${jarToday}</b><small>/${jar.goal}</small>
          ${gained ? `<span class="floater">+${gained}</span>` : ''}
        </button></span>
      </div>
      <nav class="tabs" role="tablist">
        <button role="tab" aria-selected="${view === 'next'}" data-act="view" data-v="next">${L('接下來', 'Up next')} <small>${open.length || ''}</small></button>
        <button role="tab" aria-selected="${view === 'trail'}" data-act="view" data-v="trail">${L('足跡', 'Trail')} <small>${today.length || ''}</small></button>
        <button role="tab" aria-selected="${view === 'jar'}" data-act="view" data-v="jar">${L('罐子', 'Jar')} <small>${jarToday || ''}</small></button>
      </nav>
      <main>${view === 'next' ? viewNext(open, done, now) : view === 'jar' ? viewJar(now) : viewTrail(today, now)}</main>
      <footer>
        <div class="switches">
          <label class="switch">
            <input type="checkbox" data-act="notch" ${st.settings.notch !== false ? 'checked' : ''}>
            <span class="track"><span class="knob"></span></span>
            ${L('網頁右側顯示小麻雀（點它看足跡）', 'Show the sparrow on the right edge of pages')}
          </label>
          <label class="switch">
            <input type="checkbox" data-act="toast" ${st.settings.toast ? 'checked' : ''}>
            <span class="track"><span class="knob"></span></span>
            ${L('切換分頁時自動跳出提醒', 'Pop up a reminder when switching tabs')}
          </label>
        </div>
        <div class="foot-r">
          <label class="lang-pick" title="${L('語言', 'Language')}">🌐
            <select data-act="lang" aria-label="${L('語言', 'Language')}">
              ${[['auto', L('自動', 'Auto')], ['zh', '中文'], ['en', 'English']].map(([v, n]) =>
                `<option value="${v}" ${(st.settings.lang || 'auto') === v ? 'selected' : ''}>${n}</option>`).join('')}
            </select></label>
          <button class="link" data-act="clear">${L('清空重來', 'Start over')}</button>
        </div>
      </footer>`;

    if (gained) app.querySelector('.bird').classList.add('hop');
    app.querySelectorAll('.fav img').forEach((img) =>
      img.addEventListener('error', () => img.remove(), { once: true }));
    app.querySelectorAll('.fav img').forEach((img) => {
      // Chrome serves a generic globe for unknown pages; keep the letter underneath either way.
      img.addEventListener('load', () => img.classList.add('ok'), { once: true });
    });
  }

  const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function viewNext(open, done, now) {
    const [top, ...rest] = open;
    const hero = top ? `
      <section class="now" draggable="true" data-drag="${e(top.key)}">
        <span class="grip hero-grip" title="${L('拖曳調整順序', 'Drag to reorder')}">${ICON.grip}</span>
        <div class="eyebrow">${top.isCurrent ? L('你正在做', 'You\'re on it') : L('現在先做這件', 'Do this first')} ${projectPick(top)}</div>
        <div class="now-title">${favicon(top.url, top.site)}<h2>${e(tr(top.title))}</h2></div>
        <p class="why">${e(top.reason)}${top.note ? `<br><span class="note-inline">${L('你說要：', 'You said: ')}${e(top.note)}</span>` : ''}</p>
        ${progressBar(top, 'lg')}
        <div class="row">
          ${top.isCurrent
            ? `<span class="here">${ICON.check} ${L('你在這頁', 'You\'re here')}</span>`
            : top.url ? `<button class="btn primary" data-act="jump" data-key="${e(top.key)}">${L('回到這頁', 'Go back')} ${ICON.arrow}</button>` : ''}
          <button class="btn ghost" data-act="done" data-key="${e(top.key)}">${L('做完了', 'Done')}</button>
          <span class="spacer"></span>
          ${taskTools(top)}
        </div>
      </section>` : `
      <section class="empty">
        <p>${done.length ? L('沒有待辦了，今天好好收工。', 'Nothing left. Call it a day.') : L('開幾個分頁工作一下，這裡會自動長出你的清單。', 'Work for a bit and your list will grow here on its own.')}</p>
      </section>`;

    const LIMIT = 4;
    const shown = showMore ? rest : rest.slice(0, LIMIT);
    const list = shown.map((t, i) => `
      <li class="task ${t.isCurrent ? 'current' : ''}" draggable="true" data-drag="${e(t.key)}">
        <span class="num" title="${L('拖曳調整順序', 'Drag to reorder')}"><i>${i + 2}</i>${ICON.grip}</span>
        <button class="check" data-act="done" data-key="${e(t.key)}" aria-label="${L('標記完成', 'Mark done')}"></button>
        <div class="t-body" ${t.url ? `data-act="jump" data-key="${e(t.key)}" role="button" tabindex="0"` : ''}>
          <div class="t-title">${favicon(t.url, t.site)}<span>${e(tr(t.title))}</span></div>
          <div class="t-meta">${projectPick(t)}<span class="kind k-${t.kind}">${(C.KIND[t.kind] || C.KIND.browse).label}</span>${t.isCurrent ? `<span class="kind k-here">${L('在這頁', 'Here')}</span>` : ''}${e(t.reason)}</div>
          ${t.note ? `<div class="t-note">${L('「', '“')}${e(t.note)}${L('」', '”')}</div>` : ''}
        </div>
        <div class="t-side">
          ${progressBar(t)}
          <div class="tools">${taskTools(t)}</div>
        </div>
      </li>`).join('');

    const doneList = done.map((t) => `
      <li class="task done">
        <button class="check on" data-act="undone" data-key="${e(t.key)}" aria-label="${L('取消完成', 'Mark not done')}">${ICON.check}</button>
        <div class="t-body"><div class="t-title"><span>${e(tr(t.title))}</span></div>
        <div class="t-meta">${t.doneAt ? L(C.fmtAgo(t.doneAt, now) + '完成', 'Done ' + C.fmtAgo(t.doneAt, now)) : ''}${t.ms >= C.MIN ? L(' · 花了 ', ' · took ') + C.fmtDur(t.ms) : ''}</div></div>
      </li>`).join('');

    return `
      ${hero}
      ${rest.length ? `<h3 class="section">${L('然後', 'Then')}<small>${rest.some((t) => t.pos) || top.pos ? L('照你排的順序；新的事會自動插進來', 'In your order; new things slot in automatically') : L('依進度、投入時間排好了，也可以拖曳調整', 'Sorted by progress and time spent — drag to reorder')}</small></h3><ol class="queue">${list}</ol>` : ''}
      ${rest.length > LIMIT ? `
        <button class="more" data-act="toggleMore">${showMore ? L('收起來，一次看少一點', 'Show less') : L(`還有 ${rest.length - LIMIT} 件，先不用看`, `${rest.length - LIMIT} more — no need to look yet`)}</button>` : ''}
      <form class="add" data-act="add">
        <span class="add-ic">${ICON.plus}</span>
        <input name="task" maxlength="60" placeholder="${L('腦中冒出一件事？先丟這裡（可以一次貼好幾行）', 'Something popped into your head? Drop it here (paste several lines at once)')}" autocomplete="off">
      </form>
      ${done.length ? `
        <button class="section toggle" data-act="toggleDone" aria-expanded="${showDone}">
          ${L(`完成了 ${done.length} 件`, `${done.length} done`)} <span class="chev">▾</span>
        </button>
        ${showDone ? `<ol class="queue">${doneList}</ol>` : ''}` : ''}`;
  }

  function taskTools(t) {
    return `
      <button class="icon ${t.pinned ? 'on' : ''}" data-act="pin" data-key="${e(t.key)}" title="${t.pinned ? L('取消釘選', 'Unpin') : L('釘在最上面', 'Pin to top')}" aria-label="${L('釘選', 'Pin')}">${ICON.pin}</button>
      <button class="icon del" data-act="delete" data-key="${e(t.key)}" title="${L('刪除這件事', 'Delete')}" aria-label="${L('刪除', 'Delete')} “${e(tr(t.title))}”">${ICON.x}</button>`;
  }

  // A tiny select dressed as a chip: which project does this belong to?
  function projectPick(t) {
    const p = C.projectOf(st, t.key);
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const color = p ? C.PALETTE[dark ? 'dark' : 'light'][p.color] : '';
    return `<label class="proj ${p ? 'on' : ''}" style="${p ? `--pc:${color}` : ''}" title="${L('歸到哪個專案', 'Assign to a project')}">
      <select data-act="assign" data-key="${e(t.key)}" aria-label="${L('專案', 'Project')}">
        <option value="">${p ? L('取消分類', 'Remove from project') : L('＋ 專案', '＋ Project')}</option>
        ${st.projects.map((x) => `<option value="${e(x.id)}" ${p && p.id === x.id ? 'selected' : ''}>${e(x.name)}</option>`).join('')}
        <option value="__new">${L('＋ 新增專案…', '＋ New project…')}</option>
      </select><span>${p ? e(p.name) : L('＋ 專案', '＋ Project')}</span></label>`;
  }

  const JAR_KIND = () => ({ done: L('完成', 'Done'), step: L('前進', 'Step'), comeback: L('回來了', 'Back'), focus: L('專注', 'Focus') });
  const WEEKDAY = () => L('日一二三四五六', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

  function viewJar(now) {
    const jar = C.jarOf(st);
    const n = C.jarDay(st, now);
    const s = C.streak(st, now);
    const todayKey = C.dayKey(now);
    const entries = jar.log.filter((x) => C.dayKey(x.at) === todayKey).reverse();
    const msg = n === 0 ? L('罐子還空空的。<br>完成任何一小步，都會掉進一粒麵包屑。', 'The jar is empty.<br>Any small step drops a crumb in.')
      : n < jar.goal ? L(`再 <b>${jar.goal - n}</b> 粒，今天的罐子就滿了。`, `<b>${jar.goal - n}</b> more and today's jar is full.`)
      : L('今天的罐子滿了！<br>多出來的堆在蓋子上，關都關不起來。', 'Today\'s jar is full!<br>The extras are piling up on the lid.');

    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const c = C.jarDay(st, d.getTime());
      week.push(`<div class="wk ${i === 0 ? 'today' : ''}" title="${c} ${L('粒', 'crumbs')}">
        ${C.jarSVG(c, jar.goal, 26, 'w' + i)}<span>${i === 0 ? L('今天', 'Today') : WEEKDAY()[d.getDay()]}</span></div>`);
    }

    const log = entries.map((x) => `
      <li class="jl jl-${x.kind}">
        <span class="jl-t">${C.fmtClock(x.at)}</span>
        <span class="jl-k">${JAR_KIND()[x.kind] || ''}</span>
        <span class="jl-title">${e(tr(x.title) || '')}${x.kind === 'step' ? ` → ${x.p}%` : ''}${x.bonus ? ` <em>${L('專注加成', 'focus bonus')} +${x.bonus}</em>` : ''}</span>
        <span class="jl-n">+${x.n}</span>
      </li>`).join('');

    return `
      <section class="jar-hero">
        <div class="jar-big">${C.jarSVG(n, jar.goal, 118, 'big')}</div>
        <div class="jar-copy">
          <div class="jar-count"><b>${n}</b><span>/ ${jar.goal} ${L('粒', 'crumbs')}</span></div>
          <p>${msg}</p>
          <div class="streak">${s.days
            ? L(`連續 <b>${s.days}</b> 天都有完成事情`, `<b>${s.days}</b>-day streak of finishing things`) + (s.today ? '' : `<br><small>${L('今天做完一件就能延續', 'Finish one thing today to keep it going')}</small>`)
            : L('完成第一件事，<br>開始你的連續紀錄', 'Finish your first thing<br>to start a streak')}</div>
        </div>
      </section>
      <div class="week">${week.join('')}</div>
      <h3 class="section">${L('今天收進罐子的', 'In the jar today')}</h3>
      ${log ? `<ol class="jar-log">${log}</ol>` : `<p class="jar-empty">${L('還沒有。去「接下來」點一格進度條試試看？', 'Nothing yet. Try tapping a progress step in “Up next”?')}</p>`}
      <div class="how">
        <div class="how-t">${L('麵包屑怎麼來？', 'How do you earn crumbs?')}</div>
        <ul>
          <li><b>+3</b> ${L('完成一件事（投入越久，最多再 +3）', 'Finish something (up to +3 more the longer you spent)')}</li>
          <li><b>+1</b> ${L('進度往前一格', 'Move a task one step forward')}</li>
          <li><b>+1</b> ${L('從滑手機、看影片回到正事', 'Come back from social media or videos to real work')}</li>
          <li><b>+2</b> ${L('同一頁專心 25 分鐘', 'Focus on one page for 25 minutes')}</li>
        </ul>
        <p>${L('分心不會扣分。罐子只會越來越滿。', 'Getting distracted never costs you. The jar only fills up.')}</p>
      </div>`;
  }

  function viewTrail(today, now) {
    if (!today.length) {
      return `<section class="empty"><p>${L('今天還沒有足跡。<br>切換幾個分頁，啾啾就會開始撿。', 'No crumbs today yet.<br>Switch between a few things and the sparrow starts picking them up.')}</p></section>`;
    }
    const cur = C.currentCrumb(st);
    const live = C.liveMs(st, now);
    const msOf = (c) => c.activeMs + (cur && cur.id === c.id ? live : 0);
    // Hour sections, and inside each one, consecutive visits to the same site merge into one card.
    const hours = [];
    for (const c of today.slice().reverse()) {
      const h = new Date(c.startedAt).getHours();
      const label = L(`${h < 12 ? '上午' : h < 18 ? '下午' : '晚上'} ${h % 12 || 12} 點`, `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`);
      if (!hours.length || hours[hours.length - 1].label !== label) hours.push({ label, items: [] });
      hours[hours.length - 1].items.push(c);
    }
    return hours.map((hr) => `
      <h3 class="hour">${hr.label}</h3>
      <ol class="trail">${C.groupTrail(hr.items).map((g) => trailGroup(g, cur, msOf)).join('')}</ol>`).join('');
  }

  function trailGroup(g, cur, msOf) {
    const c = g.items[0];                      // newest visit in this group
    const more = g.items.slice(1);
    const isCur = cur && g.items.some((x) => x.id === cur.id);
    const total = g.items.reduce((s, x) => s + msOf(x), 0);
    const open = expanded.has(c.id);
    // Same page visited several times in a row → show it once.
    const distinct = new Set(g.items.map((x) => x.subject)).size;
    return `
      <li class="crumb ${isCur ? 'current' : ''} ${c.closed ? 'closed' : ''}">
        <span class="time">${C.fmtClock(c.startedAt)}</span>
        <span class="rail">${isCur ? `<span class="perch">${C.sparrow('peek', 26)}</span>` : '<span class="bit"></span>'}</span>
        <div class="c-card" data-act="jumpCrumb" data-id="${e(c.id)}" role="button" tabindex="0">
          <div class="c-title">${favicon(c.url, c.site)}<span><b>${e(tr(c.verb))}</b> ${e(tr(c.subject))}</span>
            ${editingNote === c.id || c.note ? '' : `<button class="c-pen" data-act="editNote" data-id="${e(c.id)}" title="${L('記一下在這做什麼', 'Note what to do here')}" aria-label="${L('記一下在這做什麼', 'Note what to do here')}">${ICON.pen}</button>`}
            ${isCur ? '' : `<button class="c-del" data-act="deleteGroup" data-ids="${e(g.items.map((x) => x.id).join(','))}" title="${L('刪除這些足跡', 'Delete these crumbs')}" aria-label="${L('刪除這些足跡', 'Delete these crumbs')}">${ICON.x}</button>`}</div>
          <div class="c-meta">
            ${e(tr(c.site))} · ${C.fmtDur(total)}
            ${more.length && distinct > 1 ? `<button class="c-more" data-act="toggleGroup" data-id="${e(c.id)}" aria-expanded="${open}">＋${distinct - 1} ${L('頁', distinct - 1 === 1 ? 'page' : 'pages')} ${open ? '▴' : '▾'}</button>` : ''}
            ${isCur ? `<span class="badge">${L('你在這裡', 'You\'re here')}</span>` : c.closed ? `<span class="badge mute">${L('已關閉・點我重開', 'Closed · click to reopen')}</span>` : ''}
          </div>
          ${editingNote === c.id ? `
            <form class="note-edit" data-act="saveNote" data-id="${e(c.id)}">
              <input name="note" maxlength="60" value="${e(c.note)}" placeholder="${L('在這頁要做什麼？', 'What to do here?')}" autocomplete="off">
            </form>` : c.note ? `
            <button class="c-note" data-act="editNote" data-id="${e(c.id)}">${L('「', '“')}${e(c.note)}${L('」', '”')}</button>` : ''}
          ${open ? `<ul class="c-sub">${dedupe(more, c).map((x) => `
            <li data-act="jumpCrumb" data-id="${e(x.id)}" role="button" tabindex="0">
              <span class="t">${C.fmtClock(x.startedAt)}</span><span class="s">${e(tr(x.subject))}</span><span class="d">${C.fmtDur(msOf(x))}</span>
            </li>`).join('')}</ul>` : ''}
        </div>
      </li>`;
  }

  // One row per page inside a group (newest visit wins), skipping the page already shown on top.
  function dedupe(list, head) {
    const seen = new Set([head.subject]);
    return list.filter((x) => !seen.has(x.subject) && seen.add(x.subject));
  }

  // ── Events ─────────────────────────────────────────────────────
  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'FORM' || el.tagName === 'INPUT') return;
    const { act, key, id, v } = el.dataset;
    switch (act) {
      case 'view': view = v; pref('view', v); render(); break;
      case 'jump': send({ type: 'jump', taskKey: key }); break;
      case 'jumpCrumb': if (!ev.target.closest('button,form')) send({ type: 'jump', crumbId: id }); break;
      case 'progress': {
        const t = st.tasks[key];
        const val = Number(v);
        const next = t && t.progress === val ? val - 25 : val;
        if (next >= 100) celebrate(t);
        send({ type: 'task', key, patch: { progress: next } });
        break;
      }
      case 'done': celebrate(st.tasks[key]); send({ type: 'task', key, patch: { done: true } }); break;
      case 'undone': send({ type: 'task', key, patch: { done: false } }); break;
      case 'pin': send({ type: 'task', key, patch: { pinned: !st.tasks[key]?.pinned } }); break;
      case 'delete': send({ type: 'deleteTask', key }); break;
      case 'deleteCrumb': send({ type: 'deleteCrumb', crumbId: id }); break;
      case 'deleteGroup': el.dataset.ids.split(',').forEach((cid) => send({ type: 'deleteCrumb', crumbId: cid })); break;
      case 'toggleGroup': if (expanded.has(id)) expanded.delete(id); else expanded.add(id); render(); break;
      case 'dashboard': send({ type: 'openDashboard' }); break;
      case 'toggleDone': showDone = !showDone; render(); break;
      case 'toggleMore': showMore = !showMore; render(); break;
      case 'editNote':
        editingNote = id; render();
        app.querySelector('.note-edit input')?.focus();
        break;
      case 'clear':
        if (confirm(L('清空今天的足跡？（做到一半、釘選和手寫的待辦會留下）', 'Clear today\'s trail? (Half-done, pinned and hand-written to-dos stay.)'))) send({ type: 'clearDay' });
        break;
    }
  });

  // ── Drag to reorder ─────────────────────────────────────────────
  const clearMarks = () => app.querySelectorAll('.drop-before,.drop-after,.dragging')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));

  app.addEventListener('dragstart', (ev) => {
    const el = ev.target.closest?.('[data-drag]');
    if (!el) return;
    dragKey = el.dataset.drag;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', dragKey);
    requestAnimationFrame(() => el.classList.add('dragging'));
  });

  function dropSpot(ev) {
    const el = ev.target.closest?.('[data-drag]');
    if (!el || !dragKey || el.dataset.drag === dragKey) return null;
    const r = el.getBoundingClientRect();
    return { el, after: ev.clientY > r.top + r.height / 2 };
  }

  app.addEventListener('dragover', (ev) => {
    if (!dragKey) return;
    ev.preventDefault();
    const spot = dropSpot(ev);
    app.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    if (spot) spot.el.classList.add(spot.after ? 'drop-after' : 'drop-before');
  });

  app.addEventListener('drop', (ev) => {
    const spot = dropSpot(ev);
    if (!spot) return;
    ev.preventDefault();
    const keys = openKeys.filter((k) => k !== dragKey);
    const at = keys.indexOf(spot.el.dataset.drag) + (spot.after ? 1 : 0);
    keys.splice(at, 0, dragKey);
    send({ type: 'reorder', keys });
  });

  app.addEventListener('dragend', () => {
    dragKey = null;
    clearMarks();
    render();
  });

  // Pasting a block of to-dos: one row per line, shown before you press Enter.
  function showPasted(form) {
    let box = form.nextElementSibling;
    if (!box || !box.classList.contains('paste-preview')) {
      if (!pasted.length) return;
      box = document.createElement('div');
      box.className = 'paste-preview';
      form.after(box);
    }
    if (!pasted.length) { box.remove(); return; }
    box.innerHTML = `<ol>${pasted.map((l) => `<li>${e(l)}</li>`).join('')}</ol>
      <p>${L(`按 Enter 加入這 ${pasted.length} 項 · Esc 取消`, `Enter adds these ${pasted.length} · Esc cancels`)}</p>`;
  }
  app.addEventListener('paste', (ev) => {
    const input = ev.target.closest?.('form.add input');
    if (!input) return;
    const lines = C.splitLines(ev.clipboardData?.getData('text/plain'));
    if (lines.length < 2) return;
    ev.preventDefault();
    pasted = pasted.concat(lines);
    showPasted(input.form);
  });

  app.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && pasted.length && ev.target.closest?.('form.add')) { pasted = []; showPasted(ev.target.form); return; }
    if (ev.key === 'Enter' && ev.target.matches('[role=button]')) ev.target.click();
    if (ev.key === 'Escape' && editingNote) { editingNote = null; ev.target.blur(); render(); }
  });

  app.addEventListener('change', (ev) => {
    const act = ev.target.dataset.act;
    if (act === 'toast' || act === 'notch') send({ type: 'settings', patch: { [act]: ev.target.checked } });
    if (act === 'lang') send({ type: 'settings', patch: { lang: ev.target.value } });
    if (act === 'assign') {
      const key = ev.target.dataset.key;
      let pid = ev.target.value;
      if (pid === '__new') {
        const name = prompt(L('新專案的名字？（例如：MindGym 募資、期末報告）', 'Name of the new project? (e.g. Pitch deck, Thesis)'));
        if (!name || !name.trim()) { render(); return; }
        const before = new Set(st.projects.map((p) => p.id));
        send({ type: 'addProject', name, rules: [] }).then(async () => {
          const { state } = await chrome.storage.local.get('state');
          const added = (state.projects || []).find((p) => !before.has(p.id));
          if (added) send({ type: 'assign', key, projectId: added.id });
        });
        return;
      }
      send({ type: 'assign', key, projectId: pid || 'none' });
    }
  });

  app.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.dataset.act === 'add') {
      const input = f.elements.task;
      const lines = pasted.concat(C.splitLines(input.value));
      if (!lines.length) return;
      input.value = '';
      pasted = [];
      showPasted(f);
      // Newest first in the list: the first line gets the latest time, so it stays on top.
      lines.forEach((title, i) => send({ type: 'addTask', title, seq: lines.length - i }));
      input.blur();
    } else if (f.dataset.act === 'saveNote') {
      send({ type: 'note', crumbId: f.dataset.id, note: f.elements.note.value });
      editingNote = null;
      f.elements.note.blur();
    }
  });

  app.addEventListener('focusout', () => {
    setTimeout(() => {
      if (app.contains(document.activeElement) && document.activeElement.matches('input')) return;
      if (editingNote) editingNote = null, pendingRender = true;
      if (pendingRender) render();
    }, 0);
  });

  function celebrate(t) {
    if (t) app.querySelector('.bird')?.classList.add('hop');
  }

  setInterval(render, 30e3);
  refresh();
})();
