// app_boot.js - v6.6 patched
import { ensureViewer } from './viewer.js';
import { setupUI } from './ui.js';
import { setupPins } from './pins.js';
import { setupAuth } from './gauth.js';

const stage = document.getElementById('stage');
const spinner = document.getElementById('spinner');

const app = {
  viewer:null, auth:null, state:{}
};

(async function boot(){
  console.log('[auth] ready');
  app.viewer = await ensureViewer({ mount: stage, spinner });
  setupUI(app);
  setupPins?.(app);
  setupAuth?.(app);
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id){
    document.getElementById('fileIdInput').value = id;
    document.getElementById('btnLoad').click();
  } else {
    spinner?.remove();
  }
})();
