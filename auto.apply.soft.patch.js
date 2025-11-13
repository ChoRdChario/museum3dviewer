// [auto-apply-soft v1] calm timeouts + retry & throttle noisy logs
(function(){
  // Throttle console messages that repeat often
  const seen = new Map();
  function throttleConsole(method, substr, limit=3){
    const original = console[method].bind(console);
    return function(){
      const msg = (arguments[0]||"")+"";
      if (typeof msg === "string" && msg.includes(substr)){
        const n = (seen.get(substr)||0)+1;
        seen.set(substr, n);
        if (n <= limit) {
          return original.apply(console, arguments);
        }
        // drop beyond limit
        return;
      }
      return original.apply(console, arguments);
    };
  }
  console.warn  = throttleConsole("warn",  "[mat-id-unify] opacity section not found", 3);
  console.error = throttleConsole("error", "[auto-apply v1.2] failed Error: timeout", 1);

  // Gentle re-try loop for __LM_AUTO_APPLY__
  function scheduleRetries(){
    const fn = window.__LM_AUTO_APPLY__;
    if (!fn) return;
    let tries = 0;
    const plan = [1000, 4000, 8000, 15000, 30000];
    function tick(){
      if (!window.__lm_ctx || !window.__lm_ctx.spreadsheetId){ 
        if (tries < plan.length) setTimeout(tick, plan[tries++]); 
        return;
      }
      Promise.resolve()
        .then(()=>fn())
        .catch(()=>{/* swallow */})
        .finally(()=>{
          if (tries < plan.length){
            setTimeout(tick, plan[tries++]);
          }
        });
    }
    tick();
  }

  // Hook on contexts that indicate it's worth retrying
  window.addEventListener("lm:sheet-context", scheduleRetries);
  window.addEventListener("lm:scene-ready", scheduleRetries);
  // fire once if already loaded
  if (document.readyState !== "loading") setTimeout(scheduleRetries, 0);
})();