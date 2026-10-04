// Dev-only: inside preview.html, reuse the parent's fake chrome so panel and toast share one state.
(function () {
  try {
    if (window.parent !== window && window.parent.chrome && window.parent.__mock) {
      window.chrome = window.parent.chrome;
      return;
    }
  } catch { /* cross-origin parent */ }
  document.write('<script src="mock-chrome.js"><\/script>');
})();
