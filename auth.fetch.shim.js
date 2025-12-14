/*!
 * LociMyu - Auth Fetch Shim (v2)
 * Safe shim to ensure window.__lm_fetchJSONAuth exists.
 */
(function(){
  if (typeof window.__lm_fetchJSONAuth === 'function') return;
  window.__lm_fetchJSONAuth = async (url, init = {}) => {
    // ensure persist guard
    try{ await import('./persist.guard.js'); }catch(_){ }

    const method = String((init && init.method) || 'GET').toUpperCase();
    const guard = window.__lm_persistGuard;
    if (guard && guard.shouldBlock && guard.shouldBlock({ method, url })){
      const detail = { method, url: String(url||'') };
      try{ guard.dispatchBlocked && guard.dispatchBlocked(detail); }catch(_){ }
      console.warn('[auth-shim v2] blocked write (view mode)', detail);
      throw (guard.blockedError ? guard.blockedError(method, url) : new Error('[view] write blocked'));
    }

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

    const res = await fetch(url, { ...init, headers, body });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  };
  console.log('[auth-shim v2] __lm_fetchJSONAuth installed');
})();