// material.orchestrator.js
// v2.1 - scene capture + per-material opacity application; robust select/range lookup
console.log('[mat-orch v2.1] load');

(() => {
  const PANEL_ID = 'pm-opacity';
  const RANGE_ID = 'materialOpacity';
  const SELECT_ID = 'materialSelect';

  if (window.__lm_mat_orch_v21) {
    console.log('[mat-orch v2.1] already active');
    return;
  }
  window.__lm_mat_orch_v21 = true;

  const state = {
    scene: null,
    index: new Map(), // name -> Set<THREE.Material>
  };

  // Capture scene via custom events emitted by viewer bridge
  const buildIndex = () => {
    if (!state.scene || typeof state.scene.traverse !== 'function') return;
    state.index.clear();
    state.scene.traverse(obj => {
      const mat = obj.material;
      if (!mat) return;
      const pushMat = (m) => {
        if (!m || typeof m !== 'object') return;
        const name = m.name || '(noname)';
        if (!state.index.has(name)) state.index.set(name, new Set());
        state.index.get(name).add(m);
      };
      if (Array.isArray(mat)) mat.forEach(pushMat);
      else pushMat(mat);
    });
    console.log('[mat-orch v2.1] indexed materials', Array.from(state.index.keys()));
  };

  const sceneReady = (sc) => {
    state.scene = sc;
    buildIndex();
  };

  // Listen to bridge events
  window.addEventListener('lm:scene-ready', (e) => {
    const sc = e && e.detail && e.detail.scene;
    if (sc) sceneReady(sc);
  });
  window.addEventListener('lm:scene-stable', (e) => {
    const sc = e && e.detail && e.detail.scene;
    if (sc) sceneReady(sc);
  });

  // Soft poll fallback (several seconds) to obtain viewer scene if events were missed
  let pollMs = 0;
  const pollId = setInterval(() => {
    pollMs += 200;
    if (window.__lm_viewer && window.__lm_viewer.scene) {
      sceneReady(window.__lm_viewer.scene);
      clearInterval(pollId);
    }
    if (pollMs > 6000) clearInterval(pollId);
  }, 200);

  const qS = (sel, root=document) => root.querySelector(sel);

  const getPanel = () =>
    document.getElementById(PANEL_ID) || document.querySelector('#panel-material #pm-opacity') || document.querySelector('#pane-material #pm-opacity');

  const getSelect = () => {
    const p = getPanel();
    if (!p) return null;
    return qS('#' + SELECT_ID, p) || qS('select', p);
  };

  const getRange = () => {
    const p = getPanel();
    if (!p) return null;
    return qS('#' + RANGE_ID, p) || qS('input[type="range"]', p);
  };

  const applyOpacity = (name, value) => {
    if (!state.index.size) buildIndex();
    const set = state.index.get(name);
    if (!set || !set.size) return;
    set.forEach(mat => {
      try {
        const v = Number(value);
        if (Number.isFinite(v)) {
          mat.opacity = v;
          mat.transparent = v < 1.0 ? true : false;
          if ('depthWrite' in mat) mat.depthWrite = v >= 1.0;
          mat.needsUpdate = true;
        }
      } catch (e) {}
    });
  };

  const wireUI = () => {
    const range = getRange();
    const sel = getSelect();
    if (!range || !sel) return false;

    // Normalize attributes
    range.min = '0'; range.max = '1'; range.step = '0.01';
    range.style.pointerEvents = 'auto';
    range.style.touchAction = 'none';
    range.removeAttribute('disabled');

    const onInput = () => {
      const name = sel.value || sel.selectedOptions?.[0]?.value || sel.options?.[sel.selectedIndex]?.value;
      if (!name) return;
      applyOpacity(name, range.value);
    };
    if (!range.__lm_mat_oninput) {
      range.__lm_mat_oninput = true;
      range.addEventListener('input', onInput);
      range.addEventListener('change', onInput);
    }
    if (!sel.__lm_mat_onchange) {
      sel.__lm_mat_onchange = true;
      sel.addEventListener('change', () => {
        // When changing target material, re-apply current value
        onInput();
      });
    }
    console.log('[mat-orch v2.1] UI bound');
    return true;
  };

  const boot = () => {
    if (wireUI()) return true;
    return false;
  };

  if (!boot()) {
    // Observe material panel for dynamic synth
    const target = document.querySelector('#panel-material') || document.querySelector('#pane-material') || document.body;
    const mo = new MutationObserver(() => { wireUI(); });
    mo.observe(target, {childList:true, subtree:true});
  }
})();
