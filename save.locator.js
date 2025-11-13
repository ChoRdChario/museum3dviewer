// save.locator.js — COMPLETE REPLACEMENT (DriveAPI-first create in GLB folder)
// Version: V6_16g_DRIVE_PARENT_CREATE
// Responsibility:
//  - Create/find spreadsheet IN THE SAME FOLDER AS THE GLB using Drive API (parents)
//  - Ensure __LM_MATERIALS sheet exists and header row A1:Z1 is set (26 columns)
//  - Do not create duplicate Captions sheet; only create if missing (guarded)
//  - Expose findOrCreateSaveSheetByGlbId(glbId) and __debug_createNow(name)
//  - Emit lm:sheet-context event and update window.__lm_ctx when ready
//
// Requirements:
//  - __lm_fetchJSONAuth(url, init) must exist (boot.esm.cdn.js provides it)
//  - Scopes MUST include: spreadsheets, drive.file
//
// Notes:
//  - This file is ESM-compatible. It avoids global pollution except __lm_ctx/event.

const LOG_PREFIX = "[save.locator]";

function log(...args){ try{ console.log(LOG_PREFIX, ...args);}catch{} }
function warn(...args){ try{ console.warn(LOG_PREFIX, ...args);}catch{} }
function err(...args){ try{ console.error(LOG_PREFIX, ...args);}catch{} }

function needAuth(){
  if (typeof __lm_fetchJSONAuth !== "function"){
    throw new Error("__lm_fetchJSONAuth not found");
  }
}

// ----- Google API helpers -----
async function gget(url){
  needAuth();
  return await __lm_fetchJSONAuth(url, { method: "GET" });
}
async function gpost(url, body){
  needAuth();
  return await __lm_fetchJSONAuth(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined
  });
}
async function gpatch(url, body){
  needAuth();
  return await __lm_fetchJSONAuth(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined
  });
}

// ----- Utils -----
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Encode a Sheets A1 range with the quoted sheet title safely.
function quotedRange(title, a1){
  // Title may contain spaces or symbols; Sheets requires single-quoted title.
  const t = `'${title.replace(/'/g, "''")}'`;
  return `${t}!${a1}`;
}

// ----- Drive helpers -----
async function getGlbParentId(glbFileId){
  const resp = await gget(`https://www.googleapis.com/drive/v3/files/${glbFileId}?fields=parents`);
  const parents = resp.parents || [];
  if (!parents.length) throw new Error("GLB file has no parent folder");
  return parents[0];
}

async function createSpreadsheetViaDriveAPI(name, parentId){
  const qs = "fields=id,name,parents";
  const file = await gpost(`https://www.googleapis.com/drive/v3/files?${qs}`, {
    name,
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: [parentId]
  });
  // Drive returns file.id which equals spreadsheetId
  return { spreadsheetId: file.id };
}

// ----- Sheets helpers -----
const MATERIAL_SHEET_TITLE = "__LM_MATERIALS";

function buildMaterialsHeader26(){
  const header = [
    "__LM_MATERIALS", "version", "matKey", "opacity", "doubleSided",
    "unlitLike", "chromaKeyColor", "chromaTol", "chromaFeather",
    "note"
  ];
  while (header.length < 26) header.push("");
  return header;
}

async function ensureSheetExists(spreadsheetId, title){
  // Try to add; if already exists, API will fail → we ignore and continue
  try{
    await gpost(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      requests: [{ addSheet: { properties: { title } } }]
    });
  }catch(e){
    // If error is "already exists", ignore; otherwise rethrow
    const s = (e && e.message) || "";
    if (!/already exists|Duplicate sheet/.test(s)) {
      // Could also be permissions; surface it
      throw e;
    }
  }
}

async function readSpreadsheetMeta(spreadsheetId){
  return await gget(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`);
}

function hasSheet(meta, title){
  const sheets = (meta && meta.sheets) || [];
  return sheets.some(s => s.properties && s.properties.title === title);
}

async function ensureMaterialsHeader(spreadsheetId){
  // Ensure sheet exists first
  await ensureSheetExists(spreadsheetId, MATERIAL_SHEET_TITLE);

  // Now PUT A1:Z1 exactly 26 values
  const values = [ buildMaterialsHeader26() ];
  const range = quotedRange(MATERIAL_SHEET_TITLE, "A1:Z1");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;

  await __lm_fetchJSONAuth(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values })
  });
}

// Avoid duplicate default captions creation by checking presence.
const DEFAULT_CAPTION_TITLE = "Captions";

async function ensureDefaultCaptionSheet(spreadsheetId){
  const meta = await readSpreadsheetMeta(spreadsheetId);
  if (hasSheet(meta, DEFAULT_CAPTION_TITLE)) {
    return; // already exists
  }
  await ensureSheetExists(spreadsheetId, DEFAULT_CAPTION_TITLE);
}

// Resolve a sheet title to gid (sheetId)
async function resolveTitleToGid(spreadsheetId, title){
  const meta = await readSpreadsheetMeta(spreadsheetId);
  const sheets = (meta && meta.sheets) || [];
  const hit = sheets.find(s => s.properties && s.properties.title === title);
  if (!hit) return null;
  return hit.properties.sheetId;
}

// ----- Public main flow -----
export async function findOrCreateSaveSheetByGlbId(glbFileId){
  needAuth();

  // 1) Create spreadsheet in GLB parent folder (or find existing by name rule if you have one)
  const parentId = await getGlbParentId(glbFileId);
  const name = "LociMyu Save Data"; // If you have stronger naming rules, adjust here.

  const { spreadsheetId } = await createSpreadsheetViaDriveAPI(name, parentId);

  // 2) Ensure special sheets
  await ensureMaterialsHeader(spreadsheetId);
  await ensureDefaultCaptionSheet(spreadsheetId);

  // 3) Resolve gids and emit context
  const materialsGid = await resolveTitleToGid(spreadsheetId, MATERIAL_SHEET_TITLE);
  const defaultCaptionGid = await resolveTitleToGid(spreadsheetId, DEFAULT_CAPTION_TITLE);

  const ctx = {
    spreadsheetId,
    materialsGid: materialsGid ?? null,
    defaultCaptionGid: defaultCaptionGid ?? null
  };

  // Store on window and dispatch event for listeners
  if (typeof window !== "undefined"){
    window.__lm_ctx = Object.assign(window.__lm_ctx || {}, ctx);
    document.dispatchEvent(new CustomEvent("lm:sheet-context", { detail: ctx }));
  }

  log("ready", ctx);
  return ctx;
}

// Useful for console manual testing
export async function __debug_createNow(name="LociMyu Save Data"){
  needAuth();
  // try to create in root (no parents) as a sanity check
  const { spreadsheetId } = await createSpreadsheetViaDriveAPI(name, undefined);
  await ensureMaterialsHeader(spreadsheetId);
  await ensureDefaultCaptionSheet(spreadsheetId);
  const materialsGid = await resolveTitleToGid(spreadsheetId, MATERIAL_SHEET_TITLE);
  const defaultCaptionGid = await resolveTitleToGid(spreadsheetId, DEFAULT_CAPTION_TITLE);

  const ctx = { spreadsheetId, materialsGid, defaultCaptionGid };
  if (typeof window !== "undefined"){
    window.__lm_ctx = Object.assign(window.__lm_ctx || {}, ctx);
    document.dispatchEvent(new CustomEvent("lm:sheet-context", { detail: ctx }));
  }
  log("ready", ctx);
  return ctx;
}

export default { findOrCreateSaveSheetByGlbId, __debug_createNow };
