/* materials.sheet.bridge.js
 * LociMyu - Materials Sheet Bridge (ensure/create / load / upsert)
 * 前提:
 *  - window.__lm_fetchJSONAuth(url, init) が利用可能（boot側で定義）
 *  - 'lm:sheet-context' で { spreadsheetId, sheetGid? } が飛ぶ
 */
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);
  const err  = (...a)=>console.error('[mat-sheet]', ...a);

  const SheetTitle = 'materials';
  const Header = [
    'materialKey','name','opacity','unlit','doubleSided',
    'chromaColor','chromaThreshold','chromaFeather','updatedAt','updatedBy'
  ];

  const S = { spreadsheetId:null, title:SheetTitle, sheetId:null, headerReady:false };
  let _ensurePromise = null;

  // ==== utils ====
  const nowIso = () => new Date().toISOString();
  const toBool = x => (typeof x==='boolean') ? x :
    (x==null ? false : (String(x).toLowerCase()==='1'||String(x).toLowerCase()==='true'||String(x).toLowerCase()==='yes'));
  const asFloat = (x, d=null) => { const n=parseFloat(x); return Number.isFinite(n)?n:d; };
  const gv = (base, params) => `${base}?${new URLSearchParams(params).toString()}`;
  function fjson(url, init){
    if (typeof window.__lm_fetchJSONAuth !== 'function') throw new Error('__lm_fetchJSONAuth missing');
    return window.__lm_fetchJSONAuth(url, init);
  }

  // ==== ensure sheet (create-if-missing + header) ====
  async function ensureSheet(){
    if (_ensurePromise) return _ensurePromise;
    _ensurePromise = (async () => {
      if (!S.spreadsheetId) throw new Error('spreadsheetId missing');

      // 1) spreadsheet meta
      const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, {
        includeGridData: false
      }), { method:'GET' });
      const sheets = meta?.sheets || [];
      let target = sheets.find(s => s?.properties?.title === S.title);

      // 2) add sheet if missing
      if (!target){
        const res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:S.title } } }] })
        });
        target = res?.replies?.[0]?.addSheet || null;
        log('sheet created:', S.title);
      }
      S.sheetId = target?.properties?.sheetId;

      // 3) header row ensure
      const hdr = await fjson(
        gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {}),
        { method:'GET' }
      );
      const row = (hdr?.values && hdr.values[0]) || [];
      const same = Header.length===row.length && Header.every((h,i)=>row[i]===h);
      if (!same){
        await fjson(
          gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!1:1')}`, {
            valueInputOption:'RAW'
          }),
          {
            method:'PUT',
            headers:{ 'Content-Type':'application/json' },
            body: JSON.stringify({ values:[Header] })
          }
        );
        log('header initialized for', S.title);
      }
      S.headerReady = true;
      return true;
    })().catch(e => { _ensurePromise=null; throw e; });
    return _ensurePromise;
  }

  // ==== load all → Map(materialKey → row) ====
  async function loadAll(){
    await ensureSheet();
    const res = await fjson(
      gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:J')}`, {}),
      { method:'GET' }
    );
    const rows = res?.values || [];
    const map = new Map();
    for (const r of rows){
      const [
        materialKey='', name='', opacity='', unlit='', doubleSided='',
        chromaColor='', chromaThreshold='', chromaFeather='', updatedAt='', updatedBy=''
      ] = r;
      if (!materialKey) continue;
      map.set(materialKey, {
        materialKey,
        name,
        opacity: asFloat(opacity, null),
        unlit: toBool(unlit),
        doubleSided: toBool(doubleSided),
        chromaColor: chromaColor || '',
        chromaThreshold: asFloat(chromaThreshold, null),
        chromaFeather: asFloat(chromaFeather, null),
        updatedAt, updatedBy
      });
    }
    return map;
  }

  // ==== upsert one (by materialKey) ====
  async function upsertOne(item){
    await ensureSheet();

    // 現存キー一覧を取得（A2:A）
    const rangeAll = `${S.title}!A2:A`;
    const res = await fjson(
      gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(rangeAll)}`, {}),
      { method:'GET' }
    );
    const keys = (res?.values || []).map(v => v[0]);
    const idx  = keys.indexOf(item.materialKey); // A2起点の0-based

    const row = [
      item.materialKey || '',
      item.name || '',
      item.opacity==null ? '' : String(item.opacity),
      item.unlit ? '1' : '',
      item.doubleSided ? '1' : '',
      item.chromaColor || '',
      item.chromaThreshold==null ? '' : String(item.chromaThreshold),
      item.chromaFeather==null ? '' : String(item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'app'
    ];

    if (idx >= 0){
      const rowNum = idx + 2; // A2=2行目
      const range = `${S.title}!A${rowNum}:J${rowNum}`;
      await fjson(
        gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(range)}`, {
          valueInputOption:'RAW'
        }),
        {
          method:'PUT',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ values:[row] })
        }
      );
      log('updated row', rowNum, item.materialKey);
    } else {
      await fjson(
        gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:J')}`, {
          valueInputOption:'RAW',
          insertDataOption:'INSERT_ROWS'
        }),
        {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify({ values:[row], majorDimension:'ROWS' })
        }
      );
      log('appended', item.materialKey);
    }
  }

  // ==== bind sheet-context ====
  window.addEventListener('lm:sheet-context', (ev) => {
    const d = ev?.detail || ev;
    if (!d?.spreadsheetId){ warn('sheet-context missing spreadsheetId'); return; }
    S.spreadsheetId = d.spreadsheetId;
    log('sheet-context bound:', S.spreadsheetId);
  }, { once:false });

  // ==== export ====
  window.materialsSheetBridge = { ensureSheet, loadAll, upsertOne, config:S };
})();
