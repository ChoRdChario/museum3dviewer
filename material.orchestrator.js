
/**
 * material.orchestrator.js
 * Resilient UI wire-up that waits for both UI elements and __LM_MATERIALS__.
 */
(() => {
  const LOG_PREFIX = '[mat-orch]';
  const log = (...a) => console.log(LOG_PREFIX, ...a);
  const warn = (...a) => console.warn(LOG_PREFIX, ...a);

  const CANDIDATE_SELECTORS = {
    select: ['#materialSelect', '[data-lm=materialSelect]', '#mat-select', '#material-key-select'],
    range: ['#opacityRange', '[data-lm=opacityRange]', '#mat-opacity', 'input[type="range"][name="opacity"]'],
    ds:    ['#doubleSidedChk', '[data-lm=doubleSided]', '#mat-doublesided', 'input[type="checkbox"][name="doubleSided"]'],
    unlit: ['#unlitChk', '[data-lm=unlit]', '#mat-unlit', 'input[type="checkbox"][name="unlit"]'],
  };

  function qAny(selList) {
    for (const s of selList) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function discoverUI() {
    const select = qAny(CANDIDATE_SELECTORS.select);
    const range  = qAny(CANDIDATE_SELECTORS.range);
    const ds     = qAny(CANDIDATE_SELECTORS.ds);
    const unlit  = qAny(CANDIDATE_SELECTORS.unlit);
    return { select, range, ds, unlit };
  }

  function fillSelect(select, keys) {
    if (!select) return;
    select.innerHTML = '';
    keys.forEach((k) => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      select.appendChild(opt);
    });
  }

  function currentKey(select) { return select && select.value || null; }
  function ensureMaterials() { return window.__LM_MATERIALS__ || null; }

  function bindUI(ui) {
    const api = ensureMaterials();
    if (!api) return false;
    const keys = api.keys();
    if (!keys || keys.length === 0) return false;
    fillSelect(ui.select, keys);

    function applyFromUI() {
      const k = currentKey(ui.select) || keys[0];
      const ok = api.apply({
        key: k,
        opacity: ui.range ? parseFloat(ui.range.value) : 1.0,
        doubleSided: ui.ds ? !!ui.ds.checked : false,
        unlitLike: ui.unlit ? !!ui.unlit.checked : false,
      });
      if (!ok) warn('apply failed for key', k);
    }

    ui.select && ui.select.addEventListener('change', applyFromUI);
    ui.range  && ui.range.addEventListener('input', applyFromUI);
    ui.ds     && ui.ds.addEventListener('change', applyFromUI);
    ui.unlit  && ui.unlit.addEventListener('change', applyFromUI);

    if (ui.range && !ui.range.value) ui.range.value = 1.0;
    if (ui.select && !ui.select.value) ui.select.value = keys[0];
    applyFromUI();

    log('wired UI, keys=', keys.length);
    return true;
  }

  function boot() {
    log('V6_16h_SAFE_UI_PIPELINE.A2.6 boot');
    let tries = 0;
    const maxTries = 1200; // 120s
    const iv = setInterval(() => {
      const ui = discoverUI();
      const readyUI = !!(ui.select && ui.range);
      const api = ensureMaterials();
      const readyMat = !!(api && api.keys && api.keys().length);
      if (readyUI && readyMat) {
        clearInterval(iv);
        bindUI(ui);
      } else {
        tries++;
        if (tries % 30 === 0) {
          warn('waiting...', { tries, readyUI, readyMat, keys: (api && api.keys && api.keys().length) || 0 });
        }
        if (tries > maxTries) {
          clearInterval(iv);
          warn('UI or materials not found; keep idle.');
        }
      }
    }, 100);

    window.addEventListener('lm:materials-ready', () => {
      const ui = discoverUI();
      if (ui.select && ui.range) bindUI(ui);
    });
  }

  window.__LM_DEBUG_DUMP = () => {
    const api = ensureMaterials();
    return {
      vbKeys: (api && api.keys && api.keys()) || [],
      candidates: {
        select: CANDIDATE_SELECTORS.select,
        range:  CANDIDATE_SELECTORS.range,
        ds:     CANDIDATE_SELECTORS.ds,
        unlit:  CANDIDATE_SELECTORS.unlit,
      },
      THREE: !!(window.THREE),
    };
  };

  boot();
})();
