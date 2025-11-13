
// [caption.sheet.bridge] Phase A1 — Sheets persistence for caption rows (single active sheet)
// - Listens to lm:sheet-context (spreadsheetId + sheetGid)
// - Ensures header row on the active caption sheet
// - Loads existing captions into __LM_CAPTION_UI
// - Appends newly added captions (Shift+Click) to the sheet
(function(){
  const TAG='[caption.sheet.bridge]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);
  const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';

  const HEADER = ['id','title','body','color','posX','posY','posZ','imageFileId','createdAt','updatedAt'];

  let ctx = { spreadsheetId:'', sheetGid:'', sheetTitle:'' };
  let uiPromise = null;

  // --- auth helper (prefers __lm_fetchJSONAuth) -------------------------------
  async function authJSON(url, init){
    // 1) Prefer app-wide authorized fetch wrapper, if present
    if (typeof window.__lm_fetchJSONAuth === 'function'){
      return window.__lm_fetchJSONAuth(url, init||{});
    }

    // 2) Try to install auth.fetch.bridge.js lazily
    try{
      const mod = await import('./auth.fetch.bridge.js');
      const ensure = (mod && (mod.default || mod.ensureAuthBridge));
      if (ensure){
        const fn = await ensure();
        if (typeof fn === 'function'){
          return fn(url, init||{});
        }
      }
    }catch(e){
      warn('auth.fetch.bridge import failed', e);
    }

    // 3) Fallback: raw GIS token
    let tok = null;
    try{
      const g = await import('./gauth.module.js');
      if (typeof g.getAccessToken === 'function'){
        tok = await g.getAccessToken();
      }
    }catch(e){
      warn('gauth import failed', e);
    }
    if (!tok) throw new Error(TAG+' no auth available for Sheets API');

    const opt = Object.assign({}, init||{});
    const headers = Object.assign({}, opt.headers||{}, {
      'Authorization': `Bearer ${tok}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    });
    opt.headers = headers;
    const res = await fetch(url, opt);
    if (!res.ok){
      const text = await res.text().catch(()=> '');
      throw new Error(TAG+` fetch failed ${res.status} ${text.slice(0,256)}`);
    }
    if (opt.rawResponse) return res;
    return res.json();
  }

  // --- caption UI access ------------------------------------------------------
  function waitCaptionUI(){
    if (uiPromise) return uiPromise;
    uiPromise = new Promise(resolve=>{
      if (window.__LM_CAPTION_UI) return resolve(window.__LM_CAPTION_UI);
      let tries = 0;
      const timer = setInterval(()=>{
        if (window.__LM_CAPTION_UI){
          clearInterval(timer);
          resolve(window.__LM_CAPTION_UI);
        }else if (++tries > 100){
          clearInterval(timer);
          warn('caption UI not ready');
          resolve(null);
        }
      }, 100);
    });
    return uiPromise;
  }

  // --- sheet title resolution -------------------------------------------------
  async function resolveSheetTitle(spreadsheetId, sheetGid){
    if (!spreadsheetId) return null;
    const gid = sheetGid && String(sheetGid).trim();
    try{
      const NS = window.LM_SHEET_GIDMAP;
      if (NS && typeof NS.fetchSheetMap === 'function'){
        const map = await NS.fetchSheetMap(spreadsheetId);
        if (gid && map && map.byId){
          const hit = map.byId[Number(gid)];
          if (hit && hit.title) return hit.title;
        }
        // fallback: explicit 'Captions' sheet if present
        if (map && map.byTitle && map.byTitle['Captions']){
          return 'Captions';
        }
        // otherwise pick first non-__LM_MATERIALS
        if (map && map.byTitle){
          const keys = Object.keys(map.byTitle).filter(t=>t && t!=='__LM_MATERIALS');
          if (keys.length) return keys[0];
        }
      }
    }catch(e){
      warn('resolveSheetTitle via gid map failed', e);
    }
    // final fallback
    return 'Captions';
  }

  // --- header ensure / fetch helpers -----------------------------------------
  function buildRange(sheetTitle, a1){
    const safeTitle = String(sheetTitle||'').replace(/'/g, "''");
    return `'${safeTitle}'!${a1}`;
  }

  async function ensureHeader(spreadsheetId, sheetTitle){
    const range = buildRange(sheetTitle, 'A1:J1');
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    let needPut = false;
    try{
      const j = await authJSON(url);
      const v = (j && j.values && j.values[0]) || [];
      const ok = HEADER.every((h,i)=> v[i] === h);
      if (!ok) needPut = true;
    }catch(e){
      // 404 / missing range → PUT header
      needPut = true;
    }
    if (!needPut) return true;

    const putUrl = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const body = { values: [HEADER] };
    await authJSON(putUrl, { method:'PUT', body: JSON.stringify(body), rawResponse:true });
    log('header put', range);
    return true;
  }

  async function fetchRows(spreadsheetId, sheetTitle){
    await ensureHeader(spreadsheetId, sheetTitle);
    const range = buildRange(sheetTitle, 'A2:J');
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const j = await authJSON(url);
    return (j && j.values) || [];
  }

  function rowsToItems(rows){
    const items = [];
    for (let i=0;i<rows.length;i++){
      const r = rows[i] || [];
      const [id,title,body,color,px,py,pz,imageFileId,createdAt,updatedAt] = r;
      let pos = null;
      const nx = Number(px), ny = Number(py), nz = Number(pz);
      if (px!==undefined && py!==undefined && pz!==undefined &&
          Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)){
        pos = { x:nx, y:ny, z:nz };
      }
      items.push({
        id: id || null,
        title: title || '',
        body: body || '',
        color: color || '#eab308',
        pos,
        imageFileId: imageFileId || null,
        createdAt: createdAt || null,
        updatedAt: updatedAt || null,
        rowIndex: i+2, // 1-based, header = 1
      });
    }
    return items;
  }

  function itemToRow(item){
    const now = new Date().toISOString();
    const pos = item.pos || {};
    const px = (typeof pos.x === 'number') ? pos.x : '';
    const py = (typeof pos.y === 'number') ? pos.y : '';
    const pz = (typeof pos.z === 'number') ? pos.z : '';
    const id = item.id || ('c_'+Math.random().toString(36).slice(2,10));
    const createdAt = item.createdAt || now;
    const updatedAt = now;
    return {
      row: [id, item.title||'', item.body||'', item.color||'#eab308', px, py, pz,
            item.image && item.image.id || item.imageFileId || '',
            createdAt, updatedAt],
      id,
      createdAt,
      updatedAt,
    };
  }

  async function appendRow(spreadsheetId, sheetTitle, item){
    const { row, id, createdAt, updatedAt } = itemToRow(item);
    const range = buildRange(sheetTitle, 'A2:J');
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await authJSON(url, { method:'POST', body: JSON.stringify({ values:[row] }), rawResponse:true });
    item.id = id;
    item.createdAt = createdAt;
    item.updatedAt = updatedAt;
    log('append row', id);
  }

  // --- main: sheet-context handler -------------------------------------------
  async function handleSheetContext(detail){
    const spreadsheetId = String(detail.spreadsheetId||'');
    let sheetGid = detail.sheetGid;
    if (sheetGid===undefined || sheetGid===null) sheetGid='';
    sheetGid = String(sheetGid);

    ctx = { spreadsheetId, sheetGid, sheetTitle:'' };

    if (!spreadsheetId){
      warn('sheet-context without spreadsheetId', detail);
      return;
    }

    const title = await resolveSheetTitle(spreadsheetId, sheetGid);
    ctx.sheetTitle = title || 'Captions';
    window.__LM_ACTIVE_SPREADSHEET_ID = spreadsheetId;
    window.__LM_ACTIVE_SHEET_GID = sheetGid;

    log('sheet-context', ctx);

    try{
      const rows = await fetchRows(spreadsheetId, ctx.sheetTitle);
      const items = rowsToItems(rows);
      const ui = await waitCaptionUI();
      if (ui && typeof ui.setItems === 'function'){
        ui.setItems(items);
      }else{
        warn('caption UI missing setItems');
      }
      // subscribe for new additions (Shift+Click)
      if (ui && typeof ui.onItemAdded === 'function'){
        ui.onItemAdded(it=>{
          if (!ctx.spreadsheetId || !ctx.sheetTitle) return;
          appendRow(ctx.spreadsheetId, ctx.sheetTitle, it).catch(e=>warn('append failed', e));
        });
      }
    }catch(e){
      warn('load captions failed', e);
    }
  }

  function onSheetContext(evt){
    const d = (evt && evt.detail) || {};
    handleSheetContext(d);
  }

  window.addEventListener('lm:sheet-context', onSheetContext);
  log('armed');
})();
