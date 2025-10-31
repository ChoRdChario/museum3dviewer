/**
 * material.orchestrator.js
 * Wires #pm-material select with material names and binds the opacity slider.
 * Robust against late scene availability: reacts to repeated 'lm:scene-ready' and polls.
 */
(() => {
  const NS='mat-orch';
  const VERSION_TAG = 'V6_13C_BRIDGE_TAP_PERSIST';
  const log  = (...a)=>console.log(`[${NS}]`, ...a);
  const warn = (...a)=>console.warn(`[${NS}]`, ...a);

  function getPanelSelect() {
    return document.getElementById('pm-material');
  }
  function nearestSlider(from){
    let p = from?.closest('section,fieldset,div') || from?.parentElement || document;
    while (p){
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    return document.querySelector('[data-lm="right-panel"] input[type="range"]') || document.querySelector('input[type="range"]');
  }

  function listMaterials() {
    try {
      const b = window.viewerBridge;
      if (b?.listMaterials) {
        const arr = b.listMaterials() || [];
        if (Array.isArray(arr) && arr.length) return arr.slice();
      }
    } catch(e){}
    return [];
  }

  function populate(sel, names){
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('','-- Select --');
    names.forEach(n=>add(n,n));
    sel.value='';
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    log('populated', names.length, 'materials');
  }

  function getScene(){
    try { return window.viewerBridge?.getScene?.() || window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null; }
    catch(e){ return null; }
  }
  function applyOpacityByName(name, a){
    const sc=getScene(); if(!sc||!name) return false;
    let hit=0;
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm?.name===name){
          mm.transparent = a < 1 ? true : mm.transparent;
          mm.opacity = a;
          mm.needsUpdate = true;
          hit++;
        }
      });
    });
    return !!hit;
  }

  let wired = false;
  function wireOnce() {
    if (wired) return true;
    const sel = getPanelSelect();
    if (!sel) return false;

    const names = listMaterials();
    if (!names.length) return false;

    populate(sel, names);

    const sld = nearestSlider(sel);
    const sel2 = sel.cloneNode(true); sel2.id = sel.id; sel.parentNode.replaceChild(sel2, sel);
    let sld2 = sld;
    if (sld) { const c=sld.cloneNode(true); c.id=sld.id; sld.parentNode.replaceChild(c,sld); sld2=c; }

    const onChange = () => {
      if (!sld2) return;
      let a = parseFloat(sld2.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(sld2.value)||100)/100));
      const name = sel2.value;
      if (!name) return;
      const ok = applyOpacityByName(name, a);
      if (!ok) warn('material not found in scene for', name);
      // TODO: persist via materialsSheetBridge.upsertOne(...) when save timing is defined.
    };
    sel2.addEventListener('change', onChange);
    sld2?.addEventListener('input', onChange, {passive:true});

    wired = true;
    log('wired successfully');
    return true;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);
    // immediate try
    if (wireOnce()) return;

    // listen multiple times
    const onReady = () => {
      log('scene-ready received, trying wireOnce...');
      wireOnce();
    };
    window.addEventListener('lm:scene-ready', onReady, { once:false });
    document.addEventListener('lm:scene-ready', onReady, { once:false });

    // polling fallback
    let tries = 0;
    const iv = setInterval(() => {
      if (wireOnce()) { clearInterval(iv); }
      else {
        tries++;
        if (tries > 150) { clearInterval(iv); warn('gave up after', tries, 'attempts'); }
        else if (tries % 25 === 0) { log('still trying...', tries); }
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();