// ui.js — wires simple UI without breaking legacy layout
// Exports: setupUI(app)
// expects: an input (file id/url) and a Load button; will auto-inject if not found

export function setupUI(app) {
  // Ensure DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setupUI(app), { once: true });
    return;
  }

  let input = document.querySelector('[data-file-id], #file-id, input[type="text"]');
  let btnLoad = document.querySelector('[data-btn-load], #btn-load');
  let authBtn = document.querySelector('[data-auth-btn], #auth-btn');

  // Auto UI injection if missing
  if (!input || !btnLoad) {
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '8px';
    wrap.style.bottom = '8px';
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.zIndex = '9999';

    if (!authBtn) {
      authBtn = document.createElement('button');
      authBtn.id = 'auth-btn';
      authBtn.textContent = 'Sign in';
      wrap.appendChild(authBtn);
    }

    if (!input) {
      input = document.createElement('input');
      input.id = 'file-id';
      input.placeholder = 'Google Drive file ID (GLB)';
      input.style.width = '260px';
      wrap.appendChild(input);
    }

    if (!btnLoad) {
      btnLoad = document.createElement('button');
      btnLoad.id = 'btn-load';
      btnLoad.textContent = 'Load GLB';
      wrap.appendChild(btnLoad);
    }

    document.body.appendChild(wrap);
  }

  // Load button behavior
  btnLoad.addEventListener('click', async () => {
    try {
      if (!window.app?.auth?.isSignedIn?.()) {
        alert('サインインしてから読み込んでください。');
        return;
      }
      await app.viewer.loadByInput(input.value.trim());
    } catch (e) {
      console.error(e);
      alert('GLBの読み込みに失敗しました（詳細はコンソール）');
    }
  });
}
