/*!
 * LociMyu - Auth Fetch Shim (v2)
 * Safe shim to ensure window.__lm_fetchJSONAuth exists.
 */
(function(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return;
  window.__lm_fetchJSONAuth = async (url, init = {}) => {
    const { ensureToken, getAccessToken } = await import('./gauth.module.js');
    const tok = (await ensureToken?.()) || (await getAccessToken?.());
    if (!tok) throw new Error('no token');

    const headers = new Headers(init.headers || {});
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${tok}`);

    let body = init.body;
    const isSendable =
      typeof body === 'string' ||
      body instanceof Blob ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof ArrayBuffer;
    if (body != null && !isSendable) {
      body = JSON.stringify(body);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }

    // view mode: block all persistence writes centrally (shim path)
    try {
      const m = String(init.method || 'GET').toUpperCase();
      if (window.__lm_persistGuard?.assertAllowed) window.__lm_persistGuard.assertAllowed(m, url);
      else if (window.__LM_IS_VIEW_MODE === true && ['POST','PUT','PATCH','DELETE'].includes(m)) {
        throw new Error(`[persist.guard] blocked write in view mode: ${m} ${url}`);
      }
    } catch (e) { throw e; }
    const res = await fetch(url, { ...init, headers, body });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };
  console.log('[auth-shim v2] __lm_fetchJSONAuth installed');
})();