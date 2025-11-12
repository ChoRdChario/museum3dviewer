// materials.sheet.persist.js — ensure __LM_MATERIALS exists and header is PUT (gid-first aware)
(function(){
  const TAG='[materials]';
  const log=(...a)=>console.log(TAG, ...a);
  const err=(...a)=>console.error(TAG, ...a);
  const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';

  async function authFetch(url, opt={}){
    const tok = typeof window.__lm_getAccessToken==='function' ? await window.__lm_getAccessToken()
              : (await import('./gauth.module.js')).getAccessToken ? await (await import('./gauth.module.js')).getAccessToken()
              : null;
    if (!tok) throw new Error('no token');
    opt.headers = Object.assign({}, opt.headers||{}, { 'Authorization': `Bearer ${tok}`, 'Content-Type':'application/json' });
    return fetch(url, opt);
  }

  async function getSheetsMeta(spreadsheetId){
    const url = `${SHEETS}/${spreadsheetId}?fields=sheets(properties(sheetId,title,index))`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('spreadsheets.get failed '+res.status);
    return res.json();
  }

  async function ensureMaterialsSheet(spreadsheetId){
    const data = await getSheetsMeta(spreadsheetId);
    const sheets = data.sheets||[];
    const has = sheets.find(s => (s.properties||{}).title === '__LM_MATERIALS');
    if (has) return has.properties;
    const body = { requests:[ { addSheet:{ properties:{ title:'__LM_MATERIALS' } } } ] };
    const res = await authFetch(`${SHEETS}/${spreadsheetId}:batchUpdate`, { method:'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error('addSheet __LM_MATERIALS failed '+res.status);
    log('addSheet __LM_MATERIALS -> OK');
    const data2 = await getSheetsMeta(spreadsheetId);
    const found = (data2.sheets||[]).find(s => (s.properties||{}).title==='__LM_MATERIALS');
    return found ? found.properties : null;
  }

  async function putHeader(spreadsheetId){
    const header = [
      ['materialKey','opacity','chromaColor','chromaTolerance','chromaFeather','doubleSided','unlitLike','updatedAt','updatedBy','sheetGid']
    ];
    const range = '__LM_MATERIALS!A1:J1';
    const url = `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const res = await authFetch(url, { method:'PUT', body: JSON.stringify({ range, values: header }) });
    if (!res.ok) throw new Error('values.update header failed '+res.status);
    log('header put A1:J1 -> OK');
    return true;
  }

  let inflight = new Map();
  async function ensureMaterialsHeader(spreadsheetId){
    if (!spreadsheetId) throw new Error('spreadsheetId required');
    if (inflight.has(spreadsheetId)) return inflight.get(spreadsheetId);
    const p = (async ()=>{
      const meta = await getSheetsMeta(spreadsheetId);
      const hasSheet = (meta.sheets||[]).some(s => (s.properties||{}).title==='__LM_MATERIALS');
      if (!hasSheet){
        await ensureMaterialsSheet(spreadsheetId);
        await putHeader(spreadsheetId);
        return true;
      }
      try{
        const url = `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent('__LM_MATERIALS!A1:J1')}`;
        const r = await authFetch(url);
        const j = await r.json();
        const ok = Array.isArray(j.values) && j.values[0] && j.values[0][0]==='materialKey';
        if (!ok){ await putHeader(spreadsheetId); return true; }
        log('ensure header -> SKIP');
        return false;
      }catch(e){
        err('header check failed, retry put', e);
        await putHeader(spreadsheetId);
        return true;
      }
    })();
    inflight.set(spreadsheetId, p);
    try{ return await p; } finally { inflight.delete(spreadsheetId); }
  }

  function forbidAppendToMaterials(range){
    if (!range) return false;
    return /^__LM_MATERIALS!/i.test(range);
  }

  window.__lm_ensureMaterialsHeader = ensureMaterialsHeader;
  window.materialsPersist = { ensureMaterialsHeader, forbidAppendToMaterials };
})();