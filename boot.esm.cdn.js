/*!
 * LociMyu ESM/CDN — boot (foundation)
 * VERSION_TAG:V6_12_FOUNDATION_AUTH_CTX_MAT_HDR
 * Goals in this build:
 *  1) Stable GIS auth (single-flight) + public __lm_getAccessToken()
 *  2) GLB Drive resolver (url/id -> Blob) with Bearer auth
 *  3) __LM_MATERIALS header ensure (one-time, idempotent)
 *  4) sheet-context bridge (gid-based) emits 'lm:sheet-context' only on actual change
 *
 * This file is additive and avoids touching caption/viewer UI logic.
 * It exposes small, testable APIs on window.*
 */

/* =========================
   Small logging utilities
   ========================= */
const LOG = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);
const err  = (...args) => console.error(...args);

/* =========================
   Global config (non-breaking)
   ========================= */
window.LM_VERSION_TAG = "V6_12_FOUNDATION_AUTH_CTX_MAT_HDR";
window.LM_SCOPES = window.LM_SCOPES || [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file"
];

/* =========================
   1) client_id resolution
   ========================= */
function pickClientIdFromDOM() {
  // Priority: explicit global -> alternate global -> meta -> null
  if (typeof window.GIS_CLIENT_ID === "string" && window.GIS_CLIENT_ID.trim()) return window.GIS_CLIENT_ID.trim();
  if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID.trim()) return window.__LM_CLIENT_ID.trim();
  const m = document.querySelector('meta[name="google-signin-client_id"]');
  if (m && m.content && m.content.trim()) return m.content.trim();
  return null;
}
window.__LM_DEBUG = Object.assign(window.__LM_DEBUG || {}, {
  pickClientIdFromDOM,
});

/* ==================================
   2) GIS loader (single-flight guard)
   ================================== */
let _gisLoading = null;
let _gisReady = false;

async function loadGISOnce() {
  if (_gisReady) return;
  if (_gisLoading) return _gisLoading;
  _gisLoading = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      _gisReady = true;
      LOG("[auth] GIS already loaded");
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => { _gisReady = true; LOG("[auth] GIS loaded"); resolve(); };
    s.onerror = (e) => { err("[auth] GIS load failed", e); reject(e); };
    document.head.appendChild(s);
  });
  return _gisLoading;
}

/* =====================================
   3) Public token getter (single-flight)
   ===================================== */
let _tokClient = null;
let _tokInflight = null;
let _tokCache = null;
let _tokCacheExp = 0; // epoch ms

async function __lm_getAccessToken() {
  const now = Date.now();
  if (_tokCache && now < _tokCacheExp - 10_000) {
    return _tokCache;
  }
  await loadGISOnce();
  const clientId = pickClientIdFromDOM();
  if (!clientId) throw new Error("[auth] client_id not found. Provide window.GIS_CLIENT_ID or meta[name='google-signin-client_id'].");
  if (!_tokClient) {
    _tokClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: window.LM_SCOPES.join(" "),
      callback: (resp) => {
        if (!resp || resp.error) {
          if (_pendingReject) _pendingReject(resp && resp.error ? resp.error : "unknown_error");
          _pendingResolve = null; _pendingReject = null;
          return;
        }
        _tokCache = resp.access_token;
        _tokCacheExp = Date.now() + 50 * 60 * 1000; // 50min optimistic
        if (_pendingResolve) _pendingResolve(resp.access_token);
        _pendingResolve = null; _pendingReject = null;
      },
    });
  }
  if (_tokInflight) return _tokInflight;
  let _cancelled = false;
  let _resolver = null;
  let _rejector = null;
  window._lm_cancel_token_flow = () => { _cancelled = true; if (_rejector) _rejector("cancelled"); };

  let _pending = true;
  _tokInflight = new Promise((resolve, reject) => {
    _resolver = resolve; _rejector = reject;
    _pendingResolve = resolve; _pendingReject = reject;
    try {
      _tokClient.requestAccessToken({ prompt: "" }); // will reuse if possible
    } catch (e) {
      _tokInflight = null;
      return reject(e);
    }
  }).finally(() => { _tokInflight = null; });
  return _tokInflight;
}
let _pendingResolve = null;
let _pendingReject = null;
window.__lm_getAccessToken = __lm_getAccessToken;

/* =============================
   4) Drive GLB resolver helpers
   ============================= */
function _extractDriveId(input) {
  if (!input) return null;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input; // looks like file id
  try {
    const u = new URL(input);
    // common patterns
    // /file/d/{id}/view
    const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)\/view/);
    if (m) return m[1];
    // /uc?id={id}&export=download
    const idp = u.searchParams.get("id");
    if (idp) return idp;
  } catch (e) {}
  return null;
}

