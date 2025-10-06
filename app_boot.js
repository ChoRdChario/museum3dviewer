// app_boot.js — boot after libs ready and auth wiring
import { ensureViewer } from './viewer.js';
import { setupAuth } from './gauth.js';

console.log('[boot] ready');

async function boot() {
  const app = window.app || (window.app = {});
  await setupAuth(app);           // waits GIS/gapi and wires button
  const viewer = ensureViewer(app);
  viewer.onceReady(() => {
    console.log('[boot] viewer ready');
  });
}
boot().catch(err => console.error(err));
