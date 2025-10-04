// app_boot.js — canonical bootstrap without cache-busting query strings (2025-10-05)
console.log('[boot] module start');
import './viewer_ready.js';
import './viewer_api_shim.js';
import { setupUI, loadGLBFromDriveIdPublic } from './ui.js';

// expose for inline calls
window.LMY = window.LMY || {};
window.LMY.loadGLBFromDriveIdPublic = loadGLBFromDriveIdPublic;

function start(){
  try{
    console.log('[boot] wiring UI');
    setupUI(window.app || {});
    window.dispatchEvent(new CustomEvent('lmy:viewer-boot'));
  }catch(e){
    console.error('[boot] setupUI failed', e);
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', start, { once:true });
}else{
  start();
}

// Assist older HTML that had inline onclick="loadGLBFromInput()"
window.loadGLBFromInput = function(){
  const inp = document.getElementById('fileIdInput') || document.getElementById('inpDriveId');
  console.log('[boot] loadGLBFromInput invoked');
  return loadGLBFromDriveIdPublic(inp?.value||"");
};
