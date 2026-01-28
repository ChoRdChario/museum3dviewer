/*!
 * LociMyu ESM/CDN — boot (foundation, enhanced client_id discovery + auth button wire)
 * VERSION_TAG:V6_12b_FOUNDATION_AUTH_CTX_MAT_HDR_CLIENTID
 */

const LOG = (...a)=>console.log(...a);
const warn=(...a)=>console.warn(...a);
const err=(...a)=>console.error(...a);

window.LM_VERSION_TAG = "V6_12b_FOUNDATION_AUTH_CTX_MAT_HDR_CLIENTID";
window.LM_SCOPES = window.LM_SCOPES || [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file"
];

/* =========================
 * client_id discovery order
 *
 *   1) URL ?lm_client_id= or ?client_id=
 *   2) button#auth-signin[data-client-id]
 *   3) localStorage.LM_GIS_CLIENT_ID
 *   4) window.GIS_CLIENT_ID / window.__LM_CLIENT_ID
 *   5) <meta name="google-signin-client_id">
 *   6) <meta name="google-oauth-client_id">  <-- index.html 側の親設定
 *   ========================= */
function pickClientIdFromDOM(){
  try{
    const u = new URL(location.href);
    const fromUrl = u.searchParams.get("lm_client_id") || u.searchParams.get("client_id");
    if (fromUrl && fromUrl.trim()) {
      localStorage.setItem("LM_GIS_CLIENT_ID", fromUrl.trim());
      return fromUrl.trim();
    }
  }catch(e){}

  const btn = document.querySelector("#auth-signin");
  if (btn && btn.dataset && btn.dataset.clientId && btn.dataset.clientId.trim()){
    const v = btn.dataset.clientId.trim();
    localStorage.setItem("LM_GIS_CLIENT_ID", v);
    return v;
  }

  const ls = localStorage.getItem("LM_GIS_CLIENT_ID");
  if (ls && ls.trim()) return ls.trim();

  if (typeof window.GIS_CLIENT_ID === "string" && window.GIS_CLIENT_ID.trim()) return window.GIS_CLIENT_ID.trim();
  if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID.trim()) return window.__LM_CLIENT_ID.trim();

  const m = document.querySelector('meta[name="google-signin-client_id"]');
  if (m && m.content && m.content.trim()) return m.content.trim();

  const mo = document.querySelector('meta[name="google-oauth-client_id"]');
  if (mo && mo.content && mo.content.trim()) return mo.content.trim();

  return null;
}
window.__LM_DEBUG = Object.assign(window.__LM_DEBUG||{}, { pickClientIdFromDOM });

/* GIS load single-flight */
let _gisLoading=null, _gisReady=false;
async function loadGISOnce(){
  if (_gisReady) return;
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve,reject)=>{
    if (window.google && window.google.accounts && window.google.accounts.oauth2){
      _gisReady = true; LOG("[auth] GIS already loaded"); resolve(); return;
    }
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";
    s.async=true; s.defer=true;
    s.onload=()=>{ _gisReady=true; LOG("[auth] GIS loaded"); resolve(); };
    s.onerror=(e)=>{ err("[auth] GIS load failed", e); reject(e); };
    document.head.appendChild(s);
  });
  return _gisLoading;
}

