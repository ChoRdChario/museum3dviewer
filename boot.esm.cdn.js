/*!
 * LociMyu ESM/CDN — boot (foundation, enhanced client_id discovery + auth button wire)
 * VERSION_TAG:V6_12b_FOUNDATION_AUTH_CTX_MAT_HDR_CLIENTID_FIXED
 */

const LOG = (...a)=>console.log(...a);
const warn=(...a)=>console.warn(...a);
const err=(...a)=>console.error(...a);

window.LM_VERSION_TAG = "V6_12b_FOUNDATION_AUTH_CTX_MAT_HDR_CLIENTID_FIXED";
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
 *   5) <meta name="google-signin-client_id" content=...>
 * ======================== */

function pickClientIdFromURL(){
  try{
    const u = new URL(location.href);
    const v = u.searchParams.get('lm_client_id') || u.searchParams.get('client_id');
    if (v) return v;
  }catch(e){}
  return null;
}

function pickClientIdFromButton(){
  try{
    const b = document.querySelector('#auth-signin[data-client-id]');
    if (b && b.dataset.clientId) return b.dataset.clientId;
  }catch(e){}
  return null;
}

function pickClientIdFromLocalStorage(){
  try{
    const v = localStorage.getItem('LM_GIS_CLIENT_ID');
    if (v) return v;
  }catch(e){}
  return null;
}

function pickClientIdFromGlobals(){
  try{
    return window.GIS_CLIENT_ID || window.__LM_CLIENT_ID || null;
  }catch(e){}
  return null;
}

function pickClientIdFromMeta(){
  try{
    const m = document.querySelector('meta[name="google-signin-client_id"]');
    if (m && m.content) return m.content;
  }catch(e){}
  return null;
}

function pickClientId(){
  return pickClientIdFromURL()
      || pickClientIdFromButton()
      || pickClientIdFromLocalStorage()
      || pickClientIdFromGlobals()
      || pickClientIdFromMeta()
      || null;
}

/**
 * 互換用の DOM ベース resolver。
 * 既存コードからは pickClientIdFromDOM() を参照しているので、
 * 実装としては pickClientId() をそのまま委譲する。
 */
function pickClientIdFromDOM(){
  return pickClientId();
}

/* =========================
 * GIS / token bootstrap
 * ======================== */

let _gisLoaded = false;
let _tokenClient = null;
let _accessToken = null;

async function loadGISOnce(){
  if (_gisLoaded) return;
  if (window.google && window.google.accounts && window.google.accounts.oauth2){
    _gisLoaded = true;
    return;
  }
  await new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = ()=>{ _gisLoaded = true; resolve(); };
    s.onerror = (e)=>reject(e);
    document.head.appendChild(s);
  });
}

async function __lm_getAccessToken(){
  if (_accessToken) return _accessToken;

  await loadGISOnce();

  const clientId = pickClientId();
  if (!clientId){
    throw new Error('[auth] no client_id resolved');
  }

  if (!_tokenClient){
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: window.LM_SCOPES.join(' '),
      callback: (resp)=>{
        if (resp && resp.access_token){
          _accessToken = resp.access_token;
          LOG('[auth] token ok');
        }else{
          err('[auth] token missing in callback', resp);
        }
      },
    });
  }

  await new Promise((resolve,reject)=>{
    try{
      _tokenClient.requestAccessToken();
      const t = Date.now();
      const id = setInterval(()=>{
        if (_accessToken){
          clearInterval(id);
          resolve();
        }else if (Date.now()-t>30000){
          clearInterval(id);
          reject(new Error('timeout waiting token'));
        }
      }, 500);
    }catch(e){
      reject(e);
    }
  });

  return _accessToken;
}

/* =========================
 * Drive GLB resolver
 * ======================== */

async function resolveDriveGlbToBlob(src){
  if (!src) throw new Error('resolveDriveGlbToBlob: no src');
  // src may be URL or fileId
  let fileId = src;
  try{
    const u = new URL(src);
    if (u.searchParams.get('id')){
      fileId = u.searchParams.get('id');
    }else if (/\/d\/([^/]+)/.test(u.pathname)){
      fileId = RegExp.$1;
    }
  }catch(_){}
  if (!fileId) throw new Error('resolveDriveGlbToBlob: no fileId');

  const token = await __lm_getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok){
    throw new Error('[drive] GLB fetch failed '+res.status);
  }
  return await res.blob();
}

