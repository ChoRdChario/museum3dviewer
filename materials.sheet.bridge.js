/*! materials.sheet.bridge.js - v1.1 (hotfix)
 * Syncs per-material settings to the __LM_MATERIALS sheet.
 * Requires: window.__lm_fetchJSONAuth (provided by boot hotfix), Sheets scope.
 */
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);

  // current sheet context
  window.__lm_sheet_ctx = window.__lm_sheet_ctx || { spreadsheetId:null, sheetGid:null };

  // listen for context broadcast
  window.addEventListener('lm:sheet-context', (e)=>{
    const {spreadsheetId, sheetGid} = (e.detail||{});
    if(spreadsheetId){ window.__lm_sheet_ctx.spreadsheetId = spreadsheetId; }
    if(sheetGid!==undefined){ window.__lm_sheet_ctx.sheetGid = sheetGid; }
    log('sheet-context bound:', window.__lm_sheet_ctx.spreadsheetId, 'gid=', window.__lm_sheet_ctx.sheetGid);
  });

  function ctx(){
    return window.__lm_sheet_ctx || {};
  }

  // debounced append
  let timer=null, last=null;
  function scheduleAppend(payload){
    last = payload;
    clearTimeout(timer);
    timer = setTimeout(()=>appendRow(last), 600);
  }

  async function appendRow(p){
    const {spreadsheetId, sheetGid, materialKey, opacity, updatedAt, updatedBy} = p||{};
    if(!(spreadsheetId && materialKey)){
      return warn('append skipped - missing ctx/material', p);
    }
    if(typeof window.__lm_fetchJSONAuth !== 'function'){
      return warn('__lm_fetchJSONAuth missing; cannot write to Sheets');
    }
    const key = `${spreadsheetId}:${Number.isFinite(+sheetGid)? sheetGid : 'NOGID'}:${materialKey}`;
    const values = [[
      key,            // A: key
      '',             // B: modelKey (optional in future)
      materialKey,    // C
      (opacity ?? ''),// D opacity (0 must be preserved)
      '',             // E doubleSided
      '',             // F unlit
      '',             // G chromaEnable
      '',             // H chromaColor
      '',             // I chromaTolerance
      '',             // J chromaFeather
      updatedAt || new Date().toISOString(), // K updatedAt
      updatedBy || 'local',                  // L updatedBy
      spreadsheetId,                         // M spreadsheetId
      sheetGid ?? ''                          // N sheetGid
    ]];

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/__LM_MATERIALS:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    try{
      const res = await window.__lm_fetchJSONAuth(url, {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ values })
      });
      log('append ok', res?.updates?.updatedRange || '');
    }catch(err){
      warn('append failed', err);
    }
  }

  // react to local save events from material.state.local.v1.js
  window.addEventListener('lm:material-state-saved-local', (e)=>{
    const d = e.detail||{};
    scheduleAppend(d);
  });

  // also react to orchestrator's direct change event if state module is bypassed
  window.addEventListener('lm:material-opacity-changed', (e)=>{
    const d = e.detail||{};
    scheduleAppend(d);
  });

  log('armed');
})();
