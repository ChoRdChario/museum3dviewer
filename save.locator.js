
// save.locator.js — minimal, robust sheet creation & header setup
// ESM module

// --- Config ---
const MATERIALS_SHEET_TITLE = "__LM_MATERIALS";
const CAPTIONS_SHEET_TITLE  = "Captions";

// 10 columns -> J
const MATERIALS_HEADER = [
  "materialKey",
  "opacity",
  "doubleSided",
  "unlitLike",
  "chromaKeyColor",
  "tolerance",
  "feather",
  "lastUpdatedISO",
  "captionSheetGid",
  "note"
];

function colIndexToA1(n){
  let s = "";
  while (n > 0){
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function a1RangeForHeader(len){
  const endCol = colIndexToA1(len);
  return `A1:${endCol}1`;
}

async function getAccessToken(){
  // Lazy import to avoid early module load order issues
  const g = await import('./gauth.module.js');
  if (typeof g.getAccessToken === "function"){
    const tok = await g.getAccessToken();
    if (!tok) throw new Error("No access token");
    return tok;
  }
  throw new Error("gauth.getAccessToken not found");
}

async function fetchAuthJSON(url, init = {}){
  const token = await getAccessToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json; charset=utf-8");
  const res = await fetch(url, { ...init, headers });
  if (!res.ok){
    const text = await res.text().catch(()=> "");
    throw new Error(`HTTP ${res.status}  :: ${text}`);
  }
  return res.json();
}

function stringify(obj){
  return JSON.stringify(obj);
}

// --- Core ops ---
async function createSpreadsheetViaSheetsAPI(title){
  // Create with two sheets (__LM_MATERIALS, Captions)
  const body = {
    properties: { title },
    sheets: [
      { properties: { title: MATERIALS_SHEET_TITLE } },
      { properties: { title: CAPTIONS_SHEET_TITLE } },
    ]
  };
  const created = await fetchAuthJSON(
    "https://sheets.googleapis.com/v4/spreadsheets",
    { method: "POST", body: stringify(body) }
  );
  return created;
}

function findSheetInfoByTitle(spreadsheet, title){
  const sheet = (spreadsheet.sheets || []).find(s => s.properties && s.properties.title === title);
  if (!sheet) return null;
  return {
    gid: sheet.properties.sheetId,
    title: sheet.properties.title,
  };
}

async function ensureMaterialsHeader(spreadsheetId){
  const len = MATERIALS_HEADER.length;
  const a1  = a1RangeForHeader(len); // e.g., A1:J1
  // Use a SINGLE string for both URL and body.range (quote sheet name the same way)
  const quotedRange = `'${MATERIALS_SHEET_TITLE}'!${a1}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(quotedRange)}?valueInputOption=RAW`;
  const body = {
    range: quotedRange,                 // keep identical to URL range to avoid mismatch
    majorDimension: "ROWS",
    values: [ MATERIALS_HEADER ]
  };
  return fetchAuthJSON(url, { method: "PUT", body: stringify(body) });
}

// Best-effort search for existing spreadsheet: NOT implemented (kept minimal).
// For now, always CREATE new if caller demands a guaranteed sheet.
// If in the future we need search-by-name or Drive parent placement, add here.

// --- Public API ---
export async function findOrCreateSaveSheetByGlbId(glbId, glbName="GLB"){
  // 1) Create brand-new spreadsheet (minimal, robust path)
  const title = `LociMyu - ${glbName}`;
  const ss = await createSpreadsheetViaSheetsAPI(title);

  const materials = findSheetInfoByTitle(ss, MATERIALS_SHEET_TITLE);
  const captions  = findSheetInfoByTitle(ss, CAPTIONS_SHEET_TITLE);
  if (!materials || !captions){
    throw new Error("Expected sheets missing after create");
  }

  // 2) Put header only for __LM_MATERIALS (row-1 only; append 禁止)
  await ensureMaterialsHeader(ss.spreadsheetId);

  // 3) Context publish (window + event) for downstream listeners
  try {
    const ctx = {
      spreadsheetId: ss.spreadsheetId,
      materialsGid: materials.gid,
      defaultCaptionGid: captions.gid
    };
    // Keep both keys for old and new listeners (some listened to 'sheetGid')
    const detail = { ...ctx, sheetGid: captions.gid };

    // attach to window
    window.__lm_ctx = Object.assign(window.__lm_ctx || {}, ctx);

    // fire event
    document.dispatchEvent(new CustomEvent("lm:sheet-context", { detail }));
    console.log("[save.locator] ready", ctx);
  } catch (e){
    console.warn("[save.locator] ctx publish failed", e);
  }

  return {
    spreadsheetId: ss.spreadsheetId,
    materialsGid: materials.gid,
    defaultCaptionGid: captions.gid
  };
}

export async function __debug_createNow(glbName="GLB"){
  return findOrCreateSaveSheetByGlbId("debug", glbName);
}
