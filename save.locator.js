// save.locator.js  (ESM self-contained / no __lm_fetchJSONAuth dependency)
// Sheets API でスプレッドシートを新規作成し、__LM_MATERIALS と Captions(初回のみ) を保証。
// window.__lm_ctx を更新し、"lm:sheet-context" を dispatch。
// 2025-11-13 fix: PUT range と values の range 不一致を修正

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const MATERIALS_TITLE = '__LM_MATERIALS';
const CAPTIONS_TITLE  = 'Captions';

// --- auth fetch (self-contained) ---
async function getToken() {
  // gauth.module.js は既存の実装を想定（getAccessToken を export）
  const g = await import('./gauth.module.js');
  const tok = await g.getAccessToken();
  if (!tok) throw new Error('no access token');
  return tok;
}
async function fetchAuthJSON(url, opts = {}) {
  const token = await getToken();
  const headers = new Headers(opts.headers || {});
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text}`);
  }
  return res.json();
}

// --- util ---
function findSheetByTitle(spreadsheet, title) {
  return (spreadsheet.sheets || []).find(s => s.properties && s.properties.title === title) || null;
}
function listSheetSummaries(spreadsheet) {
  return (spreadsheet.sheets || []).map(s => ({
    title: s.properties?.title,
    sheetId: s.properties?.sheetId
  }));
}
function colLetter(n){ // 1 -> A, 26 -> Z, 27 -> AA ...
  let s = '';
  while(n>0){ let r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); }
  return s;
}

// --- core ops ---
async function createSpreadsheetViaSheetsAPI(title) {
  const body = {
    properties: { title },
    sheets: [
      { properties: { title: MATERIALS_TITLE } },
      { properties: { title: CAPTIONS_TITLE } }
    ]
  };
  const created = await fetchAuthJSON(SHEETS_BASE, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return created; // has spreadsheetId, sheets
}

async function getSpreadsheet(spreadsheetId) {
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets(properties(title,sheetId))";
  return fetchAuthJSON(url, { method: 'GET' });
}

async function batchUpdate(spreadsheetId, requests) {
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  const json = await fetchAuthJSON(url, {
    method: 'POST',
    body: JSON.stringify({ requests })
  });
  return json;
}

async function ensureSheetExists(spreadsheetId, title) {
  const ss = await getSpreadsheet(spreadsheetId);
  const hit = findSheetByTitle(ss, title);
  if (hit) return hit.properties.sheetId;

  await batchUpdate(spreadsheetId, [
    { addSheet: { properties: { title } } }
  ]);
  // 追加直後の sheetId を取り直し
  const ss2 = await getSpreadsheet(spreadsheetId);
  const hit2 = findSheetByTitle(ss2, title);
  if (!hit2) throw new Error(`failed to add sheet: ${title}`);
  return hit2.properties.sheetId;
}

// __LM_MATERIALS のヘッダは PUT で強制（append 禁止）
// ※ PUT の URL に指定したレンジと body.range / values のサイズが一致していないと 400 になるため注意
async function ensureMaterialsHeader(spreadsheetId) {
  const header = [
    "key","materialName","opacity","doubleSided","unlitLike",
    "chromaKey","chromaTol","chromaFeather","notes","updatedAt"
  ];
  const endCol = colLetter(header.length); // A..J
  const a1 = `'${MATERIALS_TITLE}'!A1:${endCol}1`;

  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1)}?valueInputOption=RAW`;
  await fetchAuthJSON(url, {
    method: 'PUT',
    body: JSON.stringify({ range: a1, values: [header] })
  });
}

// Captions は「既に他にあるなら追加しない」。新規ブックのときだけ初期化用に存在していればOK。
async function ensureCaptionsOnce(spreadsheetId) {
  const ss = await getSpreadsheet(spreadsheetId);
  const hasCaptions = !!findSheetByTitle(ss, CAPTIONS_TITLE);
  if (hasCaptions) return;
  await batchUpdate(spreadsheetId, [
    { addSheet: { properties: { title: CAPTIONS_TITLE } } }
  ]);
}

// --- public API ---
export async function findOrCreateSaveSheetByGlbId(glbFileId, glbName = 'GLB') {
  const title = `LociMyu - ${glbName}`;
  const created = await createSpreadsheetViaSheetsAPI(title);
  const spreadsheetId = created.spreadsheetId;

  const materialsGid = await ensureSheetExists(spreadsheetId, MATERIALS_TITLE);
  await ensureMaterialsHeader(spreadsheetId);

  await ensureCaptionsOnce(spreadsheetId);
  const ssAfter = await getSpreadsheet(spreadsheetId);
  const capHit = findSheetByTitle(ssAfter, CAPTIONS_TITLE);
  const defaultCaptionGid = capHit?.properties?.sheetId ?? null;

  const ctx = { spreadsheetId, materialsGid, defaultCaptionGid };
  window.__lm_ctx = Object.assign(window.__lm_ctx || {}, ctx);
  document.dispatchEvent(new CustomEvent("lm:sheet-context", {
    detail: { spreadsheetId, sheetGid: defaultCaptionGid }
  }));

  // 互換
  window.loc = window.loc || {};
  window.loc.findOrCreateSaveSheetByGlbId = findOrCreateSaveSheetByGlbId;
  window.LM_SAVE = window.LM_SAVE || {};
  window.LM_SAVE.findOrCreateSaveSheetByGlbId = findOrCreateSaveSheetByGlbId;

  console.log('[save.locator] ready', ctx);
  return ctx;
}

// デバッグ用：手動で叩けるフック
export async function __debug_createNow(glbName='GLB'){
  return findOrCreateSaveSheetByGlbId('manual', glbName);
}
