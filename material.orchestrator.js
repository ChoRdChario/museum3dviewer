// material.orchestrator.js
// Robust Step2 + panel-targeted mounting: materials 準備完了まで待機 + リスト更新 + rAF スロットル
/* eslint-disable */
(() => {
  const LOG_LEVEL = 'info'; // 'debug' | 'info' | 'silent'
  const logd = (...a)=> (LOG_LEVEL==='debug') && console.debug('[mat-orch]', ...a);
  const logi = (...a)=> (LOG_LEVEL!=='silent') && console[LOG_LEVEL]('[mat-orch]', ...a);

  const state = {
    inited: false,
    mapNameToKeys: new Map(),  // name => string[] materialKeys
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
  async function waitForMaterials({timeoutMs=6000, pollMs=120}={}){
    const t0 = performance.now();
    let lastCount = -1;
    while (performance.now() - t0 < timeoutMs) {
      const list = listMaterialsSafe();
      const ok = list.length>0 && list.every(it=>it?.name && it?.materialKey);
      if (ok) return list;
      if (list.length !== lastCount) {
        lastCount = list.length;
        logi('waiting materials…', list.length);
      }
      await new Promise(r=>setTimeout(r, pollMs));
    }
    return [];
  }

  // Mount strictly into the *panel* (not the tab button)
  function ensureUI(){
    // Prefer a tabpanel container with id #tab-material (div only), or ARIA-linked panel
    let rootTab =
      document.querySelector('div.lm-tabpanel#tab-material') ||
      document.querySelector('div[role="tabpanel"]#tab-material') ||
      document.querySelector('div.lm-tabpanel[data-panel="material"]') ||
      document.querySelector('div[role="tabpanel"][aria-labelledby="tabbtn-material"]');

    if (!rootTab) return null; // never mount into tab buttons

    let sel = rootTab.querySelector('#pm-material');
    let rng = rootTab.querySelector('#pm-opacity-range');
    let val = rootTab.querySelector('#pm-opacity-val');

    // 既存が無ければ最小UIを作成（保険）
    if (!sel || !rng) {
      let mount = rootTab.querySelector('#mat-root');
      if (!mount) {
        mount = document.createElement('div');
        mount.id = 'mat-root';
        mount.style.display='flex';
        mount.style.flexDirection='column';
        mount.style.gap='.5rem';
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
    }

    const refresh = rootTab.querySelector('#pm-refresh');
    return state.ui = { rootTab, sel, rng, val, refresh };
  }

  function buildNameMap(list){
    state.mapNameToKeys.clear();
    for (const it of list) {
      const name = it?.name ?? '';
      const key  = it?.materialKey ?? '';
      if (!name || !key) continue;
      if (!state.mapNameToKeys.has(name)) state.mapNameToKeys.set(name, []);
      state.mapNameToKeys.get(name).push(String(key));
    }
    // アクティブ名が無ければ先頭
    if (!state.activeName) {
      const first = [...state.mapNameToKeys.keys()][0] || null;
      state.activeName = first;
    }
  }

  function fillSelect(){
    const { sel } = state.ui;
    const names = [...state.mapNameToKeys.keys()].sort((a,b)=>a.localeCompare(b));
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (state.activeName && names.includes(state.activeName)) sel.value = state.activeName;
    else { sel.selectedIndex = 0; state.activeName = sel.value || null; }
    // 空の場合はプレースホルダ
    if (!names.length) {
      sel.innerHTML = `<option value="">— Select material —</option>`;
      state.activeName = null;
    }
  }

  function applyOpacityToActive(opacity){
    if (!state.activeName) return;
    const keys = state.mapNameToKeys.get(state.activeName) || [];
    const apply = window.viewer?.applyMaterialProps;
    if (!apply || !keys.length) return;
    for (const k of keys) apply(k, { opacity });
  }

  // ---- wiring ----
  async function initOnce(){
    if (state.inited) return;
    state.inited = true;

    const ui = ensureUI();
    if (!ui) { logi('material panel not found'); return; }

    // 1) materials が 0 の場合でも待つ（最大 6s）
    let list = listMaterialsSafe();
    if (!(list.length>0)) list = await waitForMaterials({timeoutMs:6000, pollMs:120});

    if (list.length===0) {
      // それでも空なら、手動更新の導線を生かす
      logi('materials still empty (timeout). Use refresh after model is fully ready.');
    }

    // 2) マップ化 & セレクト反映
    buildNameMap(list);
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
      const l = listMaterialsSafe();
      buildNameMap(l);
      fillSelect();
      // 再選択時に現行のスライダ値で即反映
      const v = +ui.rng.value || 1;
      raf(()=>applyOpacityToActive(v));
    });

    // 4) 初期反映
    const initOp = +ui.rng.value || 1;
    if (ui.val) ui.val.textContent = initOp.toFixed(2);
    raf(()=>applyOpacityToActive(initOp));

    // 5) タブが後から開かれた場合でも再試行（保険）
    const tabBtn = document.getElementById('tabbtn-material') || document.querySelector('[role="tab"][aria-controls="tab-material"]');
    tabBtn?.addEventListener('click', ()=> setTimeout(()=>{
      // DOMは既にある前提だが、materials列挙だけ更新する
      const l = listMaterialsSafe();
      if (l.length) {
        buildNameMap(l);
        fillSelect();
      }
    }, 0));
  }

  // 既に読み込み済みなら少し遅らせて初期化、そうでなければイベント待ち
  if (document.readyState !== 'loading') {
    setTimeout(()=> { initOnce(); }, 0);
  }
  window.addEventListener('lm:model-ready', ()=>initOnce(), { once: true });

  // 万一、bridgeイベントが早すぎた/落ちた場合に備えて保険の遅延初期化
  setTimeout(()=> { initOnce(); }, 1500);
})();
