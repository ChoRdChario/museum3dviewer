// dev/material.debug.diag.js
/* eslint-disable */
(() => {
  const ns = (window.lmDiag = window.lmDiag || {});
  const log = (...a)=>console.log('%c[lmDiag]', 'color:#4ea1ff', ...a);
  const warn = (...a)=>console.warn('[lmDiag]', ...a);
  const err = (...a)=>console.error('[lmDiag]', ...a);

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
    const text = await res.text();
    let json=null; try{ json = text ? JSON.parse(text) : null; }catch{}
    return { ok: res.ok, status: res.status, statusText: res.statusText, text, json };
  }

  function getSceneRoot(){ return window.viewer?.getSceneRoot?.() || window.__LM_SCENE || window.scene || null; }
  function getModelRoot(){
    const via = window.viewer?.getModelRoot?.();
    if (via) return via;
    const r = getSceneRoot(); if (!r) return null;
    let best=null, cnt=-1;
    for (const c of r.children||[]) {
      if (c?.userData?.gltfAsset) return c;
      let k=0; c.traverse(o=>{ if (o.isMesh||o.type==='Mesh') k++; });
      if (k>cnt){ cnt=k; best=c; }
    }
    return best || r;
  }
  function listModelMaterials(){
    const mats = [];
    const root = getModelRoot();
    if (!root || !root.traverse){ warn('No model root'); return []; }
    root.traverse((o)=>{
      const m = o.material;
      if (!m) return;
      const push = (mm)=> mats.push({ uuid:mm.uuid, name:mm.name||'', obj:o.name||'', type:mm.type, transparent:mm.transparent, opacity:mm.opacity });
      if (Array.isArray(m)) m.forEach(push); else push(m);
    });
    return mats;
  }

  ns.materials = {
    report(){
      const rootTab = document.querySelector('#tab-material, [role="tabpanel"]#tab-material, .lm-tabpanel#tab-material');
      const sel = document.querySelector('#pm-material');
      const rng = document.querySelector('#pm-opacity-range');
      log('UI mounts:', { rootTabFound: !!rootTab, sel: !!sel, rng: !!rng, rootTab });
      const mats = listModelMaterials();
      log('Model materials (uuid/name/obj/type/opacity):', mats);
      return mats;
    },
    async testSheetsCreate(spreadsheetId){
      try{
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
        const meta = await authFetch(url);
        if (!meta.ok){ err('Spreadsheet meta fetch failed', meta); return meta; }
        const titles = (meta.json?.sheets||[]).map(s=>s.properties?.title);
        log('Existing tabs:', titles);
        if (!titles.includes('__LM_MATERIALS')){
          const bu = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
          const body = { requests:[{ addSheet:{ properties:{ title:'__LM_MATERIALS', gridProperties:{ frozenRowCount:1 } } } }] };
          const r1 = await authFetch(bu, { method:'POST', body: JSON.stringify(body) });
          if (!r1.ok){ err('addSheet failed', r1); return r1; }
          const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('__LM_MATERIALS')}!A1:F1?valueInputOption=RAW`;
          const r2 = await authFetch(headerUrl, { method:'PUT', body: JSON.stringify({ values:[['sheetGid','matUuid','matName','schemaVer','props','updatedAt']] }) });
          if (!r2.ok){ err('header write failed', r2); return r2; }
          log('Created __LM_MATERIALS & wrote header');
        } else {
          log('__LM_MATERIALS already exists');
        }
        return { ok:true };
      }catch(e){
        err(e);
        return { ok:false, error: String(e) };
      }
    },
    async dryRunUpsert(spreadsheetId, sheetGid, matUuid = null, props = {opacity:0.5}){
      const now = new Date().toISOString();
      const mats = listModelMaterials();
      const pick = matUuid || (mats[0] && mats[0].uuid);
      const matName = (mats.find(m=>m.uuid===pick)?.name) || '';
      const record = [ String(sheetGid), String(pick), matName, '1', JSON.stringify(props||{}), now ];
      log('Dry-run record:', record);
      return { record, pick, matName };
    }
  };
})();