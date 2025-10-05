import { setupAuth } from './gauth.js';
import { ensureViewer } from './viewer.js';
import { setupUI } from './ui.js';

console.log('[boot] ready');

async function boot(){
  const app = { events: new EventTarget() };
  // viewer
  app.viewer = await ensureViewer(app);
  // auth
  app.auth = setupAuth(app);
  // ui
  setupUI(app);
  // hide spinner when first frame rendered
  app.viewer.onceReady(()=>{
    const sp = document.getElementById('spinner');
    if(sp) sp.style.display = 'none';
  });
}
boot();
