// gauth.js — GIS + gapi-less token flow (Drive readonly)
// Exports: setupAuth(app)
// Creates window.app.auth with { isSignedIn(), getAccessToken(), signIn() }

export async function setupAuth(app) {
  if (!app) window.app = (window.app || {}), app = window.app;

  // Wait DOM
  if (document.readyState === 'loading') {
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }

  // Find or inject button
  let btn = document.querySelector('[data-auth-btn], #auth-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'auth-btn';
    btn.textContent = 'Sign in';
    btn.style.position = 'fixed';
    btn.style.left = '8px';
    btn.style.bottom = '8px';
    btn.style.zIndex = '10000';
    document.body.appendChild(btn);
  }

  // Ensure GIS is available
  if (!(window.google && google.accounts && google.accounts.oauth2)) {
    console.warn('[auth] GIS not detected — did you include the GIS script tag?');
    // still provide a stub auth so the app doesn't crash
    app.auth = {
      isSignedIn: () => false,
      getAccessToken: () => null,
      async signIn() { alert('Google Identity Services が読み込まれていません'); }
    };
    return app.auth;
  }

  const scope = 'https://www.googleapis.com/auth/drive.readonly';
  let accessToken = null;
  let expiresAt = 0;

  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: (window.GOOGLE_CLIENT_ID || '').trim(),
    scope,
    prompt: '',
    callback: (resp) => {
      accessToken = resp.access_token || null;
      const now = Date.now();
      const expiresInMs = (resp.expires_in ? Number(resp.expires_in) : 0) * 1000;
      expiresAt = expiresInMs ? (now + expiresInMs - 60_000) : 0; // refresh 60s early
      if (accessToken) {
        btn.textContent = 'Signed in';
        btn.disabled = false;
      }
    }
  });

  function valid() {
    return !!accessToken && (expiresAt === 0 || Date.now() < expiresAt);
  }

  app.auth = {
    isSignedIn: () => valid(),
    getAccessToken: () => (valid() ? accessToken : null),
    async signIn() {
      return new Promise((resolve) => {
        tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
        const t = setInterval(() => {
          if (valid()) { clearInterval(t); resolve(accessToken); }
        }, 100);
        setTimeout(() => { clearInterval(t); resolve(accessToken); }, 10_000);
      });
    }
  };

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await app.auth.signIn(); }
    finally { btn.disabled = false; }
  });

  console.log('[auth] ready');
  return app.auth;
}
