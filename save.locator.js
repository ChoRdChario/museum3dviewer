// save.locator.js — minimal surgical fix (2025-11-13)
// - Fixes "Unexpected identifier '$'" by using proper template literals
// - Makes URL range and body.range exactly identical based on header width
// - Removes dependency on __lm_fetchJSONAuth (uses local fetchAuthJSON)
// - Avoids Captions の増殖: only create if missing
// - Exports: findOrCreateSaveSheetByGlbId(), __debug_createNow()

// ---- Auth helper (self-contained) ----
async function getAccessToken() {
  // import gauth lazily to avoid cyclic loads
  const g = await import('./gauth.module.js');
  const tok = await g.getAccessToken();
  if (!tok) throw new Error('No access token');
  return tok;
}

async function fetchAuthJSON(url, { method = 'GET', headers = {}, body } = {}) {
  const token = await getAccessToken();
  const h = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    ...headers
  };
  // auto-JSON if body is object
  let payload = body;
  if (body && typeof body === 'object' && !(body instanceof Blob)) {
    h['Content-Type'] = 'application/json; charset=UTF-8';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch(e) { /* keep text */ }
  if (!res.ok) {
    const detail = json ? JSON.stringify(json, null, 2) : text;
    throw new Error(`HTTP ${res.status}  :: ${detail}`);
  }
  return json;
}

// ---- A1 helpers ----
function colLetter(n /* 1-based */) {
  // 1->A, 26->Z, 27->AA
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function a1ForHeader(title, headerLen) {
  const endCol = colLetter(Math.max(1, headerLen));
  // Title must be single-quoted if it may include spaces/specials
  return `'${title}'!A1:${endCol}1`;
}

// ---- Domain constants ----
const MATERIALS_SHEET_TITLE = "__LM_MATERIALS";
const DEFAULT_CAPTIONS_TITLE = "Captions";

function materialsHeader() {
  // Keep existing order/keys; adjust here if you add/remove columns
  return [
    "key","mat.name","opacity","doubleSided","unlitLike",
    "chromaKey.enabled","chromaKey.color","#hex",
    "chromaKey.tolerance","chromaKey.feather"
  ];
}

// ---- Sheets small utils ----
async function getSpreadsheet(sid) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sid}`;
  return await fetchAuthJSON(url, { method: 'GET' });
}

function findSheet(sheets, title) {
  return (sheets || []).map(s => s.properties).find(p => p && p.title === title);
}

async function addSheetIfMissing(sid, title) {
  const meta = await getSpreadsheet(sid);
  const already = findSheet(meta.sheets, title);
  if (already) return already;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sid}:batchUpdate`;
  const body = {
    requests: [{ addSheet: { properties: { title } } }]
  };
  const res = await fetchAuthJSON(url, { method: 'POST', body });
  // batchUpdate returns replies; fetch fresh meta to get consistent properties
  const meta2 = await getSpreadsheet(sid);
  return findSheet(meta2.sheets, title);
}

async function ensureMaterialsHeader(sid) {
  const header = materialsHeader();
  const a1 = a1ForHeader(MATERIALS_SHEET_TITLE, header.length); // e.g. "'__LM_MATERIALS'!A1:J1"
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(a1)}?valueInputOption=RAW`;
  const body = {
    range: a1,
    majorDimension: "ROWS",
    values: [ header ]
  };
  await fetchAuthJSON(url, { method: 'PUT', body });
}

async function createSpreadsheetViaSheetsAPI(glbName = "GLB") {
  const title = `LociMyu ${glbName} ${new Date().toISOString().slice(0,10)}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets`;
  const body = {
    properties: { title, locale: "en_US", timeZone: "Asia/Tokyo" },
    sheets: [
      { properties: { title: MATERIALS_SHEET_TITLE } },
      { properties: { title: DEFAULT_CAPTIONS_TITLE } }
    ]
  };
  const json = await fetchAuthJSON(url, { method: 'POST', body });
  const sid = json.spreadsheetId;
  // Ensure header width matches our definition (first row overwrite is idempotent)
  await ensureMaterialsHeader(sid);
  // Return ids
  const meta = await getSpreadsheet(sid);
  const mat = findSheet(meta.sheets, MATERIALS_SHEET_TITLE);
  const cap = findSheet(meta.sheets, DEFAULT_CAPTIONS_TITLE);
  return { spreadsheetId: sid, materialsGid: mat?.sheetId ?? null, defaultCaptionGid: cap?.sheetId ?? null };
}

async function ensureCaptionsOnce(sid) {
  const meta = await getSpreadsheet(sid);
  if (findSheet(meta.sheets, DEFAULT_CAPTIONS_TITLE)) return;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sid}:batchUpdate`;
  const body = { requests: [{ addSheet: { properties: { title: DEFAULT_CAPTIONS_TITLE } } }] };
  await fetchAuthJSON(url, { method: 'POST', body });
}

// ---- Public: create/find entry point ----
export async function findOrCreateSaveSheetByGlbId(glbId, glbName = "GLB") {
  // Minimal: always create new spreadsheet (root). Later we can move into Drive folder by fileId if needed.
  const { spreadsheetId, materialsGid, defaultCaptionGid } = await createSpreadsheetViaSheetsAPI(glbName);
  await ensureCaptionsOnce(spreadsheetId);
  // Broadcast context for listeners
  window.__lm_ctx = Object.assign(window.__lm_ctx || {}, { spreadsheetId, materialsGid, defaultCaptionGid });
  document.dispatchEvent(new CustomEvent("lm:sheet-context", {
    detail: { spreadsheetId, materialsGid, defaultCaptionGid }
  }));
  console.log('[save.locator] ready', { spreadsheetId, materialsGid, defaultCaptionGid });
  return { spreadsheetId, materialsGid, defaultCaptionGid };
}

// ---- Debug helper (manual create) ----
export async function __debug_createNow(glbName = "GLB") {
  return await findOrCreateSaveSheetByGlbId(null, glbName);
}