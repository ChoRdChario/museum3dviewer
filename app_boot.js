console.log('[boot] ready');
import { setupAuth } from './gauth.js';
import { setupUI } from './ui.js';
import { ensureViewer } from './viewer.js';

async function boot(){
  console.log('[boot] call setupAuth');
  await setupAuth?.();
  console.log('[boot] setupAuth resolved');

  // viewer初期化
  await ensureViewer();
  // UI配線（存在しない要素は無視される）
  try{
    await setupUI(window.app);
    console.log('[boot] setupUI(module) done');
  }catch(e){
    console.warn('[boot] ui.js not found or failed to load', e);
  }

  // onceReadyフックがあれば呼ぶ
  if (window.app?.viewer?.onceReady) {
    await window.app.viewer.onceReady();
    console.log('[boot] viewer ready');
  } else {
    console.log('[boot] viewer ready (no onceReady hook)');
  }
}
boot();
