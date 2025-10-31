// materials.sheet.bridge.js
// LociMyu - Materials Sheet Bridge
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);
  const err  = (...a)=>console.error('[mat-sheet]', ...a);

  const SheetTitle = '__LM_MATERIALS';
  const Header = [
    'key','modelKey','materialKey','opacity','doubleSided','unlit',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'updatedAt','updatedBy','spreadsheetId','sheetGid'
  ];

  const S = { spreadsheetId:null, sheetGid:0, sheetId:null, headerReady:false, title:SheetTitle };

  function nowIso(){ return new Date().toISOString(); }

  async function fjson(url, init){
    if (typeof window.__lm_fetchJSONAuth === 'function'){
      return window.__lm_fetchJSONAuth(url, init);
    }
    const tok = (await (window.gauth?.getAccessToken?.() || Promise.resolve(null))) || window.__LM_TOKEN;
    if (!tok) throw new Error('__lm_fetchJSONAuth missing');
    init = init || {};
    init.headers = Object.assign({'Authorization':'Bearer '+tok}, init.headers||{});
    const res = await fetch(url, init);
    if (!res.ok) throw new Error('fetch failed '+res.status);
    return res.json();
  }

  function gv(base, params){
    const usp = new URLSearchParams(params||{});
    return usp.toString() ? `${base}?${usp.toString()}` : base;
  }

  async function ensureSheet(){
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');

    const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, {includeGridData:false}), {method:'GET'});
    const sheets = meta?.sheets || [];
    let target = sheets.find(s => s?.properties?.title === S.title);
    if (!target){
      const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: S.title } } }] })
      });
      target = (res?.replies?.[0]?.addSheet) || null;
      log('sheet created:', S.title);
    }
    S.sheetId = target?.properties?.sheetId;

    const hdr = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, { method:'GET' });
    const row = (hdr?.values && hdr.values[0]) || [];
    const same = Header.length === row.length && Header.every((h,i)=>row[i]===h);
    if (!same){
      await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, { valueInputOption:'RAW' }), {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ values:[Header] })
      });
      log('header initialized for', S.title);
    }
    S.headerReady = true;
  }

  async function loadAll(){
    await ensureSheet();
    const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:N')}`, { method:'GET' });
    const rows = res?.values || [];
    const map = new Map();
    for (const r of rows){
      const [key='', modelKey='', materialKey='', opacity='', doubleSided='', unlit='',
             chromaEnable='', chromaColor='', chromaTolerance='', chromaFeather='',
             updatedAt='', updatedBy='', spreadsheetId='', sheetGid=''] = r;
      if (!materialKey) continue;
      map.set(materialKey, {
        key, modelKey, materialKey,
        opacity: (opacity===''?null:Number(opacity)),
        doubleSided: !!doubleSided,
        unlit: !!unlit,
        chromaEnable, chromaColor,
        chromaTolerance: (chromaTolerance===''?null:Number(chromaTolerance)),
        chromaFeather: (chromaFeather===''?null:Number(chromaFeather)),
        updatedAt, updatedBy, spreadsheetId, sheetGid
      });
    }
    return map;
  }

  async function upsertOne(item){
    await ensureSheet();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:N')}:append`;
    const qs  = { valueInputOption:'RAW', insertDataOption:'INSERT_ROWS' };
    const row = [
      item.key || `${item.materialKey}::opacity`,
      item.modelKey || '',
      item.materialKey || '',
      (item.opacity==null?'':item.opacity),
      item.doubleSided ? '1' : '',
      item.unlit ? '1' : '',
      item.chromaEnable ? '1' : '',
      item.chromaColor || '',
      (item.chromaTolerance==null?'':item.chromaTolerance),
      (item.chromaFeather==null?'':item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'mat-orch',
      S.spreadsheetId || '',
      (S.sheetGid==null? '' : S.sheetGid)
    ];
    await fjson(gv(url, qs), {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ values:[row] })
    });
    log('appended', item.materialKey || item.key || '(unknown)');
  }

  window.addEventListener('lm:sheet-context', (ev)=>{
    const d = ev?.detail || ev;
    if (!d?.spreadsheetId) { warn('sheet-context missing spreadsheetId'); return; }
    S.spreadsheetId = d.spreadsheetId;
    if (typeof d.sheetGid === 'number') S.sheetGid = d.sheetGid;
    log('sheet-context bound:', S.spreadsheetId, 'gid=', S.sheetGid);
  }, { once:false });

  window.materialsSheetBridge = { ensureSheet, loadAll, upsertOne, config:S };
})();