/* materials.sheet.persist.js v1.0
 * Persist per-material opacity to Google Sheets (__LM_MATERIALS).
 * Requires: window.__lm_fetchJSONAuth (from boot.esm.cdn.js), gauth token scoped for spreadsheets.
 * Listens to:
 *   - 'lm:sheet-context' for { spreadsheetId }
 *   - 'lm:mat-opacity-change' custom event { name, opacity }  (fired by orchestrator or this script's UI hooks)
 * Fallback: If orchestrator doesn't dispatch, this script also wires #pm-material, #pm-range directly.
 */
(function(){
  const TAG='[mat-sheet-persist v1.0]';
  console.log(TAG,'loaded');
  const STATE = {
    spreadsheetId: null,
    sheetName: '__LM_MATERIALS',
    headers: ['materialKey','opacity','updatedAt','updatedBy'],
    colIndex: {materialKey:0, opacity:1, updatedAt:2, updatedBy:3},
    ready: false,
  };

  // Util: safe fetch via __lm_fetchJSONAuth
  async function gfetch(url, init){
    const fx = window.__lm_fetchJSONAuth || window.__lm_fetchJSON;
    if(!fx){ throw new Error('__lm_fetchJSONAuth not present'); }
    const res = await fx(url, init);
    return res;
  }

  function fmtNow(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // Ensure target sheet exists with headers
  async function ensureSheet(){
    if(!STATE.spreadsheetId) return;
    // get sheets list
    const meta = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}?fields=sheets.properties`);
    const exists = (meta.sheets||[]).some(s=>s.properties && s.properties.title===STATE.sheetName);
    if(!exists){
      console.log(TAG,'creating sheet', STATE.sheetName);
      await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}:batchUpdate`, {
        method:'POST',
        body: JSON.stringify({requests:[{addSheet:{properties:{title:STATE.sheetName}}}]})
      });
      // write headers
      await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}/values/${encodeURIComponent(STATE.sheetName+'!A1:D1')}:update?valueInputOption=USER_ENTERED`, {
        method:'PUT',
        body: JSON.stringify({range: `${STATE.sheetName}!A1:D1`, values: [STATE.headers]})
      });
    }
    STATE.ready = true;
  }

  async function upsertOpacity(materialName, opacity){
    if(!STATE.spreadsheetId){ console.warn(TAG,'no spreadsheetId'); return; }
    if(!STATE.ready){ await ensureSheet(); }
    const sheet = STATE.sheetName;
    // fetch all current values (small table expected)
    const vals = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}/values/${encodeURIComponent(sheet)}?majorDimension=ROWS`);
    const rows = vals.values || [];
    // find header row
    let startRow = 1;
    if(rows.length === 0 || rows[0][0] !== STATE.headers[0]){
      // headers missing -> set
      await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}/values/${encodeURIComponent(sheet+'!A1:D1')}:update?valueInputOption=USER_ENTERED`, {
        method:'PUT',
        body: JSON.stringify({range:`${sheet}!A1:D1`, values:[STATE.headers]})
      });
    }
    // search for materialName
    let rowIndex = -1;
    for(let i=1;i<rows.length;i++){
      if((rows[i][0]||'') === materialName){ rowIndex = i; break; }
    }
    const updatedAt = fmtNow();
    const updatedBy = (window.__LM_USER_EMAIL || window.__LM_USER_NAME || 'anonymous');
    if(rowIndex === -1){
      // append
      const body = {
        values: [[materialName, String(opacity), updatedAt, updatedBy]]
      };
      await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}/values/${encodeURIComponent(sheet+'!A2:D2')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
        method:'POST',
        body: JSON.stringify(body)
      });
      console.log(TAG,'appended', materialName, opacity);
    }else{
      // update specific row
      const range = `${sheet}!A${rowIndex+1}:D${rowIndex+1}`;
      await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${STATE.spreadsheetId}/values/${encodeURIComponent(range)}:update?valueInputOption=USER_ENTERED`, {
        method:'PUT',
        body: JSON.stringify({range, values:[[materialName, String(opacity), updatedAt, updatedBy]]})
      });
      console.log(TAG,'updated', materialName, opacity, 'at row', rowIndex+1);
    }
  }

  // Listen: sheet context
  window.addEventListener('lm:sheet-context', (e)=>{
    const { spreadsheetId } = e.detail || {};
    if(spreadsheetId){
      STATE.spreadsheetId = spreadsheetId;
      console.log(TAG,'sheet bound', spreadsheetId);
      STATE.ready = false;
      ensureSheet().catch(err=>console.warn(TAG,'ensureSheet',err));
    }
  });

  // Listen: explicit opacity change event
  window.addEventListener('lm:mat-opacity-change', (e)=>{
    const { name, opacity } = e.detail || {};
    if(!name || typeof opacity!=='number'){ return; }
    upsertOpacity(name, opacity).catch(err=>console.warn(TAG,'persist',err));
  });

  // Fallback wiring: if orchestrator didn't emit custom event, tap UI directly
  function wireUIFallback(){
    const sel = document.querySelector('#pm-material') || document.querySelector('#pm-opacity select');
    const range = document.querySelector('#pm-range') || document.querySelector('#pm-opacity input[type="range"]');
    if(!sel || !range){ return false; }
    sel.addEventListener('change', ()=>{
      const name = sel.value;
      if(!name) return;
      const val = Number(range.value);
      window.dispatchEvent(new CustomEvent('lm:mat-opacity-change', {detail:{name, opacity: val}}));
    }, {passive:true});
    range.addEventListener('input', ()=>{
      const name = (sel && sel.value) || '';
      if(!name) return;
      const val = Number(range.value);
      window.dispatchEvent(new CustomEvent('lm:mat-opacity-change', {detail:{name, opacity: val}}));
    }, {passive:true});
    console.log(TAG,'fallback UI wiring armed');
    return true;
  }

  // small retry to wait DOM
  (async ()=>{
    for(let i=0;i<8;i++){
      if(wireUIFallback()) break;
      await new Promise(r=>setTimeout(r, 200*(i+1)));
    }
  })();

})();