/* purpose.overlay.js — v1.1
 * Shows a lightweight "purpose" overlay on the viewer area until a GLB is loaded.
 * No persistent "About" button; users can access details via PRIVACY＆GUIDE.
 */
(() => {
  'use strict';

  const OVERLAY_ID = 'lm-purpose-overlay';
  const CLOSE_BTN_SEL = '[data-lm-close]';

  function byId(id){ return document.getElementById(id); }

  function sceneChildCount(){
    try{
      const s = window.__LM_SCENE || window.__lm_scene || (window.viewer && window.viewer.scene) || null;
      return (s && s.children && s.children.length) || 0;
    }catch(_){ return 0; }
  }

  function setOverlayVisible(v){
    const ov = byId(OVERLAY_ID);
    if(!ov) return;
    ov.classList.toggle('is-hidden', !v);
  }

  function wire(){
    const ov = byId(OVERLAY_ID);
    if(ov){
      ov.addEventListener('click', (ev) => {
        const t = ev.target;
        if(t && t.matches && t.matches(CLOSE_BTN_SEL)){
          ev.preventDefault();
          setOverlayVisible(false);
        }
      });
    }

    // Hide overlay on successful GLB load (signal emitted by glb.load.signal.js)
    window.addEventListener('lm:glb-loaded', () => setOverlayVisible(false));

    // If GLB already present (e.g., share mode or prefill), do not show overlay.
    const initial = sceneChildCount();
    if(initial > 0){
      setOverlayVisible(false);
    }else{
      setOverlayVisible(true);
      // best-effort re-check after app boot
      setTimeout(() => {
        if(sceneChildCount() > 0) setOverlayVisible(false);
      }, 1500);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wire);
  }else{
    wire();
  }
})();
