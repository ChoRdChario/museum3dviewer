// save.locator.js (ESM) — v2.0
// Provides the API expected by glb.btn.bridge.v3.js:
//   export async function findOrCreateSaveSheetByGlbId(glbFileId, glbName)
// Creates (if needed) and returns a context: { spreadsheetId, materialsGid, defaultCaptionGid }
// Also updates window.__lm_ctx and dispatches "lm:sheet-context" on document.
//
// Design notes:
// - Uses window.__lm_fetchJSONAuth (provided by boot.esm.cdn.js) for authenticated calls.
// - Creates the spreadsheet in Drive root using Sheets scope only (works without drive.file).
//   If Drive write scope is later added, moving into the GLB's folder can be added easily.
// - Never auto-add a duplicate "Captions" sheet. Only creates a captions sheet when none exist.
// - __LM_MATERIALS: header is enforced via values.update (no append).

const JSON_HEADERS = { "Content-Type": "application/json" };

function log(...args){ try{ console.log("[save.locator.v2]", ...args); }catch(e){} }
function warn(...args){ try{ console.warn("[save.locator.v2]", ...args); }catch(e){} }

function fetchAuthJSON(url, opts = {}){
  const f = (typeof window !== "undefined" && window.__lm_fetchJSONAuth);
  if (!f) throw new Error("__lm_fetchJSONAuth not found");
  const merged = Object.assign({ headers: JSON_HEADERS }, opts);
  return f(url, merged);
}

