
// sheet-rename.module.js
// Responsibilities:
// - Normalize Sheets "values" endpoints to the safe form (values:append?range=...)
// - Sniff and publish spreadsheetId early
// - Inject Authorization header (via window.__LM_OAUTH) for all sheets.googleapis.com calls
// - Gate append/update calls until both spreadsheetId and token are ready

(() => {
  if (window.__LM_SHEET_RANGEFIX_INSTALLED) return;
  window.__LM_SHEET_RANGEFIX_INSTALLED = true;

  const OAUTH = () => window.__LM_OAUTH;
  let spreadsheetId = null;

  // Publish helper
  const publishId = (id) => {
    if (!id || spreadsheetId === id) return;
    spreadsheetId = id;
    console.log('[sheet-rangefix] published spreadsheetId:', spreadsheetId);
    window.dispatchEvent(new CustomEvent('materials:spreadsheetId', { detail: { id: spreadsheetId } }));
  };

  // External setter
  window.__LM_setSpreadsheetId = (id) => publishId(id);

  // Try to sniff initial id
  const sniffInitialId = () => {
    try {
      const u = new URL(location.href);
      const ssid = u.searchParams.get('ssid');
      if (ssid) publishId(ssid);
    } catch {}
    try {
      const cand = window.__LM_CONFIG?.spreadsheet || window.__LM_SPREADSHEET_ID;
      if (cand) publishId(cand);
    } catch {}
  };
  sniffInitialId();

  // Normalize legacy append URLs
  const normalizeValuesAppendURL = (url) => {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith('googleapis.com')) return url;
      const path = u.pathname;
      // Extract spreadsheetId if present
      const m = path.match(/\/v4\/spreadsheets\/([^/]+)/);
      if (m && m[1]) publishId(m[1]);

      if (/\/values:append$/.test(path)) {
        return u.toString();
      }
      const legacy = path.match(/\/values\/(.+):append$/);
      if (legacy && legacy[1]) {
        const encodedRange = legacy[1];
        u.pathname = path.replace(/\/values\/.+:append$/, '/values:append');
        if (!u.searchParams.has('range')) {
          u.searchParams.set('range', encodedRange);
        }
        return u.toString();
      }
      return u.toString();
    } catch {
      return url;
    }
  };

  const needsAuth = (url) => {
    try {
      const u = new URL(url);
      return u.hostname.endsWith('googleapis.com') && u.pathname.startsWith('/v4/spreadsheets/');
    } catch {
      return false;
    }
  };

  const _fetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    let url = (typeof input === 'string') ? input : (input?.url || '');
    let opt = init || {};

    if (input instanceof Request) {
      url = input.url;
      opt = {
        method: input.method,
        headers: new Headers(input.headers),
        body: input.body,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal,
        window: input.window
      };
    }

    if (typeof url === 'string') {
      url = normalizeValuesAppendURL(url);
    }

    try {
      const m = url.match(/\/v4\/spreadsheets\/([^/?#]+)/);
      if (m && m[1]) publishId(m[1]);
    } catch {}

    if (needsAuth(url)) {
      const headers = new Headers(opt.headers || {});
      let token = OAUTH()?.getToken();
      if (!token) {
        token = await OAUTH()?.ensureToken({ interactive: false });
        if (!token) {
          window.dispatchEvent(new CustomEvent('lm:oauth-need-consent'));
          token = await OAUTH()?.ensureToken({ interactive: true });
        }
      }
      if (!token) {
        console.warn('[sheet-rangefix] no OAuth token — aborting Sheets request');
        throw new Error('NO_TOKEN');
      }
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
      opt.headers = headers;
    }

    try {
      return await _fetch(url, opt);
    } catch (e) {
      console.warn('[sheet-rangefix] patchedFetch error', e);
      throw e;
    }
  };

  console.log('[sheet-rangefix] installed+sniffer');
})();
