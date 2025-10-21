// sheet-rename.module.js
// Patch: Google Sheets range quote fix + basic guards
// This file safely wraps window.fetch to sanitize A1 ranges like `'materials'!A2:K9999`
// into `materials!A2:K9999`. Drop-in replacement (no rename).

(function () {
  const LOG_PREFIX = "[sheet-rangefix]";
  try {
    const originalFetch = window.fetch.bind(window);

    function sanitizeRangeInUrl(urlStr) {
      try {
        const url = new URL(urlStr);
        if (!/sheets\.googleapis\.com\/v4\/spreadsheets\//.test(url.hostname + url.pathname)) {
          return urlStr; // not a Sheets API call
        }
        // Guard: if spreadsheet id is 'null' or empty, block & warn
        if (/\/spreadsheets\/null\//.test(url.pathname)) {
          console.warn(LOG_PREFIX, "blocked call (null spreadsheet id)", urlStr);
          // Return original url; the request will 4xx—to keep behavior consistent.
          return urlStr;
        }

        // Only touch /values/xxx endpoints (get/update/append), not batchUpdate
        const valuesIdx = url.pathname.indexOf("/values/");
        if (valuesIdx === -1) return urlStr;

        // Extract the A1 range piece between /values/ and either end or next ":" after path segment
        // Safer approach: decode the part after /values/ up to query
        const prefix = url.pathname.substring(0, valuesIdx + 8); // includes "/values/"
        const rangePart = url.pathname.substring(valuesIdx + 8);
        // rangePart may contain encoded characters. Work on a decoded form.
        let decoded = decodeURIComponent(rangePart);

        // Fix common pattern: leading and trailing single quotes around sheet name
        // Examples:
        //   'materials'!A2:K9999    -> materials!A2:K9999
        //   '%27materials%27!A2:K9999' (already decoded above) -> same
        decoded = decoded.replace(/^'([^']+)'(!)/, (_m, name, bang) => `${name}${bang}`);

        // Also handle cases where sheet name has accidental whitespace around quotes
        decoded = decoded.replace(/^'\s*([^']*?)\s*'(!)/, (_m, name, bang) => `${name}${bang}`);

        // Re-encode the path piece conservatively
        // We need to encode only characters that are not allowed in path. Keep "!" and ":" unencoded.
        // We'll encode with encodeURIComponent and then restore "!" and ":" for readability (optional).
        let recoded = encodeURIComponent(decoded)
          .replace(/%21/g, "!")
          .replace(/%3A/gi, ":");

        const newPath = prefix + recoded;
        const rebuilt = url.origin + newPath + (url.search || "");
        if (rebuilt !== urlStr) {
          console.log(LOG_PREFIX, "sanitized range:", { from: urlStr, to: rebuilt });
        }
        return rebuilt;
      } catch (e) {
        console.warn(LOG_PREFIX, "sanitize error, using original url", e);
        return urlStr;
      }
    }

    window.fetch = async function(input, init) {
      try {
        let urlStr = typeof input === "string" ? input : input && input.url ? input.url : "" ;
        if (!urlStr) return originalFetch(input, init);
        const fixedUrl = sanitizeRangeInUrl(urlStr);

        if (typeof input === "string") {
          return originalFetch(fixedUrl, init);
        } else {
          // clone the Request with the fixed URL
          const newReq = new Request(fixedUrl, input);
          return originalFetch(newReq, init);
        }
      } catch (e) {
        console.warn(LOG_PREFIX, "fetch wrapper error, falling back", e);
        return originalFetch(input, init);
      }
    };

    console.log(LOG_PREFIX, "installed");
  } catch (e) {
    console.warn(LOG_PREFIX, "failed to install", e);
  }
})();