/* =========================
 * __LM_MATERIALS sheet helpers
 * ======================== */

async function ensureMaterialsSheet(spreadsheetId){
  const token = await __lm_getAccessToken();
  const headers = { "Authorization": `Bearer ${token}`, "Content-Type":"application/json" };
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`, {
    headers
  });
  if (!metaRes.ok){
    throw new Error("[mat-sheet] meta fetch failed "+metaRes.status);
  }
  const meta = await metaRes.json();
  const existing = (meta.sheets || []).find(s=>s.properties && s.properties.title==="__LM_MATERIALS");
  if (existing && existing.properties && existing.properties.sheetId!=null){
    LOG("[mat-sheet] __LM_MATERIALS exists sheetId", existing.properties.sheetId);
    return existing.properties.sheetId;
  }

  const body = {
    requests: [{
      addSheet: {
        properties: {
          title: "__LM_MATERIALS",
          gridProperties: { rowCount: 1000, columnCount: 14 }
        }
      }
    }]
  };
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok){
    throw new Error("[mat-sheet] addSheet failed "+res.status);
  }
  const json = await res.json();
  const sheetId = json.replies && json.replies[0] && json.replies[0].addSheet &&
                  json.replies[0].addSheet.properties && json.replies[0].addSheet.properties.sheetId;
  LOG("[mat-sheet] created __LM_MATERIALS sheetId", sheetId);
  return sheetId;
}

async function putHeaderOnce(spreadsheetId, rangeA1, values){
  const token = await __lm_getAccessToken();
  const headers = { "Authorization": `Bearer ${token}`, "Content-Type":"application/json" };
  const body = {
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
  await ensureMaterialsSheet(spreadsheetId);
  const token = await __lm_getAccessToken();
  const headers = { "Authorization": `Bearer ${token}` };
  const range = "__LM_MATERIALS!A1:N1";
  const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, { headers });
  if (!getRes.ok){
    throw new Error("[mat-sheet] header get failed "+getRes.status);
  }
  const json = await getRes.json();
  const rows = json.values || [];
  if (rows.length>0 && rows[0] && rows[0].length>0){
    LOG("[mat-sheet] header already present");
    return;
  }
  await putHeaderOnce(spreadsheetId, range, [
    "sheetGid",
    "materialKey",
    "opacity",
    "doubleSided",
    "unlitLike",
    "chromaKeyEnabled",
    "chromaKeyColor",
    "chromaKeyTolerance",
    "chromaKeyFeather",
    "timestamp",
    "user",
    "note1",
    "note2",
    "note3",
  ]);
}

// グローバル公開
window.__lm_ensureMaterialsHeader = window.__lm_ensureMaterialsHeader || ensureMaterialsHeader;
window.ensureMaterialsHeader = window.ensureMaterialsHeader || ensureMaterialsHeader;
window.__lm_getAccessToken = window.__lm_getAccessToken || __lm_getAccessToken;

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

/* =========================
 * Sign-in button wiring
 * ======================== */

async function wireAuthButton(){
  const btn = document.getElementById('auth-signin');
  if (!btn){
    warn('[auth] button#auth-signin not found');
    return;
  }
  btn.addEventListener('click', async ()=>{
    try{
      await __lm_getAccessToken();
      LOG('[auth] signin ok (button)');
      window.dispatchEvent(new Event('lm:auth-ok'));
    }catch(e){
      err('[auth] signin failed', e);
      alert('Sign-in failed: '+e.message);
    }
  });
}

/* bootstrap */
(async function(){
  try{
    await wireAuthButton();
  }catch(e){
    err('[boot] wireAuthButton failed', e);
  }
})().catch(e=>err('[boot] init error', e));

export {
  pickClientId,
  pickClientIdFromURL,
  pickClientIdFromButton,
  pickClientIdFromLocalStorage,
  pickClientIdFromGlobals,
  pickClientIdFromMeta,
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
