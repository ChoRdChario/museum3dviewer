
// ui.js — 最小のUI配線、安全ガード付き
export function setupUI(mod) {
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.querySelector('[data-drive-id]') || document.getElementById('drive-id') || document.getElementById('gdrive-id');
    const btn   = document.querySelector('[data-btn-load]') || document.getElementById('btn-load') || document.getElementById('btnLoad');

    if (!input || !btn) {
      console.warn('[ui] input/button not found; skip wiring');
      return;
    }

    btn.addEventListener('click', async () => {
      try {
        if (!(globalThis.app && app.auth && typeof app.auth.isSignedIn === 'function' && app.auth.isSignedIn())) {
          alert('サインインしてから読み込んでください。');
          return;
        }
        const v = input.value.trim();
        if (!v) {
          alert('Google Drive の fileId または共有URL を入力してください。');
          return;
        }
        await app.viewer.loadByInput(v);
      } catch (e) {
        console.error(e);
        alert('GLBの読み込みに失敗しました（詳細はコンソール）');
      }
    });
    console.log('[ui] wired');
  }, { once: true });
}
