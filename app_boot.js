// app_boot.js — boot + UIブリッジ（最小差分）
import { ensureViewer } from './viewer.js';
import { setupAuth } from './gauth.js';

console.log('[boot] ready');

async function boot() {
  const app = window.app || (window.app = {});

  console.log('[boot] call setupAuth');
  await setupAuth(app);
  console.log('[boot] setupAuth resolved');

  const viewer = ensureViewer(app);

  // UI 初期化（ui.js が存在する場合のみ）
  try {
    const mod = await import('./ui.js');
    if (mod && typeof mod.setupUI === 'function') {
      mod.setupUI(app);
      console.log('[boot] setupUI(module) done');
    } else if (typeof window.setupUI === 'function') {
      window.setupUI(app);
      console.log('[boot] setupUI(window) done');
    } else {
      console.warn('[boot] setupUI not found — operations UI may be inert');
    }
  } catch (e) {
    console.warn('[boot] ui.js not found or failed to load', e);
  }

  // ビューア準備完了通知（既存 onceReady があれば利用）
  if (viewer && typeof viewer.onceReady === 'function') {
    viewer.onceReady(() => {
      console.log('[boot] viewer ready');
      document.dispatchEvent(new CustomEvent('lmy:viewer-ready', { detail: { app } }));
    });
  } else {
    console.log('[boot] viewer ready (no onceReady hook)');
    document.dispatchEvent(new CustomEvent('lmy:viewer-ready', { detail: { app } }));
  }

  // ブート完了の合図（UIがこれにバインドしていれば動く）
  document.dispatchEvent(new CustomEvent('lmy:boot-ready', { detail: { app } }));
}
boot().catch(err => console.error('[boot] fatal', err));
