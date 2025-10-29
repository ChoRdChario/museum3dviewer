// material.orchestrator.js
// LociMyu Material Orchestrator
// - ユーザー操作直後のみ GIS ポップアップを許可（ブラウザブロック回避）
// - Spreadsheet/GID を自動ブリッジ（sheet.ctx.bridge.js 経由）
// - __LM_MATERIALS シートの ensure / Upsert
// - マテリアルのドロップダウン populate を堅牢化
// - 既存機能を壊さない UI-only 変更
//
// VERSION TAG
const VERSION_TAG = 'V6_10_AUTH_UI_ENSURE';
const log  = (...a)=>console.log('[mat-orch]', ...a);
const warn = (...a)=>console.warn('[mat-orch]', ...a);

// --------- State ---------
const state = {
  spreadsheetId: null,
  sheetGid: null,
  ui: {},
};

function ctx() { return { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid }; }

// --------- Auth Helpers (user-gesture only consent) ---------
let __lm_tokenCache = null;
let __lm_tokenClient = null;

async function getAccessToken() {
  // 既存キャッシュ
  if (__lm_tokenCache) return __lm_tokenCache;

  // 既存アクセサ
  if (typeof window.__lm_getAccessToken === 'function') {
    const t = await window.__lm_getAccessToken();
    if (t) { __lm_tokenCache = t; return t; }
  }
  if (window.gauth?.getAccessToken) {
    const t = await window.gauth.getAccessToken().catch(()=>null);
    if (t) { __lm_tokenCache = t; return t; }
  }

  // GIS スクリプト
  if (!window.google?.accounts?.oauth2) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(()=>{});
  }

  // TokenClient を準備（ここでは起動しない）
  if (window.google?.accounts?.oauth2 && !__lm_tokenClient) {
    __lm_tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.__LM_CLIENT_ID
        || window.gauth?.CLIENT_ID
        || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
      callback: (resp) => {
        if (resp?.access_token) __lm_tokenCache = resp.access_token;
      }
    });
  }

  // ユーザー操作で叩いてもらう「同意」関数を公開
  window.__lm_requestSheetsConsent = () => {
    if (!__lm_tokenClient) return;
    __lm_tokenCache = null;
    __lm_tokenClient.requestAccessToken({ prompt: 'consent' });
  };

  // ここではまだ未取得
  throw new Error('token_missing');
}

async function authFetch(url, init={}) {
  const tok = await getAccessToken(); // token_missing の可能性：呼び元でハンドル
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${tok}`);
  return fetch(url, { ...init, headers });
}

// --------- Sheets helpers ---------
async function spreadsheetGetA1(spreadsheetId, a1range) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(a1range)}`;
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`sheets_get_failed:${res.status}`);
  return res.json();
}

async function batchUpdate(spreadsheetId, body) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`batch_update_failed:${res.status}`);
  return res.json();
}

