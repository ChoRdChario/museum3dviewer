// material.orchestrator.js v20251029
// Minimal UI orchestrator for Material tab (opacity + material select).
// Requires window.lmMaterials from material.store.js
(function(){
  'use strict';
  const state = {
    ui: null,
    mats: [], // {uuid,name}
    current: null, // selected mat uuid
    inited: false,
  };

  function log(...a){ console.debug('[mat-orch]', ...a); }

  // --- scene helpers ---
  function getSceneRoot(){
    return window.viewer?.getSceneRoot?.() || window.__LM_SCENE || window.scene || null;
  }
  function getModelRoot(){
    const via = window.viewer?.getModelRoot?.();
    if (via) return via;
    const r = getSceneRoot(); if (!r) return null;
    let best=null, cnt=-1;
    (r.children||[]).forEach(c=>{
      if (c?.userData?.gltfAsset) return best = c;
      let k=0; c.traverse(o=>{ if (o.isMesh||o.type==='Mesh') k++; });
      if (k>cnt){ cnt=k; best=c; }
    });
    return best || r;
  }
  function listUniqueMaterials(){
    const root = getModelRoot();
    const list = [];
    if (!root) return list;
    const map = new Map();
    root.traverse(o=>{
      const m = o.material; if (!m) return;
      const push = (mm)=>{
        if (!map.has(mm.uuid)) { map.set(mm.uuid, { uuid:mm.uuid, name:mm.name||'(unnamed)' }); }
      };
      Array.isArray(m) ? m.forEach(push) : push(m);
    });
    return Array.from(map.values()).sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  }
  function applyOpacity(uuid, value){
    const root = getModelRoot(); if (!root) return;
    root.traverse(o=>{
      const m = o.material; if (!m) return;
      const setv = (mm)=>{ if (mm.uuid===uuid) { mm.opacity = value; mm.transparent = value < 1.0; mm.needsUpdate = true; } };
      Array.isArray(m) ? m.forEach(setv) : setv(m);
    });
  }

  // --- UI wiring ---
  function ensureUI(){
    const rootTab = document.querySelector('#tab-material, [role="tabpanel"]#tab-material, .lm-tabpanel#tab-material');
    if (!rootTab) return null; // <<< guard: do not render anywhere else
    const sel = document.querySelector('#pm-material');
    const rng = document.querySelector('#pm-opacity-range');
    const val = document.querySelector('#pm-opacity-value');
    const refresh = document.querySelector('#pm-refresh, #pm-refresh-btn');
    state.ui = { rootTab, sel, rng, val, refresh };
    return state.ui;
  }

  function fillSelect(){
    const ui = state.ui; if (!ui || !ui.sel) return;
    ui.sel.innerHTML = '';
    const ph = document.createElement('option');
    ph.textContent = '— Select material —'; ph.value='';
    ui.sel.appendChild(ph);
    state.mats.forEach(m=>{
      const opt = document.createElement('option');
      opt.value = m.uuid; opt.textContent = m.name || m.uuid;
      ui.sel.appendChild(opt);
    });
  }

  async function refreshMaterials(){
    state.mats = listUniqueMaterials();
    fillSelect();
    log('materials:', state.mats.length);
  }

  function bindHandlers(){
    const ui = state.ui; if (!ui) return;
    if (ui.refresh) ui.refresh.addEventListener('click', refreshMaterials);
    if (ui.sel) ui.sel.addEventListener('change', e=>{
      state.current = e.target.value || null;
    });
    if (ui.rng){
      const syncLabel = (v)=>{ if (ui.val) ui.val.textContent = (Number(v)||0).toFixed(2); };
      ui.rng.addEventListener('input', e=>{
        const v = Number(e.target.value||1);
        syncLabel(v); if (state.current) applyOpacity(state.current, v);
      });
      const commit = async (v)=>{
        if (!state.current) return;
        try { await window.lmMaterials?.saveOpacity?.(state.current, (state.mats.find(m=>m.uuid===state.current)?.name)||'', Number(v)); }
        catch(err){ console.warn('[mat-orch] saveOpacity failed', err); }
      };
      ['change','pointerup','keyup'].forEach(type=>{
        ui.rng.addEventListener(type, e=>commit(e.target.value));
      });
    }
  }

  function onceInit(){
    if (state.inited) return;
    if (!ensureUI()) { log('material panel not found'); return; }
    bindHandlers();
    state.inited = true;
    setTimeout(refreshMaterials, 300); // after model-ready settle
  }

  // boot on model-ready & on first scene-ready as fallback
  window.addEventListener('lm:model-ready', onceInit);
  window.addEventListener('lm:scene-ready', onceInit);
  // also try a delayed boot in case events already fired
  setTimeout(onceInit, 1000);
})();
