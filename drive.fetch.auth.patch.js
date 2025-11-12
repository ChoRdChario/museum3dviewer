// [auth-fetch] Drive v3 media Authorization patch (safe, idempotent)
// Injects Authorization header for Drive alt=media fetches.
// This must load before modules that call fetch(...drive/v3/files/...alt=media...)
console.log('[auth-fetch] installing Drive media fetch patch');
(async () => {
  try {
    const { getAccessToken } = await import('./gauth.module.js');
    const origFetch = window.fetch.bind(window);
    let installing = false;
    if (window.__LM_AUTH_FETCH_PATCH) return;
    window.__LM_AUTH_FETCH_PATCH = true;
    window.fetch = async function(input, init) {
      const reqUrl = (typeof input === 'string') ? input : (input && input.url) || '';
      const isDriveMedia = reqUrl.startsWith('https://www.googleapis.com/drive/v3/files/') && reqUrl.includes('alt=media');
      if (isDriveMedia) {
        try {
          const tok = await getAccessToken();
          init = init || {};
          // normalize headers to a Headers object
          let headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers || {});
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${tok}`);
            // Keep supportsAllDrives if missing
            if (!reqUrl.includes('supportsAllDrives=')) {
              const augmented = reqUrl + (reqUrl.includes('?') ? '&' : '?') + 'supportsAllDrives=true';
              input = augmented;
            }
          }
          init.headers = headers;
        } catch (e) {
          console.warn('[auth-fetch] token attach failed', e);
        }
      }
      return origFetch(input, init);
    };
    console.log('[auth-fetch] patch installed');
  } catch (e) {
    console.warn('[auth-fetch] failed to install patch', e);
  }
})();
