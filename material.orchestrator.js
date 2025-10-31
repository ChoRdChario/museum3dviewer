// material.orchestrator.js
const VERSION_TAG = 'V6_15_INIT_ORDER_FIX';
(function(){
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  let haveScene=false, haveSheet=false, wired=false;
  let suppress=false;
  let debounceT=0;

  function getScene(){
    try { return window.viewerBridge?.getScene?.() || window.__LM_SCENE || window.viewer?.scene || window.__viewer?.scene || window.lm?.scene || null; }
    catch(e){ return null; }
  }
  function listMaterials(){
    try { return window.viewerBridge?.listMaterials?.() || []; }
    catch(e){ return []; }
  }
  function nearestSlider(from){
    let p = from?.closest('section,fieldset,div') || from?.parentElement || null;
    while(p){
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    return (document.querySelector('[data-lm="right-panel"] input[type="range"]') ||
            document.querySelector('input[type="range"]'));
  }
  function applyOpacityByName(name, a){
    const sc = getScene(); if(!sc||!name) return 0;
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
    return hit;
  }
  function populateSelect(sel, names){
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('','-- Select --'); names.forEach(n=>add(n,n));
    sel.value='';
  }

  async function wireOnce(){
    if (wired) return true;
    if (!haveScene || !haveSheet) return false;

    const sel = document.getElementById('pm-material');
    const sld = nearestSlider(sel);
    if (!sel || !sld){ warn('panel controls missing'); return false; }

    const names = listMaterials();
    if (!names.length){ warn('no materials yet'); return false; }
    populateSelect(sel, names);
    log('panel populated', names.length, 'materials');

    suppress = true;
    try{
      const map = await window.materialsSheetBridge?.loadAll?.();
      const latest = new Map();
      for (const rec of (map ? map.values():[])) latest.set(rec.materialKey, rec);

      for (const n of names){
        const rec = latest.get(n);
        if (rec && rec.opacity!=null){
          applyOpacityByName(n, Number(rec.opacity));
        }
      }

      sel.value = names[0] || '';
      if (sel.value){
        const rec0 = latest.get(sel.value);
        const a0 = (rec0 && rec0.opacity!=null) ? Number(rec0.opacity) : 1.0;
        sld.value = isFinite(a0) ? a0 : 1;
      }
    } finally {
      suppress = false;
    }

    const onChange = async ()=>{
      if (suppress) return;
      const name = sel.value; if (!name) return;
      let a = parseFloat(sld.value); if (isNaN(a)) a = 1;
      applyOpacityByName(name, a);

      clearTimeout(debounceT);
      debounceT = setTimeout(async ()=>{
        try{
          await window.materialsSheetBridge?.upsertOne?.({
            key: `${name}::opacity`,
            modelKey: '',
            materialKey: name,
            opacity: a,
            doubleSided: false,
            unlit: false,
            chromaEnable: '',
            chromaColor: '',
            chromaTolerance: '',
            chromaFeather: '',
            updatedAt: new Date().toISOString(),
            updatedBy: 'mat-orch'
          });
          log('persisted to sheet:', name);
        }catch(e){ warn('persist failed:', e); }
      }, 250);
    };

    sel.addEventListener('change', onChange);
    sld.addEventListener('input', onChange, {passive:true});

    wired = true;
    log('wired panel');
    return true;
  }

  log('loaded VERSION_TAG:', VERSION_TAG);

  window.addEventListener('lm:sheet-context', ()=>{ haveSheet=true; wireOnce(); }, {once:true});
  window.addEventListener('lm:scene-ready', ()=>{ haveScene=true; wireOnce(); }, {once:true});

  let tries=0;
  const iv = setInterval(()=>{
    if (!haveScene && getScene()) haveScene=true;
    if (!haveSheet && window.materialsSheetBridge?.config?.spreadsheetId) haveSheet=true;
    if (wireOnce()){ clearInterval(iv); }
    else if ((++tries)%20===0) log('still trying...', tries);
    if (tries>100){ clearInterval(iv); warn('gave up'); }
  }, 100);
})();