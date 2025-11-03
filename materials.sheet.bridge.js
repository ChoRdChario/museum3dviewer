
/* materials.sheet.bridge.js — minimal sheet bridge with cache helpers
 * Exposes: getOne(materialKey), upsertOne({materialKey, opacity, updatedAt}), loadAll()
 */
(function(){
  const log = (...a)=>console.log('[mat-sheet]', ...a);
  const CACHE_TTL_MS = 1500;
  const g = window.materialsSheetBridge = window.materialsSheetBridge || {};

  let _ctx = { spreadsheetId: null, sheetGid: 0 };
  let _cache = { at: 0, map: new Map() };

  g.bindContext = function(spreadsheetId, sheetGid){
    _ctx = { spreadsheetId, sheetGid: sheetGid ?? 0 };
    log('sheet-context bound:', spreadsheetId, 'gid=', _ctx.sheetGid);
  };

  async function fetchAllRows(){
    // Placeholder: expect host app to implement fetch to Google Sheets JSON
    // Here we keep the interface; host will overwrite g.loadAll if it already exists.
    return Array.from(_cache.map.entries()).map(([k,v])=>({ materialKey:k, ...v }));
  }

  g.loadAll = g.loadAll || async function(){
    const now = Date.now();
    if (now - _cache.at < CACHE_TTL_MS) return _cache.map;
    const rows = await fetchAllRows();
    const map = new Map();
    rows.forEach(r=>{ if (r.materialKey) map.set(r.materialKey, r); });
    _cache = { at: now, map };
    return map;
  };

  g.getOne = g.getOne || async function(materialKey){
    const map = await g.loadAll();
    return map.get(materialKey) || null;
  };

  g.upsertOne = g.upsertOne || async function({materialKey, opacity, updatedAt}){
    // Placeholder: the real app will implement persistence via Google Sheets API
    // We simulate local cache update so that subsequent getOne returns the new value.
    const map = await g.loadAll();
    map.set(materialKey, { materialKey, opacity, updatedAt });
    _cache = { at: Date.now(), map };
    log('appended', materialKey);
    return true;
  };
})();
