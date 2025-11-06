
// material.pm.controller.v7.js
// LociMyu: Per‑Material Opacity Controller (GLB-triggered, Sheet upsert on commit)
(function(){
  const TAG = '[pm-ctrl v7]';
  const log  = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // ---- Helpers: environment ----
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

  async function getAccessToken(){
    try{
      if (window.gauth?.getAccessToken) return await window.gauth.getAccessToken();
      const mod = await import('./gauth.module.js');
      if (mod?.getAccessToken) return await mod.getAccessToken();
    }catch(e){ warn('getAccessToken failed', e); }
    return null;
  }

  async function fetchJSONAuth(url, init={}){
    try{
      if (typeof window.__lm_fetchJSONAuth === 'function'){
        return await window.__lm_fetchJSONAuth(url, init);
      }
      const token = await getAccessToken();
      const res = await fetch(url, {
        ...init,
        headers: {
          'Authorization': token ? `Bearer ${token}` : undefined,
          'Content-Type': 'application/json',
          ...(init.headers||{})
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }catch(e){
      warn('fetchJSONAuth failed', url, e);
      throw e;
    }
  }

  // ---- UI discovery ----
  function findControls(){
    const root = document.querySelector('#pane-material, #tab-material, [data-tab="material"], .tab-material, .material-tab')
            || document.getElementById('right')
            || document.querySelector('aside, .right, #sidebar, .sidebar')
            || document.body;
    // Prefer a card that mentions the hint text
    const hintMatch = [...root.querySelectorAll('section, .card, .panel, .group, div')]
      .find(n => /per-?material opacity|pick a material/i.test(n.textContent||''));
    const scope = hintMatch || root;
    const sel = scope.querySelector('#pm-material, select') || document.getElementById('materialSelect');
    const rng = scope.querySelector('#pm-opacity-range, input[type="range"]') || document.getElementById('opacityRange');
    const readout = scope.querySelector('#pm-opacity-value, .value, .readout');
    if (sel) sel.id = 'materialSelect';
    if (rng) rng.id = 'opacityRange';
    return {root, scope, sel, rng, readout, ok: !!sel && !!rng};
  }

  // ---- Scene helpers ----
  function isGLBMaterialName(n){
    if (!n) return false;
    if (/^mesh.*material$/i.test(n)) return false;
    if (/^material(\.\d+)?$/i.test(n)) return false;
    if (n.startsWith('__') || n.startsWith('LM_')) return false;
    return true;
  }

  function collectMaterialsByName(scene){
    const map = new Map(); // name -> material[]
    scene?.traverse?.(o=>{
      if (!o?.isMesh) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
        const name = (m?.name||'').trim();
        if (!isGLBMaterialName(name)) return;
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(m);
      });
    });
    return map;
  }

  function applyOpacityTo(sceneNameMap, matName, v){
    const mats = sceneNameMap.get(matName) || [];
    for (const m of mats){
      m.transparent = (v < 1.0) || m.transparent;
      m.opacity = v;
      if ('needsUpdate' in m) m.needsUpdate = true;
    }
  }

  // ---- Sheets helpers ----
  function colLetter(idx){ // 0-based -> A,B,...
    let n = idx+1, s='';
    while(n>0){ n--; s = String.fromCharCode(65 + (n%26)) + s; n = Math.floor(n/26); }
    return s;
  }

  async function readMaterialsSheet(spreadsheetId){
    // Read __LM_MATERIALS!A:Z
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent('__LM_MATERIALS')}!A:Z`;
    const data = await fetchJSONAuth(url, { method:'GET' });
    const rows = data.values || [];
    if (!rows.length) return {headers:[], rows:[], map:new Map(), colIndex:{}};

    const headers = rows[0].map(h => (h||'').toString().trim());
    const colIndex = {};
    // tolerant header matching
    function findCol(cands){
      const i = headers.findIndex(h => cands.some(c => h.toLowerCase()===c));
      return i >= 0 ? i : -1;
    }
    colIndex.key = findCol(['materialkey','material_key','name','material','mat','key']);
    colIndex.opacity = findCol(['opacity','alpha','opacityvalue','value']);

    // Fall back default positions if not found
    if (colIndex.key < 0) colIndex.key = 0;
    if (colIndex.opacity < 0) colIndex.opacity = 1;

    const map = new Map();
    for (let i=1;i<rows.length;i++){
      const r = rows[i];
      const key = (r[colIndex.key]||'').toString().trim();
      const val = parseFloat(r[colIndex.opacity]||'');
      if (!key) continue;
      if (!Number.isFinite(val)) continue;
      map.set(key, val);
    }
    return {headers, rows, map, colIndex};
  }

  async function upsertMaterialOpacity(spreadsheetId, key, value, sheetMeta){
    // Use existing meta if provided to avoid re-reading
    const meta = sheetMeta || await readMaterialsSheet(spreadsheetId);
    const {headers, rows, colIndex} = meta;

    // ensure headers exist
    let needsHeaderUpdate = false;
    if (!headers.length){
      headers.push('materialKey','opacity');
      needsHeaderUpdate = true;
    }else{
      if (colIndex.key < 0){ headers[0] = 'materialKey'; needsHeaderUpdate = true; colIndex.key = 0; }
      if (colIndex.opacity < 0){ headers[1] = 'opacity'; needsHeaderUpdate = true; colIndex.opacity = 1; }
    }

    // Step 1: write headers if needed
    if (needsHeaderUpdate){
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent('__LM_MATERIALS')}!A1:${colLetter(headers.length-1)}1?valueInputOption=RAW`;
      await fetchJSONAuth(url, {
        method:'PUT',
        body: JSON.stringify({ range:'__LM_MATERIALS!A1', values:[headers] })
      });
    }

    // Find existing row
    let rowIndex = -1; // 1-based for sheet (including header)
    for (let i=1;i<rows.length;i++){
      const r = rows[i];
      const k = (r[colIndex.key]||'').toString().trim();
      if (k === key){ rowIndex = i+1; break; }
    }

    if (rowIndex > 0){
      // update one cell
      const col = colLetter(colIndex.opacity);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`__LM_MATERIALS!${col}${rowIndex}`)}?valueInputOption=RAW`;
      await fetchJSONAuth(url, {
        method:'PUT',
        body: JSON.stringify({ values:[[ value ]] })
      });
      log('sheet updated', key, value, `row ${rowIndex}`);
      return true;
    }else{
      // append new row
      // make row length = headers.length, set key & value at indices
      const row = Array(Math.max(headers.length, colIndex.opacity+1, colIndex.key+1)).fill('');
      row[colIndex.key] = key;
      row[colIndex.opacity] = value;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent('__LM_MATERIALS')}!A:Z:append?valueInputOption=RAW`;
      await fetchJSONAuth(url, {
        method:'POST',
        body: JSON.stringify({ values:[ row ] })
      });
      log('sheet appended', key, value);
      return true;
    }
  }

  // ---- Main controller ----
  let lastSceneNameMap = null;
  let lastSheetId = null;
  let lastSheetMeta = null;
  let controlsBound = false;

  function hookUI(scene){
    const {sel, rng, readout, ok} = findControls();
    if (!ok){ warn('controls missing'); return false; }

    const nameMap = collectMaterialsByName(scene);
    // Populate select
    const names = [...nameMap.keys()].sort((a,b)=>a.localeCompare(b,'ja'));
    sel.innerHTML = '';
    if (!names.length){
      const opt = document.createElement('option'); opt.value=''; opt.textContent='(no GLB materials)'; sel.appendChild(opt);
    }else{
      for (const n of names){
        const opt = document.createElement('option'); opt.value = n; opt.textContent = n; sel.appendChild(opt);
      }
    }
    lastSceneNameMap = nameMap;

    // Live preview on input
    const onInput = ()=>{
      const key = sel.value;
      if (!key) return;
      const v = parseFloat(rng.value);
      applyOpacityTo(nameMap, key, v);
      if (readout) readout.textContent = v.toFixed(2);
      // broadcast live change (optional)
      window.dispatchEvent(new CustomEvent('lm:material-opacity-changed', { detail:{ materialKey:key, value:v, live:true } }));
    };

    // Commit to sheet on "pointer up / blur / change"
    let dragging = false;
    const commit = async ()=>{
      const key = sel.value;
      if (!key || !Number.isFinite(parseFloat(rng.value))) return;
      const v = parseFloat(rng.value);
      window.dispatchEvent(new CustomEvent('lm:material-opacity-changed', { detail:{ materialKey:key, value:v } }));
      if (!lastSheetId) return;
      try{
        // cache meta to reduce reads
        lastSheetMeta = lastSheetMeta || await readMaterialsSheet(lastSheetId);
        await upsertMaterialOpacity(lastSheetId, key, v, lastSheetMeta);
        // refresh meta cache (row count may have changed)
        lastSheetMeta = await readMaterialsSheet(lastSheetId);
      }catch(e){ warn('sheet upsert failed', e); }
    };

    rng.addEventListener('input', onInput);
    rng.addEventListener('pointerdown', ()=>{ dragging = true; });
    rng.addEventListener('pointerup', ()=>{ if (dragging){ dragging=false; commit(); } });
    rng.addEventListener('change', commit);
    rng.addEventListener('blur', commit);
    sel.addEventListener('change', onInput);

    // expose
    window.__lm_materials_apply = (entries)=>{
      // entries: Map<string, number> or {name:value}
      const it = entries instanceof Map ? entries.entries() : Object.entries(entries||{});
      for (const [name, v] of it){
        if (!Number.isFinite(parseFloat(v))) continue;
        applyOpacityTo(nameMap, name, parseFloat(v));
        if (sel.value === name){
          rng.value = String(v);
          if (readout) readout.textContent = Number(v).toFixed(2);
        }
      }
      // ensure scene updates
      window.dispatchEvent(new Event('render-request'));
    };

    controlsBound = true;
    log('UI wired', {count:names.length});
    // announce available materials for external loader
    window.dispatchEvent(new CustomEvent('lm:materials-populated', { detail:{ names } }));
    return true;
  }

  // When sheet context is available, store sheet id and try load values
  window.addEventListener('lm:sheet-context', async (e)=>{
    lastSheetId = e?.detail?.spreadsheetId || null;
    log('sheet-context', lastSheetId);
    // If UI already bound and we have materials, try to hydrate from sheet
    if (lastSheetId && lastSceneNameMap){
      try{
        lastSheetMeta = await readMaterialsSheet(lastSheetId);
        const entries = Object.fromEntries(lastSheetMeta.map);
        if (Object.keys(entries).length){
          window.__lm_materials_apply?.(entries);
          log('sheet values applied', entries);
        }
      }catch(err){ warn('initial sheet read failed', err); }
    }
  });

  // Also accept an out-of-band snapshot event (if existing bridge emits it)
  window.addEventListener('lm:materials-sheet-snapshot', (e)=>{
    const map = e?.detail?.map;
    if (!map) return;
    window.__lm_materials_apply?.(map);
    log('sheet snapshot applied');
  });

  // Scene deep-ready -> bind UI & (if sheet id present) hydrate
  window.addEventListener('pm:scene-deep-ready', async (e)=>{
    const scene = e?.detail?.scene || window.__lm_scene || null;
    if (!scene) return;
    // defer one tick for viewer stabilization
    await Promise.resolve();
    hookUI(scene);
    if (lastSheetId){
      try{
        lastSheetMeta = await readMaterialsSheet(lastSheetId);
        const entries = Object.fromEntries(lastSheetMeta.map);
        if (Object.keys(entries).length){
          window.__lm_materials_apply?.(entries);
          log('sheet values applied (after scene)');
        }
      }catch(err){ warn('sheet read after scene failed', err); }
    }
  });

  log('installed (idle until pm:scene-deep-ready).');
})();