async function resolveDriveGlbToBlob(urlOrId) {
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

/* =======================================
   5) Sheets helpers (tiny, fetch-based)
   ======================================= */
async function gapiFetchJson(url, init={}) {
  const token = await __lm_getAccessToken();
  const headers = Object.assign({ "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, init.headers||{});
  const res = await fetch(url, Object.assign({ headers }, init));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch(e) { body = text; }
  if (!res.ok) throw new Error(`[gapi] ${res.status} ${url} -> ${text}`);
  return body;
}

async function ensureMaterialsSheet(spreadsheetId) {
  // List sheets
  const meta = await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  const exists = (meta.sheets||[]).find(s => s.properties && s.properties.title === "__LM_MATERIALS");
  if (exists) {
    LOG("[materials] ensure sheet -> EXISTS", exists.properties.sheetId);
    return { title: "__LM_MATERIALS", sheetId: exists.properties.sheetId };
  }
  // addSheet
  const added = await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [{ addSheet: { properties: { title: "__LM_MATERIALS" } } }]
    })
  });
  const sheetId = added.replies && added.replies[0] && added.replies[0].addSheet && added.replies[0].addSheet.properties.sheetId;
  LOG("[materials] ensure sheet -> OK(200)", sheetId);
  return { title: "__LM_MATERIALS", sheetId };
}

const MATERIAL_HEADERS = [
  "materialKey","opacity","chromaColor","chromaTolerance","chromaFeather","doubleSided","unlitLike","captionSheetGid","updatedAt","updatedBy"
];

let _hdrGuard = new Set();
async function putHeaderOnce(spreadsheetId, range="__LM_MATERIALS!A1:J1") {
  const key = spreadsheetId + "::" + range;
  if (_hdrGuard.has(key)) { LOG("[materials] header put", range, "-> SKIP (guard)"); return; }
  // read range
  try {
    const got = await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`);
    const values = (got.values && got.values[0]) || [];
    if ((values||[]).length) { LOG("[materials] header present -> SKIP"); _hdrGuard.add(key); return; }
  } catch(e) {
    // not fatal; continue to put
    warn("[materials] header check failed; will put anyway", String(e));
  }
  await gapiFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ range, values: [MATERIAL_HEADERS] })
  });
  LOG("[materials] header put", range, "-> OK(200)");
  _hdrGuard.add(key);
}

async function ensureMaterialsHeader(spreadsheetId) {
  if (!spreadsheetId) throw new Error("[materials] spreadsheetId required");
  window.__LM_MATERIALS_READY__ = window.__LM_MATERIALS_READY__ || new Set();
  if (window.__LM_MATERIALS_READY__.has(spreadsheetId)) { LOG("[materials] ensure header -> SKIP (ready)"); return; }
  await ensureMaterialsSheet(spreadsheetId);
  await putHeaderOnce(spreadsheetId, "__LM_MATERIALS!A1:J1");
  window.__LM_MATERIALS_READY__.add(spreadsheetId);
}
window.__lm_ensureMaterialsHeader = ensureMaterialsHeader;

/* ===================================
   6) sheet-context bridge (gid-based)
   =================================== */
const sheetCtxBridge = (() => {
  let _last = null;
  let _timer = null;
  function _emit(ctx) {
    LOG("[ctx] set", ctx);
    window.dispatchEvent(new CustomEvent("lm:sheet-context", { detail: ctx }));
  }
  function start(getter, opt={}) {
    const interval = opt.intervalMs || 4000;
    if (_timer) clearInterval(_timer);
    // immediate tick
    try {
      const ctx = getter();
      if (!ctx || !ctx.spreadsheetId) { warn("[ctx] getter returned empty"); }
      else { _last = JSON.stringify(ctx); _emit(ctx); }
    } catch(e) { warn("[ctx] first tick failed", e); }
    _timer = setInterval(() => {
      try {
        const ctx = getter();
        if (!ctx || !ctx.spreadsheetId) return;
        const s = JSON.stringify(ctx);
        if (s !== _last) { _last = s; _emit(ctx); }
      } catch(e) { /* ignore */ }
    }, interval);
  }
  function stop() { if (_timer) clearInterval(_timer); _timer = null; }
  return { start, stop };
})();
window.sheetCtxBridge = sheetCtxBridge;

/* ==================================================
   7) Wire minimal event to trigger materials ensure
   ================================================== */
window.addEventListener("lm:sheet-context", (ev) => {
  const ctx = ev.detail || {}
  if (ctx && ctx.spreadsheetId) {
    ensureMaterialsHeader(ctx.spreadsheetId).catch(e => err("[materials] ensure header failed", e));
  }
});

/* ==================================================
   8) Optional: wire GLB load via custom event
   ================================================== */
window.addEventListener("lm:load-glb", async (ev) => {
  try {
    const src = ev && ev.detail && (ev.detail.id || ev.detail.url);
    if (!src) return;
    const blob = await resolveDriveGlbToBlob(src);
    const objUrl = URL.createObjectURL(blob);
    LOG("[drive] lm:load-glb -> dispatch lm:model-url");
    window.dispatchEvent(new CustomEvent("lm:model-url", { detail: { url: objUrl } }));
  } catch(e) {
    err("[drive] lm:load-glb failed", e);
  }
});

/* End of boot */
export {
  pickClientIdFromDOM,
  loadGISOnce,
  __lm_getAccessToken,
  resolveDriveGlbToBlob,
  ensureMaterialsSheet,
  putHeaderOnce,
  ensureMaterialsHeader,
};
