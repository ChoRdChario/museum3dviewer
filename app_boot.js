
// museum3dviewer/app_boot.js
import { setupAuth } from './gauth.js';
import { setupUI } from './ui.js';

function clearBootOverlay(){
  // Hide common "booting" overlays if present
  const ids = ['bootOverlay','booting','bootStatus'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.style.display='none'; });
  // also hide literal text nodes in a dedicated container
  const msg = document.querySelector('[data-boot]'); if (msg) msg.style.display='none';
}

async function boot(){
  try{
    window.app = window.app || {};
    console.log('[auth] ready');

    setupAuth(window.app, { /* can override clientId/scopes here if needed */ });

    try{ setupUI(window.app); }catch(e){ console.warn('[boot] setupUI deferred', e); }

    clearBootOverlay();

    const id = new URLSearchParams(location.search).get('id');
    if (id && window.app?.viewer?.loadGLBFromDriveId){
      try{ await window.app.viewer.loadGLBFromDriveId(id); }catch(e){ console.error('[boot] autoload failed', e); }
    }
  }catch(err){
    console.error('[boot] failed', err);
    clearBootOverlay();
    const el = document.getElementById('bootError');
    if (el){ el.textContent = 'Boot failed. See console logs.'; el.style.display = 'block'; }
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
}else{
  boot();
}
