import { setupAuth } from './gauth.js';
import { setupUI } from './ui.js';

(async function boot(){
  console.log('[boot] start');
  const app = {
    state:{},
  };
  window.app = app;

  // Auth
  await setupAuth({
    clientId: '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com',
    apiKey: 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });

  await setupUI(app);
  const bootmsg = document.getElementById('bootmsg');
  if (bootmsg) bootmsg.textContent = '';
  console.log('[boot] ready');
})();