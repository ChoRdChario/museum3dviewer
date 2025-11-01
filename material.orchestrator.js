
/* material.orchestrator.js — V6_15i_FIX_PACK
 * Robust wiring order: (UI) → (bridges) → (context) → (load saved → apply → bind events)
 */
(function(){
  const LOG='[mat-orch]';
  const VERSION_TAG='V6_15i_FIX_PACK';
  function log(...a){ try{ console.log(LOG, ...a);}catch(e){} }
  function warn(...a){ try{ console.warn(LOG, ...a);}catch(e){} }
  if (window.__mat_orch_loaded){ return; }
  window.__mat_orch_loaded = true;
  log('loaded VERSION_TAG:', VERSION_TAG);

  const $ = (s,r=document)=>r.querySelector(s);
  const sleep = ms=>new Promise(r=>setTimeout(r,ms));
  const debounce = (fn,ms)=>{ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms);} };

  async function waitForUI(timeout=6000){
    const t0 = performance.now();
    while (performance.now()-t0 < timeout){
      const sel = $('#pm-material-select') || $('[data-lm="pm-material-select"]');
      const rang = $('#pm-opacity') || $('[data-lm="pm-opacity"]') || document.querySelector('input[type="range"][name="pm-opacity"]');
      if (sel && rang) return { sel, rang };
      await sleep(50);
    }
    throw new Error('UI controls not found');
  }

  async function waitForBridges(timeout=6000){
    const t0 = performance.now();
    const ok = ()=> window.viewerBridge?.listMaterials && window.viewerBridge?.getScene &&
                    window.materialsSheetBridge?.ensureSheet && window.materialsSheetBridge?.loadAll && window.materialsSheetBridge?.upsertOne;
    while (performance.now()-t0 < timeout){
      if (ok()) return true;
      await sleep(60);
    }
    throw new Error('viewerBridge/materialsSheetBridge not ready');
  }

  async function waitForContext(timeout=8000){
    let scene = false, sheet = false;
    const t0 = performance.now();
    const hs = ()=> scene=true;
    const hc = ()=> sheet=true;
    document.addEventListener('lm:scene-ready', hs, {once:true});
    document.addEventListener('lm:sheet-context', hc, {once:true});
    if (window.__lm_last_sheet_context) sheet = true;
    while (performance.now()-t0 < timeout){
      if (scene && sheet) return true;
      await sleep(80);
    }
    throw new Error('scene/sheet context not ready');
  }

  let wired=false;
  async function boot(){
    const ui = await waitForUI();
    log('ui ok');
    await waitForBridges();
    await waitForContext();
    if (wired) return; wired=true;

    const sel = ui.sel;
    const slider = ui.rang;

    // populate select
    const mats = await window.viewerBridge.listMaterials();
    sel.innerHTML = '';
    const ph = document.createElement('option'); ph.value=''; ph.textContent='— Select —'; sel.appendChild(ph);
    (mats||[]).forEach(m=>{
      const opt = document.createElement('option');
      const key = m.name || m.materialKey || m.uuid || '';
      opt.value = key; opt.textContent = key || '(unnamed)';
      sel.appendChild(opt);
    });
    log(`panel populated ${mats?.length||0} materials`);

    let saved = new Map();
    try{ saved = await window.materialsSheetBridge.loadAll(); } catch(e){ warn('loadAll failed (continue with empty):', e); }

    let current=null, applying=false;

    function applyToScene(matKey, opacity){
      try{
        const scene = window.viewerBridge.getScene();
        scene.traverse?.((obj)=>{
          const mat = obj.material;
          const applyOne = (m)=>{
            if (!m || !m.name) return;
            if (m.name === matKey){
              m.transparent = true;
              m.opacity = Number(opacity);
              m.needsUpdate = true;
            }
          };
          if (Array.isArray(mat)) mat.forEach(applyOne); else applyOne(mat);
        });
      }catch(e){}
    }

    function reflect(state){
      const v = (state && state.opacity!=null) ? Number(state.opacity) : 1;
      slider.value = String(v);
    }

    async function onSel(){
      current = sel.value || null;
      if (!current) return;
      applying = true;
      const state = saved.get(current) || { opacity: 1 };
      reflect(state);
      applyToScene(current, state.opacity ?? 1);
      applying = false;
    }
    sel.addEventListener('change', onSel);

    slider.addEventListener('input', (e)=>{
      if (!current) return;
      applyToScene(current, parseFloat(e.target.value));
    });

    const persist = debounce(async (v)=>{
      if (!current || applying) return;
      try{
        await window.materialsSheetBridge.upsertOne({ materialKey: current, name: current, opacity: v });
      }catch(e){ warn('upsertOne failed', e); }
    }, 250);

    slider.addEventListener('change', (e)=> persist(parseFloat(e.target.value)));

    log('wired panel');
  }

  async function maybeWire(){
    try{ await boot(); }
    catch(e){ warn('boot failed (will retry automatically)', e); setTimeout(maybeWire, 700); }
  }
  maybeWire();
})();
