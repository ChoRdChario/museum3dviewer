// sheet-rename.module.js
// LociMyu - Google Sheets range/URL sanitizer + token injector
// Drop-in replacement. No other files need to change.

(() => {
  const log = (...a) => console.log('[sheet-rangefix]', ...a);
  const warn = (...a) => console.warn('[sheet-rangefix]', ...a);

  // Keep reference to the original fetch
  const _fetch = window.fetch.bind(window);

  // Helpers ---------------------------------------------------------------
  const decode = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };
  const encode = (s) => encodeURIComponent(s);

  // Fix spreadsheetId segment if it accidentally contains query params etc.
  const fixSpreadsheetPath = (urlObj) => {
    const parts = urlObj.pathname.split('/').filter(Boolean); // ['', 'v4', 'spreadsheets', '{id}', ...] => ['v4','spreadsheets','{id}',...]
    const idx = parts.indexOf('spreadsheets');
    if (idx >= 0 && parts[idx+1]) {
      let idSeg = decode(parts[idx+1]);
      // Trim off anything after a '?', ':' or other non-id characters
      idSeg = idSeg.replace(/[\?\:\&].*$/,'');        // remove accidental tail
      idSeg = idSeg.replace(/[^a-zA-Z0-9\-\_]/g, ''); // keep only allowed chars
      if (idSeg) {
        parts[idx+1] = idSeg; // keep decoded clean id; path will be rebuilt below
      }
    }
    // Rebuild pathname
    urlObj.pathname = '/' + parts.join('/');
    return urlObj;
  };

  // Normalize /values endpoint usage:
  //   - /values/'Sheet'!A1:Z9  (ok for GET)
  //   - /values/<RANGE>:append  (bad, we rewrite to /values:append?range=<RANGE>)
  //   - quotes around sheet name should be single quotes; URL-encoded when placed in query
  const normalizeValuesEndpoint = (urlObj) => {
    let path = urlObj.pathname;

    // Case: ".../values/<range>:append"  =>  "/values:append?range=<range>"
    const mAppend = path.match(/\/values\/([^/]+):append$/);
    if (mAppend) {
      const rangeRaw = decode(mAppend[1]); // e.g. 'materials'!A2:K9999  or  materials!A2:K9999
      // Rebuild endpoint
      path = path.replace(/\/values\/[^/]+:append$/, '/values:append');
      urlObj.pathname = path;

      // sanitize range: ensure quoted sheet name
      const ex = rangeRaw.split('!');
      if (ex.length >= 2) {
        let sheet = ex[0].replace(/^'+|'+$/g, '');
        const rest  = ex.slice(1).join('!');
        const rangeParam = `'${sheet}'!${rest}`;
        urlObj.searchParams.set('range', rangeParam);
      } else {
        // No '!' present; still pass through
        urlObj.searchParams.set('range', rangeRaw);
      }
    }

    // If path is ".../values" (read/write by row range), make sure any "'Sheet'!R:C" in search is de-quoted properly
    // (Google accepts quotes but we prefer them in query not path)
    return urlObj;
  };

  // Remove quotes around sheet name if they got placed in the PATH section
  const dequoteSheetNameInPath = (urlObj) => {
    // /values/'材料'!A1:Z999  =>  /values/材料!A1:Z999  (path)
    urlObj.pathname = urlObj.pathname.replace(/\/values\/%27([^%]+)%27(![A-Za-z0-9\:\$A-Z0-9]+)$/g, (_m, p1, p2) => {
      return '/values/' + p1 + p2;
    });
    urlObj.pathname = urlObj.pathname.replace(/\/values\/'([^']+)'(![A-Za-z0-9\:\$A-Z0-9]+)$/g, (_m, p1, p2) => {
      return '/values/' + p1 + p2;
    });
    return urlObj;
  };

  // Try to obtain access token from host app (best-effort)
  const getBearer = async () => {
    try {
      if (typeof window.ensureToken === 'function') {
        const t = await window.ensureToken();
        if (t) return t;
      }
    } catch {}
    try {
      if (typeof window.getAccessToken === 'function') {
        const t = await window.getAccessToken();
        if (t) return t;
      }
    } catch {}
    try {
      const t = window.gapi?.auth?.getToken?.()?.access_token;
      if (t) return t;
    } catch {}
    return null;
  };

  // Patch fetch -----------------------------------------------------------
  window.fetch = async function patchedFetch(input, init = {}) {
    // Build a URL object we can mutate safely
    const u0 = (typeof input === 'string') ? input : (input?.url || '');
    let urlObj;
    try {
      // If relative, pass-through
      urlObj = new URL(u0, location.origin);
    } catch {
      return _fetch(input, init);
    }

    // Only touch Google Sheets v4 endpoints
    const isSheets = /(^|\.)sheets\.googleapis\.com$/.test(urlObj.host) && urlObj.pathname.includes('/spreadsheets/');
    if (!isSheets) {
      return _fetch(input, init);
    }

    // ___________ Normalize URL ___________
    // 1) ensure spreadsheetId path is clean (strip accidental query tail)
    fixSpreadsheetPath(urlObj);

    // 2) fix /values endpoint forms
    normalizeValuesEndpoint(urlObj);

    // 3) remove quotes that were incorrectly placed in PATH part
    dequoteSheetNameInPath(urlObj);

    // 4) If "range" query exists, ensure it is a proper "'Sheet'!A1:Z999" (quote the sheet name once)
    if (urlObj.searchParams.has('range')) {
      const rr0 = urlObj.searchParams.get('range');
      const rr = decode(rr0);
      if (rr && rr.includes('!')) {
        let [sheet, ...rest] = rr.split('!');
        sheet = sheet.replace(/^'+|'+$/g, '');
        urlObj.searchParams.set('range', `'${sheet}'!${rest.join('!')}`);
      }
    }

    // Try to sniff & export spreadsheetId for the app
    try {
      const m = urlObj.pathname.match(/\/spreadsheets\/([a-zA-Z0-9\-\_]+)/);
      if (m && m[1]) {
        const sid = m[1];
        if (!window.currentSpreadsheetId || window.currentSpreadsheetId !== sid) {
          window.currentSpreadsheetId = sid;
          log('sniffed spreadsheetId:', sid);
          // Let the host app know we have a good ID
          window.dispatchEvent(new CustomEvent('materials:refresh', { detail: { spreadsheetId: sid } }));
        }
      }
    } catch {}

    // ___________ Headers / Body ___________
    const method = (init.method || 'GET').toUpperCase();
    const isWrite = method === 'POST' || method === 'PUT' || /:append$/.test(urlObj.pathname) || urlObj.pathname.endsWith(':batchUpdate');

    // Clone/extend headers
    const headers = new Headers(init.headers || {});

    // Inject Bearer token if missing
    if (!headers.has('Authorization')) {
      try {
        const token = await getBearer();
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } catch {}
    }

    // Content-Type for write calls
    if (isWrite && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // If body is object/array, stringify
    let body = init.body;
    if (isWrite && body && typeof body !== 'string' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      try { body = JSON.stringify(body); } catch {}
    }

    // Final URL string
    const finalUrl = urlObj.toString();

    // Debug
    log('sanitized range:', { from: u0, to: finalUrl });

    try {
      const res = await _fetch(finalUrl, { ...init, headers, body });
      if (!res.ok) {
        // Surface error body for diagnostics
        let txt = '';
        try { txt = await res.text(); } catch {}
        warn('HTTP error', res.status, res.statusText, txt.slice(0, 400));
      }
      return res;
    } catch (e) {
      warn('patchedFetch error', e);
      throw e;
    }
  };

  log('installed+sniffer');
})();
