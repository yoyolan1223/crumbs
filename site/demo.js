// Hero demo: hop between apps → double-tap ⌃ → the sparrow's bar rises → Enter jumps back.
(() => {
  const $ = (id) => document.getElementById(id);
  const win = $('win'), title = $('winTitle'), body = $('winBody');
  const keys = $('keys'), bar = $('bar'), caption = $('caption');
  if (!win) return;

  const EN = document.documentElement.lang === 'en';
  const lines = (n) => Array.from({ length: n }, (_, i) => `<div class="l" style="width:${92 - (i * 13) % 35}%"></div>`).join('');
  const APPS = EN ? {
    word: { t: 'Final paper.docx — Word', b: `<div class="doc-t">Final paper: attention and phone use in college students</div>${lines(7)}` },
    slides: { t: 'Seed pitch deck v3 — Google Slides', b: '<div class="slide">Market size: TAM / SAM / SOM</div>' },
    line: { t: 'Messages', b: '<div class="chat"><span>Still on for the hike Saturday?</span><span class="me">Yes! 8am at the station</span><span>Great, I\'ll grab bagels 🥯</span></div>' },
  } : {
    word: { t: '期末報告.docx — Word', b: `<div class="doc-t">期末報告：大學生的注意力與手機使用</div>${lines(7)}` },
    slides: { t: 'MindGym 募資簡報 v3 — Google 簡報', b: '<div class="slide">市場規模 TAM / SAM / SOM</div>' },
    line: { t: 'LINE', b: '<div class="chat"><span>週六爬山還去嗎？</span><span class="me">去！8 點捷運站見</span><span>好～那我訂早餐 🥯</span></div>' },
  };
  const T = EN ? {
    still: 'Double-tap ⌃ to get back to your slides', word: 'Writing a paper in Word…', slides: 'Jumping over to the pitch deck…',
    line: 'A message pops up, quick reply…', ask: '“Wait, what was I doing?” Double-tap ⌃',
    bar: 'Sparrow: you were on your slides, and said you\'d finish page 8', enter: 'Press Enter to jump right back', back: 'Back on track 🍞',
  } : {
    still: '連按兩下 ⌃，接回剛剛的簡報', word: '在 Word 寫報告…', slides: '跑去改募資簡報…',
    line: 'LINE 跳出訊息，回一下…', ask: '「我剛剛在幹嘛？」連按兩下 ⌃',
    bar: '小麻雀：你剛剛在做簡報，還說要補第 8 頁', enter: '按 Enter，切回剛剛那一頁', back: '接回來了 🍞',
  };
  const show = (k) => {
    win.style.opacity = 0;
    setTimeout(() => { title.textContent = APPS[k].t; body.innerHTML = APPS[k].b; win.style.opacity = 1; }, 160);
  };

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    show('line'); bar.classList.add('show'); caption.textContent = T.still;
    return;
  }

  const kbds = keys.querySelectorAll('kbd');
  const steps = [
    [0, () => { show('word'); caption.textContent = T.word; }],
    [1700, () => { show('slides'); caption.textContent = T.slides; }],
    [3400, () => { show('line'); caption.textContent = T.line; }],
    [5400, () => { keys.classList.add('show'); caption.textContent = T.ask; }],
    [5700, () => kbds[0].classList.add('hit')],
    [5950, () => kbds[1].classList.add('hit')],
    [6350, () => { keys.classList.remove('show'); kbds.forEach((k) => k.classList.remove('hit')); bar.classList.add('show'); caption.textContent = T.bar; }],
    [8700, () => { caption.textContent = T.enter; }],
    [9400, () => { bar.classList.remove('show'); show('slides'); caption.textContent = T.back; }],
  ];
  const LOOP = 11600;

  let timers = [];
  const run = () => {
    timers.forEach(clearTimeout);
    timers = steps.map(([t, fn]) => setTimeout(fn, t));
    timers.push(setTimeout(run, LOOP));
  };
  // Only animate while visible.
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) run(); else timers.forEach(clearTimeout);
  }).observe($('stage'));
})();
