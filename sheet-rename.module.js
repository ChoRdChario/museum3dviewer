
/*! sheet-rename.module.js — LM range sanitizer + spreadsheetId sniffer + id publisher (full) */
(() => {
  const MODTAG = '[sheet-rangefix]';
  const log  = (...a) => console.log(MODTAG, ...a);
  const warn = (...a) => console.warn(MODTAG, ...a);

  // ---- helpers ------------------------------------------------------------
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Publish the spreadsheetId everywhere common implementations might read
  const publishId = (id) => {
    if (!id) return;
    try {
      window.__LM_SPREADSHEET_ID = id;
      // popular local/session keys
      try { localStorage.setItem('lm.spreadsheet', id); } catch {}
      try { localStorage.setItem('materials.spreadsheet', id); } catch {}
      try { sessionStorage.setItem('lm.spreadsheet', id); } catch {}
      // cookie fallback
      try { document.cookie = `lm_spreadsheet=${encodeURIComponent(id)}; path=/; max-age=31536000`; } catch {}

      // callable helpers (pull-style)
      window.lmGetSpreadsheetId = () => id;
      window.__materialsProvideSpreadsheet = () => id;

      // push-style events (fire a few times to pass race windows)
      const detail = { spreadsheet: id };
      const fire = () => {
        window.dispatchEvent(new CustomEvent('materials:spreadsheet', { detail }));
        window.dispatchEvent(new CustomEvent('materials:refresh', { detail }));
        document.dispatchEvent(new CustomEvent('materials:spreadsheet', { detail }));
        document.dispatchEvent(new CustomEvent('materials:refresh', { detail }));
      };
      fire();
      setTimeout(fire, 60);
      setTimeout(fire, 300);
      setTimeout(fire, 1200);

      // call-through if consumer exposes a setter
      if (typeof window.__materialsSetSpreadsheet === 'function') {
        try { window.__materialsSetSpreadsheet(id); } catch {}
      }
      // periodic nudge for 10s
      let n = 0;
      const t = setInterval(() => {
        if (++n > 20) { clearInterval(t); return; }
        if (typeof window.__materialsSetSpreadsheet === 'function') {
          try { window.__materialsSetSpreadsheet(id); } catch {}
        }
        fire();
      }, 500);

      log('published spreadsheetId:', id);
    } catch (e) {
      warn('publishId error', e);
    }
  };

  // ---- sniffers -----------------------------------------------------------
  const extractFromUrl = (u) => {
    try {
      const url = new URL(u);
      const q = url.searchParams;
      // explicit ?sheet= / ?spreadsheet=
      const cand = q.get('sheet') || q.get('spreadsheet');
      if (cand) return cand;
      // /d/<id>/ pattern (Google Sheets link)
      const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (m) return m[1];
      return null;
    } catch { return null; }
  };

  const sniffInitial = () => {
    // 1) from location (search & hash)
    const fromLoc = extractFromUrl(location.href) || extractFromUrl(location.hash.replace(/^#/, location.origin + location.pathname + '?'));
    if (fromLoc) return fromLoc;
    // 2) from DOM (links to sheets)
    const link = qsa('a[href*="docs.google.com/spreadsheets/"], a[href*="sheets.googleapis.com/v4/spreadsheets/"]').map(a => extractFromUrl(a.href)).find(Boolean);
    if (link) return link;
    // 3) from prior storage
    try {
      return localStorage.getItem('lm.spreadsheet') ||
             localStorage.getItem('materials.spreadsheet') ||
             sessionStorage.getItem('lm.spreadsheet') ||
             window.__LM_SPREADSHEET_ID ||
             null;
    } catch { /* no-op */ }
    return null;
  };

  // Observe new anchors added later (SPA)
  const observeLinks = () => {
    const mo = new MutationObserver(() => {
      const id = sniffInitial();
      if (id && !window.__LM_SPREADSHEET_ID) publishId(id);
    });
    mo.observe(document.documentElement, { subtree: true, childList: true });
  };

  // ---- fetch patch (range normalization + token injection passthrough) ----
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init = {}) {
    try {
      let url = typeof input === 'string' ? input : input.url;

      // Normalize append endpoint format for Sheets API
      // NG: /values/'シート'!A2:K9999:append?... → OK: /values:append?range='シート'!A2:K9999
      if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/[^/]+\/values\/.+:append/i.test(url)) {
        const m = url.match(/\/values\/(.+):append(.*)$/i);
        if (m) {
          const range = m[1]; // may contain quotes / URL-encoded
          const tail = m[2] || '';
          const base = url.replace(/\/values\/.+:append.*$/i, '/values:append');
          const params = new URLSearchParams(tail.replace(/^\?/, ''));
          // ensure proper 'range' query
          params.set('range', decodeURIComponent(range));
          url = `${base}?${params.toString()}`;
          log('sanitized range:', { from: (typeof input === 'string' ? input : input.url), to: url });
          if (typeof input !== 'string') input = new Request(url, input);
          else input = url;
        }
      }

      // Try to learn spreadsheetId from Sheets URLs
      if (/https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\//i.test(url)) {
        const idm = url.match(/\/spreadsheets\/([^/?#]+)/i);
        if (idm && idm[1]) {
          publishId(idm[1]);
        }
      }

      return await originalFetch(input, init);
    } catch (e) {
      warn('patchedFetch error', e);
      throw e;
    }
  };

  // ---- boot ---------------------------------------------------------------
  log('installed+sniffer');

  const id0 = sniffInitial();
  if (id0) {
    publishId(id0);
  } else {
    warn('spreadsheetId not found (non-fatal)');
    observeLinks();
  }

  // In case consumer wants an explicit refresh trigger
  window.addEventListener('materials:refresh:request', () => {
    const id = sniffInitial();
    if (id) publishId(id);
  });
})();
