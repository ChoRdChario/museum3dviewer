// material.id.unify.v1.js — patched 2025-11-13 (JST)
// Purpose:
//  - Reduce noisy timeouts / polling spam in console
//  - Keep original tag strings to avoid breaking downstream parsing
(function(){
  const TAG = "[mat-id-unify]";
  const MAX_TRIES = 20;     // lowered from potentially unbounded
  const INTERVAL_MS = 80;   // shorter interval, but limited tries
  const LOG_LIMIT = 3;      // only warn a few times

  let warnCount = 0;
  function warn(msg){
    if (warnCount < LOG_LIMIT){
      console.warn(TAG, msg);
      warnCount++;
      if (warnCount === LOG_LIMIT){
        console.warn(TAG, "suppress further logs...");
      }
    }
  }

  function hasOpacityUI(){
    // Looks for the known opacity range/select in material panel
    const panel = document.getElementById("panel-material");
    if (!panel) return false;
    const byId = panel.querySelector("#opacityRange, [data-role='opacityRange']");
    return !!byId;
  }

  function applyOnce(){
    // noop by default; we only unify IDs if the section exists
    // Place holder for future transforms
  }

  function retryTick(){
    let tries = 0;
    const t = setInterval(() => {
      if (hasOpacityUI()){
        try { applyOnce(); } catch(e){ /* ignore */ }
        clearInterval(t);
        return;
      }
      tries++;
      if (tries === 1 || tries === Math.floor(MAX_TRIES/2)){
        warn("opacity section not found (waiting)");
      }
      if (tries >= MAX_TRIES){
        clearInterval(t);
        warn("give up waiting");
      }
    }, INTERVAL_MS);
  }

  // Kick
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", retryTick, { once: true });
  }else{
    retryTick();
  }
})();
