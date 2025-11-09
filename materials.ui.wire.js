
/*!
 * materials.ui.wire.js v1.2
 * - Binds to #pm-material / #pm-opacity-range
 * - Debounced persist using LM_MaterialsPersist.upsert()
 * - Waits for auth helper and sheet-context
 */
(function(){
  const LOG = (...a)=>console.log('[mat-ui-wire v1.2]', ...a);
  const WARN = (...a)=>console.warn('[mat-ui-wire v1.2]', ...a);

  function waitAuthHelper(timeoutMs=15000){
    if (typeof window.__lm_fetchJSONAuth === 'function') return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const t0 = performance.now();
      const iv = setInterval(()=>{
        if (typeof window.__lm_fetchJSONAuth === 'function'){
          clearInterval(iv); resolve();
        } else if (performance.now() - t0 > timeoutMs){
          clearInterval(iv); reject(new Error('__lm_fetchJSONAuth not present'));
        }
      }, 50);
    });
  }

  function waitCtx(timeoutMs=15000){
    // quick path: if ctx already present
    const ok = (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.spreadsheetId);
    if (ok) return Promise.resolve(window.__LM_SHEET_CTX);
    return new Promise((resolve,reject)=>{
      const t0 = performance.now();
      const on = (e)=>{
        const c = (e && e.detail) || window.__LM_SHEET_CTX;
        if (c && c.spreadsheetId){ cleanup(); resolve(c); }
      };
      const cleanup = ()=>{
        window.removeEventListener('lm:sheet-context', on, true);
      };
      window.addEventListener('lm:sheet-context', on, true);
      setTimeout(()=>{ cleanup(); reject(new Error('sheet-context timeout')); }, timeoutMs);
    });
  }

  (async function init(){
    try{
      await waitAuthHelper().catch(()=>{});
      await waitCtx().catch(()=>{});
    }catch(e){ WARN('pre-wait failed', e); }

    const sel = document.querySelector('#pm-material');
    const rng = document.querySelector('#pm-opacity-range');
    if (!sel || !rng){
      WARN('UI not found', {sel: !!sel, rng: !!rng});
      return;
    }

    // ensure we have persist
    const P = window.LM_MaterialsPersist;
    if (!P || typeof P.upsert !== 'function'){
      WARN('LM_MaterialsPersist missing');
      return;
    }

    let timer;
    const handler = async ()=>{
      const key = sel.value || sel.selectedOptions?.[0]?.value || '';
      if (!key) return;
      const opacity = parseFloat(rng.value);
      try{
        await P.upsert({ materialKey:key, opacity });
      }catch(err){ WARN('persist failed', err); }
    };
    const debounced = ()=>{ clearTimeout(timer); timer = setTimeout(handler, 150); };

    rng.addEventListener('input', debounced, {passive:true});
    rng.addEventListener('change', debounced, {passive:true});
    rng.addEventListener('pointerup', debounced, {passive:true});
    sel.addEventListener('change', handler, {passive:true});

    LOG('wired');
  })();
})();
