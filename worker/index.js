// Tiny privacy-friendly analytics in front of the static site.
//   POST /api/hit       ← beacon from track.js (page views + download-button clicks)
//   GET  /downloads/*   ← counted server-side, then served from site/
//   GET  /stats?key=…   ← private dashboard (key = STATS_KEY secret)
const BOT = /bot|crawl|spider|slurp|preview|curl|wget|python|headless|lighthouse|facebookexternalhit|embedly/i;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === '/api/hit' && req.method === 'POST') {
      let body = {};
      try { body = await req.json(); } catch {}
      const kind = body.k === 'click' ? 'click' : 'view';
      const path = String(body.p || '/').slice(0, 120);
      ctx.waitUntil(record(env, req, kind, path, body.r));
      return new Response(null, { status: 204 });
    }

    if (url.pathname.startsWith('/downloads/')) {
      const res = await env.ASSETS.fetch(req);
      // HEAD / range resumes / failed requests don't count as a new download
      if (req.method === 'GET' && res.status === 200 && !req.headers.get('range')) {
        ctx.waitUntil(record(env, req, 'download', url.pathname, req.headers.get('referer')));
      }
      return res;
    }

    if (url.pathname === '/stats') {
      if (!env.STATS_KEY || url.searchParams.get('key') !== env.STATS_KEY) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(await statsPage(env), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
      });
    }

    return env.ASSETS.fetch(req);
  },
};

async function record(env, req, kind, path, referrer) {
  const ua = req.headers.get('user-agent') || '';
  if (BOT.test(ua)) return;
  const now = Date.now();
  const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10); // Asia/Taipei
  const ip = req.headers.get('cf-connecting-ip') || '';
  const visitor = (await sha256(`${ip}|${ua}|${day}|${env.STATS_KEY || ''}`)).slice(0, 16);
  let ref = null;
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, '');
    if (h && h !== new URL(req.url).hostname) ref = h;
  } catch {}
  const device = /iphone|ipad/i.test(ua) ? 'iphone' : /android/i.test(ua) ? 'android'
    : /mac os x/i.test(ua) ? 'mac' : /windows/i.test(ua) ? 'windows' : 'other';
  await env.DB.prepare(
    'INSERT INTO hits (ts, day, kind, path, ref, country, device, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(now, day, kind, path, ref, req.cf?.country || null, device, visitor).run();
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── /stats ────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function statsPage(env) {
  const q = (sql) => env.DB.prepare(sql).all().then((r) => r.results);
  const since = "day >= date('now', '+8 hours', '-29 days')";
  const [total, daily, pages, refs, countries, devices, clicks] = await Promise.all([
    q(`SELECT kind, COUNT(*) n, COUNT(DISTINCT day || visitor) u FROM hits GROUP BY kind`),
    q(`SELECT day,
         SUM(kind='view') views, COUNT(DISTINCT CASE WHEN kind='view' THEN visitor END) visitors,
         SUM(kind='download') downloads
       FROM hits WHERE ${since} GROUP BY day ORDER BY day DESC`),
    q(`SELECT path k, COUNT(*) n FROM hits WHERE kind='view' AND ${since} GROUP BY path ORDER BY n DESC LIMIT 10`),
    q(`SELECT COALESCE(ref, '（直接開啟）') k, COUNT(*) n FROM hits WHERE kind='view' AND ${since} GROUP BY k ORDER BY n DESC LIMIT 10`),
    q(`SELECT COALESCE(country, '?') k, COUNT(*) n FROM hits WHERE kind='view' AND ${since} GROUP BY k ORDER BY n DESC LIMIT 10`),
    q(`SELECT device k, COUNT(*) n FROM hits WHERE kind='view' AND ${since} GROUP BY k ORDER BY n DESC`),
    q(`SELECT path k, COUNT(*) n FROM hits WHERE kind IN ('click', 'download') AND ${since} GROUP BY kind, path ORDER BY n DESC LIMIT 10`),
  ]);
  const t = Object.fromEntries(total.map((r) => [r.kind, r]));
  const max = Math.max(1, ...daily.map((d) => d.views));
  const tile = (label, v, sub) => `<div class="tile"><b>${v ?? 0}</b><span>${label}</span>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const list = (title, rows) => `<section><h2>${title}</h2>${rows.length ? `<table>${rows.map((r) =>
    `<tr><td>${esc(r.k)}</td><td class="n">${r.n}</td></tr>`).join('')}</table>` : '<p class="empty">還沒有資料</p>'}</section>`;

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>網站統計 — Crumbs</title><style>
:root{--bg:#faf6ef;--card:#fff;--ink:#3b2f24;--muted:#8a7b6b;--line:#eadfce;--bar:#c98a4b}
@media (prefers-color-scheme:dark){:root{--bg:#1f1a15;--card:#2a231c;--ink:#f1e7da;--muted:#a8998a;--line:#3d342a;--bar:#d9a066}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"PingFang TC",sans-serif;padding:24px 16px}
main{max-width:860px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}.meta{color:var(--muted);margin:0 0 20px;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.tile,section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.tile b{display:block;font-size:28px}.tile span{color:var(--muted);font-size:13px}.tile i{display:block;font-style:normal;color:var(--muted);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px}
h2{font-size:14px;margin:0 0 8px;color:var(--muted);font-weight:600}table{width:100%;border-collapse:collapse}
td,th{padding:5px 4px;border-bottom:1px solid var(--line);text-align:left;font-weight:normal}th{color:var(--muted);font-size:12px}
.n{text-align:right;font-variant-numeric:tabular-nums}.empty{color:var(--muted);margin:0}
.bar{height:8px;border-radius:4px;background:var(--bar);min-width:2px}td.b{width:40%}
</style></head><body><main>
<h1>🍞 Crumbs 網站統計</h1>
<p class="meta">每頁瀏覽、當天不重複訪客、DMG 下載次數。不使用 cookie、不存 IP；已排除機器人與 curl。</p>
<div class="tiles">
${tile('總瀏覽', t.view?.n)}${tile('不重複訪客（按天累計）', t.view?.u)}${tile('DMG 下載', t.download?.n, `${t.download?.u ?? 0} 位不同訪客`)}${tile('按下載鈕', t.click?.n)}
</div>
<section><h2>最近 30 天（台灣時間）</h2>${daily.length ? `<table><tr><th>日期</th><th class="n">瀏覽</th><th class="n">訪客</th><th class="n">下載</th><th></th></tr>${daily.map((d) =>
  `<tr><td>${d.day}</td><td class="n">${d.views}</td><td class="n">${d.visitors}</td><td class="n">${d.downloads}</td><td class="b"><div class="bar" style="width:${(d.views / max) * 100}%"></div></td></tr>`).join('')}</table>` : '<p class="empty">還沒有資料</p>'}</section>
<div class="grid">
${list('從哪裡來', refs)}${list('看了哪些頁', pages)}${list('下載與按鈕', clicks)}${list('國家', countries)}${list('裝置', devices)}
</div></main></body></html>`;
}
