// app_boot.js — fail-safe bootstrap (2025-10-05)
console.log('[boot] module start');
import './viewer_ready.js';
import './viewer_api_shim.js';
import { setupUI, loadGLBFromDriveIdPublic } from './ui.js';

window.LMY = window.LMY || {};
window.LMY.loadGLBFromDriveIdPublic = loadGLBFromDriveIdPublic;

async function start(){
  try{
    console.log('[boot] wiring UI');
    setupUI(window.app || {});
  }catch(e){
    console.error('[boot] setupUI failed', e);
  }
  try{
    const v = await (window.__viewerReadyPromise || Promise.resolve(null));
    console.log('[boot] viewer ready state:', !!v);
    const hud = document.getElementById('bootStatus') || document.getElementById('toast');
    if (hud){
      hud.textContent = v ? 'Viewer ready' : 'Viewer shim active';
      hud.style.display = 'block';
      setTimeout(()=> hud.style.display='none', 1200);
    }
  }catch(e){
    console.warn('[boot] viewer readiness wait failed', e);
  }
  window.dispatchEvent(new CustomEvent('lmy:viewer-boot'));
  console.log('[boot] done');
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', start, { once:true });
}else{
  start();
}

// inline compatibility
window.loadGLBFromInput = function(){
  const inp = document.getElementById('fileIdInput') || document.getElementById('inpDriveId');
  console.log('[boot] loadGLBFromInput invoked');
  return loadGLBFromDriveIdPublic(inp?.value||"");
};
