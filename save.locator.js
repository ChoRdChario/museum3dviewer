// save.locator.js (patched)
// - waits for auth bridge (__lm_fetchJSONAuth)
// - creates Spreadsheet (in GLB parent folder if possible)
// - ensures __LM_MATERIALS header (A1:Z1) and one captions sheet (no duplicates)
// - exposes lm:sheet-context on success
import ensureAuthBridge from './auth.fetch.bridge.js';

const TAG = "[save.locator]";

// Constants
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE  = "https://www.googleapis.com/drive/v3";

const MATERIALS_TITLE = "__LM_MATERIALS";
// 26 columns (A..Z)
const MATERIALS_HEADERS = [
  "key","matName","opacity","doubleSided","unlitLike","chromaKeyEnabled",
  "chromaColor","#r","#g","#b","tolerance",
  "feather","alphaClip","metalness","roughness","emissive","emissiveIntensity",
  "map","normalMap","metalnessMap","roughnessMap","emissiveMap","alphaMap",
  "side","blending","notes"
];

function A1(range){
  // Helper to URL-encode A1 with quotes for sheet title
  return encodeURIComponent(`'${MATERIALS_TITLE}'!${range}`);
}

async function needAuth(){
  const fn = await ensureAuthBridge();
  if (typeof fn !== "function") throw new Error("__lm_fetchJSONAuth not found");
  return fn;
}

// Drive helper (create spreadsheet in specific folder)
async function createSpreadsheetInFolder(fetchAuth, name, parentId){
  // Create Drive file with mimeType = Google Sheets and parent
  const meta = {
    name,
    mimeType: "application/vnd.google-apps.spreadsheet",
    parents: parentId ? [parentId] : undefined
  };
  const url = `${DRIVE_BASE}/files`;
  const res = await fetchAuth(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: meta
  });
  // res contains id but not sheets metadata; we need spreadsheetId
  const fileId = (typeof res === "string") ? (JSON.parse(res).id) : res.id;
  if (!fileId) throw new Error("Drive files.create returned no id");
  // Sheets API can open by fileId as spreadsheetId
  return fileId;
}

async function ensureMaterialsHeader(fetchAuth, spreadsheetId){
  // Ensure sheet exists and header row written A1:Z1
  // 1) ensure sheet present (add if missing)
  const meta = await fetchAuth(`${SHEETS_BASE}/${spreadsheetId}`);
  const hasMaterials = (meta.sheets||[]).some(s => s.properties && s.properties.title === MATERIALS_TITLE);
  if (!hasMaterials){
    await fetchAuth(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: {
        requests: [ { addSheet: { properties: { title: MATERIALS_TITLE } } } ]
      }
    });
  }
  // 2) write header (A1:Z1 exactly 26 columns)
  const values = [ MATERIALS_HEADERS ];
  const putUrl = `${SHEETS_BASE}/${spreadsheetId}/values/${A1("A1:Z1")}?valueInputOption=RAW`;
  await fetchAuth(putUrl, {
    method: "PUT",
    body: { range: `${MATERIALS_TITLE}!A1:Z1`, majorDimension: "ROWS", values }
  });
}

async function ensureDefaultCaptions(fetchAuth, spreadsheetId){
  // Create one captions sheet if none exists (excluding MATERIALS)
  const meta = await fetchAuth(`${SHEETS_BASE}/${spreadsheetId}`);
  const titles = (meta.sheets||[]).map(s => (s.properties||{}).title).filter(Boolean);
  const captionSheets = titles.filter(t => t !== MATERIALS_TITLE);
  if (captionSheets.length === 0){
    await fetchAuth(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: { requests: [ { addSheet: { properties: { title: "Captions" } } } ] }
    });
  }
}

function dispatchCtx(spreadsheetId, materialsGid, defaultCaptionGid){
  try {
    window.__lm_ctx = window.__lm_ctx || {};
    Object.assign(window.__lm_ctx, { spreadsheetId, materialsGid, defaultCaptionGid });
    document.dispatchEvent(new CustomEvent("lm:sheet-context", {
      detail: { spreadsheetId, materialsGid, defaultCaptionGid }
    }));
  } catch(_){}
}

export async function findOrCreateSaveSheetByGlbId(glbFileId){
  const fetchAuth = await needAuth();

  // 1) find GLB file's parent
  const file = await fetchAuth(`${DRIVE_BASE}/files/${glbFileId}?fields=id,name,parents`);
  const parentId = (file.parents && file.parents[0]) || undefined;

  // 2) look for an existing spreadsheet next to GLB (same parent)
  let spreadsheetId = null;
  if (parentId){
    const q = encodeURIComponent(f"'{parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and name contains 'LociMyu'");
  }
  // Simpler approach: always create for now (avoid Drive query complexities/permissions)
  const name = "LociMyu Save";
  const fileId = await createSpreadsheetInFolder(fetchAuth, name, parentId);
  spreadsheetId = fileId;

  // 3) ensure MATERIALS and Captions
  await ensureMaterialsHeader(fetchAuth, spreadsheetId);

  // We need gids: fetch meta again
  const meta2 = await fetchAuth(`${SHEETS_BASE}/${spreadsheetId}`);
  const materialsSheet = (meta2.sheets||[]).find(s => s.properties && s.properties.title === MATERIALS_TITLE);
  let materialsGid = materialsSheet ? materialsSheet.properties.sheetId : null;

  await ensureDefaultCaptions(fetchAuth, spreadsheetId);
  const meta3 = await fetchAuth(`${SHEETS_BASE}/${spreadsheetId}`);
  const captionsSheet = (meta3.sheets||[]).find(s => s.properties && s.properties.title !== MATERIALS_TITLE);
  const defaultCaptionGid = captionsSheet ? captionsSheet.properties.sheetId : null;

  console.log(TAG, "ready", { spreadsheetId, materialsGid, defaultCaptionGid });
  dispatchCtx(spreadsheetId, materialsGid, defaultCaptionGid);
  return { spreadsheetId, materialsGid, defaultCaptionGid };
}

// Debug helper for console
export async function __debug_createNow(name="LociMyu Debug"){
  const fetchAuth = await needAuth();
  // Create at user's root (no parent)
  const fileId = await createSpreadsheetInFolder(fetchAuth, name, undefined);
  await ensureMaterialsHeader(fetchAuth, fileId);
  await ensureDefaultCaptions(fetchAuth, fileId);
  const meta = await fetchAuth(`${SHEETS_BASE}/${fileId}`);
  const materials = (meta.sheets||[]).find(s => s.properties && s.properties.title === MATERIALS_TITLE);
  const captions  = (meta.sheets||[]).find(s => s.properties && s.properties.title !== MATERIALS_TITLE);
  const res = { spreadsheetId: fileId, materialsGid: materials?.properties?.sheetId, defaultCaptionGid: captions?.properties?.sheetId };
  console.log(TAG, "debug created", res);
  dispatchCtx(res.spreadsheetId, res.materialsGid, res.defaultCaptionGid);
  return res;
}
