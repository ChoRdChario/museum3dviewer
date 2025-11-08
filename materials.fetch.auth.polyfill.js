
/* materials.fetch.auth.polyfill.js
 * v1.0 (LociMyu) — define __lm_fetchJSONAuth if missing.
 */
(() => {
  const TAG = '[auth-polyfill v1.0]';
  if (typeof window.__lm_fetchJSONAuth === 'function') {
    console.log(TAG, 'skip (already present)');
    return;
  }
  let _tokenCache = null;

  async function getTokenViaGauth() {
    try {
      const mod = await import('./gauth.module.js');
      if (typeof mod.getAccessToken === 'function') {
        const t = await mod.getAccessToken();
        if (t && typeof t === 'string') return t;
      }
    } catch (_) {}
    return null;
  }

  function getTokenViaGIS() {
    return new Promise((resolve) => {
      try {
        if (!window.tokenClient) return resolve(null);
        const client = window.tokenClient;
        const handler = (resp) => {
          if (resp && resp.access_token) resolve(resp.access_token);
          else resolve(null);
        };
        client.callback = handler;
        try { client.requestAccessToken({prompt: ''}); }
        catch (_) { try { client.requestAccessToken(); } catch (__) {} }
        setTimeout(() => resolve(null), 3000);
      } catch (_) { resolve(null); }
    });
  }

  async function getToken() {
    if (_tokenCache) return _tokenCache;
    const t1 = await getTokenViaGauth();
    if (t1) { _tokenCache = t1; return t1; }
    const t2 = await getTokenViaGIS();
    if (t2) { _tokenCache = t2; return t2; }
    return null;
  }

  async function __lm_fetchJSONAuth(url, init = {}) {
    const token = await getToken();
    if (!token) throw new Error('__lm_fetchJSONAuth token missing');
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      init = {...init, body: JSON.stringify(init.body)};
    }
    const res = await fetch(url, {...init, headers});
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error(`fetch ${res.status} ${res.statusText} ${text}`);
    }
    const ct = res.headers.get('content-type')||'';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  window.__lm_fetchJSONAuth = __lm_fetchJSONAuth;
  window.dispatchEvent(new Event('lm:auth-ready'));
  console.log(TAG, 'ready');
})();