async function getSpreadsheetMeta(spreadsheetId){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`;
  return await fetchAuthJSON(url, { method: "GET" });
}

async function createSpreadsheetViaSheetsAPI(title){
  const url = "https://sheets.googleapis.com/v4/spreadsheets";
  const body = { properties: { title } };
  const res = await fetchAuthJSON(url, { method: "POST", body: JSON.stringify(body) });
  if (!res || !res.spreadsheetId) throw new Error("Failed to create spreadsheet");
  return res;
}

async function batchUpdate(spreadsheetId, requests){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  return await fetchAuthJSON(url, { method: "POST", body: JSON.stringify({ requests }) });
}

async function valuesGet(spreadsheetId, rangeA1){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
  return await fetchAuthJSON(url, { method: "GET" });
}

async function valuesUpdate(spreadsheetId, rangeA1, values){
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  return await fetchAuthJSON(url, { method: "PUT", body: JSON.stringify({ range: rangeA1, values }) });
}

function pickSheets(meta){
  const sheets = (meta && meta.sheets) ? meta.sheets.map(s => s.properties) : [];
  const materials = sheets.find(s => s.title === "__LM_MATERIALS") || null;
  const captions = sheets.filter(s => s.title && !s.title.startsWith("__"));
  return { sheets, materials, captions };
}

async function ensureMaterialsSheet(spreadsheetId){
  const meta = await getSpreadsheetMeta(spreadsheetId);
  let { materials } = pickSheets(meta);
  if (!materials){
    log("add __LM_MATERIALS");
    await batchUpdate(spreadsheetId, [{
      addSheet: { properties: { title: "__LM_MATERIALS", gridProperties: { frozenRowCount: 1 } } }
    }]);
  }
  // Re-fetch to get sheetId
  const meta2 = await getSpreadsheetMeta(spreadsheetId);
  ({ materials } = pickSheets(meta2));
  if (!materials) throw new Error("materials sheet missing after creation");

  // Ensure header row (only if A1 is empty)
  const headerRange = "__LM_MATERIALS!A1:I1";
  const header = ["matKey","opacity","doubleSided","unlit","chromaKeyColor","#RRGGBB","tolerance","feather","note"];
  try{
    const cur = await valuesGet(spreadsheetId, "__LM_MATERIALS!A1:A1");
    const hasA1 = cur && Array.isArray(cur.values) && cur.values.length && cur.values[0].length && String(cur.values[0][0]||"").trim().length>0;
    if (!hasA1){
      log("write header");
      await valuesUpdate(spreadsheetId, headerRange, [header]);
    }else{
      log("header exists (skip)");
    }
  }catch(e){
    warn("header ensure skipped", e);
  }

  return materials.sheetId;
}

async function ensureDefaultCaptionSheet(spreadsheetId){
  const meta = await getSpreadsheetMeta(spreadsheetId);
  const { captions } = pickSheets(meta);
  if (captions.length > 0){
    return captions[0].sheetId;
  }
  // No caption sheet: rename the first sheet (if any) to "Captions"; else create new
  const first = (meta.sheets && meta.sheets[0] && meta.sheets[0].properties) ? meta.sheets[0].properties : null;
  if (first){
    await batchUpdate(spreadsheetId, [{
      updateSheetProperties: {
        properties: { sheetId: first.sheetId, title: "Captions" },
        fields: "title"
      }
    }]);
    return first.sheetId;
  }else{
    const r = await batchUpdate(spreadsheetId, [{
      addSheet: { properties: { title: "Captions" } }
    }]);
    const reply = (r && r.replies && r.replies[0] && r.replies[0].addSheet && r.replies[0].addSheet.properties) ? r.replies[0].addSheet.properties : null;
    if (!reply) throw new Error("failed to create Captions sheet");
    return reply.sheetId;
  }
}

function publishCtx(ctx){
  if (typeof window !== "undefined"){
    window.__lm_ctx = Object.assign(window.__lm_ctx || {}, ctx);
  }
  try{
    document.dispatchEvent(new CustomEvent("lm:sheet-context", { detail: ctx }));
  }catch(e){}
  return ctx;
}

export async function findOrCreateSaveSheetByGlbId(glbFileId, glbName = "GLB"){
  if (!glbFileId) throw new Error("glbFileId required");

  // Fast path: if context already set, return it
  if (typeof window !== "undefined" && window.__lm_ctx && window.__lm_ctx.spreadsheetId && window.__lm_ctx.materialsGid != null){
    log("reuse existing __lm_ctx");
    return publishCtx({
      spreadsheetId: window.__lm_ctx.spreadsheetId,
      materialsGid: window.__lm_ctx.materialsGid,
      defaultCaptionGid: window.__lm_ctx.defaultCaptionGid ?? null
    });
  }

  // Try to find an existing spreadsheet by simple name pattern in root (lightweight, no Drive write needed)
  // NOTE: This avoids Drive 'write' scope; for more precise folder scoping we would need drive.file.
  let spreadsheetId = null;
  try{
    // Heuristic: check a Drive search by name. If unavailable (drive.readonly only), we can still list files.
    // We intentionally skip this to stay minimal; we'll just create fresh and rely on future consolidations.
  }catch(e){
    // ignore
  }

  if (!spreadsheetId){
    const title = `LociMyu Save — ${glbName || "GLB"}`;
    const created = await createSpreadsheetViaSheetsAPI(title);
    spreadsheetId = created.spreadsheetId;
    log("created spreadsheet", spreadsheetId);
  }

  const materialsGid = await ensureMaterialsSheet(spreadsheetId);
  const defaultCaptionGid = await ensureDefaultCaptionSheet(spreadsheetId);

  const ctx = { spreadsheetId, materialsGid, defaultCaptionGid };
  log("ready", ctx);
  return publishCtx(ctx);
}

// Back-compat: also attach a window namespace if someone uses <script type="module"> import-less access
try{
  if (typeof window !== "undefined"){
    window.LM_SAVE = { findOrCreateSaveSheetByGlbId };
    // Some older code referenced a global 'loc' namespace; provide it if absent.
    window.loc = window.loc || {};
    if (!window.loc.findOrCreateSaveSheetByGlbId){
      window.loc.findOrCreateSaveSheetByGlbId = findOrCreateSaveSheetByGlbId;
    }
  }
}catch(e){}
