// material.id.unify.v1.js  v1.8 (ready-gated, idempotent, robust)
(function () {
  const TAG = '[mat-id-unify]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  let armed = false;

  function findOpacitySection(panel){
    const sections = Array.from(panel.querySelectorAll('section, fieldset, div'));
    return sections.find(el => {
      const hasRange = !!el.querySelector('input[type="range"]');
      const txt = (el.textContent || '').toLowerCase();
      return hasRange && (txt.includes('opacity') || txt.includes('透明'));
    });
  }

  function applyOnce(){
    if (armed) return true;
    const panel = document.querySelector('#panel-material');
    if (!panel) { warn('panel not found'); return false; }

    const sec = findOpacitySection(panel);
    if (!sec) { warn('opacity section not found (waiting)'); return false; }

    // === original binding logic (kept minimal & safe) ===
    // Unify element IDs so other modules can reliably select them
    const range = sec.querySelector('input[type="range"]');
    if (range && !range.id) range.id = 'lm-opacity-range';
    sec.id = sec.id || 'lm-opacity-section';

    // Signal readiness for downstream consumers
    window.dispatchEvent(new CustomEvent('lm:materials-ui-ready', {
      detail: { sectionId: sec.id, rangeId: range ? range.id : null }
    }));
    log('bound', { sectionId: sec.id, rangeId: range ? range.id : null });

    armed = true;
    return true;
  }

  // Try immediately
  if (applyOnce()) return;

  // Gate by scene ready & DOM mutations
  let retries = 30;
  const retryTick = () => {
    if (applyOnce()) { obs && obs.disconnect(); return; }
    if (--retries <= 0) { warn('give up waiting'); obs && obs.disconnect(); return; }
    setTimeout(retryTick, 150);
  };

  // Wait for scene ready (often implies UI finished laying out)
  const onScene = () => setTimeout(retryTick, 0);
  window.addEventListener('lm:scene-ready', onScene, { once:true });

  // Also observe panel-material for dynamic children
  const panel = document.querySelector('#panel-material');
  let obs = null;
  if (panel && 'MutationObserver' in window){
    obs = new MutationObserver(()=> { if (applyOnce()){ obs.disconnect(); } });
    obs.observe(panel, { childList: true, subtree: true });
  } else {
    // Fallback: timed retries
    retryTick();
  }
})();