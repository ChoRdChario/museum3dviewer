/* materials.sheet.bridge.js
 * Ensures __LM_MATERIALS sheet & appends/loads rows.
 */
(function(){
  const log=(...a)=>console.log('[mat-sheet]',...a), warn=(...a)=>console.warn('[mat-sheet]',...a), err=(...a)=>console.error('[mat-sheet]',...a);

  const S = {
    spreadsheetId: null,
    sheetId: null,
    title: '__LM_MATERIALS',
    header: ['key','modelKey','materialKey','opacity','doubleSided','unlit','chromaEnable','chromaColor','chromaTolerance','chromaFeather','updatedAt','updatedBy','spreadsheetId','sheetGid'],
  };

  function nowIso(){ return new Date().toISOString(); }

  async function fjson(url, init={}){
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      return window.__lm_fetchJSONAuth(url, init);
    }
    const g = await import('./gauth.module.js');
    const token = await g.getAccessToken({interactive:true});
    init.headers = Object.assign({'Authorization': `Bearer ${token}`}, init.headers||{});
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function gv(base, params){
    const usp = new URLSearchParams(params); return `${base}?${usp.toString()}`;
  }

  async function ensureSheet(){
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');

    // spreadsheet meta
    const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, {includeGridData:false}), {method:'GET'});
    const sheets = meta?.sheets||[];
    let tgt = sheets.find(s=>s?.properties?.title===S.title);
    if (!tgt){
      const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({requests:[{addSheet:{properties:{title:S.title}}}]})
      });
      tgt = res?.replies?.[0]?.addSheet;
      log('sheet created:', S.title);
    }
    S.sheetId = tgt?.properties?.sheetId;

    // header row
    const hdr = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {method:'GET'});
    const row = (hdr?.values && hdr.values[0]) || [];
    const same = S.header.length===row.length && S.header.every((h,i)=>row[i]===h);
    if (!same){
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {valueInputOption:'RAW'}), {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({values:[S.header]})
      });
      log('header initialized');
    }
  }

  async function loadAll(){
    await ensureSheet();
    const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:N')}`, {method:'GET'});
    const rows = res?.values||[];
    const map = new Map();
    for (const r of rows){
      const [key='', modelKey='', materialKey='', opacity='', doubleSided='', unlit='',
             chromaEnable='', chromaColor='', chromaTolerance='', chromaFeather='',
             updatedAt='', updatedBy='', spreadsheetId='', sheetGid=''] = r;
      if (!materialKey) continue;
      map.set(materialKey, {key, modelKey, materialKey, opacity, doubleSided, unlit, chromaEnable, chromaColor, chromaTolerance, chromaFeather, updatedAt, updatedBy, spreadsheetId, sheetGid});
    }
    return map;
  }

  async function upsertOne(item){
    await ensureSheet();
    const row = [
      item.key||item.materialKey||'',
      item.modelKey||'',
      item.materialKey||'',
      item.opacity==null? '' : Number(item.opacity),
      item.doubleSided? '1':'',
      item.unlit? '1':'',
      item.chromaEnable? '1':'',
      item.chromaColor||'',
      item.chromaTolerance==null? '' : Number(item.chromaTolerance),
      item.chromaFeather==null? '' : Number(item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'mat-orch',
      S.spreadsheetId,
      0
    ];

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:N')}:append`;
    const qs  = { valueInputOption:'RAW', insertDataOption:'INSERT_ROWS' };
    await fjson(gv(url, qs), {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ values: [row], majorDimension:'ROWS' })
    });
    log('appended', item.materialKey);
  }

  window.addEventListener('lm:sheet-context', (ev)=>{
    const d = ev?.detail||ev;
    if (!d?.spreadsheetId) { warn('sheet-context missing spreadsheetId'); return; }
    S.spreadsheetId = d.spreadsheetId;
    log('sheet-context bound:', S.spreadsheetId, 'gid=', d.sheetGid||0);
  }, {once:false});

  window.materialsSheetBridge = { ensureSheet, loadAll, upsertOne, config: S };
})();