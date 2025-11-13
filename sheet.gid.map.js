/**
 * sheet.gid.map.js
 * Build and cache a mapping {title -> gid} and {gid -> {title,index}} for a spreadsheet.
 * - Uses window.__lm_fetchJSONAuth if available (preferred), otherwise falls back to fetch with same signature and expects JSON.
 * - Exposes the API on window.LM_SHEET_GIDMAP for use by non-module scripts.
 */
(() => {
  const TAG = "[gidmap]";
  const cache = new Map(); // spreadsheetId -> { byTitle: Object, byId: Object, fetchedAt: number }

  const getFetcher = () => {
    if (typeof window.__lm_fetchJSONAuth === "function") return window.__lm_fetchJSONAuth;
    // Fallback: emulate __lm_fetchJSONAuth(url, init) -> parsed JSON
    return async (url, init) => {
      const res = await fetch(url, init || {});
      if (!res.ok) throw new Error(`fetch failed ${res.status}`);
      return res.json();
    };
  };

  async function fetchSpreadsheetMeta(spreadsheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title,index))`;
    const fetchJSON = getFetcher();
    return await fetchJSON(url, { method: "GET" });
  }

  function buildMap(meta) {
    const byTitle = Object.create(null);
    const byId = Object.create(null);
    const sheets = (meta && meta.sheets) || [];
    for (const s of sheets) {
      const p = s && s.properties || {};
      const gid = p.sheetId;
      const title = p.title;
      const index = p.index;
      if (typeof gid === "number" && typeof title === "string") {
        byTitle[title] = gid;
        byId[gid] = { title, index };
      }
    }
    return { byTitle, byId, fetchedAt: Date.now() };
  }

  async function fetchSheetMap(spreadsheetId, { force=false } = {}) {
    if (!force && cache.has(spreadsheetId)) return cache.get(spreadsheetId);
    const meta = await fetchSpreadsheetMeta(spreadsheetId);
    const map = buildMap(meta);
    cache.set(spreadsheetId, map);
    console.log(`${TAG} map ready`, { spreadsheetId, count: Object.keys(map.byId).length });
    return map;
  }

  function invalidateMap(spreadsheetId) {
    cache.delete(spreadsheetId);
  }

  async function resolveTitleToGid(spreadsheetId, title, opts={}) {
    const map = await fetchSheetMap(spreadsheetId, opts);
    return map.byTitle[title];
  }

  async function resolveGidToTitle(spreadsheetId, gid, opts={}) {
    const map = await fetchSheetMap(spreadsheetId, opts);
    const ent = map.byId[Number(gid)];
    return ent ? ent.title : undefined;
  }

  // Expose for non-module consumers
  window.LM_SHEET_GIDMAP = {
    fetchSheetMap,
    resolveTitleToGid,
    resolveGidToTitle,
    invalidateMap,
  };
})();
