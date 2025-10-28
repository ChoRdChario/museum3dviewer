// material.store.js v20251029
// Step3: Sheets-backed material props store (opacity first).
// Public API on window.lmMaterials:
//   - setCurrentSheetContext({ spreadsheetId, sheetGid })
//   - saveOpacity(matUuid, matName, opacity)
//   - getCurrentContext()
//   - ensureSheet()  // creates __LM_MATERIALS with header if missing
//   - preload()      // fetch cache for current sheet
(function() {
  'use strict';
  const SHEET_NAME = '__LM_MATERIALS';
  const HEADERS = ['sheetGid','matUuid','matName','schemaVer','props','updatedAt'];
  const SCHEMA_VER = 1;

  const state = {
    ctx: null, // { spreadsheetId, sheetGid }
    cache: new Map(), // key: matUuid -> {row, props, matName}
    ready: false,
  };

  function log(...a){ console.debug('[lmMaterials]', ...a); }
  function nowIso(){ return new Date().toISOString(); }

  async function getAccessToken(){
    if (window.__lm_getAccessToken) return await window.__lm_getAccessToken();
    if (window.gauth?.getAccessToken) return await window.gauth.getAccessToken();
    throw new Error('No access token provider');
  }
  async function authFetch(url, init={}){
    const token = await getAccessToken();
    const headers = Object.assign({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }, init.headers||{});
    const res = await fetch(url, Object.assign({ method:'GET' }, init, { headers }));
    const text = await res.text();
    let json=null; try{ json = text ? JSON.parse(text) : null; }catch{}
    return { ok: res.ok, status: res.status, statusText: res.statusText, text, json };
  }

  async function ensureSheet(){
    const { spreadsheetId } = state.ctx || {};
    if (!spreadsheetId) throw new Error('ensureSheet: no spreadsheetId');
    // List sheets
    const meta = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title,sheetId))`);
    if (!meta.ok) throw new Error('meta failed '+meta.status);
    const titles = (meta.json?.sheets||[]).map(s=>s.properties?.title);
    if (!titles.includes(SHEET_NAME)){
      // add sheet
      const bu = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method:'POST',
        body: JSON.stringify({
          requests:[{ addSheet: { properties: { title:SHEET_NAME, gridProperties: { frozenRowCount:1 } } } }]
        })
      });
      if (!bu.ok) throw new Error('addSheet failed '+bu.status);
      // header
      const hdr = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A1:F1?valueInputOption=RAW`, {
        method:'PUT',
        body: JSON.stringify({ values:[HEADERS] })
      });
      if (!hdr.ok) throw new Error('header write failed '+hdr.status);
    }
    return true;
  }

  function makeKey(sheetGid, matUuid){ return String(sheetGid)+'::'+String(matUuid); }

  async function preload(){
    state.cache.clear();
    const { spreadsheetId, sheetGid } = state.ctx || {};
    if (!spreadsheetId || (sheetGid===undefined)) return false;
    await ensureSheet();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A2:F`;
    const r = await authFetch(url);
    if (!r.ok) throw new Error('preload failed '+r.status);
    const rows = r.json?.values || [];
    rows.forEach((arr, idx)=>{
      const g = arr[0]; const mu = arr[1]; const mn = arr[2]; const props = arr[4];
      if (String(g) !== String(sheetGid)) return;
      let parsed={}; try{ parsed = props ? JSON.parse(props) : {}; }catch{ parsed={}; }
      state.cache.set(String(mu), { row: idx+2, matName: mn, props: parsed });
    });
    state.ready = true;
    return true;
  }

  async function upsert(matUuid, matName, nextProps){
    const { spreadsheetId, sheetGid } = state.ctx || {};
    if (!spreadsheetId || (sheetGid===undefined)) throw new Error('upsert: context not set');
    await ensureSheet();
    if (!state.ready) await preload();

    const key = String(matUuid);
    const cached = state.cache.get(key);
    const merged = Object.assign({}, (cached?.props||{}), nextProps||{});
    const rowVals = [ String(sheetGid), String(matUuid), String(matName||''), String(SCHEMA_VER), JSON.stringify(merged), nowIso() ];

    if (cached?.row){
      // update in-place
      const range = `${SHEET_NAME}!A${cached.row}:F${cached.row}`;
      const put = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
        method:'PUT',
        body: JSON.stringify({ values:[rowVals] })
      });
      if (!put.ok) throw new Error('update failed '+put.status);
    } else {
      // append
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME)}!A:F:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const app = await authFetch(appendUrl, { method:'POST', body: JSON.stringify({ values:[rowVals] }) });
      if (!app.ok) throw new Error('append failed '+app.status);
    }
    // refresh cache entry
    state.cache.set(key, { row: cached?.row || NaN, matName, props: merged });
    return true;
  }

  async function saveOpacity(matUuid, matName, opacity){
    const v = Number(opacity);
    const bounded = isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    return await upsert(matUuid, matName, { opacity: bounded });
  }

  function setCurrentSheetContext(ctx){
    if (!ctx || !ctx.spreadsheetId || ctx.sheetGid===undefined) throw new Error('bad ctx');
    state.ctx = { spreadsheetId: ctx.spreadsheetId, sheetGid: ctx.sheetGid };
    state.ready = false;
  }

  window.lmMaterials = Object.freeze({
    setCurrentSheetContext,
    getCurrentContext: () => state.ctx,
    ensureSheet,
    preload,
    saveOpacity
  });
})();
