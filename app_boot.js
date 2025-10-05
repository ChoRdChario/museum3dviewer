// app_boot.js — bootstrap
import { setupAuth } from './gauth.js';
import { setupUI }   from './ui.js';
import { ensureViewer } from './viewer.js';
import { setupPins } from './pins.js';

window.app = {};
async function boot(){
  console.log('[boot] start');
  // mount viewer immediately
  const viewer = ensureViewer({ stage: document.getElementById('stage') });
  window.app.viewer = viewer;

  // auth
  const chip = document.getElementById('authChip');
  const auth = setupAuth({
    chip,
    onReady(){ console.log('[auth] ready'); },
    onSignedIn(){ chip.textContent = 'Sign out'; },
    onSignedOut(){ chip.textContent = 'Sign in'; }
  });
  window.app.auth = auth;

  // UI and pins
  setupPins(window.app);
  setupUI(window.app);
  console.log('[boot] ready');
}
boot().catch(e=>{ console.error('Boot failed', e); const b=document.getElementById('bootMsg'); if(b) b.textContent='Boot failed. See console.'; });
