// materials.sheet.persist.js — LM_MaterialsPersist (append-only to __LM_MATERIALS!A:N)
(function(){
  const TAG = '[LM_MaterialsPersist]';
  const log  = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

  // ---- コンテキスト取得（現在のスプレッドシート / シートGID） ----
  function getActiveSheetContext(){
    const ssid = window.__LM_ACTIVE_SPREADSHEET_ID || (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.spreadsheetId);
    const gid  = window.__LM_ACTIVE_SHEET_GID   || (window.__LM_SHEET_CTX && window.__LM_SHEET_CTX.sheetGid);
    if (!ssid) return null;
    return {
      spreadsheetId: String(ssid),
      sheetGid:      gid != null ? String(gid) : ''
    };
  }

  // ---- __LM_MATERIALS ヘッダの保証 ----
  async function ensureHeaders(){
    const ctx = getActiveSheetContext();
    if (!ctx){
      warn('ensureHeaders: no active sheet context');
      return;
    }
    const fn = window.__lm_ensureMaterialsHeader || window.ensureMaterialsHeader;
    if (typeof fn !== 'function'){
      warn('ensureHeaders: __lm_ensureMaterialsHeader missing');
      return;
    }
    try{
      await fn(ctx.spreadsheetId);
    }catch(e){
      warn('ensureHeaders failed', e);
    }
  }

  // ---- 認可付き fetch の確保 ----
  async function ensureAuthFetch(){
    if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
    try{
      // auth.fetch.bridge.js を優先して読み込み
      const mod = await import('./auth.fetch.bridge.js');
      if (typeof mod?.default === 'function'){
        await mod.default();
      }
    }catch(e){
      warn('auth.fetch.bridge import failed', e);
    }
    if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;

    // それでも無ければ shim 依存
    try{
      await import('./auth.fetch.shim.js');
    }catch(e){
      warn('auth.fetch.shim import failed', e);
    }
    if (typeof window.__lm_fetchJSONAuth !== 'function'){
      throw new Error('__lm_fetchJSONAuth not available');
    }
    return window.__lm_fetchJSONAuth;
  }

  // ---- 1 行 append ----
  async function appendRowForContext(ctx, row){
    const fetchAuth = await ensureAuthFetch();
    const range = encodeURIComponent('__LM_MATERIALS!A:N');
    const url = `${SHEETS}/${ctx.spreadsheetId}/values/${range}:append` +
                `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    await fetchAuth(url, {
      method: 'POST',
      json: { values: [row] }
    });
  }

  /**
   * upsert(patch)
   * patch: {
   *   materialKey, opacity, doubleSided, unlitLike,
   *   chromaEnable, chromaColor, chromaTolerance, chromaFeather,
   *   roughness?, metalness?, emissiveHex?
   * }
   * Append-only だが、auto.apply 側が「最後に現れた行」を採用するので、更新として振る舞う。
   */
  async function upsert(patch){
    const ctx = getActiveSheetContext();
    if (!ctx){
      warn('upsert: no active sheet context (__LM_ACTIVE_SPREADSHEET_ID / __LM_ACTIVE_SHEET_GID)');
      return;
    }
    const key = patch && patch.materialKey;
    if (!key){
      warn('upsert: materialKey required');
      return;
    }

    await ensureHeaders();

    const now  = new Date().toISOString();
    const user = window.__LM_USER_EMAIL || window.__LM_USER_NAME || '';

    // A..N までの 14 列（auto.apply 側の rowToObj と揃える）
    const row = [
      key,                                  // A: materialKey
      patch.opacity ?? '',                  // B: opacity
      patch.doubleSided === undefined ? '' : !!patch.doubleSided,  // C: doubleSided
      patch.unlitLike   === undefined ? '' : !!patch.unlitLike,    // D: unlitLike
      patch.chromaEnable === undefined ? '' : !!patch.chromaEnable,// E: chromaEnable
      patch.chromaColor || '#000000',       // F: chromaColor
      patch.chromaTolerance ?? 0,           // G: chromaTolerance
      patch.chromaFeather   ?? 0,           // H: chromaFeather
      patch.roughness  ?? '',               // I: roughness
      patch.metalness  ?? '',               // J: metalness
      patch.emissiveHex ?? '',              // K: emissiveHex
      now,                                  // L: updatedAt
      user,                                 // M: updatedBy
      ctx.sheetGid || ''                    // N: sheetGid
    ];

    try{
      await appendRowForContext(ctx, row);
      log('upsert row', { materialKey: key, sheetGid: ctx.sheetGid });
    }catch(e){
      warn('upsert failed', e);
    }
  }

  // ---- 公開 API ----
  window.LM_MaterialsPersist = {
    ensureHeaders,
    upsert,
  };

  // ---- 互換用：__LM_MATERIALS への通常 append を塞ぐフラグ ----
  function forbidAppendToMaterials(range){
    if (!range) return false;
    return /^__LM_MATERIALS!/i.test(range);
  }

  // 既存の materialsPersist にぶら下げ（caption 側の append ガード用）
  window.materialsPersist = Object.assign(window.materialsPersist || {}, {
    ensureMaterialsHeader: window.__lm_ensureMaterialsHeader,
    forbidAppendToMaterials,
  });

  log('ready');
})();
