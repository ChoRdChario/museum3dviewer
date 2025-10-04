// viewer_ready.js — provide a promise that resolves when window.app.viewer is ready
(function(){
  if (window.__viewerReadyPromise) return;
  let resolveFn;
  const p = new Promise(res => { resolveFn = res; });
  function check(){
    if (window.app && window.app.viewer){
      resolveFn(window.app.viewer);
      return true;
    }
    return false;
  }
  function tryResolve(){
    if (check()){
      window.removeEventListener('lmy:viewer-ready', tryResolve);
      window.removeEventListener('lmy:model-loaded', tryResolve);
      document.removeEventListener('DOMContentLoaded', tryResolve);
    }
  }
  // attach & check
  window.__viewerReadyPromise = p;
  // fast path
  if (!check()){
    window.addEventListener('lmy:viewer-ready', tryResolve);
    window.addEventListener('lmy:model-loaded', tryResolve);
    document.addEventListener('DOMContentLoaded', tryResolve);
    // also poll briefly as safety (in case no custom events fire)
    let c = 0;
    const h = setInterval(()=>{
      if (check() || (++c>100)) clearInterval(h); // ~10s max
    }, 100);
  }
})();
