// viewer_api_shim.js — install a minimal app.viewer if missing so UI won't hang
import { loadGLBArrayBufferIntoStage } from './viewer_min_loader.js';

(function(){
  window.app = window.app || {};
  const v = window.app.viewer;
  if (v && typeof v.loadGLB === 'function'){
    // real viewer present — do nothing
    return;
  }
  // Provide a minimal shim so ui.js can always call loadGLB
  const shim = {
    async loadGLB(arrayBuffer){
      // Use fallback loader to render
      const out = await loadGLBArrayBufferIntoStage(arrayBuffer);
      // Dispatch an event so others can detect readiness
      window.dispatchEvent(new CustomEvent('lmy:viewer-ready', { detail: { viewer: shim } }));
      return out;
    },
    // No-op hooks for material API to avoid errors before real viewer binds
    setOpacity(){}, setHSL(){}, setUnlit(){}, setDoubleSide(){}, setWhiteKey(){}, setWhiteKeyEnabled(){},
  };
  window.app.viewer = shim;
})();
