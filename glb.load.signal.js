
/* glb.load.signal.js — v1.1 (quiet)
 * Purpose: After user presses Load, detect when GLB content arrives,
 * then emit a single lm:glb-loaded signal with timestamp.
 */
(() => {
  const TAG='[glb-signal v1.1]';
  const seen = new Set();
  function qlog(key, ...rest){ if (seen.has(key)) return; seen.add(key); console.log(TAG, key, ...rest); }

  function sceneChildCount(){
    const s = window.__LM_SCENE || window.__lm_scene || (window.viewer && window.viewer.scene) || null;
    return (s && s.children && s.children.length) || 0;
  }

  function onceLoadArm(){
    const btn = document.getElementById('btnGlb') || document.querySelector('button#btnGlb,[data-action="load-glb"]');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const before = sceneChildCount();
      const start = performance.now();
      let last = before;
      let ticks = 0;
      const maxTicks = 600; // ~10s
      const iv = setInterval(() => {
        const now = sceneChildCount();
        ticks++;
        if (now > last && now > 2){
          clearInterval(iv);
          const ts = Date.now();
          qlog('glb-detected', {before, after: now, ms: Math.round(performance.now()-start)});
          try {
            window.dispatchEvent(new CustomEvent('lm:glb-loaded', { detail: { before, after: now, ts } }));
          } catch(_) {}
        } else if (ticks >= maxTicks){
          clearInterval(iv);
        } else {
          last = now;
        }
      }, 16); // ~60fps
    }, { once:false });
    qlog('armed');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', onceLoadArm, { once:true });
  } else {
    onceLoadArm();
  }
})();
