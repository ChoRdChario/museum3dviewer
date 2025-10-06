// app_boot.js — boot order & extra logs
import { ensureViewer } from './viewer.js';
import { setupAuth } from './gauth.js';

console.log('[boot] ready');

async function boot() {
  const app = window.app || (window.app = {});
  console.log('[boot] call setupAuth');
  await setupAuth(app);
  console.log('[boot] setupAuth resolved');

  const viewer = ensureViewer(app);
  viewer.onceReady(() => {
    console.log('[boot] viewer ready');
  });
}
boot().catch(err => console.error('[boot] fatal', err));
