import { setupAuth } from './gauth.js';
import './ui.js';

async function boot(){
  setupAuth();
  window.__LMY_setupUI();
  document.getElementById('boot').style.display='none';
}
boot();
