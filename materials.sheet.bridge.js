// materials.sheet.bridge.js
// Bridge for __LM_MATERIALS sheet (append-only, latest-row-wins)

(() => {
  const SHEET_NAME = '__LM_MATERIALS';
  const HEADERS = [
    'key',          // stable row id (uuid if you want; we can ignore when appending)
    'modelKey',     // GLB/model id if any (optional for now)
    'materialKey',  // viewer material name/key
    'opacity',      // 0..1 number
    'doubleSided',  // 0/1
    'unlit',        // 0/1
    'chromaEnable', // 0/1
    'chromaColor',  // e.g. #ffffff (reserved)
    'chromaTolerance', // number
    'chromaFeather',   // number
    'updatedAt',    // ISO string
    'updatedBy',    // e.g. 'mat-orch'
    'spreadsheetId',
    'sheetGid',
  ];

  function nowIso() { return new Date().toISOString(); }

  // --- tiny helpers ---
  async function fjson(url, init = {}) {
    // すべての Sheets API 呼び出しは __lm_fetchJSONAuth を通す
    if (typeof window.__lm_fetchJSONAuth !== 'function') {
      throw new Error('__lm_fetchJSONAuth missing');
    }
    return await window.__lm_fetchJSONAuth(url, init);
  }

  function requireCtx(ctx) {
    if (!ctx || !ctx.spreadsheetId) {
      throw new Error('spreadsheetId missing');
    }
  }

  async function getSpreadsheet(spreadsheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`;
    return await fjson(url);
  }

  async function addSheet(spreadsheetId, title) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const body = {
      requests: [{ addSheet: { properties: { title } } }],
    };
    const res = await fjson(url, { method: 'POST', body: JSON.stringify(body) });
    const prop = res.replies?.[0]?.addSheet?.properties;
    return prop?.sheetId;
  }

  async function writeHeaders(spreadsheetId, title) {
    const range = `${title}!A1:${String.fromCharCode('A'.charCodeAt(0) + HEADERS.length - 1)}1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const body = { range, majorDimension: 'ROWS', values: [HEADERS] };
    await fjson(url, { method: 'PUT', body: JSON.stringify(body) });
  }

  async function ensureSheet(ctx) {
    requireCtx(ctx);
    const spreadsheetId = ctx.spreadsheetId;

    // 既存シート探索
    const meta = await getSpreadsheet(spreadsheetId);
    const found = meta.sheets?.find(s => s.properties?.title === SHEET_NAME);
    if (found) {
      return { title: SHEET_NAME, sheetId: found.properties.sheetId };
    }

    // なければ作成→ヘッダ書き込み
    const sheetId = await addSheet(spreadsheetId, SHEET_NAME);
    await writeHeaders(spreadsheetId, SHEET_NAME);
    return { title: SHEET_NAME, sheetId };
  }

  // 最新行だけを採用する正規化（materialKey -> latestRowObj）
  function normalizeLatest(rows) {
    const byKey = new Map();
    for (const r of rows) {
      const key = r.materialKey;
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, r); continue; }
      // updatedAt 降順、なければ自然順
      const a = Date.parse(prev.updatedAt || '') || 0;
      const b = Date.parse(r.updatedAt || '') || 0;
      if (b >= a) byKey.set(key, r);
    }
    return byKey;
  }

  async function loadAll(ctx) {
    requireCtx(ctx);
    const spreadsheetId = ctx.spreadsheetId;
    const { title } = await ensureSheet(ctx);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${title}!A2:Z`)}`;
    const json = await fjson(url);
    const values = json.values || [];

    // ヘッダ順にマッピング
    const rows = values.map(arr => {
      const o = {};
      for (let i = 0; i < HEADERS.length; i++) {
        const k = HEADERS[i];
        o[k] = arr[i] ?? '';
      }
      // 型整形
      o.opacity = Number(o.opacity || 0);
      o.doubleSided = Number(o.doubleSided || 0);
      o.unlit = Number(o.unlit || 0);
      o.chromaEnable = Number(o.chromaEnable || 0);
      o.chromaTolerance = Number(o.chromaTolerance || 0);
      o.chromaFeather = Number(o.chromaFeather || 0);
      return o;
    });

    return normalizeLatest(rows); // Map(materialKey -> latestRowObj)
  }

  async function upsertOne(ctx, partial) {
    requireCtx(ctx);
    const spreadsheetId = ctx.spreadsheetId;
    const sheetGid = String(ctx.sheetGid ?? '');
    const { title } = await ensureSheet(ctx);

    const row = {
      key: partial.key || '',
      modelKey: partial.modelKey || '',
      materialKey: partial.materialKey || '',
      opacity: partial.opacity ?? '',
      doubleSided: partial.doubleSided ?? '',
      unlit: partial.unlit ?? '',
      chromaEnable: partial.chromaEnable ?? '',
      chromaColor: partial.chromaColor ?? '',
      chromaTolerance: partial.chromaTolerance ?? '',
      chromaFeather: partial.chromaFeather ?? '',
      updatedAt: nowIso(),
      updatedBy: 'mat-orch',
      spreadsheetId,
      sheetGid,
    };
    const range = `${title}!A1`; // append は開始セルだけでOK
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const body = {
      range,
      majorDimension: 'ROWS',
      values: [HEADERS.map(h => row[h] ?? '')],
    };
    await fjson(url, { method: 'POST', body: JSON.stringify(body) });
    return row;
  }

  // イベントバインド：sheet-context を保持
  let currentCtx = null;
  window.addEventListener('lm:sheet-context', (ev) => {
    currentCtx = ev.detail || ev; // { spreadsheetId, sheetGid }
    console.log('[mat-sheet] sheet-context bound:', currentCtx);
  });

  // 外部公開
  window.materialsSheetBridge = {
    ensureSheet,
    loadAll: (ctx = currentCtx) => loadAll(ctx),
    upsertOne: (partial, ctx = currentCtx) => upsertOne(ctx, partial),
  };

  console.log('[mat-sheet] ready');
})();
