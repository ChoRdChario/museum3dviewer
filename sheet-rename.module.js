/* sheet-rename.module.js
 * LociMyu Sheets range/cors fixer (full file)
 * - Normalizes Google Sheets API URLs (range / :append / quoted sheet names)
 * - Adds OAuth Authorization header if missing (using ensureToken/getAccessToken if available)
 * - Sniffs spreadsheetId and exposes it to window.currentSpreadsheetId
 * - Dispatches 'materials:refresh' once when spreadsheetId is discovered
 */
(() => {
  const log = (...a) => console.log("[sheet-rangefix]", ...a);
  const warn = (...a) => console.warn("[sheet-rangefix]", ...a);

  // Keep original fetch
  const _fetch = window.fetch.bind(window);

  let didDispatchRefresh = false;

  function parseURL(u) {
    try { return new URL(u); } catch { return null; }
  }

  function unquoteSheetInPath(path) {
    // .../values/'シート1'!A1:Z9999  ->  .../values/シート1!A1:Z9999
    return path.replace(/\/values\/'%?([^']+?)'%?(![A-Z]+\d+:[A-Z]+\d+)/, (m, p1, p2) => {
      try {
        // Path may be percent-encoded; decode for sheet name only
        const decoded = decodeURIComponent(p1);
        return `/values/${decoded}${p2}`;
      } catch {
        return `/values/${p1}${p2}`;
      }
    });
  }

  function moveAppendRangeToQuery(u) {
    // .../values/materials!A2:K9999:append?x= -> .../values:append?range=materials!A2:K9999&x=
    // (works even if materials! is encoded)
    const url = parseURL(u);
    if (!url) return u;
    if (!/\/values\/.+:append$/.test(url.pathname)) return u;

    // Extract "range" between /values/ and :append
    const m = url.pathname.match(/\/values\/(.+):append$/);
    if (!m) return u;
    let range = m[1];

    try { range = decodeURIComponent(range); } catch {}
    // Rebuild URL
    url.pathname = url.pathname.replace(/\/values\/.+:append$/, "/values:append");
    // Preserve existing params
    url.searchParams.set("range", range);
    return url.toString();
  }

  function decodeBangAndAppend(u) {
    // materials%21A2%3AK9999 -> materials!A2:K9999, and %3Aappend edge cases
    try {
      return u
        .replace(/%21/g, "!")
        .replace(/%3Aappend/gi, ":append");
    } catch { return u; }
  }

  function sanitizeSheetsUrl(u) {
    let out = u;
    const url = parseURL(out);
    if (!url) return out;
    if (!/(^|\.)sheets\.googleapis\.com$/.test(url.hostname)) return out;
    if (!/^\/v4\/spreadsheets\//.test(url.pathname)) return out;

    // 1) Unquote sheet names if present in path
    url.pathname = unquoteSheetInPath(url.pathname);

    // 2) If :append is in the path, move range to query
    out = url.toString();
    out = moveAppendRangeToQuery(out);

    // 3) Decode %21 (bang) and %3Aappend if still present
    out = decodeBangAndAppend(out);

    // Sniff spreadsheetId and expose (first time only)
    const m = out.match(/\/v4\/spreadsheets\/([^/]+)/);
    if (m && m[1]) {
      const ssid = m[1];
      if (!window.currentSpreadsheetId) {
        window.currentSpreadsheetId = ssid;
        log("sniffed spreadsheetId:", ssid);
        if (!didDispatchRefresh) {
          didDispatchRefresh = true;
          window.dispatchEvent(new Event("materials:refresh"));
          log("dispatched materials:refresh");
        }
      }
    }
    return out;
  }

  async function ensureAuthHeaders(u, options) {
    const url = parseURL(u);
    if (!url) return options || {};
    if (!/(^|\.)sheets\.googleapis\.com$/.test(url.hostname)) return options || {};

    const opts = Object.assign({}, options);
    // Normalize headers into a Headers object
    const hdr = new Headers(opts.headers || {});
    // If Authorization is missing, try to get access token from page helpers
    if (!hdr.get("Authorization")) {
      try {
        if (typeof window.ensureToken === "function") {
          await Promise.resolve(window.ensureToken());
        }
        if (typeof window.getAccessToken === "function") {
          const token = await Promise.resolve(window.getAccessToken());
          if (token && typeof token === "string") {
            hdr.set("Authorization", `Bearer ${token}`);
          }
        }
      } catch (e) {
        warn("token obtain failed", e);
      }
    }

    // Ensure JSON content-type for write ops
    const method = (opts.method || "GET").toUpperCase();
    if (method !== "GET" && !hdr.get("Content-Type")) {
      hdr.set("Content-Type", "application/json; charset=UTF-8");
    }
    opts.headers = hdr;
    opts.mode = opts.mode || "cors";
    return opts;
  }

  // Install patched fetch
  window.fetch = async function patchedFetch(input, init) {
    try {
      const urlStr = typeof input === "string" ? input : (input && input.url) || "";
      const sanitized = sanitizeSheetsUrl(urlStr);
      if (sanitized !== urlStr) {
        log("sanitized range:", { from: urlStr, to: sanitized });
      }
      const opts = await ensureAuthHeaders(sanitized, init);

      // Execute
      const res = await _fetch(sanitized, opts);

      // Log suspicious failures to help debugging
      if (!res.ok) {
        const ct = res.headers.get("content-type") || "";
        let bodyText = "";
        try {
          if (ct.includes("application/json")) {
            const j = await res.clone().json();
            bodyText = JSON.stringify(j);
          } else {
            bodyText = await res.clone().text();
          }
        } catch {}
        warn("HTTP", res.status, res.statusText, { url: sanitized, body: bodyText });
      }
      return res;
    } catch (e) {
      warn("patchedFetch error", e);
      throw e;
    }
  };

  log("installed+sniffer");
})();