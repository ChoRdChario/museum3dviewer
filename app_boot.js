// app_boot.js — bootstrap real viewer (with safe fallback) and wire UI
console.log('[boot] module start');
import './viewer_ready.js';
import './viewer_api_shim.js'; // installs shim if no viewer yet
import { ensureViewer } from './viewer.js';
import { setupUI, loadGLBFromDriveIdPublic } from './ui.js';

window.LMY = window.LMY || {};
window.LMY.loadGLBFromDriveIdPublic = loadGLBFromDriveIdPublic;

async function start(){
  // 1) Try to start real viewer (materials/UI features)
  try{
    const mount = document.getElementById('stage');
    const spinner = document.getElementById('spinner');
    const viewer = await ensureViewer({ mount, spinner });
    window.app = window.app || {};
    window.app.viewer = viewer;
    window.dispatchEvent(new CustomEvent('lmy:viewer-ready', { detail:{ viewer } }));
    console.log('[boot] viewer ready state: true');
  }catch(e){
    console.warn('[boot] ensureViewer failed, fallback shim will take over', e);
  }
  // 2) Wire UI
  try{
    console.log('[boot] wiring UI');
    setupUI(window.app || {});
    console.log('[boot] done');
  }catch(e){
    console.error('[boot] setupUI failed', e);
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', start, { once:true });
}else{
  start();
}

// inline compatibility helper
window.loadGLBFromInput = function(){
  const inp = document.getElementById('fileIdInput') || document.getElementById('inpDriveId');
  console.log('[boot] loadGLBFromInput invoked');
  return loadGLBFromDriveIdPublic(inp?.value||"");
};
