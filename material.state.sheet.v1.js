// material.state.sheet.v1.js — append/update __LM_MATERIALS
(() => {
  const TAG='[mat-sheet v1]';
  const log=(...a)=>console.log(TAG,...a), warn=(...a)=>console.warn(TAG,...a);

  const SHEET_NAME = '__LM_MATERIALS';
  const HEADERS = [
    'key','modelKey','materialKey','opacity','doubleSided','unlit',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'updatedAt','updatedBy','spreadsheetId','sheetGid'
  ];

  const $ = s => document.querySelector(s);
  // Global runtime flags and index for restoration
  window.__lm_restoringMaterial = window.__lm_restoringMaterial ?? false;
  window.__lm_currentMaterialKey = window.__lm_currentMaterialKey ?? null;
  window.__lm_materialIndex = window.__lm_materialIndex ?? new Map();
  function idxKey(sid,gid,mat){ return `${sid}:${gid}:${mat}`; }
  function idxSet(ctx, row){ if (!row?.materialKey) return; window.__lm_materialIndex.set(idxKey(ctx.spreadsheetId, ctx.sheetGid, row.materialKey), row); }
  function idxGet(ctx, mat){ return window.__lm_materialIndex.get(idxKey(ctx.spreadsheetId, ctx.sheetGid, mat)) || null; }

  const ui = {
    sel:  $('#materialSelect, #pm-material'),
    rng:  $('#opacityRange, #pm-opacity-range'),
    dbl:  $('#doubleSided, #pm-double'),
    unlit:$('#unlitLike, #pm-unlit')
  };

  let ctx = { spreadsheetId:null, sheetGid:null };
  window.addEventListener('lm:sheet-context', (e) => {
    ctx = e.detail || ctx;
    log('context', ctx);
  });

  function base(id){ return `https://sheets.googleapis.com/v4/spreadsheets/${id}`; }
  async function j(fetchPromise){
    const r = await fetchPromise;
    const t = await r.text();
    try { return t ? JSON.parse(t) : {}; } catch(_){ return {}; }
  }
  async function authed(url, init){
    if (window.__lm_fetchJSONAuth) return await window.__lm_fetchJSONAuth(url, init);
    return await fetch(url, init);
  }

  async function ensureSheet(spreadsheetId){
    if (!spreadsheetId) return;
    const meta = await j(authed(`${base(spreadsheetId)}?fields=sheets.properties`, {method:'GET'}));
    const found = (meta.sheets||[]).some(s => s.properties?.title === SHEET_NAME);
    if (!found){
      await authed(`${base(spreadsheetId)}:batchUpdate`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:SHEET_NAME } } }] })
      });
      await authed(`${base(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A1:Z1?valueInputOption=RAW`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ values:[HEADERS] })
      });
      log('sheet created', SHEET_NAME);
    }
  }

  async function readAll(spreadsheetId){
    const js = await j(authed(`${base(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}?majorDimension=ROWS`, {method:'GET'}));
    const rows = js.values || [];
    const hdr = rows[0] || [];
    const list = rows.slice(1).map(a => Object.fromEntries((hdr.length?hdr:HEADERS).map((h,i)=>[h, a[i] ?? ''])));
    return {hdr: hdr.length?hdr:HEADERS, rows:list};
  }

  const keyOf = (spreadsheetId, sheetGid, materialKey) => `${spreadsheetId}:${sheetGid}:${materialKey}`;

  async function upsert(spreadsheetId, rowObj){
    await ensureSheet(spreadsheetId);
    const {hdr, rows} = await readAll(spreadsheetId);
    const k = rowObj.key;
    let rowIndex = rows.findIndex(r => (r.key||'') === k);

    const line = HEADERS.map(h => rowObj[h] ?? '');
    if (rowIndex === -1){
      await authed(`${base(spreadsheetId)}/values/${encodeURIComponent(SHEET_NAME)}!A1:Z1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ values:[line] })
      });
      log('append', rowObj.materialKey);
    } else {
      const a1 = `${SHEET_NAME}!A${rowIndex+2}:${String.fromCharCode(65+HEADERS.length-1)}${rowIndex+2}`;
      await authed(`${base(spreadsheetId)}/values/${encodeURIComponent(a1)}?valueInputOption=RAW`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ values:[line] })
      });
      log('update', rowObj.materialKey, 'row', rowIndex+2);
    }
  }

  let last = null, timer = 0;
  function currentKey(){
    return (ui.sel && ui.sel.value || '').trim();
  }
  function snapshot(){
    if (!ctx.spreadsheetId) return null;
    const materialKey = currentKey();
    if (!materialKey) return null;
    const now = new Date().toISOString();
    return {
      key: keyOf(ctx.spreadsheetId, ctx.sheetGid, materialKey),
      modelKey: 'NOSPREAD:NOGID',
      materialKey,
      opacity: ui.rng ? String(parseFloat(ui.rng.value)) : '',
      doubleSided: ui.dbl ? (ui.dbl.checked ? '1':'0') : '',
      unlit: ui.unlit ? (ui.unlit.checked ? '1':'0') : '',
      chromaEnable:'', chromaColor:'', chromaTolerance:'', chromaFeather:'',
      updatedAt: now, updatedBy: 'app',
      spreadsheetId: ctx.spreadsheetId || '', sheetGid: String(ctx.sheetGid ?? '')
    };
  }
  const same = (a,b) => !!a && !!b &&
    a.materialKey===b.materialKey && a.opacity===b.opacity &&
    a.doubleSided===b.doubleSided && a.unlit===b.unlit;

  async function schedule(){
    if (window.__lm_restoringMaterial) return;
    const s = snapshot(); if (!s) return;
    if (same(s,last)) return;
    last = s;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async ()=>{
      try { await upsert(ctx.spreadsheetId, s); } catch(e){ warn('save failed', e); }
    }, 500);
  }

  function arm(){
    ui.sel  && ui.sel.addEventListener('change', onSelectRestore, false);
    ui.rng  && ui.rng.addEventListener('input',  schedule, false);
    ui.dbl  && ui.dbl.addEventListener('change', schedule, false);
    ui.unlit&& ui.unlit.addEventListener('change', schedule, false);
    log('armed');
  }

  window.addEventListener('lm:glb-loaded', ()=>setTimeout(schedule,0));
  setTimeout(arm, 0);
})();


  async function rebuildIndex(){
    if (!ctx.spreadsheetId) return;
    try{
      const all = await readAll(ctx.spreadsheetId);
      window.__lm_materialIndex = new Map();
      for(const row of all.rows){
        idxSet(ctx, row);
      }
      log('index rebuilt', window.__lm_materialIndex.size);
    }catch(e){ warn('index build failed', e); }
  }

  async function onSelectRestore(){
    if (!ui.sel) return;
    window.__lm_currentMaterialKey = ui.sel.value;
    window.__lm_restoringMaterial = true;
    try{
      const snap = idxGet(ctx, ui.sel.value) || { opacity: 1 };
      if (ui.rng){ ui.rng.value = String(snap.opacity ?? 1); }
      if (window.viewerBridge?.setMaterialOpacity && typeof snap.opacity !== 'undefined'){
        window.viewerBridge.setMaterialOpacity(ui.sel.value, Number(snap.opacity ?? 1));
      }
      log('restore', ui.sel.value, snap.opacity);
    }finally{
      window.__lm_restoringMaterial = false;
    }
  }

  // Rebuild index on sheet-context
  window.addEventListener('lm:sheet-context', ()=>{ setTimeout(rebuildIndex, 0); });

  // Initial restore when conditions are likely ready
  window.addEventListener('lm:glb-loaded', ()=>{ setTimeout(()=>{ if (ui.sel && ui.sel.value) onSelectRestore(); }, 0); });
