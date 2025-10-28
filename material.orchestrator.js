// material.orchestrator.js
// Robust Step2 with full fallback:
// - Prefer viewer.listMaterials() -> name -> [materialKey...] map
// - If unavailable/empty, traverse scene to collect material names
// - If applyMaterialProps/materialKey is unavailable, fall back to direct material edits by name
/* eslint-disable */
(() => {
  const LOG_LEVEL = 'info'; // 'debug' | 'info' | 'silent'
  const logd = (...a)=> (LOG_LEVEL==='debug') && console.debug('[mat-orch]', ...a);
  const logi = (...a)=> (LOG_LEVEL!=='silent') && console.info('[mat-orch]', ...a);

  const state = {
    inited: false,
    mapNameToKeys: new Map(),  // name => string[] materialKeys (may be empty if using fallback)
    haveKeys: false,           // true when keys are valid for applyMaterialProps
    activeName: null,
    rafId: 0,
    ui: null
  };

  const raf = (fn) => {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(()=>{ state.rafId=0; try{ fn(); }catch{} });
  };

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  // ---- viewer helpers ----
  function listMaterialsSafe(){
    try { return (window.viewer?.listMaterials?.() || []).filter(Boolean); }
    catch(e){ return []; }
  }
  function getSceneRoot(){
    return window.viewer?.getSceneRoot?.() || window.scene || null;
  }
  function traverseAllMaterials(fn){
    const root = getSceneRoot();
    if (!root || !root.traverse) return;
    root.traverse((obj)=>{
      const m = obj && obj.material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach(fn);
      else fn(m);
    });
  }
  function enumerateMaterialsFromScene(){
    const names = new Map(); // name => placeholder key list (empty)
    traverseAllMaterials((mat)=>{
      const nm = (mat && (mat.name || (mat.userData && mat.userData.name))) || '';
      if (!nm) return;
      if (!names.has(nm)) names.set(nm, []);
    });
    return [...names.keys()];
  }

  async function waitForMaterials({timeoutMs=6000, pollMs=120}={}){
    const t0 = performance.now();
    let last = -1;
    while (performance.now() - t0 < timeoutMs) {
      const list = listMaterialsSafe();
      const ok = list.length>0 && list.every(it=>it?.name);
      if (ok) return list;
      // try scene traversal as soon as there are meshes
      const root = getSceneRoot();
      if (root) {
        let found = 0;
        traverseAllMaterials(()=>{ found++; });
        if (found>0) return []; // signal to use traversal fallback
      }
      if (list.length !== last) { last = list.length; logi('waiting materials…', list.length); }
      await new Promise(r=>setTimeout(r, pollMs));
    }
    return []; // timeout
  }

  // --- Mount / UI discovery ---
  function ensureUI(){
    // 1) 既存のコントロールを最優先で拾う
    let sel = document.getElementById('pm-material') || document.querySelector('#pm-material');
    let rng = document.getElementById('pm-opacity-range') || document.querySelector('#pm-opacity-range');
    let val = document.getElementById('pm-opacity-val') || document.querySelector('#pm-opacity-val');

    let rootTab = null;
    if (sel) {
      rootTab = sel.closest('.lm-tabpanel,[role="tabpanel"]')
             || document.getElementById('tab-material')
             || document.querySelector('[aria-labelledby="tabbtn-material"]')
             || document.querySelector('[data-panel="material"]')
             || document.body;
    }

    // 既存がなければ作る
    if (!sel || !rng) {
      if (!rootTab) {
        rootTab =
          document.querySelector('.lm-tabpanel#tab-material, [role="tabpanel"]#tab-material') ||
          document.querySelector('.lm-tabpanel[data-panel="material"]') ||
          document.querySelector('[role="tabpanel"][aria-labelledby="tabbtn-material"]');
      }
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
      // Refreshボタン（未設置なら追加）
      const hasRefresh = !!(sel.parentElement && sel.parentElement.querySelector('#pm-refresh'));
      if (!hasRefresh) {
        const btn = document.createElement('button');
        btn.id = 'pm-refresh'; btn.type = 'button'; btn.title = 'Refresh materials'; btn.textContent = '↻';
        sel.insertAdjacentElement('afterend', btn);
      }
    }

    const refresh = (rootTab || document).querySelector('#pm-refresh');
    return (state.ui = { rootTab: rootTab || document.body, sel, rng, val, refresh });
  }

  function buildNameMapFromViewer(list){
    state.mapNameToKeys.clear();
    for (const it of list) {
      const name = it?.name ?? '';
      const key  = it?.materialKey ?? '';
      if (!name) continue;
      if (!state.mapNameToKeys.has(name)) state.mapNameToKeys.set(name, []);
      if (key) state.mapNameToKeys.get(name).push(String(key));
    }
    state.haveKeys = [...state.mapNameToKeys.values()].some(arr => arr.length>0);
    if (!state.activeName) {
      const first = [...state.mapNameToKeys.keys()][0] || null;
      state.activeName = first;
    }
  }

  function buildNameMapFromScene(){
    state.mapNameToKeys.clear();
    const names = enumerateMaterialsFromScene();
    names.forEach(n => state.mapNameToKeys.set(n, [])); // keys unknown in fallback
    state.haveKeys = false;
    if (!state.activeName) state.activeName = names[0] || null;
  }

  function fillSelect(){
    const { sel } = state.ui;
    const names = [...state.mapNameToKeys.keys()].sort((a,b)=>a.localeCompare(b));
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (state.activeName && names.includes(state.activeName)) sel.value = state.activeName;
    else { sel.selectedIndex = 0; state.activeName = sel.value || null; }
    if (!names.length) {
      sel.innerHTML = `<option value="">— Select material —</option>`;
      state.activeName = null;
    }
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

    // Fallback: traverse scene and set by name
    traverseAllMaterials((mat)=>{
      const nm = (mat && (mat.name || (mat.userData && mat.userData.name))) || '';
      if (nm !== name) return;
      mat.transparent = (opacity < 1);
      mat.opacity = opacity;
      mat.needsUpdate = true;
    });
  }

  // ---- wiring ----
  async function initOnce(){
    if (state.inited) return;
    state.inited = true;

    const ui = ensureUI();
    if (!ui) { logi('material UI not found'); return; }

    // 1) materials を待機（viewer API or scene準備）
    let list = listMaterialsSafe();
    if (!(list.length>0)) list = await waitForMaterials({timeoutMs:6000, pollMs:120});

    if (list.length>0) {
      buildNameMapFromViewer(list);
    } else {
      // viewer APIが空 or 未準備 -> シーントラバースで列挙
      buildNameMapFromScene();
      if (state.mapNameToKeys.size===0) {
        logi('materials not ready yet; use refresh after model fully ready.');
      }
    }

    fillSelect();

    // 3) ハンドラ
    ui.sel.addEventListener('change', ()=>{
      state.activeName = ui.sel.value || null;
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
    });

    ui.rng.addEventListener('input', ()=>{
      const v = +ui.rng.value || 1;
      if (ui.val) ui.val.textContent = v.toFixed(2);
      raf(()=>applyOpacityToActive(v));
    });

    ui.refresh?.addEventListener('click', ()=>{
      // 再列挙（viewer優先、無ければscene）
      const l = listMaterialsSafe();
      if (l.length>0) buildNameMapFromViewer(l);
      else { buildNameMapFromScene(); }
      fillSelect();
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
    });

    // 4) 初期反映
    const initOp = +ui.rng.value || 1;
    if (ui.val) ui.val.textContent = initOp.toFixed(2);
    raf(()=>applyOpacityToActive(initOp));

    // 5) タブクリック後の再列挙（保険）
    const tabBtn = document.getElementById('tabbtn-material') || document.querySelector('[role="tab"][aria-controls="tab-material"]');
    tabBtn?.addEventListener('click', ()=> setTimeout(()=>{
      const l = listMaterialsSafe();
      if (l.length>0) buildNameMapFromViewer(l);
      else buildNameMapFromScene();
      fillSelect();
    }, 0));
  }

  if (document.readyState !== 'loading') {
    setTimeout(()=> { initOnce(); }, 0);
  }
  window.addEventListener('lm:model-ready', ()=>initOnce(), { once: true });
  window.addEventListener('lm:scene-ready', ()=>initOnce(), { once: true });
  setTimeout(()=> { initOnce(); }, 1500);
})();
