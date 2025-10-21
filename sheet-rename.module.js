
// sheet-rename.module.js
// Drop-in shim: sanitize A1 ranges and help the app discover spreadsheetId.
// Safe to include before/after the main app boot. No renames needed.

(function () {
  if (window.__LM_SHEET_RANGEFIX_INSTALLED__) return;
  window.__LM_SHEET_RANGEFIX_INSTALLED__ = true;

  const SHEETS_RE = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/]+)\/values\/([^?]+)(\?.*)?$/;
  let announced = false;

  const decode = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };

  function sanitizeRange(pathPart) {
    // pathPart example: "'materials'!A2%3AK9999" or "%E3%82%B7%E3%83%BC%E3%83%881!A1%3AZ9999"
    // 1) decode
    const decoded = decode(pathPart);
    // 2) strip quotes around sheet name only if present at the start
    //    Pattern: 'Sheet Name'!A1:Z999 —> Sheet Name!A1:Z999
    const fixed = decoded.replace(/^'([^']+)'(![A-Za-z0-9:$]+)$/u, (_, sheet, tail) => `${sheet}${tail}`);
    // 3) re-encode only the query-breaking bits (: and !) while keeping unicode intact
    //    We can safely use encodeURIComponent then un-escape slashes
    const reencoded = fixed
      .replace(/!/g, '%21')
      .replace(/:/g, '%3A')
      .replace(/\//g, '%2F'); // keep it conservative inside path
    return reencoded;
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    try {
      let url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));

      const m = url.match(SHEETS_RE);
      if (m) {
        const ssid = m[1];
        const pathPart = m[2]; // "'"sheet"'!A1%3AZ999 or similar
        const rest = m[3] || '';

        // Sanitize the range
        const newPathPart = sanitizeRange(pathPart);
        const newUrl = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${newPathPart}${rest}`;

        if (newUrl !== url) {
          console.log('[sheet-rangefix] sanitized range:', { from: url, to: newUrl });
          url = newUrl;
          if (typeof input === 'string') {
            input = url;
          } else if (input && input.url) {
            // recreate Request with same options
            input = new Request(url, input);
          }
        }

        // SpreadsheetId sniff & announce
        if (!window.currentSpreadsheetId || typeof window.currentSpreadsheetId !== 'string') {
          window.currentSpreadsheetId = ssid;
          console.log('[sheet-rangefix] sniffed spreadsheetId:', ssid);
          if (!announced) {
            announced = true;
            setTimeout(() => {
              try {
                window.dispatchEvent(new Event('materials:refresh'));
                console.log('[sheet-rangefix] dispatched materials:refresh');
              } catch (e) {
                console.warn('[sheet-rangefix] dispatch failed', e);
              }
            }, 0);
          }
        }
      }
    } catch (e) {
      console.warn('[sheet-rangefix] patch error (ignored):', e);
    }

    return origFetch(input, init);
  };

  console.log('[sheet-rangefix] installed+sniffer');
})();
