// auto.apply.soft.patch.js — patched 2025-11-13 (JST)
// Purpose:
//  - Wrap postLoadEnsureSaveSheet invocation with safe error handling
//  - Prevent repeated loud logging; surface a single concise message
(function(){
  const TAG = "[glb-bridge-v3]";

  // idempotent guard
  if (window.__LM_AUTO_APPLY_SOFT_PATCH__) return;
  window.__LM_AUTO_APPLY_SOFT_PATCH__ = true;

  function once(fn){
    let done=false; return (...a)=>{ if(done) return; done=true; try{ return fn(...a);}catch(e){done=false; throw e;} };
  }

  // This hook can be called by viewer init code after scene loads the GLB.
  window.__lm_postLoadEnsureSaveSheet__ = once(async function(ctxParams){
    try{
      if (typeof window.postLoadEnsureSaveSheet !== "function"){
        console.log(TAG, "postLoadEnsureSaveSheet not ready yet; skip");
        return null;
      }
      return await window.postLoadEnsureSaveSheet(ctxParams || {});
    }catch(err){
      // Condense noisy stack to a single line
      console.log(TAG, "postLoadEnsureSaveSheet failed", (err && err.message) || err);
      return null;
    }
  });
})();
