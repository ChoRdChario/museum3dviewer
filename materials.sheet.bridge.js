/* materials.sheet.bridge.js
 * LociMyu - Materials Sheet Bridge (ensure / load / append)
 * 依存:
 *  - window.__lm_fetchJSONAuth(url, init?) があればそれを優先
 *  - ない場合は gauth.module.js の getAccessToken() をフォールバックで使用
 *  - 'lm:sheet-context' で { spreadsheetId, sheetGid } が飛ぶ
 */
(function(){
  const log  = (...a)=>console.log('[mat-sheet]', ...a);
  const warn = (...a)=>console.warn('[mat-sheet]', ...a);
  const err  = (...a)=>console.error('[mat-sheet]', ...a);

  // スクショのタブ名に合わせる（__LM_MATERIALS）
  const SheetTitle = '__LM_MATERIALS';

  // ヘッダはスクショの列順（A〜N）
  const Header = [
    'key','modelKey','materialKey','opacity','doubleSided','unlit',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'updatedAt','updatedBy','spreadsheetId','sheetGid'
  ];

  const S = {
    spreadsheetId: null,
    sheetGid: null,        // 参考保存用（数値 or 文字列でもOK）
    title: SheetTitle,
    sheetId: null,         // 数値の sheetId（batchUpdate 用などで使う）
    headerReady: false,
  };

  // ===== Utilities =====
  function nowIso(){ return new Date().toISOString(); }
  function to01(v){ return v ? '1' : ''; }
  function asFloat(x, def=null){ const n=parseFloat(x); return Number.isFinite(n)?n:def; }

  // 認可付き fetch ラッパ（__lm_fetchJSONAuth が無ければフォールバック実装）
  async function fjson(url, init){
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      return window.__lm_fetchJSONAuth(url, init);
    }
    // フォールバック: gauth からトークン取得して Authorization 付与
    const g = await import('./gauth.module.js');
    const token = await g.getAccessToken({ interactive: true });
    const headers = new Headers(init?.headers || {});
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Content-Type') && init?.method && init.method !== 'GET') {
      headers.set('Content-Type','application/json');
    }
    const res = await fetch(url, { ...(init||{}), headers });
    if (!res.ok) {
      // 401 のときは一回だけトークン更新して再試行
      if (res.status === 401) {
        const fresh = await g.getAccessToken({ forceRefresh: true, interactive: true });
        headers.set('Authorization', `Bearer ${fresh}`);
        const res2 = await fetch(url, { ...(init||{}), headers });
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        return res2.json();
      }
      throw new Error(`HTTP ${res.status}`);
    }
    // 204 等もありえるが、Sheets は通常 JSON 返す
    return res.status === 204 ? null : res.json();
  }

  function gv(base, params){
    const usp = new URLSearchParams(params);
    return `${base}?${usp.toString()}`;
  }

  // ===== ensure: シート存在 & ヘッダ行の保証 =====
  async function ensureSheet(){
    if (!S.spreadsheetId) throw new Error('spreadsheetId missing');

    // スプレッドシートのメタ取得
    const meta = await fjson(gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}`, {
      includeGridData: 'false'
    }), { method:'GET' });

    const sheets = meta?.sheets || [];
    let target = sheets.find(s => s?.properties?.title === S.title);
    if (!target){
      // なければ追加
      let res;
      try{ res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, {
        method:'POST',
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: S.title } } }]
        })
      });
      }catch(e){ console.warn('[mat-sheet] addSheet batchUpdate warn, retry once', e); res = await fjson(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}:batchUpdate`, { method:'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: S.title } } }] }) }); }
      target = res?.replies?.[0]?.addSheet || null;
      log('sheet created:', S.title);
    }
    S.sheetId = target?.properties?.sheetId ?? S.sheetId;

    // ヘッダ確認（A1:N1）
    const hdr = await fjson(
      `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A1:N1')}`,
      { method:'GET' }
    );
    const row = (hdr?.values && hdr.values[0]) || [];
    const same = Header.length === row.length && Header.every((h,i)=>row[i]===h);
    if (!same){
      await fjson(
        gv(`https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A1:N1')}`, {
          valueInputOption:'RAW'
        }),
        {
          method:'PUT',
          body: JSON.stringify({ values:[Header] })
        }
      );
      log('header initialized for', S.title);
    }
    S.headerReady = true;
  }

  // ===== loadAll: 全行を読み込み（Map by key） =====
  async function loadAll(){
    await ensureSheet();
    const res = await fjson(
      `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A2:N')}`,
      { method:'GET' }
    );
    const rows = res?.values || [];
    const map = new Map();
    for (const r of rows){
      const [
        key='', modelKey='', materialKey='', opacity='',
        doubleSided='', unlit='',
        chromaEnable='', chromaColor='', chromaTolerance='', chromaFeather='',
        updatedAt='', updatedBy='', spreadsheetId='', sheetGid=''
      ] = r;
      if (!key) continue;
      map.set(key, {
        key, modelKey, materialKey,
        opacity: asFloat(opacity, null),
        doubleSided: doubleSided==='1',
        unlit: unlit==='1',
        chromaEnable: chromaEnable==='1',
        chromaColor,
        chromaTolerance: asFloat(chromaTolerance, null),
        chromaFeather: asFloat(chromaFeather, null),
        updatedAt, updatedBy, spreadsheetId, sheetGid
      });
    }
    return map;
  }

  // ===== upsertOne: ひとまず append（履歴を残す運用） =====
  async function upsertOne(item){
    await ensureSheet();

    // 行データを RAW で渡す
    const row = [
      item.key || '',
      item.modelKey || '',
      item.materialKey || '',
      item.opacity==null ? '' : Number(item.opacity),
      to01(!!item.doubleSided),
      to01(!!item.unlit),
      to01(!!item.chromaEnable),
      item.chromaColor || '',
      item.chromaTolerance==null ? '' : Number(item.chromaTolerance),
      item.chromaFeather==null ? '' : Number(item.chromaFeather),
      item.updatedAt || nowIso(),
      item.updatedBy || 'app',
      S.spreadsheetId || '',
      S.sheetGid ?? ''
    ];

    // ★ ここが本題：values.append は「:append」が必須
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${S.spreadsheetId}/values/${encodeURIComponent(S.title+'!A:N')}:append`;
    const qs  = { valueInputOption:'RAW', insertDataOption:'INSERT_ROWS' };

    await fjson(gv(url, qs), {
      method:'POST',
      body: JSON.stringify({ values: [row] /* majorDimension: ROWS (デフォルト) */ })
    });
    log('appended', item.key || item.materialKey || '(no-key)');
  }

  // ===== lm:sheet-context を取り込む =====
  window.addEventListener('lm:sheet-context', (ev)=>{
    const d = ev?.detail || ev;
    if (!d?.spreadsheetId) { warn('sheet-context missing spreadsheetId'); return; }
    S.spreadsheetId = d.spreadsheetId;
    if (d.sheetGid != null) S.sheetGid = d.sheetGid;
    log('sheet-context bound:', S.spreadsheetId, 'gid=', S.sheetGid);
  }, { once:false });

  // ===== export =====
  window.materialsSheetBridge = {
    ensureSheet,
    loadAll,
    upsertOne,
    config: S,
  };
})();
