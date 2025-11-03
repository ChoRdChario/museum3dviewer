/* material.ui.commitmode.patch.js
 * "Commit-mode" for Material panel: 
 * - Slider 'input' => preview only
 * - Slider 'change' (mouse/touch release) => persist to sheet
 * - Material select 'change' => reflect from sheet into UI (no persist)
 * This file runs after existing orchestrator. It replaces the select/range nodes
 * with clones to drop previous listeners, then attaches our own.
 */
(function(){
  const log  = (...a)=>console.log('[commit-mode]', ...a);
  const warn = (...a)=>console.warn('[commit-mode]', ...a);

  function $pane(){ return document.querySelector('#pane-material'); }
  function $sel(){  return document.querySelector('#pane-material select'); }
  function $rng(){  return document.querySelector('#pane-material input[type="range"]'); }

  let programmatic = false;
  let sheetCache = null;
  let sheetCacheAt = 0;

  async function loadMap(){
    try {
      const m = await window.materialsSheetBridge.loadAll();
      return m;
    } catch(e){
      warn('loadAll failed', e);
      return null;
    }
  }
  async function getSheetValue(name){
    const now = Date.now();
    if (!sheetCache || (now - sheetCacheAt) > 1500){
      sheetCache = await loadMap();
      sheetCacheAt = Date.now();
    }
    const it = sheetCache && sheetCache.get && sheetCache.get(name);
    const v  = (it && it.opacity!=null && it.opacity!=='') ? parseFloat(it.opacity) : null;
    return (Number.isFinite(v) ? v : null);
  }

  function programmaticSet(el, v){
    programmatic = true;
    try { el.value = String(Math.max(0, Math.min(1, v))); }
    finally { setTimeout(()=>{ programmatic = false; }, 0); }
  }

  function listMatches(name){
    const sc = window.viewerBridge?.getScene?.();
    if (!sc) return [];
    const out=[];
    sc.traverse((obj)=>{
      if (obj.isMesh && obj.material){
        const handleMat = (mat)=>{
          if (!mat || !mat.name) return;
          if (mat.name===name) out.push({obj, material:mat});
        };
        if (Array.isArray(obj.material)) obj.material.forEach(handleMat);
        else handleMat(obj.material);
      }
    });
    return out;
  }

  function applyOpacityByName(name, val){
    const matches = listMatches(name);
    matches.forEach(({material:m})=>{
      try {
        m.transparent = (val < 1);
        m.opacity = val;
        if (m.needsUpdate!==false) m.needsUpdate = true;
      } catch(e){ warn('apply fail', e); }
    });
    log('preview opacity', val.toFixed ? val.toFixed(2) : val, '→', `"${name}"`, 'x'+matches.length);
  }

  function currentOpacityFromScene(name){
    const matches = listMatches(name);
    for (const {material:m} of matches){
      if (typeof m.opacity === 'number') return Math.max(0, Math.min(1, m.opacity));
    }
    return 1;
  }

  async function reflectFromSheet(name, rng){
    const vSheet = await getSheetValue(name);
    const v = (vSheet!=null) ? vSheet : currentOpacityFromScene(name);
    programmaticSet(rng, v);
    // Do not mutate scene here. Only reflect into UI.
  }

  async function persist(name, val){
    try {
      await window.materialsSheetBridge.upsertOne({materialKey:name, opacity:val});
      // Refresh cache eagerly
      sheetCache = await loadMap();
      sheetCacheAt = Date.now();
      log('persisted', name, 'opacity=', val);
    } catch(e){
      warn('persist failed', e);
    }
  }

  function rewire(){
    const pane = $pane();
    const sel0 = $sel();
    const rng0 = $rng();
    if (!pane || !sel0 || !rng0) return false;

    // Replace nodes to drop existing listeners
    const sel = sel0.cloneNode(true);
    const rng = rng0.cloneNode(true);
    sel.id = sel0.id || 'pm-material';
    rng.id = rng0.id || 'pm-opacity-range';

    sel0.replaceWith(sel);
    rng0.replaceWith(rng);

    sel.addEventListener('change', async ()=>{
      const name = sel.value;
      if (!name) return;
      await reflectFromSheet(name, rng);
    });

    // Preview on move
    rng.addEventListener('input', ()=>{
      if (programmatic) return;
      const raw = rng.value;
      const val = raw>1 ? (raw/100) : parseFloat(raw||'0') || 0;
      if (!sel.value) return;
      applyOpacityByName(sel.value, val);
    });

    // Commit on release
    const commitHandler = async ()=>{
      if (programmatic) return;
      const raw = rng.value;
      const val = raw>1 ? (raw/100) : parseFloat(raw||'0') || 0;
      if (!sel.value) return;
      applyOpacityByName(sel.value, val);
      await persist(sel.value, val);
    };
    rng.addEventListener('change', commitHandler);
    // Also commit on keyboard Enter/Space adjustment via blur
    rng.addEventListener('blur', commitHandler);

    // Initial reflect
    if (sel.value) { reflectFromSheet(sel.value, rng); }

    log('rewired material UI in commit-mode');
    return true;
  }

  function ensure(){
    if (rewire()) return;
    // retry while UI boots
    let tries=0;
    const iv = setInterval(()=>{
      tries++;
      if (rewire() || tries>60) clearInterval(iv);
    }, 250);
  }

  // Run after scene is stabilized or immediately
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    ensure();
  } else {
    window.addEventListener('DOMContentLoaded', ensure, {once:true});
  }
  window.addEventListener('lm:scene-ready', ensure, {once:true});
})();