
// captions.sheet.bridge.js
const SCHEMA = ["id","title","body","x","y","z","color","imageFileId","createdAt","updatedAt"];
const EVT_READY = "cap:bridge-ready";
const EVT_REFRESHED = "cap:list-refreshed";
const EVT_SAVED = "cap:item-saved";
const EVT_RENAMED = "cap:sheet-renamed";

let spreadsheetId = null;
let sheetGid = null;
let fetchAuth = null;

async function ensureAuth(){
  if (window.__lm_fetchJSONAuth) return window.__lm_fetchJSONAuth;
  const m = await import('./auth.fetch.bridge.js');
  fetchAuth = await m.default();
  return fetchAuth;
}
async function resolveTitleByGid(gid){
  if (!spreadsheetId || gid==null) throw new Error("resolveTitleByGid: missing ids");
  const title = await LM_SHEET_GIDMAP.resolveGidToTitle(spreadsheetId, gid);
  return title;
}
function currentTitleHint(){
  return window.__cap_currentTitle || "__CAPTION";
}
async function ensureHeader(){
  const title = await resolveTitleByGid(sheetGid);
  const range = `'${title}'!A1:J1`;
  const body = { values: [SCHEMA] };
  await ensureAuth();
  await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  window.__cap_currentTitle = title;
}
function arrayToObj(arr){
  const o = {};
  for (let i=0;i<SCHEMA.length;i++) o[SCHEMA[i]] = (arr[i] ?? "");
  return o;
}
async function listCaptions(){
  const title = await resolveTitleByGid(sheetGid);
  const range = `'${title}'!A1:J10000`;
  await ensureAuth();
  const res = await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
  const values = (res && res.values) ? res.values : [];
  const rows = [];
  for (let i=1;i<values.length;i++){
    rows.push(arrayToObj(values[i]));
  }
  document.dispatchEvent(new CustomEvent(EVT_REFRESHED, { detail: rows }));
  return rows;
}
function nowISO(){ return new Date().toISOString(); }
function newId(){ return 'c_'+Math.random().toString(36).slice(2,10); }
async function appendCaption(cap){
  await ensureHeader();
  const title = await resolveTitleByGid(sheetGid);
  const range = `'${title}'!A1:J1`;
  const now = nowISO();
  const row = [
    cap.id || newId(),
    cap.title || "",
    cap.body || "",
    cap.x ?? "",
    cap.y ?? "",
    cap.z ?? "",
    cap.color || "",
    cap.imageFileId || "",
    cap.createdAt || now,
    now
  ];
  await ensureAuth();
  const body = { values: [row] };
  await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  document.dispatchEvent(new CustomEvent(EVT_SAVED, { detail: row }));
  return row[0];
}
async function updateCaptionById(id, patch){
  const title = await resolveTitleByGid(sheetGid);
  await ensureAuth();
  const rangeAll = `'${title}'!A1:J10000`;
  const res = await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(rangeAll)}`);
  const values = res.values || [];
  const idxId = 0;
  let found = -1;
  for (let i=1;i<values.length;i++){
    if (values[i][idxId]===id){ found=i; break; }
  }
  if (found<0) throw new Error("updateCaption: id not found");
  const row = values[found];
  const obj = arrayToObj(row);
  Object.assign(obj, patch, {updatedAt: nowISO()});
  const newRow = SCHEMA.map(k => obj[k] ?? "");
  const rowIndex = found+1;
  const range = `'${title}'!A${rowIndex}:J${rowIndex}`;
  await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({values:[newRow]})
  });
  document.dispatchEvent(new CustomEvent(EVT_SAVED, { detail: newRow }));
  return true;
}
async function renameCaptionSheet(newTitle){
  await ensureAuth();
  const payload = {
    requests: [{
      updateSheetProperties: {
        properties: { sheetId: sheetGid, title: newTitle },
        fields: "title"
      }
    }]
  };
  await window.__lm_fetchJSONAuth(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  window.__cap_currentTitle = newTitle;
  document.dispatchEvent(new CustomEvent(EVT_RENAMED, { detail: { title:newTitle } }));
  return true;
}
document.addEventListener("lm:sheet-context", async (e)=>{
  const d = e.detail || {};
  spreadsheetId = d.spreadsheetId || spreadsheetId;
  sheetGid = d.defaultCaptionGid ?? d.sheetGid ?? sheetGid;
  if (!spreadsheetId || sheetGid==null) return;
  try{
    await ensureHeader();
    await listCaptions();
    document.dispatchEvent(new CustomEvent(EVT_READY));
    console.log("[cap-bridge] ready", { spreadsheetId, sheetGid });
  }catch(err){
    console.warn("[cap-bridge] init failed", err);
  }
});
export const CAPTIONS_BRIDGE = {
  listCaptions, appendCaption, updateCaptionById, renameCaptionSheet,
  getContext(){ return { spreadsheetId, sheetGid }; },
  SCHEMA
};
window.CAPTIONS_BRIDGE = CAPTIONS_BRIDGE;
