/* material.ui.silence.patch.js v2.5
   Goal:
   - When switching material, immediately reflect the saved value (from sheet cache or localStorage) to the UI slider
   - During that short reflection window, silence input/change so orchestrator doesn't leak prior material's value
   - Learn/save per-material values locally when user actually manipulates the slider
*/
(function(){
  const TAG='[silence-patch v2.5]';
  let sheetCtx = { spreadsheetId:null, sheetGid:null };
  let silenceUntil = 0;
  const SILENCE_MS = 480;

  // capture sheet-context (logs show `lm:sheet-context {spreadsheetId, sheetGid}` is dispatched)
  window.addEventListener('lm:sheet-context', (ev)=>{
    try{
      const d = ev && ev.detail || ev;
      if(d && d.spreadsheetId){
        sheetCtx = { spreadsheetId: d.spreadsheetId, sheetGid: d.sheetGid ?? null };
        console.log(TAG,'sheet-context', sheetCtx);
      }
    }catch(e){ console.warn(TAG,'sheet-context parse error', e); }
  }, {capture:true, passive:true});

  function now(){ return Date.now(); }
  function inSilence(){ return now() < silenceUntil; }
  function armSilence(ms=SILENCE_MS){ silenceUntil = now()+ms; }

  // local cache helpers
  function cacheKey(matKey){
    const ss = sheetCtx.spreadsheetId || 'no-sheet';
    return `lm::mat::${ss}::${matKey}::opacity`;
  }
  function readLocal(matKey){
    try{
      const v = localStorage.getItem(cacheKey(matKey));
      if(v===null || v===undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }catch(_){ return null; }
  }
  function writeLocal(matKey, value){
    try{ localStorage.setItem(cacheKey(matKey), String(value)); }catch(_){}
  }

  // optional integration: if materials.sheet.bridge exposes cached getters
  function readBridge(matKey){
    try{
      const b = window.__lm_mat_sheet_bridge || window.materialsSheetBridge || window.materials_sheet_bridge;
      if(!b) return null;
      const fns = ['getCachedOpacity','getOpacityCached','getLastOpacity','getLastValue'];
      for(const fn of fns){
        if(typeof b[fn] === 'function'){
          const val = b[fn](matKey);
          const num = Number(val);
          if(Number.isFinite(num)) return num;
        }
      }
      return null;
    }catch(_){ return null; }
  }

  // find UI controls robustly
  function findControls(){
    const candidates = [].concat(
      Array.from(document.querySelectorAll('select#materialSelect')),
      Array.from(document.querySelectorAll('select[name="materialSelect"]')),
      Array.from(document.querySelectorAll('select[data-lm="material-select"]')),
      Array.from(document.querySelectorAll('#materialsTab select')),
      Array.from(document.querySelectorAll('section.materials select')),
      Array.from(document.querySelectorAll('select'))
    );
    const selectEl = candidates.find(el => el && el.tagName === 'SELECT' && (el.id==='materialSelect' || el.name==='materialSelect' || el.dataset.lm==='material-select' || el.closest('#materialsTab') || el.closest('section.materials')));
    const rangeCandidates = [].concat(
      Array.from(document.querySelectorAll('input#opacityRange')),
      Array.from(document.querySelectorAll('input[name="opacityRange"]')),
      Array.from(document.querySelectorAll('input[data-lm="opacity-range"]')),
      Array.from(document.querySelectorAll('#materialsTab input[type="range"]')),
      Array.from(document.querySelectorAll('section.materials input[type="range"]')),
      Array.from(document.querySelectorAll('input[type="range"]'))
    );
    const rangeEl = rangeCandidates.find(el => el && el.tagName==='INPUT' && el.type==='range');
    return {selectEl, rangeEl};
  }

  // generic capture silencer
  function captureSilencer(ev){
    if(inSilence()){
      ev.stopImmediatePropagation();
      ev.preventDefault();
      // no log spam
      return false;
    }
  }

  function currentMatKey(selectEl){
    if(!selectEl) return null;
    // prefer value; fallback to option text
    const opt = selectEl.options[selectEl.selectedIndex];
    return (selectEl.value||'').trim() || (opt ? (opt.value||opt.textContent||'').trim() : null);
  }

  function reflectUI(selectEl, rangeEl){
    const matKey = currentMatKey(selectEl);
    if(!matKey || !rangeEl) return;
    // priority: bridge -> local -> default 1.0
    let val = readBridge(matKey);
    if(val===null) val = readLocal(matKey);
    if(val===null) val = 1.0;
    // silence around UI programmatic set
    armSilence();
    // set without firing events
    try{
      rangeEl.value = val;
      // also mirror any numeric readout next to the slider
      const num = rangeEl.closest('label,div,section')?.querySelector('input[type="number"]');
      if(num){ num.value = val; }
      console.log(TAG,'switch ->', matKey, 'reflect', val);
    }catch(e){
      console.warn(TAG,'reflect failed', e);
    }
  }

  function learnOnUserInput(selectEl, rangeEl){
    // only when not in silence, store to local
    rangeEl.addEventListener('input', (ev)=>{
      if(inSilence()) return;
      const matKey = currentMatKey(selectEl);
      if(!matKey) return;
      const v = Number(rangeEl.value);
      if(Number.isFinite(v)){ writeLocal(matKey, v); }
    }, {passive:true});
  }

  function hookOnce(selectEl, rangeEl){
    // capture silencer on both controls
    ['change','input'].forEach(t=>{
      selectEl.addEventListener(t, captureSilencer, {capture:true});
      rangeEl.addEventListener(t, captureSilencer, {capture:true});
    });

    // on material change: silence then reflect saved value
    selectEl.addEventListener('change', (ev)=>{
      armSilence();
      // queue microtask to ensure option index updated
      Promise.resolve().then(()=> reflectUI(selectEl, rangeEl));
    }, {capture:false});

    learnOnUserInput(selectEl, rangeEl);

    console.log(TAG,'hooked select+range for silence+reflect');
  }

  // Wait for controls using MutationObserver + fallback polling
  function waitAndHook(){
    const {selectEl, rangeEl} = findControls();
    if(selectEl && rangeEl){
      hookOnce(selectEl, rangeEl);
      // initial bootstrap: reflect for first selected material as well
      reflectUI(selectEl, rangeEl);
      return true;
    }
    return false;
  }

  if(!waitAndHook()){
    console.log(TAG,'controls not found; observing...');
    const obs = new MutationObserver(()=>{
      if(waitAndHook()){
        obs.disconnect();
      }
    });
    obs.observe(document.documentElement || document.body, {subtree:true, childList:true});
    // hard fallback: stop after 15s
    setTimeout(()=>obs.disconnect(), 15000);
  }
})();