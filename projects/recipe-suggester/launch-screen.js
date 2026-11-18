/* ホーム画面から開いた最初のページだけに、起動用の絵を表示します。 */
(() => {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone) return;
  const previous = performance.getEntriesByType('navigation')[0];
  if (previous && previous.type !== 'navigate') return;

  const splash = document.getElementById('launch-screen');
  const picture = splash.querySelector('img');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let appReady = false;
  let firstPaint;
  let timer;
  function hide() {
    clearTimeout(timer);
    splash.hidden = true;
  }
  function finishWhenReady() {
    if (appReady && firstPaint !== undefined && !splash.hidden) {
      const remaining = (reducedMotion ? 0 : 700) - (performance.now() - firstPaint);
      clearTimeout(timer);
      timer = setTimeout(hide, Math.max(0, remaining));
    }
  }
  picture.addEventListener('load', () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      firstPaint = performance.now();
      finishWhenReady();
    }));
  }, {once: true});
  picture.addEventListener('error', hide, {once: true});
  document.addEventListener('meal-palette-ready', () => {
    appReady = true;
    finishWhenReady();
  }, {once: true});
  window.addEventListener('pagehide', hide, {once: true});
  splash.hidden = false;
  timer = setTimeout(hide, 4000);
  picture.src = picture.dataset.src;
})();
