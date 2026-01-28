// [caption.sheet.bridge] Phase A1’+A2 — Sheets persistence for caption rows (single active sheet, gid-based)
// - Listens to lm:sheet-context (spreadsheetId + sheetGid [+ sheetTitle])
// - Resolves sheet title from gid via LM_SHEET_GIDMAP (or uses provided sheetTitle)
// - Ensures header row on the active caption sheet
// - Loads existing captions into __LM_CAPTION_UI
// - Appends newly added captions (Shift+Click) to the sheet
// - Updates title/body edits back to the same row
(function(){
  const TAG='[caption.sheet.bridge]';
  if (window.__LM_CAPTION_SHEET_BRIDGE__ && window.__LM_CAPTION_SHEET_BRIDGE__.__ver && String(window.__LM_CAPTION_SHEET_BRIDGE__.__ver).startsWith('A2')) {
    console.log('[caption.sheet.bridge]', 'already loaded');
    return;
  }

  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);
  const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';

  const HEADER = ['id','title','body','color','posX','posY','posZ','imageFileId','createdAt','updatedAt'];

  // Sheets 書き込みスロットル（同一行への PUT を 2 秒に 1 回までに制限）
  const UPDATE_THROTTLE_MS = 2000;
  const lastUpdateAt = new Map(); // key: item.id or "row:<rowIndex>" → timestamp(ms)

  // 高頻度の変更（テキスト入力→画像アタッチ等）で更新が「落ちる」ことを防ぐため、
  // throttle は単純に捨てず、最後の更新を遅延実行で coalesce する
  const pendingUpdate = new Map(); // key -> { spreadsheetId, sheetTitle, item }
  const pendingTimer = new Map();  // key -> timeout id

  function cloneItemSafe(item) {
    try { return structuredClone(item); } catch (_) {}
    try { return JSON.parse(JSON.stringify(item)); } catch (_) {}
    // それでもダメなら参照を返す（最終手段）
    return item;
  }

  function scheduleDeferredUpdate(key, spreadsheetId, sheetTitle, item, waitMs) {
    pendingUpdate.set(key, { spreadsheetId, sheetTitle, item: cloneItemSafe(item) });

    if (pendingTimer.has(key)) return;

    const t = setTimeout(async () => {
      pendingTimer.delete(key);
      const p = pendingUpdate.get(key);
      pendingUpdate.delete(key);
      if (!p) return;

      // throttle による早期returnを回避するため、最終更新時刻をリセットしてから実行
      lastUpdateAt.set(key, 0);
      try {
        await updateRowForItem(p.spreadsheetId, p.sheetTitle, p.item, '[deferred]');
      } catch (e) {
        warn('Deferred update failed:', key, e);
      }
    }, Math.max(100, waitMs));

    pendingTimer.set(key, t);
  }


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
          const keys = Object.keys(map.byTitle).filter(t=>t && t!=='__LM_MATERIALS');
          if (keys.length) return keys[0];
        }
      }
    }catch(e){
      warn('resolveSheetTitle via gid map failed', e);
    }
    // final fallback
    return 'シート1';
  }

  // --- header ensure / fetch helpers -----------------------------------------
  function buildRange(sheetTitle, a1){
    // シート名をクォートで囲まず「シート名!A1」形式で返す
    const safeTitle = String(sheetTitle || '').trim();
    if (!safeTitle) return a1; // 念のため
    return `${safeTitle}!${a1}`;
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
        (item.image && item.image.id) || item.imageFileId || '',
        createdAt,
        updatedAt
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
    if (!item){
      return;
    }
    if (!item.id || !item.rowIndex){
      // rowIndex が無い場合は安全のため append にフォールバック
      return appendRow(spreadsheetId, sheetTitle, item);
    }

    // 同じ行への書き込み頻度を制限
    const key = item.id || (`row:${item.rowIndex}`);
    const nowTs = Date.now();
    const last = lastUpdateAt.get(key) || 0;
    const delta = nowTs - last;

    if (delta < UPDATE_THROTTLE_MS) {
      // 短時間に連続する更新は「捨てずに」遅延実行で coalesce する
      log('update row throttled (deferred)', key, 'delta', delta);
      scheduleDeferredUpdate(key, spreadsheetId, sheetTitle, item, (UPDATE_THROTTLE_MS - delta) + 50);
      return;
    }

    lastUpdateAt.set(key, nowTs);

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
      warn('softDeleteRow: missing rowIndex; skip', item && item.id);
      return;
    }
    const rowIndex = item.rowIndex;
    if (rowIndex <= 1) return; // keep header
    const a1 = `A${rowIndex}:J${rowIndex}`;
    const range = buildRange(sheetTitle, a1);
    const url = `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const empty = new Array(HEADER.length).fill('');
    await authJSON(url, { method:'PUT', body: JSON.stringify({ values:[empty] }), rawResponse:true });
    log('soft delete row', item.id, 'row', rowIndex);
  }

  // --- main: sheet-context handler -------------------------------------------
  async function handleSheetContext(detail){
    const spreadsheetId = String(detail.spreadsheetId || '');
    let sheetGid = detail.sheetGid;
    if (sheetGid === undefined || sheetGid === null) sheetGid = '';
    sheetGid = String(sheetGid);

    // sheet-rename.module.js 等から sheetTitle が渡されていればそれを優先
    let sheetTitle = detail.sheetTitle;
    if (sheetTitle !== undefined && sheetTitle !== null){
      sheetTitle = String(sheetTitle);
    }else{
      sheetTitle = '';
    }

    ctx = { spreadsheetId, sheetGid, sheetTitle:'', nextRowIndex:2 };

    if (!spreadsheetId){
      warn('sheet-context without spreadsheetId', detail);
      return;
    }

    let resolvedTitle = sheetTitle;
    if (!resolvedTitle){
      // タイトルが渡されていない場合のみ gid map から解決
      resolvedTitle = await resolveSheetTitle(spreadsheetId, sheetGid);
    }
    ctx.sheetTitle = resolvedTitle || 'シート1';

    // デバッグ／他モジュール用の現在値
    window.__LM_ACTIVE_SPREADSHEET_ID = spreadsheetId;
    window.__LM_ACTIVE_SHEET_GID = sheetGid;
    window.__LM_ACTIVE_SHEET_TITLE = ctx.sheetTitle;

    log('sheet-context', ctx);

    try{
      const rows = await fetchRows(spreadsheetId, ctx.sheetTitle);
      const items = rowsToItems(rows);
      // nextRowIndex = 最大 rowIndex + 1
      const maxRow = items.reduce((m,it)=> Math.max(m, it.rowIndex || 1), 1);
      ctx.nextRowIndex = maxRow + 1;

      const ui = await waitCaptionUI();
      if (ui && typeof ui.setItems === 'function'){
        ui.setItems(items);
        try{ document.dispatchEvent(new CustomEvent('lm:captions-loaded', { detail:{ count: (items||[]).length } })); }catch(_e){}
        try{ window.__LM_READY_GATE__?.mark?.('captions'); }catch(_e){}
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
        // subscribe for edits (title/body/pos/image 等)
        if (typeof ui.onItemChanged === 'function' && !changedHookBound){
          ui.onItemChanged(it=>{
            if (!ctx.spreadsheetId || !ctx.sheetTitle) return;
            updateRow(ctx.spreadsheetId, ctx.sheetTitle, it).catch(e=>warn('update failed', e));
          });
          changedHookBound = true;
        }
        // subscribe for deletes (soft delete)
        if (!deletedHookBound){
          const deleter = ui.onItemDeleted || ui.registerDeleteListener;
          if (typeof deleter === 'function'){
            deleter(it=>{
              if (!ctx.spreadsheetId || !ctx.sheetTitle) return;
              if (!it || !it.rowIndex){
                warn('delete without rowIndex; skip soft delete', it && it.id);
                return;
              }
              softDeleteRow(ctx.spreadsheetId, ctx.sheetTitle, it).catch(e=>warn('soft delete failed', e));
            });
            deletedHookBound = true;
          }
        }
      }
    }catch(e){
      warn('load captions failed', e);
      try{ window.__LM_READY_GATE__?.mark?.('captions'); }catch(_e){}
    }
  }

  function onSheetContext(evt){
    const d = (evt && evt.detail) || {};
    handleSheetContext(d);
  }

  window.addEventListener('lm:sheet-context', onSheetContext);
  log('armed');

  window.__LM_CAPTION_SHEET_BRIDGE__ = { __ver: 'A2' };
})();
