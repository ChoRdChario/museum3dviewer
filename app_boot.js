
import { setupAuth } from './gauth.js';
import { setupUI }   from './ui.js';

async function boot(){
  try{
    window.app = window.app || {};
    console.log('[auth] ready');
    setupAuth(window.app);

    // safe UI setup
    try{ setupUI(window.app); }catch(e){ console.warn('[boot] setupUI deferred', e); }

    // autoload by ?id
    const id = new URLSearchParams(location.search).get('id');
    if (id && window.app?.viewer?.loadGLBFromDriveId){
      await window.app.viewer.loadGLBFromDriveId(id).catch(err => console.error('[boot] autoload failed', err));
    }
  }catch(err){
    console.error('[boot] failed', err);
    const el = document.getElementById('bootError');
    if (el){ el.textContent = 'Boot failed. See console logs.'; el.style.display = 'block'; }
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot);
}else{
  boot();
}
