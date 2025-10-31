/* material.orchestrator.js
 * LociMyu - Material UI Orchestrator (P0: persist + perf)
 * 前提:
 *  - viewerBridge.listMaterials(): string[] (material.name 列挙)
 *  - viewerBridge.getScene(): THREE.Scene
 *  - materialsSheetBridge.loadAll()/upsertOne() 利用可（①で追加）
 *  - 右パネルの中段カード: select#pm-material, 近傍 range スライダ
 */
(function(){
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  const VERSION_TAG = 'V6_13_P0_PERSIST_APPLY';
  log('loaded VERSION_TAG:', VERSION_TAG);

  // ==== State ====
  const ST = {
    spreadsheetId: null,
    materialNames: [],               // from viewerBridge
    matCacheByName: new Map(),       // name -> Material[]（初回 traverse で構築）
    applyQueue: null,                // rAF キュー
    saveTimer: null,                 // debounce
    lastSel: '',                     // last selected material name
  };

  // ==== Event wiring ====
  window.addEventListener('lm:sheet-context', (ev)=>{
    const d = ev?.detail || ev;
    if (d?.spreadsheetId) {
      ST.spreadsheetId = d.spreadsheetId;
      log('sheet-context captured', ST.spreadsheetId);
    }
  });

  // ==== DOM helpers ====
  function $(s,root=document){ return root.querySelector(s); }
  function nearestSlider(from){
    let p = from.closest('section,fieldset,div') || from.parentElement;
    while (p){ const r = p.querySelector('input[type="range"]'); if (r) return r; p=p.parentElement; }
    return document.querySelector('[data-lm="right-panel"] input[type="range"]') || $('input[type="range"]');
  }

  // ==== Bridge helpers ====
  function listMaterials(){
    try{ const b=window.viewerBridge; if (b?.listMaterials){ const arr=b.listMaterials()||[]; if (arr.length) return arr.slice(); } }catch(e){}
    return [];
  }
  function getScene(){
    const b=window.viewerBridge;
    if (b?.getScene){ try{ return b.getScene(); }catch(e){} }
    return window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }

  // ==== Cache build (name -> material instances[]) ====
  function buildCacheOnce(){
    if (ST.matCacheByName.size) return;
    const scene = getScene(); if (!scene) return;
    const map = ST.matCacheByName;
    scene.traverse(o=>{
      const m = o.material; if (!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        const name = mm?.name || '';
        if (!name) return;
        const arr = map.get(name) || [];
        arr.push(mm);
        map.set(name, arr);
      });
    });
    log('cache built (names):', map.size);
  }

  // ==== Apply opacity by name (rAF-coalesced) ====
  function _applyOpacityNow(name, alpha){
    const arr = ST.matCacheByName.get(name);
    if (!arr || !arr.length) return false;
    let hit=0;
    for (const mm of arr){
      if (!mm) continue;
      mm.transparent = alpha < 1 ? true : mm.transparent;
      mm.opacity = alpha;
      mm.needsUpdate = true;
      hit++;
    }
    return !!hit;
  }
  function applyOpacity(name, alpha){
    if (!name) return;
    if (ST.applyQueue) cancelAnimationFrame(ST.applyQueue);
    ST.applyQueue = requestAnimationFrame(()=>{
      buildCacheOnce();
      const ok = _applyOpacityNow(name, alpha);
      if (!ok) warn('apply miss (name not cached yet?):', name);
    });
  }

  // ==== Save (debounce) ====
  function debounceSave(materialName, patch){
    if (!ST.spreadsheetId || !window.materialsSheetBridge) return;
    if (ST.saveTimer) clearTimeout(ST.saveTimer);
    ST.saveTimer = setTimeout(async ()=>{
      try{
        const item = {
          materialKey: materialName,           // P0は name をキー（次フェーズで安定IDに）
          name: materialName,
          opacity: patch.opacity,
          unlit: !!patch.unlit,
          doubleSided: !!patch.doubleSided,
          chromaColor: patch.chromaColor||'',
          chromaThreshold: patch.chromaThreshold ?? null,
          chromaFeather: patch.chromaFeather ?? null,
          updatedAt: new Date().toISOString(),
          updatedBy: (window.__lm_userEmail || '') // 任意
        };
        await window.materialsSheetBridge.upsertOne(item);
        log('saved', materialName, item);
      }catch(e){ warn('save failed', e); }
    }, 250);
  }

  // ==== Load & apply persisted values ====
  async function loadAndApplyAll(){
    if (!ST.spreadsheetId || !window.materialsSheetBridge) return;
    try{
      const map = await window.materialsSheetBridge.loadAll();
      if (!map || !map.size) return;
      // 今は opacity のみ適用（P0範囲）
      buildCacheOnce();
      for (const name of ST.materialNames){
        const rec = map.get(name);
        if (rec && rec.opacity!=null){
          _applyOpacityNow(name, rec.opacity);
          log('applied persisted opacity', name, rec.opacity);
        }
      }
    }catch(e){ warn('load persisted failed', e); }
  }

  // ==== UI wiring ====
  function bindUI(){
    const sel = document.getElementById('pm-material');
    if (!sel){ warn('panel select #pm-material not found'); return false; }
    // 材料名投入
    sel.innerHTML = '';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '-- Select --');
    ST.materialNames.forEach(n=>add(n,n));
    sel.value = ST.lastSel || '';

    const slider = nearestSlider(sel);
    if (!slider) warn('opacity slider not found near #pm-material');

    // 重複防止：クローン置換
    const sel2 = sel.cloneNode(true); sel2.id = sel.id;
    sel.parentNode.replaceChild(sel2, sel);
    const sld2 = slider ? (()=>{ const n=slider.cloneNode(true); n.id = slider.id; slider.parentNode.replaceChild(n, slider); return n; })() : null;

    const handle = ()=>{
      const name = sel2.value;
      ST.lastSel = name;
      if (!name || !sld2) return;
      let a = parseFloat(sld2.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(sld2.value)||100)/100));
      applyOpacity(name, a);
      debounceSave(name, { opacity:a });
    };

    sel2.addEventListener('change', handle);
    sld2?.addEventListener('input', handle, {passive:true});
    log('UI bound to #pm-material', { sliderFound: !!sld2 });
    return true;
  }

  // ==== Bootstrap ====
  function start(){
    // 1) materials from scene
    ST.materialNames = listMaterials();
    if (!ST.materialNames.length){
      // 少し待ってから再試行（最大3秒）
      let tries=0; const iv=setInterval(()=>{
        ST.materialNames = listMaterials();
        tries++;
        if (ST.materialNames.length || tries>30){ clearInterval(iv); afterMaterials(); }
      },100);
    } else {
      afterMaterials();
    }
  }

  function afterMaterials(){
    if (!ST.materialNames.length){ warn('no materials found in scene'); return; }
    // 2) cache
    buildCacheOnce();
    // 3) bind UI
    const ok = bindUI();
    // 4) persisted load適用（UIの有無に関係なく）
    loadAndApplyAll();
    if (!ok){
      // UIまだなら、DOM変化を少し監視
      let tries=0; const mo = new MutationObserver(()=>{
        if (bindUI()){ mo.disconnect(); }
        tries++; if (tries>50){ mo.disconnect(); }
      });
      mo.observe(document.body, {childList:true,subtree:true});
    }
  }

  // 起動タイミング：viewerBridgeのシーン確立後を想定
  // 既存の bridge ログからポーリングで捕捉
  let t=0; const readyIv = setInterval(()=>{
    try{
      if (window.viewerBridge?.getScene && getScene()){
        clearInterval(readyIv);
        start();
      }
    }catch(e){}
    t++; if (t>100){ clearInterval(readyIv); warn('scene not ready'); }
  }, 100);
})();