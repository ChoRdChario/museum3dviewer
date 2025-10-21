
/* sheet-rename.module.js
 * Robust spreadsheetId sniffer + optional ensure(materials) helper
 * - No rename required. Drop-in replacement.
 * - Does NOT break existing logic; only augments.
 */
(() => {
  const TAG = "[sheet-rangefix]";
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // =============== Utilities ===============
  const isSheetsApi = (u) => {
    try { const x = new URL(u, location.href); return (x.hostname === "sheets.googleapis.com" && x.pathname.includes("/v4/spreadsheets/")); }
    catch { return false; }
  };
  const extractIdFromSheetsApi = (u) => {
    try {
      const x = new URL(u, location.href);
      // /v4/spreadsheets/{ID}/...
      const m = x.pathname.match(/\/v4\/spreadsheets\/([^/]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch { return null; }
  };
  const extractIdFromDocsUrl = (u) => {
    try {
      const x = new URL(u, location.href);
      // https://docs.google.com/spreadsheets/d/{ID}/...
      if (!/docs\.google\.com$/.test(x.hostname)) return null;
      const m = x.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch { return null; }
  };
  const extractIdFromText = (s) => {
    if (!s) return null;
    // 30-80 chars of allowed base64url-ish
    const m = s.match(/[A-Za-z0-9_\-]{20,}/g);
    if (!m) return null;
    // heuristic: prefer IDs that appear next to "spreadsheets"
    const cand = m.find(t => /[A-Za-z0-9_\-]{30,}/.test(t)) || m[0];
    return cand || null;
  };
  const parseFromLocation = () => {
    const tryKeys = ["sheet","spreadsheet","sheetId","spreadsheetId","sid","id"];
    const all = [location.search, location.hash].join("&");
    const usp = new URLSearchParams(all.replace(/^#/, "&"));
    for (const k of tryKeys) {
      const v = usp.get(k);
      const id = extractIdFromText(v);
      if (id) return id;
    }
    // Try raw URL pattern in the hash
    const id2 = extractIdFromDocsUrl(location.hash.replace(/^#/, ""));
    if (id2) return id2;
    return null;
  };
  const setFoundId = (id) => {
    if (!id) return;
    if (window.__LM_SPREADSHEET_ID === id) return;
    window.__LM_SPREADSHEET_ID = id;
    try { localStorage.setItem("lm.spreadsheet", id); } catch {}
    log("sniffed spreadsheetId:", id);
    // Broadcast to app
    try {
      window.dispatchEvent(new CustomEvent("materials:spreadsheet", { detail: { spreadsheetId: id }}));
      window.dispatchEvent(new Event("materials:refresh"));
    } catch {}
  };

  // =============== 1) Early sniff ===============
  log("installed+sniffer");
  const early = parseFromLocation() || ( () => { try { return localStorage.getItem("lm.spreadsheet") || null; } catch { return null; } })();
  if (early) setFoundId(early);
  else warn("spreadsheetId not found (non-fatal)");

  // =============== 2) Observe DOM for Google Sheets links ===============
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n && n.nodeType === 1) {
          const a = n.matches?.("a[href]") ? [n] : Array.from(n.querySelectorAll?.("a[href]") || []);
          for (const el of a) {
            const id = extractIdFromDocsUrl(el.href);
            if (id) { setFoundId(id); return; }
          }
        }
      }
    }
  });
  mo.observe(document.documentElement, { subtree:true, childList:true });

  // =============== 3) Patch fetch: normalize append URL; capture ID ===============
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init = {}) {
    let url = (typeof input === "string") ? input : (input?.url || "");
    if (isSheetsApi(url)) {
      // Capture spreadsheetId from outgoing calls
      const sid = extractIdFromSheetsApi(url);
      if (sid) setFoundId(sid);

      // Normalize append endpoint format: /values:append?range=....
      // Handle both legacy ".../values/'sheet'!A2:K9999:append?..." and wrong-encoded variants
      try {
        const u = new URL(url, location.href);
        // If path ends with /values/<range>:append  → convert to /values:append?range=<range>
        const m = u.pathname.match(/\/values\/(.+):append$/);
        if (m) {
          const range = m[1];
          u.pathname = u.pathname.replace(/\/values\/.+:append$/, "/values:append");
          // keep existing query params but set range=
          u.searchParams.set("range", range);
          url = u.toString();
          if (typeof input !== "string") input = new Request(url, input);
          else input = url;
          // Optional: log once
          if (!window.__LM_ONCE_APPEND_LOGGED) {
            window.__LM_ONCE_APPEND_LOGGED = true;
            log("normalized append URL →", url);
          }
        }
      } catch {}
    }
    return nativeFetch(input, init);
  };

  // =============== 4) Optional: ensure 'materials' sheet once we have id + token ===============
  const getAccessToken = () => {
    try {
      // Prefer gapi if available
      if (window.gapi?.auth?.getToken) {
        const t = window.gapi.auth.getToken();
        if (t?.access_token) return t.access_token;
      }
      if (window.gapi?.client?.getToken) {
        const t = window.gapi.client.getToken();
        if (t?.access_token) return t.access_token;
      }
    } catch {}
    // Fallback: some apps stick token here
    try { const t = localStorage.getItem("google_access_token"); if (t) return t; } catch {}
    return null;
  };

  const HEADERS = ["index","materialKey","unlit","doubleSided","opacity","white2alpha","whiteThr","black2alpha","blackThr","ts","source"];

  const GV = async (spreadsheetId, rangeA1, token) => {
    const u = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
    const r = await fetch(u, { headers: { "Authorization": `Bearer ${token}` }});
    if (!r.ok) throw new Error(`GV ${r.status}`);
    return r.json();
  };
  const PV = async (spreadsheetId, rangeA1, values, token) => {
    const u = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
    const body = JSON.stringify({ range: rangeA1, values: [values] });
    const r = await fetch(u, { method:"PUT", headers: { "Authorization": `Bearer ${token}`, "Content-Type":"application/json" }, body });
    if (!r.ok) throw new Error(`PV ${r.status}`);
    return r.json();
  };
  const batchUpdate = async (spreadsheetId, body, token) => {
    const u = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const r = await fetch(u, { method:"POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`batchUpdate ${r.status}`);
    return r.json();
  };

  let ensured = false;
  const ensureMaterialsSheet = async () => {
    if (ensured) return;
    const sid = window.__LM_SPREADSHEET_ID;
    const token = getAccessToken();
    if (!sid || !token) return;

    // Try header read; if not exists, add sheet, then header PUT.
    try {
      await GV(sid, "'materials'!A1:K1", token);
      // If came here OK, still write headers to be safe when empty/different
      await PV(sid, "'materials'!A1:K1", HEADERS, token);
      ensured = true;
      log("materials sheet ensured (header write)");
      return;
    } catch (e) {
      // Likely not found → addSheet then header
      try {
        await batchUpdate(sid, { requests: [{ addSheet: { properties: { title: "materials" } } }] }, token);
      } catch(_e) { /* ignore 400/409 */ }
      await PV(sid, "'materials'!A1:K1", HEADERS, token);
      ensured = true;
      log("materials sheet ensured (created+header)");
      return;
    }
  };

  // Kick: try a few times to allow token/UI to settle
  let tries = 0;
  const t = setInterval(() => {
    ensureMaterialsSheet().catch(err => warn("ensureMaterialsSheet error", err?.message || err));
    if (++tries > 40 || ensured) clearInterval(t);
  }, 500);
})();
