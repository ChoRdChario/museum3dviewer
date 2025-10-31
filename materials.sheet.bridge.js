
/* materials.sheet.bridge.js  V6_15b
 * - waits for lm:sheet-context
 * - ensures __LM_MATERIALS sheet + header
 * - loadAll / upsertOne with values.append (:append)
 * - uses __lm_fetchJSONAuth or falls back to GIS token
 */
(() => {
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);
  const error= (...a)=>console.error('[mat-sheet]', ...a);

  const SheetTitle = '__LM_MATERIALS';
  const Header = [
    'materialKey','name','opacity','unlit','doubleSided',
    'chromaColor','chromaThreshold','chromaFeather','updatedAt','updatedBy',
    'sheetGid','modelKey','glbId','source'
  ];

  const S = { spreadsheetId:null, sheetId:null, title:SheetTitle, gid:null };
  let contextResolve; const contextReady = new Promise(res => contextResolve = res);

  function nowIso(){ return new Date().toISOString(); }
  const gv = (base, params) => {
    const u = new URLSearchParams(params||{}); return base + (u.toString()?('?'+u.toString()):'');
  };

  async function getTokenInteractive(interactive=false){
    try {
      const g = window.gauth || (await import('./gauth.module.js'));
      if (g?.getAccessToken) return await g.getAccessToken({ interactive });
    } catch(e){ warn('getAccessToken failed', e); }
    throw new Error('No auth token available');
  }

  async function fjson(url, init){
    // Prefer app's authenticated fetch if available
    if (typeof window.__lm_fetchJSONAuth === 'function'){
      return await window.__lm_fetchJSONAuth(url, init);
    }
    // Fallback: manual fetch with GIS token
    const token = await getTokenInteractive(false);
    const headers = Object.assign({'Authorization': `Bearer ${token}`}, init?.headers||{});
    const res = await fetch(url, {...init, headers});
    if (res.status === 401) {
      const t2 = await getTokenInteractive(true);
      const res2 = await fetch(url, {...init, headers:{...headers, Authorization: `Bearer ${t2}`}});
      if (!res2.ok) throw new Error('Auth failed '+res2.status);
      return await res2.json();
    }
    if (!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }

  // Listen sheet-context
  window.addEventListener('lm:sheet-context', (ev) => {
    const d = ev?.detail || ev;
    if (!d?.spreadsheetId) { warn('sheet-context missing spreadsheetId'); return; }
    S.spreadsheetId = d.spreadsheetId;
    S.gid = d.sheetGid ?? null;
    log('sheet-context bound:', S.spreadsheetId, 'gid=', S.gid||0);
    contextResolve();
  }, { once:false });

  async function ensureSheet(){
    await contextReady;
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');

    const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, { includeGridData:false }), { method:'GET' });
    const sheets = meta?.sheets||[];
    let target = sheets.find(s => s?.properties?.title === S.title);
    if (!target){
      const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:S.title } } }] })
      });
      target = res?.replies?.[0]?.addSheet;
      log('sheet created:', S.title);
    }
    S.sheetId = target?.properties?.sheetId;

    // header row
    const hdr = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, { method:'GET' });
    const row = (hdr?.values && hdr.values[0]) || [];
    const same = Header.length===row.length && Header.every((h,i)=>row[i]===h);
    if (!same){
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, { valueInputOption:'RAW' }), {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ values:[Header] })
      });
      log('header initialized for', S.title);
    }
  }

  async function loadAll(){
    await ensureSheet();
    const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:N')}`, { method:'GET' });
    const rows = res?.values||[];
    const map = new Map();
    for (const r of rows){
      const [
        materialKey='', name='', opacity='', unlit='', doubleSided='',
        chromaColor='', chromaThreshold='', chromaFeather='', updatedAt='', updatedBy='',
        sheetGid='', modelKey='', glbId='', source=''
      ] = r;
      if (!materialKey) continue;
      map.set(materialKey, {
        materialKey, name,
        opacity: opacity===''?null:parseFloat(opacity),
        unlit: !!(unlit==='1' || unlit===true),
        doubleSided: !!(doubleSided==='1' || doubleSided===true),
        chromaColor, chromaThreshold: chromaThreshold===''?null:parseFloat(chromaThreshold),
        chromaFeather: chromaFeather===''?null:parseFloat(chromaFeather),
        updatedAt, updatedBy, sheetGid, modelKey, glbId, source
      });
    }
    return map;
  }

  async function upsertOne(item){
    await ensureSheet();
    const row = [
      item.materialKey||'',
      item.name||'',
      item.opacity==null?'':String(item.opacity),
      item.unlit?'1':'',
      item.doubleSided?'1':'',
      item.chromaColor||'',
      item.chromaThreshold==null?'':String(item.chromaThreshold),
      item.chromaFeather==null?'':String(item.chromaFeather),
      item.updatedAt||nowIso(),
      item.updatedBy||'app',
      S.gid||0,
      item.modelKey||'',
      item.glbId||'',
      item.source||'ui'
    ];
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:N')}:append`;
    const qs  = { valueInputOption:'RAW', insertDataOption:'INSERT_ROWS' };
    await fjson(gv(url, qs), {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ values:[row] })
    });
    log('appended', item.name||item.materialKey);
  }

  async function waitReady(){ await contextReady; }

  window.materialsSheetBridge = { ensureSheet, loadAll, upsertOne, waitReady, config:S };
})();