// __LM_MATERIALS の存在保証
async function ensureMaterialSheet() {
  if (!state.spreadsheetId) {
    warn('ensureMaterialSheet: no spreadsheetId');
    return { ok:false, reason:'no_spreadsheet' };
  }

  // token 無ければユーザー操作まで待つ
  try {
    await getAccessToken();
  } catch (e) {
    if (String(e?.message||e).includes('token_missing')) {
      warn('auto-ensure skipped (no token). Use __lm_requestSheetsConsent() from a user action.');
      return { ok:false, reason:'no_token' };
    }
    throw e;
  }

  // 存在チェック
  try {
    await spreadsheetGetA1(state.spreadsheetId, '__LM_MATERIALS!A1:F');
    // すでにある
    return { ok:true, existed:true };
  } catch (_) {
    // 無ければ作成
    const body = {
      requests: [
        { addSheet: { properties: { title: '__LM_MATERIALS' } } },
        { updateCells: {
            range: { sheetId: null }, // タイトル指定で updateValues の方が楽
            fields: 'userEnteredValue'
        } }
      ],
      includeSpreadsheetInResponse: false
    };
    // addSheet は sheetId を返すが、ここでは列見出しだけ A1:Fx に書く
    await batchUpdate(state.spreadsheetId, { requests: [{ addSheet: { properties: { title: '__LM_MATERIALS' } } }] });
    // ヘッダを書き込み
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent('__LM_MATERIALS!A1:F1')}:update?valueInputOption=RAW`;
    await authFetch(url, {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        range: '__LM_MATERIALS!A1:F1',
        majorDimension: 'ROWS',
        values: [[ 'sheetGid','matUuid','matName','schemaVer','props','updatedAt' ]]
      })
    });
    log('created __LM_MATERIALS');
    return { ok:true, created:true };
  }
}

// アップサート（選択中マテリアルの不透明度）
async function saveCurrentOpacity() {
  if (!state.spreadsheetId || state.sheetGid == null) {
    warn('save skipped: no sheet context');
    return;
  }
  // token 無ければ何もしない（ユーザー操作で同意後に再試行される）
  try { await getAccessToken(); }
  catch(e) {
    if (String(e?.message||e).includes('token_missing')) {
      warn('save skipped: token_missing');
      return;
    }
    throw e;
  }

  const sel = document.querySelector('#pm-material');
  const name = sel?.value || '';
  if (!name) return;

  // 現在の不透明度を読んで props(JSON) を準備
  const v = getOpacityByName(name);
  const props = JSON.stringify({ opacity: v });

  // ひとまず append-only（後続で Upsert ロジックを強化予定）
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${state.spreadsheetId}/values/${encodeURIComponent('__LM_MATERIALS!A2:F')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const body = {
    range: '__LM_MATERIALS!A2:F',
    majorDimension: 'ROWS',
    values: [[ String(state.sheetGid), cryptoRandom(), name, '1', props, new Date().toISOString() ]]
  };
  await authFetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  log('saved opacity row for', name, v);
}

function cryptoRandom() {
  try {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    return [...buf].map(x=>x.toString(16).padStart(2,'0')).join('');
  } catch {
    return String(Math.random()).slice(2);
  }
}

// --------- Materials populate / apply ---------
function listFromScene() {
  const names = new Set();
  const s = window.__LM_SCENE;
  s?.traverse(o=>{
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.name && names.add(m.name));
  });
  return [...names];
}

async function listFromViewer() {
  try {
    const viewer = await import('./viewer.module.cdn.js');
    return (viewer?.listMaterials?.() || []).map(r=>r?.name).filter(Boolean);
  } catch { return []; }
}

function dedup(names){ return [...new Set(names)].filter(n=>!/^#\d+$/.test(n)); }

function fillSelect(names){
  const sel = document.querySelector('#pm-material'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select material —</option>' +
    names.map(n=>`<option value="${n}">${n}</option>`).join('');
  if (cur && names.includes(cur)) sel.value = cur;
  updateValueDisplay();
}

function setOpacityByName(name, v){
  v = Math.max(0, Math.min(1, Number(v)));
  import('./viewer.module.cdn.js').then(viewer=>{
    if (viewer?.applyMaterialPropsByName) {
      viewer.applyMaterialPropsByName(name, { opacity:v });
      return;
    }
    const s = window.__LM_SCENE;
    s?.traverse(o=>{
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
        if ((m?.name||'')===name){
          m.transparent = v < 1;
          m.opacity     = v;
          m.depthWrite  = v >= 1;
          m.needsUpdate = true;
        }
      });
    });
  });
}

function getOpacityByName(name){
  let val=null;
  const s = window.__LM_SCENE;
  s?.traverse(o=>{
    if (val!=null) return;
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).some(m=>{
      if ((m?.name||'')===name){ val = Number(m.opacity ?? 1); return true; }
      return false;
    });
  });
  return (val==null?1:Math.max(0,Math.min(1,val)));
}

// UI wiring
const sel = (s)=>document.querySelector(s);
const rng = sel('#pm-opacity-range');
const out = sel('#pm-opacity-val');

function updateValueDisplay(){
  const n = sel('#pm-material')?.value;
  const v = n ? getOpacityByName(n) : 1;
  if (rng) rng.value = v;
  if (out) out.textContent = (Number(v)||1).toFixed(2);
}

sel('#pm-material')?.addEventListener('change', updateValueDisplay);
rng?.addEventListener('input', ()=>{
  const n = sel('#pm-material')?.value; if (!n) return;
  const v = Number(rng.value||1);
  out.textContent = v.toFixed(2);
  setOpacityByName(n, v);
}, {passive:true});

// Flags + chroma dispatch（既存へイベント通知）
function fire(type, payload){
  const name = sel('#pm-material')?.value; if (!name) return;
  document.dispatchEvent(new CustomEvent(type, { detail: { name, ...payload }}));
}
sel('#pm-flag-doublesided')?.addEventListener('change', e=>fire('pm:flag-change',{doubleSided: e.target.checked}));
sel('#pm-flag-unlit')?.addEventListener('change', e=>fire('pm:flag-change',{unlitLike: e.target.checked}));
sel('#pm-chroma-enable')?.addEventListener('change', e=>fire('pm:chroma-change',{
  enabled:e.target.checked, color:sel('#pm-chroma-color')?.value || '#000000',
  tolerance:Number(sel('#pm-chroma-tol')?.value||0), feather:Number(sel('#pm-chroma-feather')?.value||0)
}));
['#pm-chroma-color','#pm-chroma-tol','#pm-chroma-feather'].forEach(id=>{
  sel(id)?.addEventListener('input', ()=>sel('#pm-chroma-enable')?.checked && fire('pm:chroma-change',{
    enabled:true, color:sel('#pm-chroma-color')?.value || '#000000',
    tolerance:Number(sel('#pm-chroma-tol')?.value||0), feather:Number(sel('#pm-chroma-feather')?.value||0)
  }), {passive:true});
});

// populate（堅牢化）
async function populateWhenReady(){
  // 1) scene-ready
  if (!window.__LM_SCENE) {
    await new Promise(r=>document.addEventListener('lm:scene-ready', r, {once:true}));
  }
  // 2) 少し待つ
  await new Promise(r=>setTimeout(r, 50));
  // 3) リトライ
  let tries=0, names=[];
  while (tries++ < 30) {
    const a = await listFromViewer();
    const b = listFromScene();
    names = dedup([ ...a, ...b ]);
    if (names.length) break;
    await new Promise(r=>setTimeout(r, 200));
  }
  if (names.length) fillSelect(names);
  else console.warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)');
}

// --------- Sheet context bridge ---------
// sheet.ctx.bridge.js から {spreadsheetId, sheetGid} を受け取る
document.addEventListener('lm:sheet-context', (ev)=>{
  const { spreadsheetId, sheetGid } = ev.detail || {};
  if (spreadsheetId) state.spreadsheetId = spreadsheetId;
  if (sheetGid != null) state.sheetGid = sheetGid;
  log('sheet context set', { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid });

  // トークンが既にあるなら ensure を試みる（無ければスキップして UI へ委ねる）
  ensureIfCtx().catch(e=>warn('auto-ensure failed', e));
});

async function ensureIfCtx(){
  if (!state.spreadsheetId) return;
  try {
    await ensureMaterialSheet();
  } catch(e) {
    if (!String(e?.message||e).includes('token_missing')) throw e;
  }
}

// --------- Expose API on window ---------
window.lmMaterials = {
  VERSION_TAG: `VERSION_TAG:${VERSION_TAG}`,
  setCurrentSheetContext({ spreadsheetId, sheetGid }) {
    state.spreadsheetId = spreadsheetId || state.spreadsheetId;
    if (sheetGid != null) state.sheetGid = sheetGid;
    log('sheet context set', { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid });
  },
  report(){ return { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid, ui: state.ui, VERSION_TAG: `VERSION_TAG:${VERSION_TAG}` }; },
  ensureMaterialSheet,
  saveCurrentOpacity,
  populateWhenReady,
};

// 起動
log('loaded VERSION_TAG:'+VERSION_TAG);
populateWhenReady();
document.addEventListener('lm:model-ready', populateWhenReady);
document.getElementById('tab-material')?.addEventListener('click', populateWhenReady);


// ===== PLAN_A_FIX3 (append-only, brace-safe) =====
(function(){
  try{
    // robust sheet-context: set state first, then ensure
    document.addEventListener('lm:sheet-context', function(e){
      try{
        var det = (e && e.detail) || {};
        console.log('[mat-orch][fix3] sheet-context detail', det);
        if (det && det.spreadsheetId){
          state.spreadsheetId = det.spreadsheetId;
          if (typeof det.sheetGid !== 'undefined' && det.sheetGid !== null) state.sheetGid = det.sheetGid;
          log('ctx set (fix3)', { spreadsheetId: state.spreadsheetId, sheetGid: state.sheetGid });
          Promise.resolve().then(()=>ensureMaterialSheet()).catch(function(err){
            console.warn('[mat-orch][fix3] ensureMaterialSheet failed', err);
          });
        } else {
          warn('[fix3] sheet-context missing spreadsheetId');
        }
      }catch(err){
        console.warn('[mat-orch][fix3] sheet-context handler error', err);
      }
    }, { once:false });
  }catch(e){
    console.warn('[mat-orch][fix3] install error', e);
  }
})();