/* Public token getter (single-flight + cache) */
let _tokClient=null, _tokInflight=null, _tokCache=null, _tokCacheExp=0;
// CSRF mitigation: OAuth state parameter for GIS token flow
let _oauthState = null;
function _makeOAuthState(){
  try{
    const arr = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i=0;i<arr.length;i++) arr[i] = Math.floor(Math.random()*256);
    return Array.from(arr).map(b=>b.toString(16).padStart(2,"0")).join("");
  }catch(e){
    return String(Math.random()).slice(2) + String(Date.now());
  }
}
let _pendingResolve=null, _pendingReject=null;
async function __lm_getAccessToken(){
  const now = Date.now();
  if (_tokCache && now < _tokCacheExp - 10_000) return _tokCache;

  await loadGISOnce();
  const clientId = pickClientIdFromDOM();
  if (!clientId) throw new Error("[auth] client_id not found. Provide window.GIS_CLIENT_ID or meta[name='google-signin-client_id'] or meta[name='google-oauth-client_id'] or URL ?lm_client_id=... or localStorage.LM_GIS_CLIENT_ID");

  if (!_tokClient){
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2){
      throw new Error("[auth] GIS not ready after load");
    }
    _tokClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: (window.LM_SCOPES||[]).join(" "),
      state: (_oauthState = _makeOAuthState()),
      callback: (resp)=>{
        if (resp && resp.state && _oauthState && resp.state !== _oauthState){
          err("[auth] state mismatch", {expected:_oauthState, got:resp.state});
          if (_pendingReject) _pendingReject(new Error("OAuth state mismatch"));
          _pendingReject = null; _pendingResolve = null;
          return;
        }
        if (resp.error){
          err("[auth] token error", resp);
          if (_pendingReject) _pendingReject(resp);
          _pendingResolve = _pendingReject = null;
          _tokInflight=null;
          window.dispatchEvent(new CustomEvent("lm:signin-error", { detail:{ error:resp } }));
          return;
        }
        LOG("[auth] token ok");
        _tokCache = resp.access_token;
        _tokCacheExp = Date.now() + 50*60*1000;
        if (_pendingResolve) _pendingResolve(resp.access_token);
        _pendingResolve = _pendingReject = null;
        window.dispatchEvent(new CustomEvent("lm:signin-ok", { detail:{ ok:true }}));
      },
    });
  }
  if (_tokInflight) return _tokInflight;
  _tokInflight = new Promise((resolve, reject)=>{
    _pendingResolve = resolve; _pendingReject = reject;
    try{ _tokClient.requestAccessToken({ prompt: "" }); }
    catch(e){ _tokInflight=null; reject(e); }
  }).finally(()=>{ _tokInflight=null; });
  return _tokInflight;
}
window.__lm_getAccessToken = __lm_getAccessToken;

/* Drive helper: resolve GLB URL in Drive to Blob via Files API */
async function resolveDriveGlbToBlob(src){
  const token = await __lm_getAccessToken();
  const headers = { "Authorization": `Bearer ${token}` };
  let fileIdMatch = null;

  if (typeof src === "string"){
    // pattern: https://drive.google.com/file/d/<id>/view?usp=...
    const m1 = src.match(/\/file\/d\/([^/]+)/);
    if (m1) fileIdMatch = m1[1];
    // pattern: https://drive.google.com/open?id=<id>
    const m2 = src.match(/[?&]id=([^&]+)/);
    if (!fileIdMatch && m2) fileIdMatch = m2[1];
  }
  const fileId = fileIdMatch || src.id || src.fileId || src;
  if (!fileId) throw new Error("[drive] cannot resolve fileId from src");

  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=json&fields=id,name,mimeType`, { headers });
  if (!metaRes.ok) throw new Error("[drive] meta fetch failed "+metaRes.status);
  const meta = await metaRes.json();
  LOG("[drive] meta", meta);

  const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers });
  if (!downloadRes.ok) throw new Error("[drive] download failed "+downloadRes.status);
  return await downloadRes.blob();
}

/* Materials sheet helpers */
const MAT_HEADER = [
  "materialKey",   // A
  "opacity",       // B
  "doubleSided",   // C
  "unlitLike",     // D
  "chromaEnable",  // E
  "chromaColor",   // F
  "chromaTolerance", // G
  "chromaFeather",   // H
  "roughness",     // I
  "metalness",     // J
  "emissiveHex",   // K
  "updatedAt",     // L
  "updatedBy",     // M
  "sheetGid",      // N
];


const VIEWS_HEADER = [
  "id",             // A
  "captionSheetGid",// B
  "name",           // C
  "bgColor",        // D
  "cameraType",     // E
  "eyeX",           // F
  "eyeY",           // G
  "eyeZ",           // H
  "targetX",        // I
  "targetY",        // J
  "targetZ",        // K
  "upX",            // L
  "upY",            // M
  "upZ",            // N
  "fov",            // O
  "createdAt",      // P
  "updatedAt",      // Q
];

async function ensureViewsSheet(spreadsheetId){
  if (!spreadsheetId) return null;
  if (window.__LM_IS_SHARE_MODE || window.__LM_IS_VIEW_MODE || (window.__LM_MODE && window.__LM_MODE.isShareMode)) {
    // Do not create sheets in Share mode.
    const exist = await findSheetByTitle(spreadsheetId, SHEET_TITLE);
    return exist || null;
  }

  const token = await __lm_getAccessToken();
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`, { headers });
  if (!getRes.ok){
    throw new Error("[views-sheet] get sheets failed "+getRes.status);
  }
  const data = await getRes.json();
  const sheets = (data.sheets||[]).map(s=>s.properties || {});
  const found = sheets.find(p=>p.title==="__LM_VIEWS");
  if (found) return { spreadsheetId, sheetId: found.sheetId, title: found.title };

  const body = {
    requests: [{
      addSheet: {
        properties: {
          title: "__LM_VIEWS",
          gridProperties: { rowCount: 1000, columnCount: 20 },
        },
      },
    }],
  };
  const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!batchRes.ok){
    throw new Error("[views-sheet] create __LM_VIEWS failed "+batchRes.status);
  }
  const batchJson = await batchRes.json();
  const reply = (batchJson.replies||[])[0] || {};
  const props = reply.addSheet && reply.addSheet.properties;
  LOG("[views-sheet] created __LM_VIEWS", props || {});
  return { spreadsheetId, sheetId: (props && props.sheetId) || "", title: "__LM_VIEWS" };
}

