// auth-gate.js
// Minimal, robust token provider using your existing gauth.module.js
// Exposes window.Auth.getToken() and window.Auth.fetchJSON(url, init)

(function () {
  const RETRY_WAIT = (n)=> new Promise(r=> setTimeout(r, 300 * Math.pow(2,n)));
  async function _getAccessToken() {
    const g = await import('./gauth.module.js');
    // prefer ensureToken if present
    if (typeof g.ensureToken === 'function') {
      await g.ensureToken(); // this may open a popup; UI must allow user gesture
    }
    if (typeof g.getAccessToken === 'function') {
      const tok = await g.getAccessToken();
      if (!tok) throw new Error('no_token');
      return tok;
    }
    throw new Error('auth_module_missing');
  }

  async function getToken({retries = 1} = {}) {
    for (let i=0; i<=retries; i++) {
      try {
        const t = await _getAccessToken();
        return t;
      } catch(e) {
        if (i >= retries) throw e;
        await RETRY_WAIT(i);
      }
    }
  }

  async function fetchJSON(url, init = {}, { retries = 1 } = {}) {
    const headers = new Headers(init.headers || {});
    if (!headers.get('Authorization')) {
      const tok = await getToken();
      headers.set('Authorization', 'Bearer ' + tok);
    }
    if (!headers.get('Content-Type') && (init.body || /sheets\.googleapis\.com\/.*values/.test(url))) {
      headers.set('Content-Type', 'application/json');
    }
    const doFetch = async () => {
      const res = await fetch(url, { ...init, headers });
      const ct = res.headers.get('content-type') || '';
      const body = ct.includes('json') ? await res.json() : await res.text();
      if (!res.ok) {
        const err = new Error('HTTP ' + res.status);
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    };
    for (let i=0; i<=retries; i++) {
      try { return await doFetch(); }
      catch (e) {
        if (e.status === 401 && i < retries) {
          // token might be stale; force re-auth next loop
          await RETRY_WAIT(i);
          continue;
        }
        throw e;
      }
    }
  }

  window.Auth = { getToken, fetchJSON };
})();