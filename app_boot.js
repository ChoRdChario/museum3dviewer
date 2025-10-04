// app_boot.js — robust boot order with guards
import { setupAuth } from './gauth.js';
import { setupUI }   from './ui.js';

async function boot(){
  try{
    window.app = window.app || {};
    console.log('[auth] ready');
    setupAuth(window.app); // never throws; creates chip if missing

    // UI wiring (safe if viewer not ready; ui.js defers some handlers)
    try{ setupUI(window.app); }catch(e){ console.warn('[boot] setupUI deferred:', e); }

    // Auto-load GLB if ?id= present
    const id = new URLSearchParams(location.search).get('id');
    if (id && window.app?.viewer?.loadGLBFromDriveId){
      await window.app.viewer.loadGLBFromDriveId(id).catch(err=> console.error('[boot] autoload failed', err));
    }
  }catch(err){
    console.error('[boot] failed', err);
    const el = document.getElementById('bootError');
    if (el){
      el.textContent = 'Boot failed. See console logs.';
      el.style.display = 'block';
    }
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
}else{
  boot();
}
