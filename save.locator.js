
// save.locator.js
// ESM module that also exposes an imperative API on window for non-module callers.
// Responsibilities:
// 1) Capture current GLB id/name (defensive shim around setCurrentGlbId).
// 2) Given a glbId (+ optional glbName), find or create a spreadsheet next to the GLB.
// 3) Ensure a "__LM_MATERIALS" sheet with a strict header exists (no data rows).
// 4) Return { spreadsheetId, materialsSheetId, materialsGid }.

const log = (...a) => console.log("[save.locator]", ...a);
const warn = (...a) => console.warn("[save.locator]", ...a);
const err = (...a) => console.error("[save.locator]", ...a);

// OAuth-aware fetch provided by boot.hotfix
function fx(url, opt={}) {
  const f = (window.__lm_fetchJSONAuth || window.__lm_fetchJSON);
  if (!f) throw new Error("__lm_fetchJSONAuth not found");
  return f(url, opt);
}

// Capture helpers
function installGlbIdCaptureShim() {
  if (window.__LM__GLB_CAPTURE_INSTALLED) return;
  window.__LM__GLB_CAPTURE_INSTALLED = true;

  const prev = window.setCurrentGlbId;
  window.setCurrentGlbId = function patchedSetCurrentGlbId(id, name) {
    try {
      if (id) window.__LM_CURRENT_GLB_ID = id;
      if (name) window.__LM_CURRENT_GLB_NAME = name;
      log("captured setCurrentGlbId", { id, name });
    } catch (e) { warn("capture failed", e); }
    if (typeof prev === "function") return prev.apply(this, arguments);
  };
  // Best-effort: also watch bridge helper if present
  window.__LM_CAPTURE_GLB_META = function(meta={}){
    const { id, fileId, name } = meta;
    const gid = id || fileId;
    if (gid) window.__LM_CURRENT_GLB_ID = gid;
    if (name) window.__LM_CURRENT_GLB_NAME = name;
    log("captured meta", { id: gid, name });
  };
}

// Utilities
function encodeQ(q){ return encodeURIComponent(q); }

async function driveGetFile(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents`;
  const res = await fx(url, { method: "GET" });
  if (!res || !res.id) throw new Error("driveGetFile failed");
  return res;
}

async function driveList(q, fields="files(id,name,parents,mimeType)") {
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&spaces=drive`;
  const res = await fx(url, { method:"GET" });
  return (res && res.files) || [];
}

async function driveMoveToParent(fileId, parentId) {
  // fetch current parents first
  const meta = await fx(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, { method:"GET" });
  const remove = (meta.parents || []).join(",");
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${parentId}${remove?`&removeParents=${remove}`:""}`;
  const res = await fx(url, { method:"PATCH", headers:{ "Content-Type":"application/json" }, body:"{}" });
  return res;
}

async function sheetsCreate(title) {
  const res = await fx("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title } })
  });
  if (!res || !res.spreadsheetId) throw new Error("sheetsCreate failed");
  return res;
}

async function sheetsBatchUpdate(spreadsheetId, requests) {
  const res = await fx(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests })
  });
  return res;
}

async function sheetsValuesUpdate(spreadsheetId, rangeA1, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  const res = await fx(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values })
  });
  return res;
}

async function sheetsGet(spreadsheetId) {
  const res = await fx(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, { method:"GET" });
  return res;
}

function findSheetByTitle(sheets, title) {
  for (const s of sheets || []) {
    if (s.properties && s.properties.title === title) return s;
  }
  return null;
}

function headerRow() {
  return [[
    "materialKey","opacity","chromaColor","chromaTolerance","chromaFeather",
    "doubleSided","unlitLike","updatedAt","updatedBy"
  ]];
}

async function ensureMaterialsSheet(spreadsheetId) {
  const meta = await sheetsGet(spreadsheetId);
  let sheet = findSheetByTitle(meta.sheets, "__LM_MATERIALS");
  if (!sheet) {
    await sheetsBatchUpdate(spreadsheetId, [{
      addSheet: { properties: { title: "__LM_MATERIALS" } }
    }]);
  }
  // Ensure header row only (we write header unconditionally; UI layer should block appends)
  await sheetsValuesUpdate(spreadsheetId, "__LM_MATERIALS!A1:I1", headerRow());
  const after = await sheetsGet(spreadsheetId);
  sheet = findSheetByTitle(after.sheets, "__LM_MATERIALS");
  const materialsSheetId = sheet?.properties?.sheetId;
  const materialsGid = materialsSheetId; // same id used as gid in URL context
  return { materialsSheetId, materialsGid };
}

function defaultSaveTitle(glbName) {
  const base = glbName || window.__LM_CURRENT_GLB_NAME || "Unnamed GLB";
  return `${base} — LociMyu Save`;
}

async function findExistingSaveSheet(parentId) {
  // Look for any spreadsheet in the GLB's folder whose name hints at LociMyu
  // This is intentionally broad to recover prior sessions.
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and name contains 'LociMyu'`;
  const files = await driveList(q, "files(id,name,parents)");
  return files[0] || null;
}

export async function findOrCreateSaveSheetByGlbId({ glbId, glbName } = {}) {
  log("module loaded (ESM export active)");
  if (!glbId) {
    glbId = window.__LM_CURRENT_GLB_ID;
  }
  if (!glbId) {
    throw new Error("glbId is required (no argument and no captured __LM_CURRENT_GLB_ID)");
  }
  const file = await driveGetFile(glbId);
  const parentId = (file.parents && file.parents[0]) || null;
  const name = glbName || file.name || window.__LM_CURRENT_GLB_NAME || "GLB";

  if (!parentId) throw new Error("GLB has no parent folder; cannot co-locate save sheet");

  let sheetFile = await findExistingSaveSheet(parentId);
  if (!sheetFile) {
    const created = await sheetsCreate(defaultSaveTitle(name));
    // Move to GLB folder
    await driveMoveToParent(created.spreadsheetId, parentId);
    sheetFile = { id: created.spreadsheetId };
  }

  const spreadsheetId = sheetFile.id;
  const { materialsSheetId, materialsGid } = await ensureMaterialsSheet(spreadsheetId);

  // Broadcast for anyone listening
  try { window.dispatchEvent(new CustomEvent("lm:save-sheet-ready", { detail: { spreadsheetId, materialsSheetId, materialsGid } })); } catch {}
  return { spreadsheetId, materialsSheetId, materialsGid };
}

// expose on window for non-module callers
installGlbIdCaptureShim();
window.__LM_SAVE_LOCATOR = { findOrCreateSaveSheetByGlbId, installGlbIdCaptureShim };
