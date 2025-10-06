// app_boot.js — minimal boot wiring using onceReady + auth button
import { ensureViewer } from './viewer.js';
import { setupAuth } from './gauth.js';

console.log('[boot] ready');

async function boot() {
  const app = window.app || (window.app = {});

  // Auth UI & clients
  await setupAuth(app); // waits gapi init and wires the button safely

  // Viewer
  const viewer = ensureViewer(app);
  viewer.onceReady(() => {
    // any post-ready hooks if needed
  });
}

boot().catch(err => console.error(err));
