// app_boot.js - unchanged from previous patch (2025-10-07)
import { ensureViewer } from './viewer.js';
import { setupUI } from './ui.js';
import { setupPins } from './pins.js';
import { setupAuth } from './gauth.js';

const stage = document.getElementById('stage');
const spinner = document.getElementById('spinner');

const app = { viewer: null, auth: null, state: {} };

(async function boot(){
  console.log('[auth] ready');
  try { app.viewer = await ensureViewer({ mount: stage, spinner }); } catch(e){ console.error('[boot] ensureViewer failed', e); }
  try { setupUI(app); } catch(e){ console.error('[boot] setupUI failed', e); }
  try { setupPins?.(app); } catch(e){ console.error('[boot] setupPins failed', e); }

  try {
    app.auth = setupAuth({
      onSignedIn(){ /* hook if needed */ },
      onSignedOut(){ /* hook if needed */ },
    });
  } catch(e){ console.error('[boot] setupAuth failed', e); }

  try {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (id){
      const input = document.getElementById('fileIdInput');
      const btn = document.getElementById('btnLoad');
      if (input) input.value = id;
      btn?.click?.();
    } else {
      spinner?.remove?.();
    }
  } catch(e){ console.error('[boot] auto-load failed', e); }
})();
