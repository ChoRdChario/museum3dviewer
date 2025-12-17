// glb.url.prefill.js
// Prefill the GLB input from URL query (?glb=...).
// Policy: prefill only (no autoload) to avoid auth/race issues.

(function(){
  try{
    const q = new URLSearchParams(location.search || '');
    const v = (q.get('glb') || q.get('fileId') || '').trim();
    if (!v) return;
    // expose for other modules
    try{ window.__LM_PREFILL_GLB__ = v; }catch(_e){}
    const apply = () => {
      const inp = document.getElementById('glbUrl');
      if (!inp) return;
      // only fill if empty (do not overwrite user input)
      if (String(inp.value || '').trim() === ''){
        inp.value = v;
        try{ inp.dispatchEvent(new Event('input', { bubbles: true })); }catch(_e){}
      }
    };
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', apply, { once: true });
    }else{
      apply();
    }
  }catch(e){
    console.warn('[glb-prefill] failed', e);
  }
})(); 
