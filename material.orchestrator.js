// material.orchestrator.js
// LociMyu: Populate #pm-material from viewerBridge and bind opacity slider
(function(){
  const VERSION_TAG = 'V6_13c_BRIDGE_TAP_PERSIST';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  function nearestSlider(from){
    let p = from.closest('section,fieldset,div') || from.parentElement;
    while (p){
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    return document.querySelector('[data-lm="right-panel"] input[type="range"]') ||
           document.querySelector('input[type="range"]');
  }

  function populateSelect(sel, names){
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '-- Select --');
    names.forEach(n=>add(n,n));
    sel.value='';
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    log('populated into #pm-material:', names.length);
  }

  function applyOpacityByName(name, a){
    const sc = window.viewerBridge?.getScene?.();
    if (!sc || !name) return false;
    let hit=0;
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm?.name===name){
          mm.transparent = a < 1 ? true : mm.transparent;
          mm.opacity = a; mm.needsUpdate = true; hit++;
        }
      });
    });
    if (hit) log(`opacity ${a.toFixed(2)} -> "${name}" x${hit}`);
    return !!hit;
  }

  function wireOnce(){
    const sel = document.getElementById('pm-material');
    if (!sel){ warn('select #pm-material not found'); return false; }
    const names = (window.viewerBridge && window.viewerBridge.listMaterials && window.viewerBridge.listMaterials()) || [];
    if (!names.length){ warn('no materials yet'); return false; }
    populateSelect(sel, names);

    const slider = nearestSlider(sel);

    // avoid duplicate handlers
    const sel2 = sel.cloneNode(true); sel2.id = sel.id; sel.parentNode.replaceChild(sel2, sel);
    let sld2 = slider;
    if (slider){ const c=slider.cloneNode(true); c.id = slider.id; slider.parentNode.replaceChild(c, slider); sld2=c; }

    const onChange = () => {
      if (!sld2) return;
      let a = parseFloat(sld2.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(sld2.value)||100)/100));
      const name = sel2.value; if (!name) return;
      applyOpacityByName(name, a);
    };
    sel2.addEventListener('change', onChange);
    sld2 && sld2.addEventListener('input', onChange, {passive:true});
    log('bound #pm-material & slider');
    return true;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);
    // Try immediately, then on scene-ready, then with short retries.
    if (wireOnce()) return;
    let tries = 0;
    const iv = setInterval(() => {
      if (wireOnce()) { clearInterval(iv); }
      else if (++tries > 80) { clearInterval(iv); warn('gave up: no materials'); }
    }, 100);
    window.addEventListener('lm:scene-ready', () => { wireOnce(); }, { once:false });
  }

  // defer start to next tick so DOM is ready
  (typeof queueMicrotask === 'function' ? queueMicrotask : setTimeout)(start, 0);
})();
