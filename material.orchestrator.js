// material.orchestrator.js
// Super-robust Step2 orchestrator
// - Works with viewer.listMaterials() OR scene traversal fallback
// - Keeps polling (with backoff) until materials are present (max ~30s)
// - Adds a small ↻ refresh button next to the select (only once)
// - rAF-throttled preview; same-name materials are updated in one go
/* eslint-disable */
(() => {
  const LOG = false; // flip to true for verbose console
  const log = (...a)=> { if (LOG) console.debug('[mat-orch]', ...a); };

  const state = {
    inited: false,
    mapNameToKeys: new Map(), // name => [materialKey]
    haveKeys: false,
    activeName: null,
    rafId: 0,
    ui: null,
    pollTimer: 0,
    pollCount: 0,
    filledOnce: false,
  };

  const raf = (fn) => {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(()=>{ state.rafId=0; try{ fn(); }catch{} });
  };

  // ------- viewer / scene helpers -------
  function listMaterialsSafe(){
    try {
      const arr = (window.viewer?.listMaterials?.() || []).filter(Boolean);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function getSceneRoot(){
    return window.viewer?.getSceneRoot?.() || window.__LM_SCENE || window.scene || null;
  }
  function traverseAllMaterials(fn){
    const root = getSceneRoot();
    if (!root || !root.traverse) return 0;
    let n = 0;
    root.traverse((obj)=>{
      const m = obj && obj.material;
      if (!m) return;
      if (Array.isArray(m)) { m.forEach((mm)=>{ n++; fn(mm); }); }
      else { n++; fn(m); }
    });
    return n;
  }

  function enumerateOnce(){
    // 1) Try viewer API first
    const vlist = listMaterialsSafe();
    if (vlist.length > 0 && vlist.every(it => it && it.name)) {
      const map = new Map(); let haveKeys = false;
      for (const it of vlist) {
        const name = it.name || '';
        const key  = it.materialKey || '';
        if (!name) continue;
        if (!map.has(name)) map.set(name, []);
        if (key) { map.get(name).push(String(key)); haveKeys = true; }
      }
      return { map, haveKeys };
    }
    // 2) Fallback: traverse scene and collect material names
    const names = new Map();
    const count = traverseAllMaterials((mat)=>{
      const nm = mat?.name || mat?.userData?.name || '';
      if (!nm) return;
      if (!names.has(nm)) names.set(nm, []);
    });
    if (names.size > 0) return { map: names, haveKeys: false };
    return { map: new Map(), haveKeys: false };
  }

  // ------- UI helpers -------
  function ensureUI(){
    // Try to use existing controls first
    let sel = document.getElementById('pm-material') || document.querySelector('#pm-material');
    let rng = document.getElementById('pm-opacity-range') || document.querySelector('#pm-opacity-range');
    let val = document.getElementById('pm-opacity-val') || document.querySelector('#pm-opacity-val');

    let rootTab = (sel && (sel.closest('.lm-tabpanel,[role="tabpanel"]') || document.getElementById('tab-material')))
               || document.querySelector('.lm-tabpanel#tab-material, [role="tabpanel"]#tab-material')
               || document.querySelector('.lm-tabpanel[data-panel="material"]')
               || document.querySelector('[role="tabpanel"][aria-labelledby="tabbtn-material"]');

    if (!sel || !rng) {
      if (!rootTab) return null;
      let mount = rootTab.querySelector('#mat-root');
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'mat-root';
        mount.style.display='flex'; mount.style.flexDirection='column'; mount.style.gap='.5rem';
        rootTab.appendChild(mount);
      }
      mount.innerHTML = `
        <div class="mat-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <label for="pm-material">Material</label>
          <select id="pm-material" aria-label="material name" style="min-width:12rem"></select>
          <button id="pm-refresh" type="button" title="Refresh materials">↻</button>
        </div>
        <div class="mat-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <label for="pm-opacity-range">Opacity</label>
          <input id="pm-opacity-range" type="range" min="0" max="1" step="0.01" value="1"/>
          <span id="pm-opacity-val" aria-live="polite">1.00</span>
        </div>
      `;
      sel = mount.querySelector('#pm-material');
      rng = mount.querySelector('#pm-opacity-range');
      val = mount.querySelector('#pm-opacity-val');
    } else {
      // add refresh button if missing
      const hasRefresh = !!(sel.parentElement && sel.parentElement.querySelector('#pm-refresh'));
      if (!hasRefresh) {
        const btn = document.createElement('button');
        btn.id = 'pm-refresh';
        btn.type = 'button';
        btn.title = 'Refresh materials';
        btn.textContent = '↻';
        sel.insertAdjacentElement('afterend', btn);
      }
    }
    const refresh = (rootTab || document).querySelector('#pm-refresh');
    return (state.ui = { rootTab: rootTab || document.body, sel, rng, val, refresh });
  }

  function fillSelectFromState(){
    const { sel } = state.ui;
    const names = [...state.mapNameToKeys.keys()].sort((a,b)=>a.localeCompare(b));
    if (names.length === 0) {
      sel.innerHTML = `<option value="">— Select material —</option>`;
      state.activeName = null;
      return;
    }
    const prev = state.activeName;
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (prev && names.includes(prev)) sel.value = prev;
    else { sel.selectedIndex = 0; state.activeName = sel.value || names[0] || null; }
  }

  function applyOpacityToActive(opacity){
    const name = state.activeName;
    if (!name) return;
    const apply = window.viewer?.applyMaterialProps;
    if (state.haveKeys && typeof apply === 'function') {
      const keys = state.mapNameToKeys.get(name) || [];
      for (const k of keys) apply(k, { opacity });
      return;
    }
    // fallback by name
    traverseAllMaterials((mat)=>{
      const nm = mat?.name || mat?.userData?.name || '';
      if (nm !== name) return;
      mat.transparent = (opacity < 1);
      mat.opacity = opacity;
      mat.needsUpdate = true;
    });
  }

  // ------- polling -------
  function startPolling(){
    stopPolling();
    state.pollCount = 0;
    const doPoll = () => {
      state.pollCount++;
      const { map, haveKeys } = enumerateOnce();
      const hadEmpty = state.mapNameToKeys.size === 0;
      if (map.size > 0) {
        state.mapNameToKeys = map;
        state.haveKeys = haveKeys;
        fillSelectFromState();
        if (!state.filledOnce || hadEmpty) {
          state.filledOnce = true;
          // apply current slider value once
          const v = +state.ui.rng.value || 1;
          state.ui.val && (state.ui.val.textContent = v.toFixed(2));
          raf(()=>applyOpacityToActive(v));
        }
        // once we have something, we can keep polling a bit longer in case keys arrive later
        if (state.pollCount > 60) { // ~24s after first fill (assuming 400ms)
          stopPolling();
        }
      } else {
        // keep polling up to ~30s total
        if (state.pollCount > 75) stopPolling();
      }
      // backoff a little
      state.pollTimer = setTimeout(doPoll, 400);
    };
    doPoll();
  }
  function stopPolling(){
    if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = 0; }
  }

  // ------- init -------
  function wireHandlers(){
    const ui = state.ui;
    ui.sel.addEventListener('change', ()=>{
      state.activeName = ui.sel.value || null;
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
    });
    ui.rng.addEventListener('input', ()=>{
      const v = +ui.rng.value || 1;
      ui.val && (ui.val.textContent = v.toFixed(2));
      raf(()=>applyOpacityToActive(v));
    });
    ui.refresh?.addEventListener('click', ()=>{
      // refresh immediately
      const { map, haveKeys } = enumerateOnce();
      state.mapNameToKeys = map; state.haveKeys = haveKeys;
      fillSelectFromState();
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
      // also restart polling to allow late keys
      startPolling();
    });

    // tab click -> re-enumerate soon after
    const tabBtn = document.getElementById('tabbtn-material') || document.querySelector('[role="tab"][aria-controls="tab-material"]');
    tabBtn?.addEventListener('click', ()=> setTimeout(()=>{
      const { map, haveKeys } = enumerateOnce();
      state.mapNameToKeys = map; state.haveKeys = haveKeys;
      fillSelectFromState();
    }, 0));
  }

  function initOnce(){
    if (state.inited) return;
    state.inited = true;
    const ui = ensureUI();
    if (!ui) { if (LOG) console.warn('[mat-orch] UI not found'); return; }
    state.ui = ui;

    // initial fill (might be empty)
    const first = enumerateOnce();
    state.mapNameToKeys = first.map; state.haveKeys = first.haveKeys;
    fillSelectFromState();

    // handlers + polling
    wireHandlers();
    startPolling();

    // initial apply
    const initOp = +ui.rng.value || 1;
    ui.val && (ui.val.textContent = initOp.toFixed(2));
    raf(()=>applyOpacityToActive(initOp));
  }

  // kick
  if (document.readyState !== 'loading') setTimeout(initOnce, 0);
  window.addEventListener('lm:model-ready', initOnce, { once: true });
  window.addEventListener('lm:scene-ready', initOnce, { once: true });
  setTimeout(initOnce, 1500);
})();
