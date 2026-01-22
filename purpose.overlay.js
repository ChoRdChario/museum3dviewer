/* purpose.overlay.js — v1.0
 * Shows a lightweight "purpose" overlay on the viewer area until a GLB is loaded,
 * and provides an always-available About dialog (without occupying UI permanently).
 */
(() => {
  'use strict';

  const OVERLAY_ID = 'lm-purpose-overlay';
  const MODAL_ID = 'lm-purpose-modal';
  const OPEN_BTN_ID = 'lm-btn-about';
  const OPEN_BTN2_ID = 'lm-purpose-open-about';
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

  function openModal(){
    const m = byId(MODAL_ID);
    if(!m) return;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    const f = m.querySelector('button, a, input, [tabindex]:not([tabindex="-1"])');
    if(f) try{ f.focus(); }catch(_){}
  }
  function closeModal(){
    const m = byId(MODAL_ID);
    if(!m) return;
    m.classList.remove('is-open');
    m.setAttribute('aria-hidden', 'true');
  }

  function wire(){
    const ov = byId(OVERLAY_ID);
    const m = byId(MODAL_ID);
    const openBtn = byId(OPEN_BTN_ID);
    const openBtn2 = byId(OPEN_BTN2_ID);

    if(openBtn) openBtn.addEventListener('click', openModal);
    if(openBtn2) openBtn2.addEventListener('click', openModal);

    // close handlers
    [ov, m].forEach(root => {
      if(!root) return;
      root.addEventListener('click', (ev) => {
        const t = ev.target;
        if(!t) return;
        if(t.matches(CLOSE_BTN_SEL)){
          ev.preventDefault();
          if(root === ov) setOverlayVisible(false);
          if(root === m) closeModal();
        }
        if(root === m && t.matches('.lm-modal-backdrop')){
          closeModal();
        }
      });
    });

    document.addEventListener('keydown', (ev) => {
      if(ev.key === 'Escape'){
        closeModal();
      }
    });

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
