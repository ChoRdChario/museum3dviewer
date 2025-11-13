// save.locator.js  (ESM self-contained / no __lm_fetchJSONAuth dependency)
// Sheets API だけでスプレッドシートを新規作成（ルートに作成）し、__LM_MATERIALS と Captions(初回のみ) を保証。
// window.__lm_ctx を更新し、"lm:sheet-context" を dispatch。

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

// --- core ops ---
async function createSpreadsheetViaSheetsAPI(title) {
  const body = {
    properties: { title },
    sheets: [
      { properties: { title: MATERIALS_TITLE } },
      // Captions は「初回のみ」作る想定だが、新規時は 1枚作っておく
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
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets(properties(title,sheetId))`;
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

  const resp = await batchUpdate(spreadsheetId, [
    { addSheet: { properties: { title } } }
  ]);
  // 追加直後の sheetId を取り直し
  const ss2 = await getSpreadsheet(spreadsheetId);
  const hit2 = findSheetByTitle(ss2, title);
  if (!hit2) throw new Error(`failed to add sheet: ${title}`);
  return hit2.properties.sheetId;
}

// __LM_MATERIALS のヘッダは PUT で強制（append 禁止）
async function ensureMaterialsHeader(spreadsheetId) {
  // 必要なヘッダは要件に合わせて調整
  const header = [
    "key","materialName","opacity","doubleSided","unlitLike",
    "chromaKey","chromaTol","chromaFeather","notes","updatedAt"
  ];
  const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${MATERIALS_TITLE}'!A1:${String.fromCharCode(64+header.length)}1`)}?valueInputOption=RAW`;
  await fetchAuthJSON(url, {
    method: 'PUT',
    body: JSON.stringify({ range: `'${MATERIALS_TITLE}'!A1:Z1`, values: [header] })
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
  // 1) GLB名ベースで新規SSを作成（毎回作らない！すでに紐づきがあるなら別途ロジックで復旧する想定）
  //   - 今回はまず「確実に 1つ作れる」ことを優先し、新規作成→ctx設定 までを保証。
  const title = `LociMyu - ${glbName}`;
  const created = await createSpreadsheetViaSheetsAPI(title);
  const spreadsheetId = created.spreadsheetId;

  // 2) __LM_MATERIALS 確保 & ヘッダ強制
  const materialsGid = await ensureSheetExists(spreadsheetId, MATERIALS_TITLE);
  await ensureMaterialsHeader(spreadsheetId);

  // 3) Captions（初回のみ）
  await ensureCaptionsOnce(spreadsheetId);
  const ssAfter = await getSpreadsheet(spreadsheetId);
  const capHit = findSheetByTitle(ssAfter, CAPTIONS_TITLE);
  const defaultCaptionGid = capHit?.properties?.sheetId ?? null;

  // 4) ctx 反映 + イベント
  const ctx = {
    spreadsheetId,
    materialsGid,
    defaultCaptionGid
  };
  window.__lm_ctx = Object.assign(window.__lm_ctx || {}, ctx);
  document.dispatchEvent(new CustomEvent("lm:sheet-context", {
    detail: { spreadsheetId, sheetGid: defaultCaptionGid }
  }));

  // 互換（古い呼び出しが window.loc / window.LM_SAVE を参照しても動くように）
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
