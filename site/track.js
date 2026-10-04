// Page-view + download-button beacon → /api/hit (see worker/index.js). No cookies, nothing stored on the device.
(() => {
  if (!/^https?:$/.test(location.protocol) || /^(localhost|127\.)/.test(location.hostname)) return;
  const send = (k, p) => {
    const body = JSON.stringify({ k, p, r: document.referrer });
    if (!(navigator.sendBeacon && navigator.sendBeacon('/api/hit', body))) {
      fetch('/api/hit', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  };
  send('view', location.pathname);
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-track]');
    if (a) send('click', a.dataset.track);
  });
})();
