// material.orchestrator.js
// Step2 満額対応版: name→keys 一括適用 + rAFスロットル + 既存DOM優先/なければ自前UI生成
/* eslint-disable */
(() => {
  const log = (...a) => console.debug?.('[mat-orch]', ...a);

  // ---- state ----
  const state = {
    inited: false,
    mapNameToKeys: new Map(), // name => string[] materialKeys
    activeName: null,
    rafId: 0,
  };

  // ---- utils ----
  const raf = (fn) => {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(() => {
      state.rafId = 0;
      try { fn(); } catch (e) { /* no-op */ }
    });
  };

  const ensureUI = () => {
    // 既存DOMを優先（index.html に pm-* がある想定）
    let root = document.getElementById('tab-material') || document.querySelector('#tab-material, [data-tab="material"]');
    if (!root) return null;

    let sel = root.querySelector('#pm-material');
    let rng = root.querySelector('#pm-opacity-range');
    let val = root.querySelector('#pm-opacity-val');

    // 無ければ最小UIを自動生成（崩し回避の保険）
    if (!sel || !rng) {
      let mount = root.querySelector('#mat-root');
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'mat-root';
        mount.style.display = 'flex';
        mount.style.flexDirection = 'column';
        mount.style.gap = '.5rem';
        root.appendChild(mount);
      }
      mount.innerHTML = `
        <div class="mat-row">
          <label for="pm-material">Material</label>
          <select id="pm-material" aria-label="material name"></select>
        </div>
        <div class="mat-row">
          <label for="pm-opacity-range">Opacity</label>
          <input id="pm-opacity-range" type="range" min="0" max="1" step="0.01" value="1"/>
          <span id="pm-opacity-val" aria-live="polite">1.00</span>
        </div>
      `;
      sel = mount.querySelector('#pm-material');
      rng = mount.querySelector('#pm-opacity-range');
      val = mount.querySelector('#pm-opacity-val');
    }
    return { root, sel, rng, val };
  };

  const buildNameToKeysMap = () => {
    state.mapNameToKeys.clear();
    try {
      const list = (window.viewer?.listMaterials?.() || []);
      for (const it of list) {
        const name = it?.name ?? '';
        const key  = it?.materialKey ?? '';
        if (!name || !key) continue;
        if (!state.mapNameToKeys.has(name)) state.mapNameToKeys.set(name, []);
        state.mapNameToKeys.get(name).push(String(key));
      }
      // 初期選択
      if (!state.activeName) {
        const first = list.find(Boolean)?.name;
        state.activeName = first || null;
      }
    } catch (e) {
      log('listMaterials failed', e);
    }
  };

  const fillSelect = (sel) => {
    const names = Array.from(state.mapNameToKeys.keys()).sort((a,b)=>a.localeCompare(b));
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (state.activeName && names.includes(state.activeName)) {
      sel.value = state.activeName;
    } else {
      sel.selectedIndex = 0;
      state.activeName = sel.value || null;
    }
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const applyOpacityToActive = (opacity) => {
    const name = state.activeName;
    if (!name) return;
    const keys = state.mapNameToKeys.get(name) || [];
    if (!keys.length) return;
    const apply = window.viewer?.applyMaterialProps;
    if (typeof apply !== 'function') return;

    for (const k of keys) {
      // viewer側が transparent の扱いや needsUpdate を適切に面倒見る前提
      apply(k, { opacity });
    }
  };

  // ---- event handlers ----
  const onModelReady = () => {
    if (state.inited) return;
    state.inited = true;

    const ui = ensureUI();
    if (!ui) { log('UI root not found'); return; }

    buildNameToKeysMap();
    fillSelect(ui.sel);

    // 選択変更
    ui.sel.addEventListener('change', () => {
      state.activeName = ui.sel.value || null;
      // 選択直後にスライダ値で即反映
      const op = +ui.rng.value || 1;
      raf(() => applyOpacityToActive(op));
    });

    // 不透明度スライダ：inputで即時（rAFスロットル）
    ui.rng.addEventListener('input', () => {
      const v = +ui.rng.value || 1;
      if (ui.val) ui.val.textContent = v.toFixed(2);
      raf(() => applyOpacityToActive(v));
    });

    // model-ready直後、現在値で一度反映
    const initOp = +ui.rng.value || 1;
    if (ui.val) ui.val.textContent = initOp.toFixed(2);
    raf(() => applyOpacityToActive(initOp));
  };

  // ---- wiring ----
  // 既にsceneが来ていれば即実行、そうでなければイベント待ち
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // 少し遅延してから（他モジュールの初期化待ち）
    setTimeout(() => {
      if (window.__LM_SCENE_READY__ || window.__LM_MODEL_READY__) onModelReady();
    }, 0);
  }
  window.addEventListener('lm:model-ready', onModelReady, { once: true });
})();
