// material.orchestrator.js  v2.6
(function () {
  const TAG = '[mat-orch v2.6]';
  try {
    // Resolve UI controls (be resilient to missing IDs)
    const panel = document.querySelector('#panel-material') || document;
    const opacitySection = panel; // ids will scope us sufficiently

    const $ = sel => panel.querySelector(sel);
    const dd = $('#pm-material') || opacitySection.querySelector('select');
    const range = $('#pm-opacity') || opacitySection.querySelector('input[type="range"]');
    const value = $('#pm-opacity-value') || (() => {
      const s = document.createElement('span');
      s.id = 'pm-opacity-value';
      s.style.marginLeft = '8px';
      (range?.parentElement || opacitySection).appendChild(s);
      return s;
    })();

    if (!dd || !range) {
      console.warn(TAG, 'pm controls missing', { hasDd: !!dd, hasRange: !!range });
      return;
    }
    console.log(TAG, 'UI bound');

    // Find a usable scene from common viewer globals
    function getScene() {
      return (window.__lm_viewer && window.__lm_viewer.scene) ||
             (window.lm_viewer && window.lm_viewer.scene) ||
             (window.viewer && window.viewer.scene) ||
             window.__lm_scene || window.scene || null;
    }

    function fmt(v) {
      const n = Math.max(0, Math.min(1, Number(v) || 0));
      return n.toFixed(2);
    }

    // Apply opacity to all sub-materials with matching name
    function applyOpacity(matName, v) {
      const scene = getScene();
      if (!scene) return;
      const target = String(matName || '').trim();
      scene.traverse(obj => {
        const setOne = (m) => {
          if (!m || !m.name) return;
          if (m.name !== target) return;
          const x = Math.max(0, Math.min(1, v));
          m.transparent = x < 1.0;
          m.opacity = x;
          // Slightly better visuals when transparent
          m.depthWrite = x >= 0.999;
          m.needsUpdate = true;
        };
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach(setOne);
        else setOne(mat);
      });
    }

    // ephemeral in-memory store (per sheet id)
    const state = (window.__lm_mat_state = window.__lm_mat_state || { bySheet: {} });
    let sheetCtx = null;

    // React to sheet-context so we can namespace values
    document.addEventListener('lm:sheet-context', (ev) => {
      sheetCtx = ev.detail || ev;
      console.log(TAG, 'sheet-context', sheetCtx);
    }, { passive: true });

    function getKey() {
      const sid = sheetCtx?.spreadsheetId || '_local';
      const gid = sheetCtx?.sheetGid ?? '_g0';
      const mat = dd.value || dd.options[dd.selectedIndex]?.text || '';
      return `${sid}:${gid}:${mat}`;
    }

    function loadUIForCurrent() {
      const key = getKey();
      const saved = state.bySheet[key];
      const val = (typeof saved === 'number') ? saved : 1.0;
      range.value = String(val);
      value.textContent = fmt(val);
      applyOpacity(dd.value, val);
    }

    // UI events
    dd.addEventListener('change', () => {
      loadUIForCurrent();
    });

    function handleRangeInput() {
      const v = Math.max(0, Math.min(1, Number(range.value) || 0));
      value.textContent = fmt(v);
      applyOpacity(dd.value, v);
      // save in memory and notify persistence layer
      const key = getKey();
      state.bySheet[key] = v;
      document.dispatchEvent(new CustomEvent('lm:material-opacity-changed', { detail: {
        materialKey: dd.value, opacity: v, sheet: sheetCtx
      }}));
    }

    range.addEventListener('input', handleRangeInput);
    range.addEventListener('change', handleRangeInput);

    // Initial paint
    loadUIForCurrent();
  } catch (e) {
    console.warn('[mat-orch]', e);
  }
})();
