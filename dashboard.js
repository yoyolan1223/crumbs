// 麵包屑 Crumbs — 一週回顧 (weekly dashboard)
(() => {
  const C = self.Crumbs;
  const e = C.esc;
  const root = document.getElementById('dash');
  const tip = document.getElementById('tip');
  const send = (msg) => chrome.runtime.sendMessage(msg);

  let st = C.emptyState();
  let offset = 0;          // 0 = this week, 1 = last week …
  let editing = null;      // project id being edited
  let groupBy = 'site';    // what the daily chart is split by: site | project | kind
  let selDay = null;       // index (0–6) of the day opened below the chart

  const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const colorOf = (pid) => {
    if (pid === 'none') return 'var(--none)';
    const p = st.projects.find((x) => x.id === pid);
    return p ? C.PALETTE[dark() ? 'dark' : 'light'][p.color] : 'var(--none)';
  };
  const nameOf = (pid) => (pid === 'none' ? '未分類' : (st.projects.find((x) => x.id === pid) || {}).name || '已刪除的專案');
  const titleOf = (key) => (st.meta[key] || st.tasks[key] || {}).title || key;

  function hm(ms) {
    const m = Math.round(ms / 60e3);
    if (m < 60) return `${m} 分`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
  }
  const hShort = (ms) => (ms >= 36e5 ? (ms / 36e5).toFixed(1).replace(/\.0$/, '') + 'h' : Math.round(ms / 60e3) + 'm');

  async function load() {
    const { state } = await chrome.storage.local.get('state');
    st = C.migrate(state || {});
    render();
  }
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.state) {
      st = C.migrate(ch.state.newValue || {});
      if (!root.contains(document.activeElement) || !document.activeElement.matches('input')) render();
    }
  });

  // ── Pieces ─────────────────────────────────────────────────────
  const FOCUS_KINDS = ['create', 'work', 'todo', 'comm', 'learn', 'search'];

  function render() {
    const now = Date.now();
    const w = C.weekStats(st, now, offset);
    const prev = C.weekStats(st, now, offset + 1);
    const from = w.days[0].date, to = w.days[6].date;
    const range = `${from.getMonth() + 1}/${from.getDate()} – ${to.getMonth() + 1}/${to.getDate()}`;
    const focus = FOCUS_KINDS.reduce((s, k) => s + (w.kinds[k] || 0), 0);
    const activeDays = w.days.filter((d) => d.total > 0).length || 1;
    const t0 = from.setHours(0, 0, 0, 0), t1 = new Date(to).setHours(23, 59, 59, 999);
    const log = C.jarOf(st).log.filter((x) => x.at >= t0 && x.at <= t1);
    const comebacks = log.filter((x) => x.kind === 'comeback').length;
    const done = log.filter((x) => x.kind === 'done').length;

    // Projects, biggest first; 未分類 last.
    const projects = Object.values(w.projects).sort((a, b) => (a.id === 'none') - (b.id === 'none') || b.ms - a.ms);
    // What the chart is coloured by, and which day is open below it.
    const series = buildSeries(w, projects);
    const lastActive = w.days.map((d) => d.total > 0).lastIndexOf(true);
    const day = selDay ?? (lastActive >= 0 ? lastActive : 6);
    const top = projects.find((p) => p.id !== 'none');
    const unassignedShare = w.total ? (w.projects.none?.ms || 0) / w.total : 0;

    let say;
    if (!w.total) say = offset ? '那一週沒有足跡。' : '這週還沒有足跡。開始工作後，這裡會長出你的一週。';
    else if (!st.projects.length) say = `這週追蹤到 ${hm(w.total)}。幫它們分個專案吧，下面的「還沒分類」點一下就能歸類。`;
    else if (top) {
      const before = prev.projects[top.id]?.ms || 0;
      const diff = top.ms - before;
      say = `這週你最多時間花在「${nameOf(top.id)}」，${hm(top.ms)}` +
        (before ? `，${diff >= 0 ? '比上週多' : '比上週少'} ${hm(Math.abs(diff))}。` : '。') +
        (comebacks ? ` 還有 ${comebacks} 次從分心中自己回來，很棒。` : '');
    } else say = `這週追蹤到 ${hm(w.total)}，大部分還沒分類。`;

    root.innerHTML = `
      <header class="d-top">
        <div class="d-brand">${C.sparrow(w.total ? 'happy' : 'sleepy', 56)}
          <div><h1>一週回顧</h1><p class="d-range">${range}${offset ? '' : '・這週'}</p></div></div>
        <div class="d-nav" role="group" aria-label="切換週">
          <button data-act="older" aria-label="上一週">‹ 上週</button>
          <button data-act="newer" ${offset === 0 ? 'disabled' : ''} aria-label="下一週">下週 ›</button>
        </div>
      </header>
      <p class="bubble d-say">${e(say)}</p>

      <section class="tiles">
        ${tile('總共', hm(w.total), prev.total ? delta(w.total, prev.total) : '')}
        ${tile('每天平均', hm(w.total / activeDays), `${activeDays} 天有紀錄`)}
        ${tile('花在正事上', w.total ? Math.round((focus / w.total) * 100) + '%' : '—', '創作、工作、溝通、學習、查資料')}
        ${tile('從分心回來', comebacks + ' 次', done ? `完成 ${done} 件事` : '分心不扣分，回來才算數')}
      </section>

      <section class="card">
        <div class="card-h"><h2>每天花在哪裡</h2>
          <div class="seg-by" role="group" aria-label="依什麼分顏色">
            ${[['site', 'App／網站'], ['project', '專案'], ['kind', '類型']].map(([v, l]) =>
              `<button data-act="by" data-v="${v}" class="${groupBy === v ? 'on' : ''}">${l}</button>`).join('')}
          </div>
        </div>
        ${legend(series.order)}
        ${barChart(w.days, series, day)}
        <p class="chart-hint">點任何一天，看那天花在哪裡 ↓</p>
      </section>

      ${dayDetail(w.days[day], series)}

      <section class="card">
        <div class="card-h"><h2>專案</h2><span class="hint">關鍵字會自動把分頁歸進專案，也可以在側欄手動指定</span></div>
        <ol class="plist">${projects.length ? projects.map((p) => projectRow(p, prev, w.total)).join('') : '<li class="empty-row">這週還沒有資料</li>'}</ol>
        ${addProjectForm()}
      </section>

      ${unassigned(w)}

      <section class="card">
        <div class="card-h"><h2>做事的類型</h2><span class="hint">點一列看它包含什麼、這週算進了哪些 App 和網站</span></div>
        ${kindBars(w.kinds, w.total, w)}
      </section>

      <p class="d-foot">資料只存在這台電腦的瀏覽器裡，保留 60 天。${unassignedShare > .5 && st.projects.length ? '・還沒分類的時間超過一半，加幾個關鍵字會更準。' : ''}</p>`;
  }

  const tile = (label, value, sub) => `<div class="tile"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  function delta(a, b) {
    const d = a - b;
    if (Math.abs(d) < 5 * 60e3) return '跟上週差不多';
    return `${d > 0 ? '比上週多' : '比上週少'} ${hm(Math.abs(d))}`;
  }

  const metaOf = (key) => st.meta[key] || st.tasks[key] || {};
  const siteOf = (key) => metaOf(key).site || key.replace(/^app:([^|]*)\|.*$/, '$1') || '其他';
  const kindOf = (key) => metaOf(key).kind || 'browse';
  const kindName = (k) => (C.KIND[k] || C.KIND.browse).label;
  const OTHER = { id: '__other', name: '其他', color: 'var(--none)' };

  // The coloured groups for the chart. Top 7 by time get the palette (in order), the rest fold into 其他.
  function buildSeries(w, projects) {
    if (groupBy === 'project') {
      const order = projects.map((p) => ({ id: p.id, name: nameOf(p.id), color: colorOf(p.id) }));
      return { order, of: (day) => day.by };
    }
    const keyOf = groupBy === 'kind' ? kindOf : siteOf;
    const totals = {};
    for (const d of w.days) for (const [k, ms] of Object.entries(d.rec)) totals[keyOf(k)] = (totals[keyOf(k)] || 0) + ms;
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const pal = C.PALETTE[dark() ? 'dark' : 'light'];
    const top = ranked.slice(0, 7);
    const order = top.map((id, i) => ({ id, name: groupBy === 'kind' ? kindName(id) : id, color: pal[i] }));
    if (ranked.length > 7) order.push(OTHER);
    const keep = new Set(top);
    return {
      order,
      of: (day) => {
        const by = {};
        for (const [k, ms] of Object.entries(day.rec)) {
          const g = keep.has(keyOf(k)) ? keyOf(k) : OTHER.id;
          by[g] = (by[g] || 0) + ms;
        }
        return by;
      },
    };
  }

  function legend(order) {
    if (!order.length) return '';
    return `<ul class="legend">${order.map((s) => `<li><i style="background:${s.color}"></i>${e(s.name)}</li>`).join('')}</ul>`;
  }

  // Stacked columns, one per day. One y-axis (hours), recessive grid, 2px gaps, 4px rounded tops.
  function barChart(days, series, sel) {
    const W = 640, H = 240, padL = 34, padB = 26, padT = 18, padR = 4;
    const max = Math.max(36e5, ...days.map((d) => d.total));
    const stepH = max > 8 * 36e5 ? 2 : 1;
    const topH = Math.ceil(max / 36e5 / stepH) * stepH;
    const y = (ms) => padT + (H - padT - padB) * (1 - ms / (topH * 36e5));
    const colW = (W - padL - padR) / 7;
    const barW = Math.min(46, colW * 0.56);
    let grid = '';
    for (let h = 0; h <= topH; h += stepH) {
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(h * 36e5)}" y2="${y(h * 36e5)}" class="${h ? 'grid' : 'base'}"/>
        <text x="${padL - 6}" y="${y(h * 36e5) + 4}" class="ax" text-anchor="end">${h}h</text>`;
    }
    let bars = '';
    days.forEach((d, i) => {
      const x = padL + colW * i + (colW - barW) / 2;
      const by = series.of(d);
      if (i === sel && d.total) bars += `<rect x="${padL + colW * i + 3}" y="${padT - 14}" width="${colW - 6}" height="${H - padT - padB + 14}" rx="10" class="selday"/>`;
      let acc = 0;
      const segs = series.order.filter((s) => by[s.id]);
      segs.forEach((s, j) => {
        const ms = by[s.id];
        const y1 = y(acc + ms), y0 = y(acc);
        const last = j === segs.length - 1;
        const h = Math.max(0, y0 - y1 - (j ? 2 : 0)); // 2px surface gap between stacked segments
        const r = last ? Math.min(4, h / 2) : 0;
        const path = r
          ? `M${x},${y1 + h}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + barW - r}Q${x + barW},${y1} ${x + barW},${y1 + r}V${y1 + h}Z`
          : `M${x},${y1}H${x + barW}V${y1 + h}H${x}Z`;
        bars += `<path d="${path}" fill="${s.color}" class="seg" data-tip="${e(`${d.label}（${d.md}）· ${s.name} · ${hm(ms)}`)}"/>`;
        acc += ms;
      });
      if (d.total) bars += `<text x="${x + barW / 2}" y="${y(d.total) - 6}" class="tot" text-anchor="middle">${hShort(d.total)}</text>`;
      bars += `<text x="${x + barW / 2}" y="${H - 8}" class="ax ${d.label === '今天' ? 'today' : ''} ${i === sel ? 'sel' : ''}" text-anchor="middle">${d.label}</text>`;
      // A generous hit target for the whole day: hover for the total, click to open the day.
      bars += `<rect x="${padL + colW * i}" y="${padT - 14}" width="${colW}" height="${H - padT - padB + 34}" fill="transparent" class="hit"
        data-act="day" data-i="${i}" data-tip="${e(`${d.label}（${d.md}）· 共 ${hm(d.total)}・點開看細節`)}"/>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每天花費時間的堆疊長條圖">${grid}${bars}</svg></div>`;
  }

  // 「那一天花在哪裡」: by app / site, each with the actual documents / pages.
  function dayDetail(d, series) {
    if (!d || !d.total) return '';
    const sites = {};
    for (const [k, ms] of Object.entries(d.rec)) {
      const s = (sites[siteOf(k)] = sites[siteOf(k)] || { name: siteOf(k), ms: 0, items: [], kinds: {} });
      s.ms += ms;
      s.items.push([k, ms]);
      s.kinds[kindOf(k)] = (s.kinds[kindOf(k)] || 0) + ms;
    }
    const rows = Object.values(sites).filter((r) => r.ms >= 60e3).sort((a, b) => b.ms - a.ms);
    if (!rows.length) return '';
    const max = rows[0].ms;
    // Same colour as the chart when it's split by app / site.
    const colorFor = (name) => (groupBy === 'site' && (series.order.find((s) => s.id === name) || OTHER).color) || 'var(--crumb)';
    const W = '日一二三四五六';
    return `<section class="card day">
      <div class="card-h"><h2>${d.md}（${W[d.date.getDay()]}）花在哪裡</h2><span class="hint">共 ${hm(d.total)}・點一列看做了哪些事</span></div>
      <ol class="dlist">${rows.map((r) => {
        const topKind = Object.entries(r.kinds).sort((a, b) => b[1] - a[1])[0][0];
        const items = r.items.sort((a, b) => b[1] - a[1]);
        const single = items.length === 1 && titleOf(items[0][0]) === r.name;
        return `<li><details>
          <summary>
            <span class="dn"><i class="dot" style="background:${colorFor(r.name)}"></i>${e(r.name)}<em>${kindName(topKind)}</em></span>
            <span class="db2"><i style="width:${(r.ms / max) * 100}%;background:${colorFor(r.name)}"></i></span>
            <span class="dv">${hm(r.ms)}</span>
          </summary>
          ${single ? '' : `<ul class="ditems">${items.filter(([, ms]) => ms >= 30e3).slice(0, 12).map(([k, ms]) =>
            `<li><span>${e(titleOf(k))}</span><em>${hm(ms)}</em></li>`).join('')}
            ${items.length > 12 ? `<li class="more">還有 ${items.length - 12} 項</li>` : ''}</ul>`}
        </details></li>`;
      }).join('')}</ol>
    </section>`;
  }

  function projectRow(p, prev, total) {
    const proj = st.projects.find((x) => x.id === p.id);
    const before = prev.projects[p.id]?.ms || 0;
    const tasks = Object.entries(p.tasks).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const pct = total ? Math.round((p.ms / total) * 100) : 0;
    if (editing === p.id && proj) {
      return `<li class="prow editing">
        <form class="pedit" data-act="saveProject" data-id="${e(p.id)}">
          <input name="name" value="${e(proj.name)}" aria-label="專案名稱" maxlength="30">
          <input name="rules" value="${e(proj.rules.join(', '))}" placeholder="關鍵字，用逗號分隔（網址、網站、標題都會比對）" aria-label="關鍵字">
          <div class="row"><button type="button" class="link danger" data-act="deleteProject" data-id="${e(p.id)}">刪除專案</button>
            <span class="sp"></span><button type="button" class="btn ghost" data-act="cancelEdit">取消</button><button class="btn primary">儲存</button></div>
        </form></li>`;
    }
    return `<li class="prow">
      <i class="sw" style="background:${colorOf(p.id)}"></i>
      <div class="pmain">
        <div class="ptop"><b>${e(nameOf(p.id))}</b><span class="pms">${hm(p.ms)}</span><span class="ppct">${pct}%</span></div>
        <div class="pbar"><i style="width:${pct}%;background:${colorOf(p.id)}"></i></div>
        <div class="pmeta">${before ? delta(p.ms, before) : '上週沒有紀錄'}${proj && proj.rules.length ? `・關鍵字：${e(proj.rules.join('、'))}` : ''}</div>
        <ul class="ptasks">${tasks.map(([k, ms]) => `<li><span>${e(titleOf(k))}</span><em>${hm(ms)}</em></li>`).join('')}</ul>
      </div>
      ${proj ? `<button class="icon" data-act="editProject" data-id="${e(p.id)}" aria-label="編輯專案" title="編輯">✎</button>` : ''}
    </li>`;
  }

  function addProjectForm() {
    return `<form class="padd" data-act="addProject">
      <input name="name" placeholder="新專案名稱，例如：MindGym 募資" maxlength="30" aria-label="新專案名稱">
      <input name="rules" placeholder="關鍵字：募資, deck, pitch" aria-label="關鍵字">
      <button class="btn primary">＋ 新增</button>
    </form>`;
  }

  function unassigned(w) {
    const none = w.projects.none;
    if (!none || !st.projects.length) return '';
    const rows = Object.entries(none.tasks).filter(([, ms]) => ms >= 60e3).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return `<section class="card">
      <div class="card-h"><h2>還沒分類</h2><span class="hint">點一下選專案，以後同一個網頁都會記得</span></div>
      <ul class="ulist">${rows.map(([k, ms]) => `<li>
        <span class="ut">${e(titleOf(k))}<small>${e((st.meta[k] || {}).site || '')}</small></span><em>${hm(ms)}</em>
        <select data-act="assign" data-key="${e(k)}" aria-label="歸到專案"><option value="">歸到…</option>
          ${st.projects.map((p) => `<option value="${e(p.id)}">${e(p.name)}</option>`).join('')}</select></li>`).join('')}</ul>
    </section>`;
  }

  // Each kind says what it means, and opens to show what actually landed in it this week.
  function kindBars(kinds, total, w) {
    const rows = Object.entries(kinds).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<p class="empty-row">這週還沒有資料</p>';
    const max = rows[0][1];
    const sitesIn = (kind) => {
      const by = {};
      for (const d of w.days) for (const [k, ms] of Object.entries(d.rec)) if (kindOf(k) === kind) by[siteOf(k)] = (by[siteOf(k)] || 0) + ms;
      return Object.entries(by).sort((a, b) => b[1] - a[1]);
    };
    return `<ul class="kbars">${rows.map(([k, ms]) => {
      const K = C.KIND[k] || C.KIND.browse;
      const list = sitesIn(k);
      return `<li><details>
        <summary>
          <span class="kl">${K.label}</span>
          <span class="kb"><i style="width:${(ms / max) * 100}%"></i></span>
          <span class="kv">${hm(ms)}<small>${Math.round((ms / total) * 100)}%</small></span>
        </summary>
        <p class="kdesc">${e(K.desc)}</p>
        <ul class="ditems">${list.slice(0, 8).map(([s, t]) => `<li><span>${e(s)}</span><em>${hm(t)}</em></li>`).join('')}</ul>
      </details></li>`;
    }).join('')}</ul>`;
  }

  // ── Events ─────────────────────────────────────────────────────
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'older') { offset++; selDay = null; render(); }
    if (act === 'newer' && offset > 0) { offset--; selDay = null; render(); }
    if (act === 'by') { groupBy = el.dataset.v; render(); }
    if (act === 'day') { selDay = Number(el.dataset.i); render(); root.querySelector('.card.day')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    if (act === 'editProject') { editing = el.dataset.id; render(); root.querySelector('.pedit input')?.focus(); }
    if (act === 'cancelEdit') { editing = null; render(); }
    if (act === 'deleteProject' && confirm('刪除這個專案？時間紀錄會變回「未分類」，不會消失。')) {
      editing = null; send({ type: 'deleteProject', id: el.dataset.id });
    }
  });
  root.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.dataset.act === 'addProject') {
      if (!f.elements.name.value.trim()) return f.elements.name.focus();
      send({ type: 'addProject', name: f.elements.name.value, rules: f.elements.rules.value });
      f.reset();
    }
    if (f.dataset.act === 'saveProject') {
      editing = null;
      send({ type: 'updateProject', id: f.dataset.id, name: f.elements.name.value, rules: f.elements.rules.value });
    }
  });
  root.addEventListener('change', (ev) => {
    if (ev.target.dataset.act === 'assign' && ev.target.value) send({ type: 'assign', key: ev.target.dataset.key, projectId: ev.target.value });
  });

  // Tooltip: follow the pointer over any mark with data-tip.
  root.addEventListener('pointermove', (ev) => {
    const t = ev.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + 'px';
    tip.style.top = ev.clientY + 14 + 'px';
  });
  root.addEventListener('pointerleave', () => { tip.hidden = true; });

  load();
})();
