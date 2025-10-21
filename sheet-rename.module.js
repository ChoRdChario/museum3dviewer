
// sheet-rename.module.js (full file)
// Purpose:
// - Normalize Google Sheets API "values" endpoints so ranges with quoted sheet names
//   and path-embedded :append don't break due to URL encoding.
// - Prefer the robust endpoint form: /values:append?range=... to avoid path encoding pitfalls.
// - Sniff spreadsheetId from requests and expose it to window.currentSpreadsheetId if missing.
// - On first successful sniff, dispatch a 'materials:refresh' so the app can re-bootstrap.
//
// This file only wraps fetch(). It does NOT change your auth flow or existing modules.

(() => {
  if (window.__SHEET_RANGEFIX_INSTALLED__) return;
  window.__SHEET_RANGEFIX_INSTALLED__ = true;

  const ORIG_FETCH = window.fetch.bind(window);

  const log = (...a) => {
    try { console.log('[sheet-rangefix]', ...a); } catch {}
  };

  // Simple URL check
  const isSheetsApi = (u) => {
    try {
      const url = (typeof u === 'string') ? new URL(u) : (u instanceof URL ? u : null);
      if (!url) return false;
      return url.hostname === 'sheets.googleapis.com' && url.pathname.startsWith('/v4/spreadsheets/');
    } catch { return false; }
  };

  // Strip outer single quotes around sheet name:  'シート1'!A1:Z9999  -> シート1!A1:Z9999
  const stripQuotedSheet = (range) => {
    // only strip if it starts with '...'!
    if (!range) return range;
    if (range[0] === '\'' && range.includes('\'!')) {
      const idx = range.indexOf('\'!');
      if (idx > 0) {
        const name = range.slice(1, idx);         // between quotes
        const rest = range.slice(idx + 2);        // after '!'
        return `${name}!${rest}`;
      }
    }
    return range;
  };

  // Decode accidental percent-encodings for path separators we actually want to keep in the range
  const decodeRangeLike = (s) => {
    if (!s) return s;
    // Decode a limited set: %21 => !, %3A => :, %2F => / (some code paths might encode slash inside sheet name; leave if present)
    return s.replace(/%21/gi,'!').replace(/%3A/gi,':').replace(/%2F/gi,'/');
  };

  // Extract spreadsheet id from path /v4/spreadsheets/{id}/...
  const sniffSpreadsheetId = (urlObj) => {
    const m = urlObj.pathname.match(/^\/v4\/spreadsheets\/([^/]+)/);
    return m ? m[1] : null;
  };

  // Normalize a Sheets values request; return {url, init, didRewrite}
  const normalizeSheetsValues = (input, init) => {
    const urlObj = (typeof input === 'string') ? new URL(input) : (input instanceof URL ? input : null);
    if (!urlObj) return { url: input, init, didRewrite: false };

    // If this is not a values endpoint, no-op
    if (!/\/values(\/|:)/.test(urlObj.pathname)) {
      return { url: input, init, didRewrite: false };
    }

    // Keep an eye on :append in the path or range-with-quotes
    // Supported original forms we want to sanitize:
    //   /values/'シート1'!A1:Z9999                  (GET/PUT)
    //   /values/シート1!A2:K9999:append?valueInputOption=...
    //   /values/'materials'!A2:K9999:append?valueInputOption=...
    //
    // Our strategy:
    //   - Extract any path-embedded range segment after "/values/"
    //   - Clean quotes and encoding
    //   - Convert to query form:
    //       /values:append?range=<cleanRange>&...
    //     or keep /values/<cleanRange> for non-append GET/PUT.
    //
    // This avoids edge cases where colon/quotes/slashes inside the path are mis-encoded.

    const afterValues = urlObj.pathname.split('/values/')[1] || '';
    let rangeSeg = afterValues; // could include ":append" or further path
    let isAppend = false;

    // If path is ".../values:append" (query form already), keep as is but fix quoted range param later
    if (urlObj.pathname.includes('/values:append')) {
      // Ensure range param is cleaned
      const qRange = urlObj.searchParams.get('range');
      if (qRange) {
        const cleaned = stripQuotedSheet(decodeRangeLike(qRange));
        if (cleaned !== qRange) {
          urlObj.searchParams.set('range', cleaned);
        }
        const finalUrl = urlObj.toString();
        return { url: finalUrl, init, didRewrite: true };
      }
      // no range param → nothing we can do; leave as-is
      return { url: urlObj.toString(), init, didRewrite: false };
    }

    // Otherwise, we are in the "/values/<something>" form
    // Detect and split ":append" suffix if present
    // e.g. materials!A2:K9999:append
    const appendIdx = rangeSeg.lastIndexOf(':append');
    if (appendIdx !== -1) {
      isAppend = true;
      rangeSeg = rangeSeg.slice(0, appendIdx); // remove :append from path portion
    }

    // rangeSeg might include additional segments like "?..." if malformed. Remove any trailing query from path parse.
    const qm = rangeSeg.indexOf('?');
    if (qm !== -1) rangeSeg = rangeSeg.slice(0, qm);

    // Decode and clean quoted sheet names
    rangeSeg = decodeRangeLike(rangeSeg);
    rangeSeg = stripQuotedSheet(rangeSeg);

    let finalUrl;
    if (isAppend) {
      // convert to /values:append?range=...
      // Keep all existing query params
      const params = urlObj.search; // includes leading "?"
      finalUrl = `${urlObj.origin}/v4/spreadsheets/${sniffSpreadsheetId(urlObj)}/values:append?range=${encodeURIComponent(rangeSeg)}${params ? '&' + params.slice(1) : ''}`;
    } else {
      // Keep non-append, but ensure cleaned range is in the path
      const before = urlObj.pathname.split('/values/')[0];
      finalUrl = `${urlObj.origin}${before}/values/${rangeSeg}${urlObj.search || ''}`;
    }

    return { url: finalUrl, init, didRewrite: true };
  };

  // We also want to poke spreadsheetId into window if not present yet.
  let sniffedOnce = false;
  const maybePokeSpreadsheetId = (reqUrl) => {
    try {
      const urlObj = (typeof reqUrl === 'string') ? new URL(reqUrl) : (reqUrl instanceof URL ? reqUrl : null);
      if (!urlObj || !isSheetsApi(urlObj)) return;
      const id = sniffSpreadsheetId(urlObj);
      if (!id) return;
      if (!window.currentSpreadsheetId) {
        window.currentSpreadsheetId = id;
        log('sniffed spreadsheetId:', id);
        if (!sniffedOnce) {
          sniffedOnce = true;
          // Give the app a nudge to re-read env
          try {
            window.dispatchEvent(new Event('materials:refresh'));
            log('dispatched materials:refresh');
          } catch {}
        }
      }
    } catch {}
  };

  // The wrapper
  window.fetch = async (input, init) => {
    try {
      // Only care about Sheets API requests
      if (isSheetsApi(input)) {
        const before = (typeof input === 'string') ? input : (input instanceof URL ? input.toString() : 'unknown');
        const { url, init: nInit, didRewrite } = normalizeSheetsValues(input, init);
        if (didRewrite) log('sanitized range:', { from: before, to: url });
        maybePokeSpreadsheetId(url);
        return ORIG_FETCH(url, nInit ?? init);
      }
      return ORIG_FETCH(input, init);
    } catch (err) {
      // Surface error to caller as usual
      throw err;
    }
  };

  log('installed+sniffer');
})();
