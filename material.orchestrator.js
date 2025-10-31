
// material.orchestrator.js  V6_15b INIT_ORDER_FIX (no UI overwrite on boot)
(() => {
  const VERSION_TAG = 'V6_15b_INIT_ORDER_FIX';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  const state = { wired:false, suppress:true, lastSel:null };

  function $(s,root=document){ return root.querySelector(s); }
  function getScene(){
    try{ return window.viewerBridge?.getScene?.() || window.__LM_SCENE || window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null; }
    catch(e){ return null; }
  }
  function listMaterials(){ try{ return window.viewerBridge?.listMaterials?.()||[]; }catch(e){ return []; } }

  function applyOpacityByName(name, a){
    const sc = getScene(); if(!sc || !name) return 0;
    let hit=0;
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm?.name===name){
          mm.transparent = a<1 ? true : mm.transparent;
          mm.opacity = a; mm.needsUpdate = true; hit++;
        }
      });
    });
    if (hit) log(`opacity ${a.toFixed(2)} → "${name}" x${hit}`);
    return hit;
  }

  function populatePanel(names){
    const sel = document.getElementById('pm-material') || $('[data-lm="right-panel"] select');
    if (!sel) return null;
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '-- Select --'); names.forEach(n=>add(n,n));
    log('panel populated', names.length, 'materials');
    return sel;
  }

  function nearestSlider(from){
    let p = from?.closest('section,fieldset,div') || from?.parentElement || document;
    while(p){
      const r = p.querySelector('input[type="range"]'); if (r) return r;
      p = p.parentElement;
    }
    return document.querySelector('[data-lm="right-panel"] input[type="range"]') || document.querySelector('input[type="range"]');
  }

  async function applySavedBeforeBinding(){
    try{
      await window.materialsSheetBridge?.waitReady?.();
      const map = await window.materialsSheetBridge.loadAll();
      const names = listMaterials();
      // apply saved opacity (default 1)
      names.forEach(name => {
        const rec = map.get(name) || map.get(String(name));
        const alpha = (rec && typeof rec.opacity==='number') ? rec.opacity : 1;
        applyOpacityByName(name, alpha);
      });
      return { names, map };
    }catch(e){ warn('applySavedBeforeBinding failed', e); return { names:listMaterials(), map:new Map() }; }
  }

  function bindUI(sel, savedMap){
    const slider = nearestSlider(sel);
    // clone-replace to drop legacy listeners
    const sel2 = sel.cloneNode(true); sel2.id = sel.id; sel.parentNode.replaceChild(sel2, sel);
    let sld2 = slider;
    if (slider){ const c = slider.cloneNode(true); c.id = slider.id; slider.parentNode.replaceChild(c, slider); sld2 = c; }

    // initialize UI from saved (but suppress events)
    state.suppress = true;
    const firstMat = sel2.options.length>1 ? sel2.options[1].value : '';
    if (firstMat && sld2){
      const rec = savedMap.get(firstMat);
      const alpha = (rec && typeof rec.opacity==='number') ? rec.opacity : 1;
      sld2.value = String(alpha);
      state.lastSel = firstMat;
    }
    // small delay then allow events
    setTimeout(()=>{ state.suppress = false; }, 100);

    // debounced persist
    let t=null;
    const persist = (mat, alpha) => {
      if (!window.materialsSheetBridge?.upsertOne) return;
      const row = { materialKey:mat, name:mat, opacity:alpha, updatedBy:'ui' };
      window.materialsSheetBridge.upsertOne(row).then(()=>log('persisted to sheet:', mat)).catch(e=>warn('persist failed', e));
    };
    const deb = (fn,ms)=>{ return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
    const debPersist = deb(persist, 250);

    const onChange = () => {
      if (!sld2) return;
      const name = sel2.value; if (!name) return;
      let a = parseFloat(sld2.value); if (isNaN(a)) a = 1;
      applyOpacityByName(name, a);
      if (!state.suppress) debPersist(name, a);
    };
    sel2.addEventListener('change', onChange);
    sld2?.addEventListener('input', onChange, {passive:true});

    state.wired = true;
    log('wired panel');
  }

  async function wireOnce(){
    const names = listMaterials();
    if (!names.length) return false;
    const sel = populatePanel(names);
    if (!sel) return false;
    const { map } = await applySavedBeforeBinding();
    bindUI(sel, map);
    return true;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);
    // try immediate
    wireOnce();

    // listen for scene-ready then retry
    window.addEventListener('lm:scene-ready', () => {
      log('scene-ready received, trying wireOnce...'); wireOnce();
    }, { once:false });

    // poll a bit
    let tries=0;
    const iv = setInterval(()=>{
      if (state.wired) { clearInterval(iv); return; }
      if (wireOnce()){ clearInterval(iv); }
      else { tries++; if (tries%20===0) log('still trying...', tries); if (tries>120){ clearInterval(iv); warn('gave up'); } }
    }, 200);
  }

  start();
})();
