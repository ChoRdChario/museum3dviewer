/* eslint-disable no-undef */
/*
 * sheet-rename.module.js
 * Purpose:
 *  - Normalize Google Sheets "append" endpoint to `values:append?range=` (avoid `/values/'name'!A1:Z1:append`)
 *  - Inject Authorization: Bearer <token> into requests to sheets.googleapis.com
 *  - Sniff and expose spreadsheetId in a robust way
 *  - On boot, idempotently ensure a 'materials' sheet with headers exists once token+id are available
 *  - Keep logs minimal: "[sheet-rangefix] ..."
 *
 * Safe to include multiple times; installs once.
 */
(() => {
  const TAG = "[sheet-rangefix]";
  if (window.__sheetFix?.installed) {
    console.log(TAG, "already installed");
    return;
  }
  window.__sheetFix = window.__sheetFix || { installed: true, lastId: null };

  const SHEETS_ORIGIN = "https://sheets.googleapis.com";
  const API_ROOT = "/v4/spreadsheets/";
  const MATERIALS_TITLE = "materials";
  const MATERIALS_HEADER = [
    "rowId","materialKey","unlit","doubleSided","opacity",
    "white2alpha","whiteThr","black2alpha","blackThr","timestamp","user"
  ];

  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // --- Token helpers --------------------------------------------------------
  const readToken = () => {
    try {
      const t1 = (window.gapi && window.gapi.auth && window.gapi.auth.getToken && window.gapi.auth.getToken()) || null;
      if (t1 && (t1.access_token || t1.accessToken)) return t1;
    } catch {}
    try {
      const t2 = (window.google && window.google.accounts && window.google.accounts.oauth2 && window.google.accounts.oauth2.getToken && window.google.accounts.oauth2.getToken()) || null;
      if (t2 && (t2.access_token || t2.accessToken)) return t2;
    } catch {}
    return null;
  };
  const readAccessToken = () => {
    const t = readToken();
    return t && (t.access_token || t.accessToken) || null;
  };

  // --- SpreadsheetId sniff --------------------------------------------------
  const parseIdFromUrl = (url) => {
    // Accept both raw id and id with accidental query suffixes; strip queries
    try {
      // If full URL like https://.../spreadsheets/{id}/... -> extract
      const m = url.match(/spreadsheets\/([a-zA-Z0-9-_]+)/);
      if (m) return m[1];
    } catch {}
    // Fallback: if looks like an id + query string, split by ?
    return (url || "").split("?")[0];
  };

  const guessSpreadsheetId = () => {
    // Sources to probe without throwing
    const cands = [
      window.currentSpreadsheetId,
      window.__sheetFix.lastId,
      (window.__sheetConfig && window.__sheetConfig.spreadsheetId),
      (window.__materials && window.__materials.spreadsheetId),
      // Sometimes kept on a global viewer config
      (window.viewer && window.viewer.sheet && window.viewer.sheet.id),
      (window.LM && window.LM.sheetId),
    ].filter(Boolean);

    for (const c of cands) {
      const id = parseIdFromUrl(String(c));
      if (id && id.length > 20) return id;
    }

    // Inspect last successful Sheets request if available
    try {
      const last = window.__lastSheetsUrl;
      if (last) {
        const id = parseIdFromUrl(String(last));
        if (id && id.length > 20) return id;
      }
    } catch {}

    // As a last resort, scan <a href> links that look like sheets URLs
    try {
      const links = Array.from(document.querySelectorAll('a[href*="spreadsheets/"]'));
      for (const a of links) {
        const id = parseIdFromUrl(a.href);
        if (id && id.length > 20) return id;
      }
    } catch {}

    return null;
  };

  // --- Range/URL normalization ----------------------------------------------
  const normalizeAppendUrl = (u) => {
    // Input examples to normalize:
    //  1) https://.../values/'materials'!A2:K9999:append?valueInputOption=RAW
    //  2) https://.../values/%27materials%27!A2%3AK9999:append?valueInputOption=RAW
    //  3) https://.../values:append?range='materials'!A2:K9999&valueInputOption=RAW  (OK)
    try {
      const url = new URL(u);
      if (!url.origin.startsWith(SHEETS_ORIGIN)) return u;
      if (!url.pathname.startsWith(API_ROOT)) return u;

      // Already the good form?
      if (url.pathname.endsWith("/values:append")) return u;

      // Path form: /values/<range>:append -> convert to /values:append?range=<range>
      const m = url.pathname.match(/\/values\/([^/]+):append$/);
      if (!m) return u;

      const encodedRange = m[1]; // may include %27
      // Build new URL: move range into query param
      const newPath = url.pathname.replace(/\/values\/[^/]+:append$/, "/values:append");
      url.pathname = newPath;

      // Preserve existing query and add normalized range
      // If there is already a range param, we will overwrite it.
      url.searchParams.set("range", encodedRange);

      return url.toString();
    } catch {
      return u;
    }
  };

  // --- Ensure materials sheet + header (idempotent) -------------------------
  const ensureMaterialsSheet = async (spreadsheetId, accessToken) => {
    const base = `${SHEETS_ORIGIN}${API_ROOT}${encodeURIComponent(spreadsheetId)}`;
    const headers = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    // 1) Try reading header
    const hdrRes = await fetch(`${base}/values/${encodeURIComponent("'materials'!A1:K1")}?majorDimension=ROWS`, { headers });
    if (hdrRes.status === 200) {
      const data = await hdrRes.json();
      const row = (data && data.values && data.values[0]) || null;
      const ok = Array.isArray(row) && row.length === MATERIALS_HEADER.length && row[0] === "rowId";
      if (!ok) {
        // header mismatch -> write header
        const put = await fetch(`${base}/values/${encodeURIComponent("'materials'!A1:K1")}?valueInputOption=RAW`, {
          method: "PUT", headers,
          body: JSON.stringify({ range: "'materials'!A1:K1", majorDimension: "ROWS", values: [MATERIALS_HEADER] }),
        });
        if (!put.ok) throw new Error(`header PUT failed ${put.status}`);
      }
      return true;
    }

    if (hdrRes.status === 404) {
      // 2) Not found -> addSheet then header
      const add = await fetch(`${base}:batchUpdate`, {
        method: "POST", headers,
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: MATERIALS_TITLE } } }] }),
      });
      // 409 conflict means sheet already exists -> ignore
      if (!(add.status === 200 || add.status === 409)) {
        const t = await add.text();
        throw new Error(`addSheet failed ${add.status} ${t}`);
      }
      const put = await fetch(`${base}/values/${encodeURIComponent("'materials'!A1:K1")}?valueInputOption=RAW`, {
        method: "PUT", headers,
        body: JSON.stringify({ range: "'materials'!A1:K1", majorDimension: "ROWS", values: [MATERIALS_HEADER] }),
      });
      if (!put.ok) throw new Error(`header PUT after add failed ${put.status}`);
      return true;
    }

    // Other error – try to read body for hints
    const txt = await hdrRes.text();
    throw new Error(`header GET failed ${hdrRes.status} ${txt}`);
  };

  // --- Install fetch patch ---------------------------------------------------
  const rawFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    let url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.startsWith(SHEETS_ORIGIN)) {
      window.__lastSheetsUrl = url;

      // Normalize append URL form
      const normalized = normalizeAppendUrl(url);
      if (normalized !== url) url = normalized;

      // Inject Authorization header if token available
      const token = readAccessToken();
      if (token) {
        init.headers = new Headers(init.headers || {});
        if (!init.headers.has("Authorization")) {
          init.headers.set("Authorization", `Bearer ${token}`);
        }
      }
      // Replace Request if original was a Request object
      if (typeof input !== "string") {
        input = new Request(url, input);
      } else {
        input = url;
      }
    }
    try {
      return await rawFetch(input, init);
    } catch (e) {
      warn("patchedFetch error", e);
      throw e;
    }
  };

  log("installed+sniffer");

  // --- Background task: find id + ensure materials once ready ---------------
  (async () => {
    // Probe few times for id/token, then attempt ensure
    let tries = 0;
    const max = 40; // ~10s at 250ms
    while (tries++ < max) {
      const id = guessSpreadsheetId();
      const tok = readAccessToken();
      if (id) window.__sheetFix.lastId = id;
      if (id && tok) {
        log("sniffed spreadsheetId:", id);
        try {
          await ensureMaterialsSheet(id, tok);
          log("materials sheet ensured");
          // Notify app code that materials is ready/fresh
          window.dispatchEvent(new CustomEvent("materials:refresh", { detail: { id } }));
        } catch (e) {
          warn("ensureMaterialsSheet error", e);
        }
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!window.__sheetFix.lastId) {
      warn("spreadsheetId not found (non-fatal)");
    }
  })();
})();
