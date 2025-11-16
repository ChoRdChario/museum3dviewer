// [caption.sheet.bridge] Phase A1’+A2 — Sheets persistence for caption rows (single active sheet, gid-based)
// - Listens to lm:sheet-context (spreadsheetId + sheetGid [+ sheetTitle])
// - Resolves sheet title from gid via LM_SHEET_GIDMAP (or uses provided sheetTitle)
// - Ensures header row on the active caption sheet
// - Loads existing captions into __LM_CAPTION_UI
// - Appends newly added captions (Shift+Click) to the sheet
// - Updates title/body edits back to the same row
// - Soft delete: blank out row when UI deletes an item (id empty rows are skipped on reload)
(function(){
  const TAG='[caption.sheet.bridge]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);
  const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';

  const HEADER = ['id','title','body','color','posX','posY','posZ','imageFileId','createdAt','updatedAt'];

  // ctx.sheetTitle は「今この UI がバインドしているシート名」
  let ctx = { spreadsheetId:'', sheetGid:'', sheetTitle:'', nextRowIndex:2 };
  let uiPromise = null;
  let addedHookBound = false;
  let changedHookBound = false;
  let deletedHookBound = false;

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

    // 3) Fallback: use gauth.module.js directly
    try{
      const gmod = await import('./gauth.module.js');
      const tok = await gmod.getAccessToken();
      if (!tok) throw new Error('no token from gauth');
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
    }catch(e){
      warn('fallback auth failed', e);
      throw e;
    }
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

  // --- sheet title resolution (gid -> title) ---------------------------------
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
          const titles = Object.keys(map.byTitle);
          const hit2 = titles.find(t=>t && t !== '__LM_MATERIALS');
          if (hit2) return hit2;
        }
      }
    }catch(e){
      warn('resolveSheetTitle via gid map failed', e);
    }
    return null;
  }

  function buildRange(sheetTitle, a1){
    const safeTitle = sheetTitle.replace(/'/g,"''");
    return `'${safeTitle}'!${a1}`;
  }

  // --- header ensure ----------------------------------------------------------
  async function ensureHeader(spreadsheetId, sheetTitle){
    if (!spreadsheetId || !sheetTitle) return;
    const range = buildRange(sheetTitle, 'A1:J1');
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const body = { values:[HEADER] };
    await authJSON(url, { method:'PUT', body: JSON.stringify(body), rawResponse:true });
    log('header ensured for', sheetTitle);
  }

  // --- load rows --------------------------------------------------------------
  async function loadRows(spreadsheetId, sheetTitle){
    const range = buildRange(sheetTitle, 'A2:J');
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const json = await authJSON(url, { method:'GET' });
    const rows = (json && json.values) || [];
    return rowsToItems(rows);
  }

  function rowsToItems(rows){
    const items = [];
    for (let i=0;i<rows.length;i++){
      const r = rows[i] || [];
      const rowIndex = i+2; // 1-based, header = 1
      const [id,title,body,color,px,py,pz,imageFileId,createdAt,updatedAt] = r;
      const idCell = (id && String(id).trim()) || '';
      if (!idCell){
        // id が空の行は「削除済み」とみなしてスキップ
        continue;
      }
      let pos = null;
      const nx = Number(px), ny = Number(py), nz = Number(pz);
      if (px!==undefined && py!==undefined && pz!==undefined &&
          Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)){
        pos = { x:nx, y:ny, z:nz };
      }
      items.push({
        id: idCell,
        title: title || '',
        body: body || '',
        color: color || '#eab308',
        pos,
        imageFileId: imageFileId || null,
        createdAt: createdAt || null,
        updatedAt: updatedAt || null,
        rowIndex,
      });
    }
    return items;
  }

  function itemToRow(item, mode){
    const now = new Date().toISOString();
    const pos = item.pos || {};
    const px = (typeof pos.x === 'number') ? pos.x : '';
    const py = (typeof pos.y === 'number') ? pos.y : '';
    const pz = (typeof pos.z === 'number') ? pos.z : '';
    const id = item.id || ('c_'+Math.random().toString(36).slice(2,10));
    let createdAt = item.createdAt;
    if (!createdAt || mode === 'append'){
      createdAt = createdAt || now;
    }
    const updatedAt = now;
    return {
      row: [
        id,
        item.title||'',
        item.body||'',
        item.color||'#eab308',
        px, py, pz,
        item.imageFileId || '',
        createdAt,
        updatedAt,
      ],
      id,
      createdAt,
      updatedAt,
    };
  }

  async function appendRow(spreadsheetId, sheetTitle, item){
    const { row, id, createdAt, updatedAt } = itemToRow(item, 'append');
    const range = buildRange(sheetTitle, 'A2:J');
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await authJSON(url, { method:'POST', body: JSON.stringify({ values:[row] }), rawResponse:true });

    const rowIndex = ctx.nextRowIndex || (item.rowIndex || 2);
    ctx.nextRowIndex = rowIndex + 1;

    item.id = id;
    item.createdAt = createdAt;
    item.updatedAt = updatedAt;
    item.rowIndex = rowIndex;

    log('append row', id, 'row', rowIndex);
  }

  async function updateRow(spreadsheetId, sheetTitle, item){
    if (!item || !item.id || !item.rowIndex){
      // rowIndex が無い場合は安全のため append にフォールバック
      return appendRow(spreadsheetId, sheetTitle, item);
    }
    const { row, createdAt, updatedAt } = itemToRow(item, 'update');
    const rowIndex = item.rowIndex;
    const a1 = `A${rowIndex}:J${rowIndex}`;
    const range = buildRange(sheetTitle, a1);
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    await authJSON(url, { method:'PUT', body: JSON.stringify({ values:[row] }), rawResponse:true });
    item.createdAt = createdAt || item.createdAt;
    item.updatedAt = updatedAt;
    log('update row', item.id, 'row', rowIndex);
  }

  async function softDeleteRow(spreadsheetId, sheetTitle, item){
    if (!item || !item.rowIndex){
      // rowIndex を持たないものは安全のためなにもしない
      return;
    }
    const rowIndex = item.rowIndex;
    const blanks = new Array(HEADER.length).fill('');
    const a1 = `A${rowIndex}:J${rowIndex}`;
    const range = buildRange(sheetTitle, a1);
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    await authJSON(url, { method:'PUT', body: JSON.stringify({ values:[blanks] }), rawResponse:true });
    log('soft delete row', item.id, 'row', rowIndex);
  }

  // --- main: sheet-context handler -------------------------------------------
  async function handleSheetContext(detail){
    const spreadsheetId = String(detail.spreadsheetId || '');
    let sheetGid = detail.sheetGid != null ? String(detail.sheetGid) : '';
    let sheetTitle = detail.sheetTitle || '';

    if (!spreadsheetId){
      warn('no spreadsheetId in sheet-context; skip');
      return;
    }

    ctx.spreadsheetId = spreadsheetId;
    ctx.sheetGid     = sheetGid;
    ctx.sheetTitle   = '';
    ctx.nextRowIndex = 2;

    if (!sheetTitle){
      sheetTitle = await resolveSheetTitle(spreadsheetId, sheetGid) || 'Captions';
    }

    ctx.sheetTitle = sheetTitle;

    try{
      await ensureHeader(spreadsheetId, sheetTitle);
    }catch(e){
      warn('ensureHeader failed', e);
    }

    try{
      const items = await loadRows(spreadsheetId, sheetTitle);
      ctx.nextRowIndex = (items.reduce((max, it)=>Math.max(max, it.rowIndex||2), 1) || 1) + 1;

      const ui = await waitCaptionUI();
      if (!ui){
        warn('no caption UI; rows loaded but not bound');
        return;
      }
      if (typeof ui.setItems === 'function'){
        ui.setItems(items);
      }else{
        warn('caption UI missing setItems');
      }

      if (ui){
        // subscribe for new additions (Shift+Click)
        if (typeof ui.onItemAdded === 'function' && !addedHookBound){
          ui.onItemAdded(it=>{
            if (!ctx.spreadsheetId || !ctx.sheetTitle) return;
            appendRow(ctx.spreadsheetId, ctx.sheetTitle, it).catch(e=>warn('append failed', e));
          });
          addedHookBound = true;
        }
        // subscribe for edits (title/body)
        if (typeof ui.onItemChanged === 'function' && !changedHookBound){
          ui.onItemChanged(it=>{
            if (!ctx.spreadsheetId || !ctx.sheetTitle) return;
            updateRow(ctx.spreadsheetId, ctx.sheetTitle, it).catch(e=>warn('update failed', e));
          });
          changedHookBound = true;
        }
        // subscribe for deletes (soft delete)
        const delReg = ui.onItemDeleted || ui.registerDeleteListener;
        if (typeof delReg === 'function' && !deletedHookBound){
          delReg(it=>{
            if (!ctx.spreadsheetId || !ctx.sheetTitle) return;
            softDeleteRow(ctx.spreadsheetId, ctx.sheetTitle, it).catch(e=>warn('soft delete failed', e));
          });
          deletedHookBound = true;
        }
      }
    }catch(e){
      warn('load captions failed', e);
    }
  }

  function onSheetContext(evt){
    const d = (evt && evt.detail) || {};
    handleSheetContext(d);
  }

  window.addEventListener('lm:sheet-context', onSheetContext, { passive:true });

})();