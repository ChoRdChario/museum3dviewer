// viewer_ready.js — resolve when a viewer is ready (real or fallback)
(function(){
  if (window.__viewerReadyPromise) return; // reuse if present
  let resolveFn; let settled = false;
  window.__viewerReadyPromise = new Promise((res)=>{ resolveFn = (v)=>{ if(!settled){ settled = true; res(v); } }; });

  function resolveNow(value){
    resolveFn(value || (window.app && window.app.viewer) || window.__lmy_fallback_viewer || null);
  }

  // 1) If app.viewer already exists
  if (window.app && window.app.viewer){
    resolveNow(window.app.viewer);
  }

  // 2) Events from real app or fallback
  window.addEventListener('lmy:viewer-ready', (e)=> resolveNow(e.detail?.viewer || window.app?.viewer || null), { once:true });
  window.addEventListener('lmy:fallback-viewer-loaded', (e)=> resolveNow(e.detail?.viewer || window.__lmy_fallback_viewer || null), { once:true });

  // 3) MutationObserver: some apps attach viewer later to window.app
  const mo = new MutationObserver(()=>{
    if (window.app && window.app.viewer){ resolveNow(window.app.viewer); mo.disconnect(); }
  });
  try{ mo.observe(document.documentElement, { childList:true, subtree:true }); }catch(_){}

  // 4) Hard timeout to avoid hanging forever
  setTimeout(()=>{ resolveNow(null); }, 4000);
})();