async function ensureViewsHeader(spreadsheetId){
  if (!spreadsheetId) return;
  if (window.__LM_IS_SHARE_MODE || window.__LM_IS_VIEW_MODE || (window.__LM_MODE && window.__LM_MODE.isShareMode)) {
    console.info('[views-sheet] Share mode: skip header ensure');
    return;
  }

  await ensureViewsSheet(spreadsheetId);
  const token = await __lm_getAccessToken();
  const headers = { "Authorization": `Bearer ${token}` };
  const range = "__LM_VIEWS!A1:Q1";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const getRes = await fetch(url, { headers });
  if (!getRes.ok){
    throw new Error("[views-sheet] header get failed "+getRes.status);
  }
  const json = await getRes.json();
  const rows = json.values || [];
  const cur = rows[0] || [];
  const expect = VIEWS_HEADER.map(String);
  const current = cur.map(String);
  const same = current.length === expect.length && current.every((v, i)=>v === expect[i]);
  if (same){
    LOG("[views-sheet] header already present & up-to-date");
    return;
  }
  await putHeaderOnce(spreadsheetId, range, VIEWS_HEADER);
  LOG("[views-sheet] header reset to canonical schema");
}

window.__lm_ensureViewsHeader = ensureViewsHeader;


async function ensureMaterialsSheet(spreadsheetId){
  if (!spreadsheetId) return null;
  if (window.__LM_IS_SHARE_MODE || window.__LM_IS_VIEW_MODE || (window.__LM_MODE && window.__LM_MODE.isShareMode)) {
    // Do not create sheets in Share mode.
    const exist = await findSheetByTitle(spreadsheetId, SHEET_TITLE);
    return exist || null;
  }

  const token = await __lm_getAccessToken();
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`, { headers });
  if (!getRes.ok){
    throw new Error("[mat-sheet] get sheets failed "+getRes.status);
  }
  const data = await getRes.json();
  const sheets = (data.sheets||[]).map(s=>s.properties || {});
  const found = sheets.find(p=>p.title==="__LM_MATERIALS");
  if (found) return { spreadsheetId, sheetId: found.sheetId, title: found.title };

  const body = {
    requests: [{
      addSheet: {
        properties: {
          title: "__LM_MATERIALS",
          gridProperties: { rowCount: 1000, columnCount: 20 },
        },
      },
    }],
  };
  const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!batchRes.ok){
    throw new Error("[mat-sheet] create __LM_MATERIALS failed "+batchRes.status);
  }
  const batchJson = await batchRes.json();
  const reply = (batchJson.replies||[])[0] || {};
  const props = reply.addSheet && reply.addSheet.properties;
  LOG("[mat-sheet] created __LM_MATERIALS", props);
  return { spreadsheetId, sheetId: props.sheetId, title: props.title };
}

async function putHeaderOnce(spreadsheetId, rangeA1, values){
  const token = await __lm_getAccessToken();
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const body = {
    valueInputOption: "RAW",
    data: [{
      range: rangeA1,
      values: [values],
    }],
  };
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok){
    throw new Error("[mat-sheet] header batchUpdate failed "+res.status);
  }
  LOG("[mat-sheet] header updated", rangeA1);
}


async function ensureMaterialsHeader(spreadsheetId){
  if (!spreadsheetId) return;
  if (window.__LM_IS_SHARE_MODE || window.__LM_IS_VIEW_MODE || (window.__LM_MODE && window.__LM_MODE.isShareMode)) {
    console.info('[mat-sheet] Share mode: skip header ensure');
    return;
  }

  await ensureMaterialsSheet(spreadsheetId);
  const token = await __lm_getAccessToken();
  const headers = { "Authorization": `Bearer ${token}` };
  const range = "__LM_MATERIALS!A1:N1";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const getRes = await fetch(url, { headers });
  if (!getRes.ok){
    throw new Error("[mat-sheet] header get failed "+getRes.status);
  }
  const json = await getRes.json();
  const rows = json.values || [];
  const cur = rows[0] || [];
  const expect = MAT_HEADER.map(String);
  const current = cur.map(String);
  const same = current.length === expect.length && current.every((v, i)=>v === expect[i]);
  if (same){
    LOG("[mat-sheet] header already present & up-to-date");
    return;
  }
  await putHeaderOnce(spreadsheetId, range, MAT_HEADER);
  LOG("[mat-sheet] header reset to canonical schema");
}

window.__lm_ensureMaterialsHeader = ensureMaterialsHeader;

/* Drive GLB load bridge: listen for lm:load-glb and resolve via Drive */
window.addEventListener("lm:load-glb", async (ev)=>{
  try{
    const src = ev && ev.detail && (ev.detail.id || ev.detail.url);
    if (!src) return;
    const blob = await resolveDriveGlbToBlob(src);
    const objUrl = URL.createObjectURL(blob);
    console.log("[drive] lm:load-glb -> dispatch lm:model-url");
    window.dispatchEvent(new CustomEvent("lm:model-url", { detail:{ url: objUrl } }));
  }catch(e){ console.error("[drive] lm:load-glb failed", e); }
});

/* ========= Auto-wire auth button if present ========= */
(function autoWireAuthButton(){
  const btn = document.querySelector("#auth-signin");
  if (!btn) return;
  if (btn.dataset && btn.dataset.lmAuthWired) return;
  btn.dataset.lmAuthWired = "1";
  btn.addEventListener("click", async (ev)=>{
    ev.preventDefault();
    try{
      await __lm_getAccessToken();
      console.log("[auth] signin ok (button)");
    }catch(e){
      console.error("[auth] signin failed", e);
      console.error("[auth] 提供方法: URL に ?lm_client_id=YOUR_CLIENT_ID を付けるか、localStorage.LM_GIS_CLIENT_ID に設定してください。");
    }
  }, { passive:true });
})();

export {
  pickClientIdFromDOM,
  loadGISOnce,
  __lm_getAccessToken,
  resolveDriveGlbToBlob,
  ensureMaterialsSheet,
  putHeaderOnce,
  ensureMaterialsHeader,
};

// Step4: viewer caption overlay bootstrap
try { import('./caption.viewer.overlay.js'); } catch (_) {}
