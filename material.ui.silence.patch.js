/* LociMyu Material UI Silence+Reflect Patch v2.3
 * Goal:
 * - When switching material (select change), DO NOT leak previous material's UI value into the newly selected one.
 * - Immediately reflect the newly selected material's own values into the UI controls (e.g., opacity slider).
 * - During a short guard window, suppress any 'input'/'change' events from UI controls so orchestrators don't persist/apply stale values.
 *
 * How it works:
 * 1) On <select> change => set a global silence lock for ~420ms.
 * 2) During the lock, capture-phase listeners on range/number inputs stop events (unless flagged as __lm_reflect__).
 * 3) We read the selected material's current value from the Three.js scene via viewer bridge and set UI controls directly.
 * 4) No synthetic 'input' events are dispatched (prevents accidental persistence). Numeric display is updated manually.
 */
(function(){
  const TAG = '[silence-patch v2.3]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // Silence window (ms)
  const SILENCE_MS = 420;

  // Global guard timestamp
  const isLocked = () => {
    const until = window.__LM_SILENCE_UNTIL__ || 0;
    return performance.now() < until;
  };
  const lock = (ms=SILENCE_MS) => {
    const until = performance.now() + ms;
    window.__LM_SILENCE_UNTIL__ = until;
    log('silence', ms+'ms (select-change)');
  };

  // Helpers: element finders
  const qs = (sel) => document.querySelector(sel);
  const findSelect = () =>
    qs('#pm-material') ||
    qs('select[aria-label="Select material"]') ||
    qs('#materialSelect') ||
    qs('#mat-select') ||
    qs('#matKeySelect') ||
    qs('select[name*="material"]') ||
    qs('select[id*="material"]');

  const findOpacityRange = () =>
    qs('#pm-opacity') ||
    qs('#opacityRange') ||
    qs('input[type="range"][name*="opacity"]') ||
    qs('input[type="range"][id*="opacity"]');

  const findOpacityNumber = () =>
    qs('#pm-opacity-num') ||
    qs('input[type="number"][name*="opacity"]') ||
    qs('input[type="number"][id*="opacity"]');

  const clamp01 = (v)=> Math.max(0, Math.min(1, v));

  // Read scene & sample opacity by material name
  const sampleOpacityFromScene = (matName) => {
    try {
      const br = window.__LM_VIEWER_BRIDGE__ || window.LM_VIEWER_BRIDGE || window.viewerBridge;
      const scene = br?.getScene?.();
      if (!scene?.traverse) return null;
      let found = null;
      scene.traverse(o=>{
        if (!o?.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || !m.name) continue;
          if (m.name === matName) {
            if (typeof m.opacity === 'number') {
              found = m.opacity;
              return;
            }
          }
        }
      });
      return (typeof found === 'number') ? clamp01(found) : null;
    } catch(e){
      warn('sampleOpacityFromScene failed:', e);
      return null;
    }
  };

  // UI setters without firing events
  const reflectOpacityToUI = (opacity01) => {
    const rng = findOpacityRange();
    const num = findOpacityNumber();

    if (!rng && !num) return false;

    // Decide scale: 0..1 or 0..100
    let vRange = opacity01;
    if (rng) {
      const max = Number(rng.max || '1');
      const step = Number(rng.step || '0.01');
      // If it looks like percentage slider, convert
      if (max > 1.01 || step >= 1) {
        vRange = Math.round(opacity01 * 100);
      }
      rng.value = String(vRange);
    }
    if (num) {
      // Try to mirror scale of number field as well
      const maxN = Number(num.max || '1');
      const stepN = Number(num.step || '0.01');
      let vNum = opacity01;
      if (maxN > 1.01 || stepN >= 1) {
        vNum = Math.round(opacity01 * 100);
      }
      num.value = String(vNum);
    }
    return true;
  };

  // Capture-phase event suppressor for range/number during lock
  const suppressor = (ev) => {
    if (!isLocked()) return;
    const detail = ev?.detail || {};
    if (detail && detail.__lm_reflect__ === true) {
      // allow programmatic reflect if ever used
      return;
    }
    // Block everything else
    ev.stopImmediatePropagation?.();
    ev.stopPropagation?.();
    // preventDefault for safety on changes
    ev.preventDefault?.();
    const t = ev.target && (ev.target.id || ev.target.name || ev.target.tagName);
    log('blocked', ev.type, t);
  };

  const installSuppressors = () => {
    const opts = {capture: true, passive: false};
    // Delegate on document to also catch late-bound inputs
    document.addEventListener('input', suppressor, opts);
    document.addEventListener('change', suppressor, opts);
  };

  // Main: hook select change
  const install = () => {
    const sel = findSelect();
    if (!sel) {
      // Retry a few times because UI may come late
      let tries = 0;
      const timer = setInterval(()=>{
        tries++;
        const s = findSelect();
        if (s) {
          clearInterval(timer);
          bindSelect(s);
        } else if (tries > 40) { // ~12s
          clearInterval(timer);
          warn('select not found');
        }
      }, 300);
      return;
    }
    bindSelect(sel);
  };

  const bindSelect = (sel) => {
    // Avoid multiple bindings
    if (sel.__lm_silence_bound__) return;
    sel.__lm_silence_bound__ = true;

    sel.addEventListener('change', (ev) => {
      // Start silence window immediately
      lock();

      // Get selected material key (prefer text; fallback to value)
      const opt = sel.options[sel.selectedIndex];
      const matName = (opt?.text || opt?.value || '').trim();

      // Sample from scene
      let op = null;
      if (matName) op = sampleOpacityFromScene(matName);
      if (typeof op !== 'number') {
        // Fallback: keep current slider (but do NOT dispatch events)
        const rng = findOpacityRange();
        if (rng) {
          if (Number(rng.max || '1') > 1.01) {
            op = clamp01((Number(rng.value || '100')/100) || 0);
          } else {
            op = clamp01(Number(rng.value || '1') || 0);
          }
        } else {
          op = 1;
        }
      }

      // Reflect immediately to UI without emitting 'input'/'change'
      reflectOpacityToUI(op);

      // Release the silence slightly later, giving orchestrators time to swap current material safely
      setTimeout(()=>{
        // Keep a tiny buffer to ensure any late listeners have finished
        window.__LM_SILENCE_UNTIL__ = performance.now() + 30;
      }, SILENCE_MS - 60);
    }, {capture: true}); // capture ensures we run before bubble-phase orchestrators

    installSuppressors();
    log('hooked select for silence+reflect');
  };

  // Kick
  if (!window.__LM_SILENCE_PATCH_INSTALLED__) {
    window.__LM_SILENCE_PATCH_INSTALLED__ = true;
    install();
    log('installed');
  } else {
    log('already installed (skipped)');
  }
})();