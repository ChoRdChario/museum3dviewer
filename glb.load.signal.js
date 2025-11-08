// glb.load.signal.js
// Guarantees a 'lm:glb-loaded' event after the user clicks Load and the scene gains meshes.
(() => {
  const TAG='[glb-signal v1]';
  const log=(...a)=>console.log(TAG,...a);
  const btn = document.getElementById('btnGlb') || document.querySelector('button[data-action="load"], button#load');
  let watching = false;

  function getScene(){
    return (
      window.__LM_SCENE ||
      window.__lm_scene ||
      (window.viewer && window.viewer.scene) ||
      (window.viewerBridge && typeof window.viewerBridge.getScene === 'function' && window.viewerBridge.getScene()) ||
      null
    );
  }

  function startWatch(){
    if (watching) return;
    watching = true;
    const scene = getScene();
    const base = (scene && scene.children ? scene.children.length : 0);
    const t0 = Date.now();
    const id = setInterval(() => {
      const sc = getScene();
      const n = (sc && sc.children ? sc.children.length : 0);
      if (n > base + 1) {
        clearInterval(id);
        watching = false;
        const detail = { before: base, after: n, ms: Date.now()-t0 };
        log('glb detected', detail);
        window.dispatchEvent(new CustomEvent('lm:glb-loaded', { detail }));
      }
    }, 200);
    setTimeout(() => { clearInterval(id); watching = false; }, 20000);
  }

  if (btn) {
    btn.addEventListener('click', () => {
      startWatch();
      // safety: also dispatch a late ping in case scene already updated
      setTimeout(startWatch, 1500);
    }, { capture:false });
    log('hooked to Load button');
  } else {
    log('Load button not found; falling back to scene polling');
    // fallback: general polling for the first big mesh increase
    startWatch();
  }
})();