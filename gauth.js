
// gauth.js — ボタンnull安全 + 簡易GISラッパ
console.log('[auth] module loaded');

export async function setupAuth() {
  // DOMReady 待ち
  if (document.readyState === 'loading') {
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }

  function ensureButton() {
    let btn = document.querySelector('[data-auth-btn], #auth-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'auth-btn';
      btn.textContent = 'Sign in';
      btn.style.position = 'fixed';
      btn.style.left = '8px';
      btn.style.bottom = '8px';
      document.body.appendChild(btn);
      console.log('[auth] auto-injected auth button');
    }
    return btn;
  }

  const state = {
    accessToken: null,
    expiresAt: 0,
  };

  globalThis.app = globalThis.app || {};
  app.auth = {
    isSignedIn() {
      return !!state.accessToken && Date.now() < state.expiresAt;
    },
    getAccessToken() {
      return this.isSignedIn() ? state.accessToken : null;
    }
  };

  const btn = ensureButton();
  btn.addEventListener('click', async () => {
    console.log('[auth] button click');
    // Google Identity Services が存在する場合のみ実行
    const gis = globalThis.google && google.accounts && google.accounts.oauth2;
    if (!gis) {
      alert('Google Identity Services が読み込まれていません。');
      return;
    }
    // client_id は HTML 側でグローバル変数として定義されている前提（従来通り）
    const clientId = globalThis.GOOGLE_CLIENT_ID || (globalThis.app && app.googleClientId);
    const scope = 'https://www.googleapis.com/auth/drive.readonly';
    if (!clientId) {
      alert('GOOGLE_CLIENT_ID が設定されていません。');
      return;
    }
    const tokenClient = gis.initTokenClient({
      client_id: clientId,
      scope,
      prompt: 'consent',
      callback: (resp) => {
        if (resp && resp.access_token) {
          state.accessToken = resp.access_token;
          const expiresIn = (resp.expires_in || 3600) * 1000;
          state.expiresAt = Date.now() + expiresIn - 5000;
          btn.textContent = 'Signed in';
          console.log('[auth] token acquired');
        } else {
          console.warn('[auth] token response missing access_token', resp);
        }
      }
    });
    tokenClient.requestAccessToken();
  });

  console.log('[auth] ready');
}
