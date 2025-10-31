
/* material.orchestrator.js
 * LociMyu Material Orchestrator (panel wiring + persist to Sheets)
 */
(function(){
  const VERSION_TAG = 'V6_14_PERSIST_FIX';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  function getScene(){
    try { if (window.viewerBridge?.getScene) return window.viewerBridge.getScene(); } catch(_){}
    return window.__LM_SCENE || window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }
  function listMaterials(){
    try { if (window.viewerBridge?.listMaterials) return window.viewerBridge.listMaterials() || []; } catch(_){}
    const sc = getScene(); if (!sc) return [];
    const set = new Set();
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{ if(mm?.name) set.add(mm.name); });
    });
    return Array.from(set);
  }

  // === Panel helpers ===
  function nearestSlider(from){
    let p = from.closest('section,fieldset,div') || from.parentElement;
    while (p){
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    return document.querySelector('[data-lm="right-panel"] input[type="range"]') ||
           document.querySelector('input[type="range"]') || null;
  }
  function populateSelect(sel, names){
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('','-- Select --');
    names.forEach(n=>add(n,n));
    sel.value='';
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    log('panel populated', names.length, 'materials');
  }

  // === Apply opacity ===
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
    if (hit) log(`opacity ${a.toFixed(2)} → "${name}" x${hit}`);
    return !!hit;
  }

  // === Persist ===
  function debounce(fn, ms){
    let t=null;
    return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }
  const persist = debounce(async (sel, slider)=>{
    try{
      const name = sel.value;
      if (!name || !window.materialsSheetBridge?.upsertOne) return;
      let a = parseFloat(slider?.value ?? '1');
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(slider?.value)||100)/100));

      const panel = document.querySelector('[data-lm="right-panel"]') || document;
      const ds = panel.querySelector('input[type="checkbox"][name="doubleSided"], input#doubleSided');
      const ul = panel.querySelector('input[type="checkbox"][name="unlit"], input#unlit');
      const ck = panel.querySelector('input[type="checkbox"][name="chromaEnable"], input#chroma-enable');
      const tol = panel.querySelector('input[type="range"][name="chromaTolerance"], input#chroma-tolerance');
      const fea = panel.querySelector('input[type="range"][name="chromaFeather"], input#chroma-feather');
      const col = panel.querySelector('input[type="color"][name="chromaColor"], input#chroma-color');

      const item = {
        materialKey: name,
        opacity: a,
        doubleSided: !!(ds && ds.checked),
        unlit: !!(ul && ul.checked),
        chromaEnable: !!(ck && ck.checked),
        chromaColor: col ? col.value : '',
        chromaTolerance: tol ? parseFloat(tol.value) : null,
        chromaFeather: fea ? parseFloat(fea.value) : null,
        updatedAt: new Date().toISOString(),
        updatedBy: 'mat-orch'
      };
      await window.materialsSheetBridge.upsertOne(item);
      log('persisted to sheet:', name);
    }catch(e){ warn('persist failed:', e); }
  }, 400);

  function wireOnce(){
    const sel = document.getElementById('pm-material');
    if (!sel) return false;
    const sld = nearestSlider(sel);
    const names = listMaterials();
    if (!names.length) return false;

    populateSelect(sel, names);

    // rebind to avoid duplicates
    const sel2 = sel.cloneNode(true); sel2.id = sel.id; sel.parentNode.replaceChild(sel2, sel);
    let sld2 = sld;
    if (sld){
      const c = sld.cloneNode(true); c.id = sld.id; sld.parentNode.replaceChild(c, sld); sld2=c;
    }
    const onChange = ()=>{
      if (!sld2) return;
      let a=parseFloat(sld2.value); if (isNaN(a)) a=Math.min(1,Math.max(0,(parseFloat(sld2.value)||100)/100));
      const name=sel2.value; if(!name) return;
      applyOpacityByName(name,a);
      persist(sel2, sld2);
    };
    sel2.addEventListener('change', onChange);
    sld2?.addEventListener('input', onChange, {passive:true});

    log('wired panel');
    return true;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);

    if (wireOnce()) return;

    window.addEventListener('lm:scene-ready', () => {
      log('scene-ready received, trying wireOnce...');
      wireOnce();
    }, { once: false });

    let tries = 0;
    const iv = setInterval(() => {
      if (wireOnce()) {
        clearInterval(iv);
      } else {
        tries++;
        if (tries > 120) {
          clearInterval(iv);
          warn('gave up after', tries, 'tries');
        } else if (tries % 20 === 0) {
          log('still trying...', tries);
        }
      }
    }, 250);
  }

  // kick
  start();
})();
