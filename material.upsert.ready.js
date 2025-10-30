// material.upsert.ready.js
// Add-on: queue opacity saves until token + sheet context are ready, then flush.
// Safe to include after material.orchestrator.js. No global overrides required.

(function(){
  const log = (...a)=>console.log('[mat-upsert-addon]', ...a);

  // Lightweight state view
  const st = (window.__lm_materialState = window.__lm_materialState || { spreadsheetId:null, sheetGid:null, modelKey:null, currentMaterialKey:null });

  // Utilities
  async function getTokenSafe(){
    try{
      if (typeof getAccessToken === 'function'){
        const v = getAccessToken();
        return (v && typeof v.then==='function') ? await v : v;
      }
      if (typeof window.__lm_getAccessToken === 'function'){
        const v = window.__lm_getAccessToken();
        return (v && typeof v.then==='function') ? await v : v;
      }
    }catch(e){}
    return null;
  }
  function hasCtx(){ return !!st.spreadsheetId; }
  async function hasToken(){ try{ return !!(await getTokenSafe()); }catch(e){ return false; } }
  async function waitForReady(maxMs=8000){
    const start = Date.now();
    while (Date.now() - start < maxMs){
      if (hasCtx() && await hasToken()) return true;
      await new Promise(r=>setTimeout(r,200));
    }
    return false;
  }

  // Pending buffer
  let pending = null;
  function setPending(v){ pending = v; }
  function takePending(){ const v = pending; pending = null; return v; }

  // Observe sheet-context to keep st in sync
  const onCtx = (ev)=>{
    const d = (ev && ev.detail) || {};
    if (d.spreadsheetId) st.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid !== 'undefined') st.sheetGid = d.sheetGid;
  };
  window.addEventListener('lm:sheet-context', onCtx);
  document.addEventListener('lm:sheet-context', onCtx);

  // Hook opacity inputs and gate saving until ready
  function isOpacityInput(el){
    if (!el) return false;
    if (el.matches && (el.matches('[data-lm="mat-opacity"]') || el.matches('#lm-opacity') || el.matches('input[type="range"].lm-opacity') || el.matches('input[type="range"][name="opacity"]'))) return true;
    return false;
  }

  const handler = async (e)=>{
    const t = e.target;
    if (!isOpacityInput(t)) return;
    const v = (typeof t.value === 'string') ? parseFloat(t.value) : (t.value || 0);
    if (isNaN(v)) return;
    // If orchestrator exposes __lm_saveCurrentOpacity, use it after readiness
    if (typeof window.__lm_saveCurrentOpacity !== 'function'){
      log('orchestrator API __lm_saveCurrentOpacity not found; skipping');
      return;
    }
    if (!hasCtx() || !(await hasToken())){
      setPending(v);
      const ok = await waitForReady(8000);
      if (!ok){
        log('skip save (not ready)');
        return;
      }
      const v2 = takePending();
      if (typeof v2 === 'number') window.__lm_saveCurrentOpacity(v2);
      else window.__lm_saveCurrentOpacity(v);
    }else{
      window.__lm_saveCurrentOpacity(v);
    }
  };

  document.addEventListener('input', handler, true);

  // On model-ready/context, flush pending if any
  const tryFlush = async ()=>{
    const v = takePending();
    if (typeof v === 'number' && hasCtx() && await hasToken()){
      window.__lm_saveCurrentOpacity(v);
    }
  };
  document.addEventListener('lm:sheet-context', ()=>setTimeout(tryFlush, 50));
  document.addEventListener('lm:model-ready',   ()=>setTimeout(tryFlush, 50));

  log('installed');
})();