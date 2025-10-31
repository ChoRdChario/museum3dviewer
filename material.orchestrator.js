
// LociMyu Material Orchestrator - Panel Inject & Apply (V6_12n)
// See chat for details.
(function(){
  const NS='[mat-orch]';
  const log=(...a)=>console.log(NS, ...a);
  const warn=(...a)=>console.warn(NS, ...a);

  function listFromBridge(){
    try{
      const b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials==='function'){
        const arr = b.listMaterials() || [];
        return Array.isArray(arr) ? arr.slice() : [];
      }
    }catch(_){}
    return [];
  }

  function listFromScene(){
    const getScene = ()=>
      (window.viewerBridge && typeof window.viewerBridge.getScene==='function' && window.viewerBridge.getScene())
      || (window.__lm_getScene && window.__lm_getScene())
      || (window.__lm_viewer && window.__lm_viewer.scene)
      || (window.viewer && window.viewer.scene)
      || null;
    const scene = getScene();
    const THREE = window.THREE;
    if (!scene || !THREE) return [];
    const badType = (m)=> /Depth|Distance|Shadow|Sprite|Shader/.test(m?.type||'')
      || m?.isLineBasicMaterial || m?.isLineDashedMaterial || m?.isPointsMaterial;
    const isOverlayObj = (o)=> o?.type==='Sprite' || o?.name?.startsWith?.('__LM_') || o?.userData?.__lmOverlay;
    const set = new Set();
    scene.traverse((obj)=>{
      if (isOverlayObj(obj)) return;
      const mat = obj.material;
      const push = (m)=>{
        if (!m || badType(m)) return;
        const n = (m.name||'').trim();
        if (!n) return;
        set.add(n);
      };
      if (Array.isArray(mat)) mat.forEach(push); else push(mat);
    });
    return [...set];
  }

  function getMaterials(){
    const a = listFromBridge();
    if (a.length) return a;
    const b = listFromScene();
    return b;
  }

  function rightPanel(){
    return document.querySelector('[data-lm="right-panel"]')
        || document.querySelector('#right-panel')
        || document.querySelector('#panel')
        || document.body;
  }
  function materialSection(){
    const root = rightPanel();
    const cands = [
      root.querySelector('[data-lm="material-tab"]'),
      root.querySelector('#lm-material-tab'),
      root.querySelector('#tab-material'),
      root
    ];
    for (const n of cands) if (n) return n;
    return root;
  }
  function perMaterialOpacityCard(){
    const box = materialSection();
    const blocks = box.querySelectorAll('section, div, fieldset');
    for (const el of blocks){
      const t = (el.textContent||'').toLowerCase();
      if ((t.includes('per-material opacity') || t.includes('saved per sheet')) &&
          el.querySelector('input[type="range"]')) return el;
    }
    for (const el of blocks){
      if (el.querySelector('input[type="range"]')) return el;
    }
    return box;
  }
  function findPanelSelect(){
    const card = perMaterialOpacityCard();
    let sel = card.querySelector('select:not(#lm-material-select)');
    if (sel) return sel;
    const box = materialSection();
    const all = box.querySelectorAll('select');
    for (const s of all){ if (s.id!=='lm-material-select') return s; }
    return null;
  }
  function findOpacitySlider(){
    const card = perMaterialOpacityCard();
    return card.querySelector('input[type="range"]');
  }
  function cleanupDebugSelect(){
    const dbg = document.querySelector('#lm-material-select');
    if (!dbg) return;
    const panel = materialSection();
    if (!panel.contains(dbg)) dbg.remove();
  }

  function populateIntoPanelSelect(materials){
    let dst = findPanelSelect();
    if (!dst) { warn('panel select not found'); return false; }
    while (dst.firstChild) dst.removeChild(dst.firstChild);
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t||v; dst.appendChild(o); };
    add('','-- Select --');
    materials.forEach(m=>add(m,m));
    dst.value='';
    dst.dispatchEvent(new Event('change', {bubbles:true}));
    log('populated into panel select:', materials.length);
    return true;
  }

  function getScene(){
    return (window.viewerBridge && typeof window.viewerBridge.getScene==='function' && window.viewerBridge.getScene())
        || (window.__lm_getScene && window.__lm_getScene())
        || (window.__lm_viewer && window.__lm_viewer.scene)
        || (window.viewer && window.viewer.scene)
        || null;
  }
  function setOpacityFor(name, alpha){
    const scene = getScene();
    if (!scene) return;
    scene.traverse((obj)=>{
      const mat = obj.material;
      const apply = (m)=>{
        if (!m) return;
        const n = (m.name||'').trim();
        if (n !== name) return;
        if (typeof m.transparent==='boolean') m.transparent = (alpha < 1.0) || m.transparent;
        if ('opacity' in m) m.opacity = alpha;
        if (typeof m.needsUpdate!=='undefined') m.needsUpdate = true;
      };
      if (Array.isArray(mat)) mat.forEach(apply); else apply(mat);
    });
  }
  function wireSliderToApply(){
    const sel = findPanelSelect();
    const slider = findOpacitySlider();
    if (!sel || !slider) { warn('apply wire: select or slider missing'); return; }
    if (slider.__lm_wired) return;
    slider.addEventListener('input', ()=>{
      const name = sel.value;
      if (!name) return;
      const alpha = parseFloat(slider.value);
      if (!isFinite(alpha)) return;
      setOpacityFor(name, alpha);
    });
    slider.__lm_wired = true;
    log('slider wired for apply');
  }

  let populatedOnce = false;
  function tryPopulate(){
    const mats = getMaterials();
    if (!mats.length){ warn('[mat-orch-hotfix] materials still empty (non-fatal)'); return false; }
    const ok = populateIntoPanelSelect(mats);
    if (ok){ populatedOnce = true; cleanupDebugSelect(); wireSliderToApply(); }
    return ok;
  }

  function whenDomReady(fn){
    if (document.readyState === 'complete' || document.readyState === 'interactive') fn();
    else document.addEventListener('DOMContentLoaded', fn, {once:true});
  }
  function armObserver(){
    const panel = rightPanel();
    const obs = new MutationObserver(()=>{ tryPopulate(); });
    obs.observe(panel, {subtree:true, childList:true});
    const stop = setInterval(()=>{
      if (populatedOnce){ obs.disconnect(); clearInterval(stop); }
    }, 500);
  }
  function armTabHook(){
    const tabs = document.querySelectorAll('button, a');
    for (const t of tabs){
      const text = (t.textContent||'').trim().toLowerCase();
      if (!text) continue;
      if (text === 'material' || text === 'materials'){
        if (t.__lm_tab_hooked) continue;
        t.addEventListener('click', ()=> setTimeout(tryPopulate, 60));
        t.__lm_tab_hooked = true;
      }
    }
  }

  log('loaded VERSION_TAG:V6_12n_PANEL_INJECT_APPLY');
  whenDomReady(()=>{
    armTabHook();
    setTimeout(tryPopulate, 0);
    setTimeout(tryPopulate, 150);
    setTimeout(tryPopulate, 400);
    armObserver();
  });
})();
