// 麵包屑 Crumbs — on the page: a little sparrow peeking from the right edge.
// Click it for the dropdown (where was I, what am I doing here, recent places).
// It only pops up by itself if you turn that on in the side panel.
(() => {
  if (window.__crumbsToast) return;
  window.__crumbsToast = true;
  const C = self.Crumbs;
  const e = C.esc;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .root { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif; color: #33291F; }

  /* the handle */
  .notch { position: fixed; right: 0; z-index: 2147483646; width: 44px; height: 40px; padding: 0 0 0 6px;
    display: flex; align-items: center; border: 1px solid #EADFCC; border-right: 0; border-radius: 20px 0 0 20px;
    background: #FFFBF3; box-shadow: 0 6px 18px -6px rgba(60,40,20,.35); cursor: pointer; opacity: .78;
    transform: translateX(12px); transition: transform .2s ease, opacity .2s ease; touch-action: none; }
  .notch:hover, .notch.open { transform: translateX(0); opacity: 1; }
  .notch svg { display: block; pointer-events: none; }
  .notch.dragging { cursor: grabbing; transition: none; }
  .notch.hidden { display: none; }
  .cheer { position: fixed; right: 52px; z-index: 2147483646; max-width: 260px; padding: 8px 12px; border-radius: 14px 14px 4px 14px;
    background: #E6F0DF; color: #3F6B43; font-size: 12.5px; box-shadow: 0 6px 18px -8px rgba(60,40,20,.3);
    opacity: 0; transform: translateX(8px); transition: opacity .25s, transform .3s cubic-bezier(.2,1.3,.4,1); pointer-events: none; }
  .cheer.in { opacity: 1; transform: none; }
  .cheer b { background: #5E8C61; color: #fff; border-radius: 99px; padding: 0 7px; margin-right: 4px; font-size: 11.5px; }

  /* the dropdown */
  .card { position: fixed; z-index: 2147483647; width: min(360px, calc(100vw - 24px)); background: #FFFBF3;
    border: 1px solid #EADFCC; border-radius: 18px; overflow: hidden;
    box-shadow: 0 1px 0 #fff inset, 0 14px 36px -10px rgba(60,40,20,.32), 0 2px 6px rgba(60,40,20,.08);
    opacity: 0; transform: translateY(-8px) scale(.98); transform-origin: top right; pointer-events: none;
    transition: opacity .18s ease, transform .3s cubic-bezier(.2,1.25,.4,1); }
  .card.in { opacity: 1; transform: none; pointer-events: auto; }
  .card.side { right: 54px; }
  .card.top { top: 12px; left: 50%; margin-left: min(-180px, calc(-50vw + 12px)); transform-origin: top center; }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 10px; }
  .head svg { flex: none; }
  .txt { flex: 1; min-width: 0; }
  .lead { font-size: 11px; color: #9A8A78; }
  .what { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .what b { font-weight: 600; color: #C0621F; }
  .dur { flex: none; font-size: 11px; color: #9A8A78; font-variant-numeric: tabular-nums; }
  .x { flex: none; border: 0; background: transparent; color: #9A8A78; width: 26px; height: 26px; border-radius: 50%;
    cursor: pointer; font: inherit; font-size: 14px; display: grid; place-items: center; }
  .x:hover { background: #F4EADB; color: #33291F; }
  .said { margin: 0 12px 8px; padding: 6px 10px; background: #FBEBD8; border-radius: 10px; font-size: 12px; color: #7A4B25; }
  .tip { margin: 0 12px 8px; padding: 7px 10px; background: #E6F0DF; color: #3F6B43; border-radius: 10px; font-size: 12.5px; }
  .tip b { background: #5E8C61; color: #fff; border-radius: 99px; padding: 0 7px; margin-right: 4px; font-size: 11.5px; }
  .body { border-top: 1px dashed #EADFCC; padding: 10px 12px 10px; }
  .note { display: block; font-size: 11px; color: #9A8A78; margin-bottom: 10px; }
  .note input { display: block; width: 100%; margin-top: 4px; padding: 8px 10px; border-radius: 10px; border: 1px solid #EADFCC;
    background: #fff; font: inherit; font-size: 13px; color: #33291F; outline: none; }
  .note input:focus { border-color: #D9772B; box-shadow: 0 0 0 3px #F7E3CC; }
  .saved { color: #5E8C61; margin-left: 6px; opacity: 0; transition: opacity .2s; }
  .saved.on { opacity: 1; }
  .label { font-size: 11px; color: #9A8A78; margin: 2px 0 4px; }
  ol { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 6px; border-radius: 10px; cursor: pointer; }
  li:hover { background: #F7EEE1; }
  .dot { flex: none; width: 7px; height: 7px; background: #D9772B; border-radius: 50% 40% 55% 45%; opacity: .75; }
  .fav { flex: none; width: 16px; height: 16px; border-radius: 4px; }
  .li-t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .li-t em { font-style: normal; color: #9A8A78; }
  .li-m { flex: none; font-size: 11px; color: #AD9E8C; font-variant-numeric: tabular-nums; }
  .del { flex: none; width: 22px; height: 22px; border: 0; border-radius: 50%; background: transparent; color: #33291F;
    opacity: .18; cursor: pointer; display: grid; place-items: center; font-size: 13px; transition: opacity .15s, background .15s; }
  li:hover .del { opacity: .45; }
  .del:hover { opacity: 1 !important; background: #F4DCD3; color: #B5452B; }
  li.gone { opacity: 0; transform: translateX(16px); transition: opacity .2s, transform .2s; }
  .empty { padding: 6px 4px; color: #AD9E8C; font-size: 12px; }
  .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 11px; color: #AD9E8C; }
  .foot button { border: 0; background: none; color: #B35A17; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; padding: 2px 0; }
  .foot button:hover { text-decoration: underline; }
  kbd { font: inherit; background: #F4EADB; border-radius: 4px; padding: 0 4px; }
  @media (prefers-reduced-motion: reduce) { .card, .notch, .cheer { transition: none; } }
  `;

  let host, root, card, notch, cheerEl, hideTimer, data, settings = { notch: true }, notchY = 140;

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('crumbs-toast');
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="root">
      <button class="notch" aria-label="麵包屑：我剛剛在幹嘛？" title="我剛剛在幹嘛？（可上下拖曳）">${C.sparrow('peek', 30)}</button>
      <div class="cheer" role="status"></div>
      <div class="card" role="dialog" aria-label="麵包屑足跡"></div></div>`;
    document.documentElement.appendChild(host);
    notch = root.querySelector('.notch');
    card = root.querySelector('.card');
    cheerEl = root.querySelector('.cheer');
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', onKey);
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', () => { if (card.classList.contains('top')) scheduleHide(2600); });
    setupNotch();
    applySettings();
  }

  // ── the handle ───────────────────────────────────────────────
  function setupNotch() {
    let startY = null, startTop = 0, moved = false;
    notch.addEventListener('pointerdown', (ev) => {
      startY = ev.clientY; startTop = notchY; moved = false;
      notch.setPointerCapture(ev.pointerId);
    });
    notch.addEventListener('pointermove', (ev) => {
      if (startY == null) return;
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 4) { moved = true; notch.classList.add('dragging'); }
      if (moved) { notchY = Math.max(8, Math.min(innerHeight - 48, startTop + dy)); place(); }
    });
    notch.addEventListener('pointerup', () => {
      notch.classList.remove('dragging');
      if (startY != null && moved) chrome.storage.local.set({ notchY });
      else if (startY != null) toggle();
      startY = null;
    });
    notch.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  }

  function place() {
    notch.style.top = notchY + 'px';
    cheerEl.style.top = notchY + 4 + 'px';
    if (card.classList.contains('side')) card.style.top = Math.min(notchY, innerHeight - 380) + 'px';
  }

  function applySettings() {
    if (!notch) return;
    notch.classList.toggle('hidden', settings.notch === false);
    place();
  }

  async function toggle() {
    if (card.classList.contains('in')) return hide();
    let payload;
    try { payload = await chrome.runtime.sendMessage({ type: 'trail' }); } catch { payload = null; }
    show(payload || { trail: [], current: null, prev: null }, 'side');
  }

  // ── the dropdown ─────────────────────────────────────────────
  const fav = (url) => {
    try { return chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32'); } catch { return ''; }
  };

  function render() {
    const { prev, trail, current, cheer } = data;
    const head = prev || current;
    const items = (trail || []).map((c) => `
      <li data-id="${e(c.id)}" data-key="${e(c.taskKey || '')}" title="${e(c.subject)}">
        <span class="dot"></span>
        <img class="fav" src="${e(fav(c.url))}" alt="">
        <span class="li-t">${e(c.verb)} · ${e(c.subject)}${c.note ? ` <em>— ${e(c.note)}</em>` : ''}</span>
        <span class="li-m">${C.fmtClock(c.startedAt)}</span>
        <button class="del" data-act="del" aria-label="刪除「${e(c.subject)}」" title="從清單刪除">✕</button>
      </li>`).join('');
    card.innerHTML = `
      <div class="head">
        ${C.sparrow('peek', 30)}
        <div class="txt">${head ? `
          <div class="lead">${prev ? '剛剛你在' : '你現在在'}</div>
          <div class="what"><b>${e(head.verb)}</b> · ${e(head.subject)}</div>` : '<div class="what">還沒有足跡</div>'}
        </div>
        ${prev ? `<span class="dur">${C.fmtDur(prev.activeMs)}</span>` : ''}
        <button class="x" data-act="close" aria-label="關閉">✕</button>
      </div>
      ${cheer ? `<div class="tip"><b>+${cheer.n}</b>${e(cheer.text)}</div>` : ''}
      ${prev && prev.note ? `<div class="said">你說過要：${e(prev.note)}</div>` : ''}
      <div class="body">
        ${current ? `<label class="note">這一頁要做什麼？<span class="saved">記下了 ✓</span>
          <input type="text" maxlength="60" placeholder="例：回 Amy 的報價、補完第 3 頁" value="${e(current.note)}"></label>` : ''}
        <div class="label">足跡（點一下跳回去）</div>
        <ol>${items || '<div class="empty">切換幾個分頁，這裡就會有足跡</div>'}</ol>
        <div class="foot"><span><kbd>⌥</kbd><kbd>⇧</kbd><kbd>Z</kbd> 隨時叫我</span><button data-act="dash">📊 一週回顧</button></div>
      </div>`;
    card.querySelectorAll('img.fav').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
  }

  function show(msg, where) {
    mount();
    data = msg;
    render();
    card.classList.remove('side', 'top');
    card.classList.add(where);
    card.style.top = '';
    notch.classList.toggle('open', where === 'side');
    place();
    requestAnimationFrame(() => card.classList.add('in'));
    clearTimeout(hideTimer);
    if (where === 'top' && !msg.expanded) scheduleHide(msg.cheer ? 7000 : 5200);
    else setTimeout(() => card.querySelector('input')?.focus({ preventScroll: true }), 200);
  }

  function hide() {
    if (!card) return;
    card.classList.remove('in');
    notch.classList.remove('open');
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer);
    if (root.activeElement) return;
    hideTimer = setTimeout(hide, ms);
  }

  function cheer(msg) {
    mount();
    if (settings.notch === false) return;
    cheerEl.innerHTML = `<b>+${msg.n}</b>${e(msg.text)}`;
    cheerEl.classList.add('in');
    setTimeout(() => cheerEl.classList.remove('in'), 5000);
  }

  function onClick(ev) {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    const li = ev.target.closest('li[data-id]');
    if (act === 'del' && li) {
      ev.stopPropagation();
      chrome.runtime.sendMessage(li.dataset.key ? { type: 'deleteTask', key: li.dataset.key } : { type: 'deleteCrumb', crumbId: li.dataset.id });
      li.classList.add('gone');
      setTimeout(() => li.remove(), 200);
      return;
    }
    if (act === 'close') return hide();
    if (act === 'dash') { chrome.runtime.sendMessage({ type: 'openDashboard' }); return hide(); }
    if (li) { chrome.runtime.sendMessage({ type: 'jump', crumbId: li.dataset.id }); hide(); }
  }

  function onKey(ev) {
    if (ev.key === 'Escape') { hide(); return; }
    if (ev.key === 'Enter' && ev.target.matches('input') && data.current) {
      const note = ev.target.value;
      chrome.runtime.sendMessage({ type: 'note', crumbId: data.current.id, note });
      data.current.note = note;
      root.querySelector('.saved').classList.add('on');
      setTimeout(hide, 900);
    }
    ev.stopPropagation(); // don't trigger the page's own shortcuts while typing
  }

  // Close when clicking anywhere else on the page.
  document.addEventListener('pointerdown', (ev) => {
    if (card && card.classList.contains('in') && !ev.composedPath().includes(host)) hide();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'crumbs:toast') show(msg, msg.expanded ? 'side' : 'top');
    if (msg.type === 'crumbs:cheer') cheer(msg);
  });

  // Settings live in the extension's storage; follow changes live.
  try {
    chrome.storage.local.get(['state', 'notchY']).then(({ state, notchY: y }) => {
      if (state && state.settings) settings = state.settings;
      if (typeof y === 'number') notchY = y;
      mount();
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.state && ch.state.newValue) { settings = ch.state.newValue.settings || settings; applySettings(); }
      if (ch.notchY) { notchY = ch.notchY.newValue; if (notch) place(); }
    });
  } catch { mount(); }
})();
