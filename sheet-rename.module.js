// sheet-rename.module.js
// Robust spreadsheetId bridge + Sheets API range/append normalizer + URL fix for /spreadsheets/undefined
(() => {
  const LOG_PREFIX = '[sheet-rangefix]';
  const SHEETS_HOST = 'sheets.googleapis.com';
  let detectedId = null;

  const log = (...a) => console.log(LOG_PREFIX, ...a);
  const warn = (...a) => console.warn(LOG_PREFIX, ...a);

  // --- Utilities ------------------------------------------------------------
  const tryGetStored = () =>
    (window.__LM_SPREADSHEET_ID)
    || localStorage.getItem('lm.spreadsheet')
    || localStorage.getItem('materials.spreadsheet')
    || sessionStorage.getItem('lm.spreadsheet')
    || (document.cookie.match(/(?:^|;)\s*lm_spreadsheet=([^;]+)/)?.[1] || null);

  const publishId = (id) => {
    if (!id || typeof id !== 'string') return;
    if (detectedId === id) return;
    detectedId = id;
    // globals
    window.__LM_SPREADSHEET_ID = id;
    window.lmGetSpreadsheetId = () => detectedId;
    window.__materialsProvideSpreadsheet = () => detectedId;
    // storage
    try { localStorage.setItem('lm.spreadsheet', id); } catch {}
    try { localStorage.setItem('materials.spreadsheet', id); } catch {}
    try { sessionStorage.setItem('lm.spreadsheet', id); } catch {}
    try { document.cookie = `lm_spreadsheet=${id}; path=/; samesite=lax`; } catch {}
    // events
    const dispatchAll = () => {
      try { window.dispatchEvent(new CustomEvent('materials:spreadsheet', { detail: { spreadsheet: id }})); } catch {}
      try { document.dispatchEvent(new CustomEvent('materials:spreadsheet', { detail: { spreadsheet: id }})); } catch {}
      try { window.dispatchEvent(new CustomEvent('materials:refresh', { detail: { spreadsheet: id }})); } catch {}
      try { document.dispatchEvent(new CustomEvent('materials:refresh', { detail: { spreadsheet: id }})); } catch {}
      // direct bridge if available
      try { window.__materialsSetSpreadsheet && window.__materialsSetSpreadsheet(id); } catch {}
    };
    dispatchAll();
    setTimeout(dispatchAll, 60);
    setTimeout(dispatchAll, 300);
    setTimeout(dispatchAll, 1200);
    log('published spreadsheetId:', id);
  };

  const sniffFromUrl = (url) => {
    try {
      // /v4/spreadsheets/{ID}/...
      const m = url.match(/\/spreadsheets\/([a-zA-Z0-9-_]{20,})\b/);
      return m ? m[1] : null;
    } catch { return null; }
  };

  // --- Initial attempt: reuse stored id -------------------------------------
  const stored = tryGetStored();
  if (stored) publishId(stored);

  // --- Observe DOM to catch Sheets URLs (links/embed) -----------------------
  try {
    const mo = new MutationObserver((muts) => {
      for (const mut of muts) {
        const nodes = [...mut.addedNodes];
        for (const n of nodes) {
          if (n && n.nodeType === 1) {
            const el = /** @type {HTMLElement} */ (n);
            const href = (el.getAttribute && el.getAttribute('href')) || '';
            const src  = (el.getAttribute && el.getAttribute('src'))  || '';
            const text = el.textContent || '';
            const found = sniffFromUrl(href) || sniffFromUrl(src) || sniffFromUrl(text);
            if (found) publishId(found);
          }
        }
      }
    });
    mo.observe(document.documentElement, { subtree: true, childList: true });
  } catch {}

  // --- Also scan existing anchors/scripts once ------------------------------
  (() => {
    const els = [...document.querySelectorAll('a,link,script,iframe')];
    for (const el of els) {
      const href = el.getAttribute('href') || '';
      const src  = el.getAttribute('src')  || '';
      const found = sniffFromUrl(href) || sniffFromUrl(src);
      if (found) { publishId(found); break; }
    }
  })();

  // --- Fetch patch -----------------------------------------------------------
  const _fetch = window.fetch;
  window.fetch = async function patchedFetch(input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      // Learn ID from outgoing URL too
      const found = sniffFromUrl(url);
      if (found) publishId(found);

      // Only touch Sheets API calls
      const isSheets = url.includes(SHEETS_HOST + '/v4/spreadsheets/');
      if (isSheets) {
        // Fix when path accidentally contains 'undefined' as ID
        if (/\/spreadsheets\/undefined\//.test(url) && detectedId) {
          url = url.replace('/spreadsheets/undefined/', `/spreadsheets/${encodeURIComponent(detectedId)}/`);
        }

        // Normalize append form: /values:append?...&range=encoded
        if (/\/values\/.+:append(\?|$)/.test(url)) {
          // move the range to query param
          const u = new URL(url);
          const pathRange = decodeURIComponent(u.pathname.split('/values/')[1]).replace(/:append$/,''); // "'materials'!A2:K9999"
          // ensure proper encoding for query
          if (!u.searchParams.get('range')) {
            u.searchParams.set('range', pathRange);
          }
          u.pathname = u.pathname.replace(/\/values\/.+:append$/, '/values:append');
          url = u.toString();
        }

        // If still no ID in URL path, but we know it, inject it
        if (/\/spreadsheets\/(?![a-zA-Z0-9-_]{20,})/.test(url) && detectedId) {
          // try to insert after '/spreadsheets/'
          url = url.replace(/\/spreadsheets\/(?![a-zA-Z0-9-_]{20,})/, `/spreadsheets/${encodeURIComponent(detectedId)}/`);
        }
      }
    } catch (e) {
      warn('patchedFetch error', e);
    }

    if (typeof input === 'string') {
      return _fetch.call(this, url, init);
    } else {
      // Request object
      try {
        const req = new Request(url, input);
        return _fetch.call(this, req);
      } catch {
        return _fetch.call(this, url, init);
      }
    }
  };

  // --- Public helpers for other modules -------------------------------------
  window.__materialsProvideSpreadsheet = () => detectedId || tryGetStored() || null;
  window.__materialsSetSpreadsheet = (id) => publishId(id);
  window.__materialsGetSpreadsheet = () => detectedId;

  // --- Final: try to sniff from any visible Sheets link text -----------------
  setTimeout(() => {
    try {
      const bodyText = document.body ? document.body.innerHTML : '';
      const found = sniffFromUrl(bodyText);
      if (found) publishId(found);
      else log('installed+sniffer');
    } catch {
      log('installed+sniffer');
    }
  }, 0);
})();
