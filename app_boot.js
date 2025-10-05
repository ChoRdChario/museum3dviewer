import { setupAuth } from './gauth.js';
import { ViewerApp } from './viewer.js';
import { setupUI } from './ui.js';

console.log('[auth] ready');

const app = {};
window.app = app;

async function boot(){
  app.viewer = new ViewerApp(document.getElementById('stage'), document.getElementById('leader'));
  await app.viewer.ready;

  setupAuth();
  setupUI(app);
}
boot().catch(e=>console.error(e));
