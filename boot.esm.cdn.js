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
   Enhanced client_id discovery
   Priority:
   1) URL ?lm_client_id= / ?client_id=
   2) button#auth-signin[data-client-id]
   3) localStorage.LM_GIS_CLIENT_ID
   4) window.GIS_CLIENT_ID / window.__LM_CLIENT_ID
   5) <meta name="google-signin-client_id">
   ========================= */
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
let _pendingResolve=null, _pendingReject=null;
async function __lm_getAccessToken(){
  const now = Date.now();
  if (_tokCache && now < _tokCacheExp - 10_000) return _tokCache;

  await loadGISOnce();
  const clientId = pickClientIdFromDOM();
  if (!clientId) throw new Error("[auth] client_id not found. Provide window.GIS_CLIENT_ID or meta[name='google-signin-client_id'] or URL ?lm_client_id=...");

  if (!_tokClient){
    _tokClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: window.LM_SCOPES.join(" "),
      callback: (resp)=>{
        if (!resp || resp.error){
          if (_pendingReject) _pendingReject(resp && resp.error ? resp.error : "unknown_error");
          _pendingResolve = _pendingReject = null;
          return;
        }
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

/* Drive GLB resolver */
function _extractDriveId(input){
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;
  try{
    const u = new URL(input);
    const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)\/view/);
    if (m) return m[1];
    const idp = u.searchParams.get("id");
    if (idp) return idp;
  }catch(e){}
  return null;
}
async function resolveDriveGlbToBlob(urlOrId){
  const id = _extractDriveId(urlOrId) || urlOrId;
  const token = await __lm_getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`[drive] fetch GLB failed ${res.status}`);
  const blob = await res.blob();
  LOG("[drive] glb resolved -> blob", blob.size);
  return blob;
}
window.__lm_resolveDriveGlbToBlob = resolveDriveGlbToBlob;

/* Sheets minimal helpers */
async function gapiFetchJson(url, init={}){
  const token = await __lm_getAccessToken();
  const headers = Object.assign({ "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, init.headers||{});
  const res = await fetch(url, Object.assign({ headers }, init));
  const text = await res.text();
  let body=null; try{ body=text?JSON.parse(text):null; }catch(e){ body=text; }
  if (!res.ok) throw new Error(`[gapi] ${res.status} ${url} -> ${text}`);
  return body;
}

async function ensureMaterialsSheet(spreadsheetId){
  const meta = await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  const exists = (meta.sheets||[]).find(s=>s.properties && s.properties.title==="__LM_MATERIALS");
  if (exists){ console.log("[materials] ensure sheet -> EXISTS", exists.properties.sheetId); return { title:"__LM_MATERIALS", sheetId: exists.properties.sheetId }; }
  const added = await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method:"POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "__LM_MATERIALS" } } }] })
  });
  const sheetId = added.replies && added.replies[0] && added.replies[0].addSheet && added.replies[0].addSheet.properties.sheetId;
  console.log("[materials] ensure sheet -> OK(200)", sheetId);
  return { title:"__LM_MATERIALS", sheetId };
}

const MATERIAL_HEADERS = [
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
  "sheetGid"       // N
];

let _hdrGuard = new Set();
async function putHeaderOnce(spreadsheetId, range="__LM_MATERIALS!A1:N1"){
  const key = spreadsheetId+"::"+range;
  if (_hdrGuard.has(key)){ console.log("[materials] header put", range, "-> SKIP (guard)"); return; }
  try{
    const got = await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
    const values = (got.values && got.values[0]) || [];
    if ((values||[]).length){ console.log("[materials] header present -> SKIP"); _hdrGuard.add(key); return; }
  }catch(e){ console.warn("[materials] header check failed; will put anyway", String(e)); }
  await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method:"PUT", body: JSON.stringify({ range, values:[MATERIAL_HEADERS] })
  });
  console.log("[materials] header put", range, "-> OK(200)");
  _hdrGuard.add(key);
}
async function ensureMaterialsHeader(spreadsheetId){
  if (!spreadsheetId) throw new Error("[materials] spreadsheetId required");
  window.__LM_MATERIALS_READY__ = window.__LM_MATERIALS_READY__ || new Set();
  if (window.__LM_MATERIALS_READY__.has(spreadsheetId)){ console.log("[materials] ensure header -> SKIP (ready)"); return; }
  await ensureMaterialsSheet(spreadsheetId);
  await putHeaderOnce(spreadsheetId, "__LM_MATERIALS!A1:N1");
  window.__LM_MATERIALS_READY__.add(spreadsheetId);
}
window.__lm_ensureMaterialsHeader = ensureMaterialsHeader;

/* sheet-context bridge */
const sheetCtxBridge = (()=>{
  let _last=null,_timer=null;
  function _emit(ctx){ console.log("[ctx] set", ctx); window.dispatchEvent(new CustomEvent("lm:sheet-context",{detail:ctx})); }
  function start(getter,opt={}){
    const interval = opt.intervalMs || 4000;
    if (_timer) clearInterval(_timer);
    try{ const ctx=getter(); if (ctx&&ctx.spreadsheetId){ _last=JSON.stringify(ctx); _emit(ctx);} else { console.warn("[ctx] getter returned empty"); } }catch(e){ console.warn("[ctx] first tick failed",e); }
    _timer=setInterval(()=>{
      try{ const ctx=getter(); if(!(ctx&&ctx.spreadsheetId)) return; const s=JSON.stringify(ctx); if (s!==_last){ _last=s; _emit(ctx);} }catch(e){}
    }, interval);
  }
  function stop(){ if (_timer) clearInterval(_timer); _timer=null; }
  return { start, stop };
})();
window.sheetCtxBridge = sheetCtxBridge;

/* materials ensure on ctx */
window.addEventListener("lm:sheet-context",(ev)=>{
  const ctx = ev.detail||{};
  if (ctx && ctx.spreadsheetId){
    ensureMaterialsHeader(ctx.spreadsheetId).catch(e=>console.error("[materials] ensure header failed", e));
  }
});

/* Optional: GLB load helper */
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
    try{
      const tok = await __lm_getAccessToken();
      console.log("[auth] signin ok (popup-safe)", !!tok);
    }catch(e){
      console.error("[auth] signin failed", e);
      if (String(e).includes("client_id not found")){
        console.warn("[auth] 提供方法: URL に ?lm_client_id=YOUR_CLIENT_ID を付けるか、localStorage.LM_GIS_CLIENT_ID に設定してください。");
      }
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
