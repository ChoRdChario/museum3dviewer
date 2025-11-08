/* material.orchestrator.js (min-safe vA3.3) */
(() => {
  const TAG='[mat-orch:min]';
  const log=(...a)=>console.log(TAG,...a), warn=(...a)=>console.warn(TAG,...a);

  // --- DOM binding (pane-local) ---
  const pane = document.querySelector('#pane-material.pane');
  if (!pane) return warn('pane not found (#pane-material)');
  const sel = pane.querySelector('#pm-material, #materialSelect');
  const rng = pane.querySelector('#pm-opacity-range, #opacityRange');
  if (!sel || !rng) return warn('controls missing in pane');

  log('UI found', {pane, select:sel, opacity:rng, doubleSided:null, unlit:null});
  // restoring guard and current key (shared globals)
  window.__lm_restoringMaterial = window.__lm_restoringMaterial ?? false;
  window.__lm_currentMaterialKey = window.__lm_currentMaterialKey ?? null;

  function getSheetCtx(){
    return { spreadsheetId: window.currentSpreadsheetId || window.spreadsheetId || null,
             sheetGid: (typeof window.currentSheetId !== 'undefined') ? window.currentSheetId : null };
  }
  function getModelKey(){ return 'NOMODEL'; }
  function restoreSnapshotFor(key){
    const ctx = getSheetCtx();
    const snap = (window.lmLookupMaterialSnapshot && window.lmLookupMaterialSnapshot(ctx, getModelKey(), key)) || { opacity: 1.0 };
    // silent UI update
    try {
      const orig = rng.oninput; rng.oninput = null;
      rng.value = String(typeof snap.opacity==='number'? snap.opacity : 1.0);
      rng.oninput = orig;
    } catch(_){}
    // viewer apply
    applyOpacity(key, parseFloat(rng.value||'1'));
    console.log('[mat-orch] restore', key, 'opacity=', rng.value);
  }
  async function rebuildIndex(){
    try{
      const sid = getSheetCtx().spreadsheetId;
      if (!sid || !window.materialsSheetBridge?.loadAll) return;
      const map = await window.materialsSheetBridge.loadAll(sid);
      const rows = Array.from(map.values());
      window.lmBuildMaterialIndex && window.lmBuildMaterialIndex(rows);
    }catch(e){ console.warn('[mat-orch] index build failed', e); }
  }


  // --- state ---
  let materialKeys = [];    // ['Hull','Glass',...]
  let currentKey = null;

  // --- helpers ---
  function setOptions(keys){
    materialKeys = Array.isArray(keys) ? keys : [];
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value=''; opt0.textContent='— Select —';
    sel.appendChild(opt0);
    for (const k of materialKeys){
      const o = document.createElement('option');
      o.value = k; o.textContent = k;
      sel.appendChild(o);
    }
    log('options populated', materialKeys);
  }

  async function fetchMaterialKeys(){
    // 1) bridge API があれば使う
    if (window.viewerBridge?.getMaterialKeys){
      try { setOptions(await window.viewerBridge.getMaterialKeys()); return; }
      catch(e){ warn('bridge.getMaterialKeys failed', e); }
    }
    // 2) 要求イベントを投げて他モジュールに任せる（任意対応）
    let resolved = false;
    const onRecv = (ev) => {
      if (resolved) return;
      const arr = ev.detail?.keys;
      if (Array.isArray(arr) && arr.length){ resolved = true; setOptions(arr); }
      window.removeEventListener('lm:material-keys', onRecv);
    };
    window.addEventListener('lm:material-keys', onRecv, {once:true});
    window.dispatchEvent(new CustomEvent('lm:req-material-keys'));
    // 3) 最後の保険：何もしない（UIは空のまま）
  }

  function applyOpacity(key, value){
    if (!key) return;
    // viewerBridge に丸投げ（既存側で material 不透明度を適用）
    if (window.viewerBridge?.setMaterialOpacity){
      try { window.viewerBridge.setMaterialOpacity(key, value); }
      catch(e){ warn('setMaterialOpacity failed', e); }
    }
  }

  // --- wire ---
  sel.addEventListener('change', async () => {
    const next = sel.value || null;
    if (!next) return;
    window.lmCancelPendingSave && window.lmCancelPendingSave();
    window.__lm_currentMaterialKey = next;
    window.__lm_restoringMaterial = true;
    restoreSnapshotFor(next);
    window.__lm_restoringMaterial = false;
  });
  rng.addEventListener('input', () => {
    const k = window.__lm_currentMaterialKey; if (!k) return;
    if (window.__lm_restoringMaterial) return; // ignore during restore
    const v = parseFloat(rng.value||'1');
    applyOpacity(k, v);
    window.lmScheduleSave && window.lmScheduleSave(k, { opacity: v });
  });

  
  // Barrier for initial restore
  const ready = { scene:false, glb:false, sheet:false };
  function tryInitial(){
    if (ready.scene && ready.glb && ready.sheet && !tryInitial.__done){
      tryInitial.__done = true;
      // rebuild index then restore current selection
      rebuildIndex().then(()=>{
        const k = sel.value || (sel.options && sel.options[0] && sel.options[0].value) || null;
        if (k){ window.__lm_currentMaterialKey = k; window.__lm_restoringMaterial = true; restoreSnapshotFor(k); window.__lm_restoringMaterial = false; }
      });
    }
  }
  window.addEventListener('lm:sheet-context', ()=>{ ready.sheet = true; tryInitial(); rebuildIndex(); });
// scene-ready で材料名を投入
  function onSceneReady(){ fetchMaterialKeys(); ready.scene = true; tryInitial(); }
  window.addEventListener('lm:scene-ready', onSceneReady);
  window.addEventListener('lm:glb-loaded', ()=>{ ready.glb = true; tryInitial(); });

  // すでにシーンができている場合もある
  setTimeout(fetchMaterialKeys, 0);

  log('UI bound');
})();