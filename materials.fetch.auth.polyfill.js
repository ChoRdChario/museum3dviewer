/* materials.fetch.auth.polyfill.js v1.0
 * Provides __lm_fetchJSONAuth if the environment hasn't defined it yet.
 * Requires a token provider at window.lmEnsureToken() or gauth.module.js.
 */
(function(){
  const TAG='[lm-auth-polyfill]';
  if (typeof window.__lm_fetchJSONAuth === 'function') {
    console.log(TAG, 'present (skipped)');
    return;
  }
  async function ensureToken(){
    try {
      if (typeof window.lmEnsureToken === 'function') return await window.lmEnsureToken();
      // Try common module
      if (window.gauth?.getAccessToken) return await window.gauth.getAccessToken();
    } catch (e) {
      console.warn(TAG, 'token fetch failed', e);
    }
    return null;
  }
  window.__lm_fetchJSONAuth = async function(url, init={}){
    const headers = new Headers(init.headers || {});
    const tok = await ensureToken();
    if (tok) headers.set('Authorization', 'Bearer ' + tok);
    if (!headers.has('Content-Type')) headers.set('Content-Type','application/json');
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  };
  console.log(TAG, 'installed');
})();