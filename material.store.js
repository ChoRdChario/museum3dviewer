// material.store.js
/* eslint-disable */
(() => {
  const TAB_TITLE = '__LM_MATERIALS';
  const COLS = ['sheetGid','matUuid','matName','schemaVer','props','updatedAt'];
  const SCHEMA_VER = 1;

  const state = {
    spreadsheetId: null,
    sheetGid: null, // current caption sheet gid
    cache: new Map(), // key = `${sheetGid}:${matUuid}` -> { matName, props }
    sheetIdByTitle: new Map(),
  };

  // ---- Access token helpers ----
  async function getAccessToken(){
    try {
      if (window.__lm_getAccessToken) return await window.__lm_getAccessToken();
      if (window.gauth?.getAccessToken) return await window.gauth.getAccessToken();
      if (window.getAccessToken) return await window.getAccessToken();
    } catch(e){}
    throw new Error('No access token provider found');
  }
  async function authFetch(url, init={}){
    const token = await getAccessToken();
    const headers = Object.assign({'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}, init.headers||{});
    const res = await fetch(url, Object.assign({}, init, { headers }));
    if (!res.ok) {
      const txt = await res.text().catch(()=>'');
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt}`);
    }
    return res;
  }

  // ---- Sheets discovery / creation ----
  async function getSpreadsheet(){
    if (!state.spreadsheetId) throw new Error('spreadsheetId not set');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}?fields=sheets(properties(sheetId,title))`;
    const res = await authFetch(url);
    const json = await res.json();
    state.sheetIdByTitle.clear();
    for (const s of (json.sheets||[])) {
      const p = s.properties || {};
      state.sheetIdByTitle.set(p.title, p.sheetId);
    }
    return json;
  }
  async function ensureMaterialsTab(){
    await getSpreadsheet();
    if (state.sheetIdByTitle.has(TAB_TITLE)) return state.sheetIdByTitle.get(TAB_TITLE);
    // create
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}:batchUpdate`;
    const body = { requests: [{ addSheet: { properties: { title: TAB_TITLE, gridProperties: { frozenRowCount: 1 } } } }] };
    await authFetch(url, { method: 'POST', body: JSON.stringify(body) });
    // header row
    const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(TAB_TITLE)}!A1:F1?valueInputOption=RAW`;
    await authFetch(valuesUrl, { method: 'PUT', body: JSON.stringify({ values: [COLS] }) });
    await getSpreadsheet();
    return state.sheetIdByTitle.get(TAB_TITLE);
  }

  // ---- Public API ----
  async function setCurrentSheetContext({ spreadsheetId, sheetGid }){
    if (spreadsheetId) state.spreadsheetId = spreadsheetId;
    if (sheetGid) state.sheetGid = String(sheetGid);
    try { await loadAllForCurrentSheet(); } catch(e){}
  }

  function keyFor(matUuid){ return `${state.sheetGid||''}:${matUuid}`; }

  async function loadAllForCurrentSheet(){
    if (!state.spreadsheetId || !state.sheetGid) throw new Error('sheet context not set');
    await ensureMaterialsTab();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(TAB_TITLE)}!A2:F`;
    const res = await authFetch(url);
    const json = await res.json();
    state.cache.clear();
    for (const row of (json.values||[])) {
      const [sheetGid, matUuid, matName, schemaVerStr, propsJSON, updatedAt] = row;
      if (String(sheetGid) !== String(state.sheetGid)) continue;
      let props = {};
      try { props = propsJSON ? JSON.parse(propsJSON) : {}; } catch(e){ props = {}; }
      state.cache.set(`${sheetGid}:${matUuid}`, { matName, props, updatedAt, schemaVer: Number(schemaVerStr)||1 });
    }
    return state.cache;
  }

  async function upsertMaterial({ matUuid, matName, props }){
    if (!state.spreadsheetId || !state.sheetGid) throw new Error('sheet context not set');
    await ensureMaterialsTab();
    const gid = String(state.sheetGid);
    const now = new Date().toISOString();

    // read all to find row index
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(TAB_TITLE)}!A2:F`;
    const res = await authFetch(readUrl);
    const json = await res.json();
    let rowIndex = -1;
    let rowOffset = 2;
    (json.values||[]).forEach((row, i)=>{
      if (String(row[0])===gid && String(row[1])===String(matUuid)) rowIndex = rowOffset + i;
    });

    const record = [ gid, String(matUuid), matName || '', '1', JSON.stringify(props||{}), now ];

    if (rowIndex === -1) {
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(TAB_TITLE)}!A:F:append?valueInputOption=RAW`;
      await authFetch(appendUrl, { method:'POST', body: JSON.stringify({ values: [record] }) });
    } else {
      const range = `${TAB_TITLE}!A${rowIndex}:F${rowIndex}`;
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
      await authFetch(updateUrl, { method:'PUT', body: JSON.stringify({ values: [record] }) });
    }
    state.cache.set(`${gid}:${matUuid}`, { matName, props, updatedAt: now, schemaVer: 1 });
    return true;
  }

  function getCachedProps(matUuid){
    const rec = state.cache.get(keyFor(matUuid));
    return rec?.props || {};
  }

  window.lmMaterials = window.lmMaterials || {};
  Object.assign(window.lmMaterials, {
    setCurrentSheetContext,
    loadAllForCurrentSheet,
    upsertMaterial,
    getCachedProps,
    TAB_TITLE,
  });

  window.addEventListener('lm:sheet-changed', (ev)=>{
    const { spreadsheetId, sheetGid } = ev.detail || {};
    setCurrentSheetContext({ spreadsheetId, sheetGid });
  });
})();
