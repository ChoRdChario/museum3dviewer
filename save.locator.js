/*!
 * LociMyu save.locator.js — 2025-11-13c
 * - IIFE化（Illegal return の根絶）
 * - __lm_fetchJSONAuth があればそれを使用、なければアクセストークンを取得してfetch
 * - postLoadEnsureSaveSheet({glbId, glbName}) を公開
 * - 互換: window.loc.findOrCreateSaveSheetByGlbId(glbId, glbName) を提供（存在しない場合のみ）
 * - __LM_MATERIALS / Captions の重複生成を防止（存在確認してから追加）
 * - 成功時: window.__lm_ctx を更新し lm:sheet-context を発火
 */
(() => {
  'use strict';
  if (window.__lm_save_locator_loaded) return;
  window.__lm_save_locator_loaded = true;

  const TAG = "[save.locator]";
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // ---------- auth / fetch helpers ----------
  async function getAccessTokenSafe() {
    try {
      if (window.gauth && typeof window.gauth.getAccessToken === "function") {
        const tok = await window.gauth.getAccessToken();
        if (tok) return tok;
      }
    } catch (e) {
      warn("token error", e);
    }
    return null;
  }

  async function fetchJSON(url, init={}) {
    // 既存の認可付きfetchがあれば最優先で使用
    if (typeof window.__lm_fetchJSONAuth === "function") {
      return await window.__lm_fetchJSONAuth(url, init);
    }
    // フォールバック：アクセストークンを付与
    const token = await getAccessTokenSafe();
    const headers = Object.assign({ "Content-Type": "application/json" }, init.headers || {});
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, Object.assign({}, init, { headers }));
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} @ ${url} :: ${text}`);
    }
    return await res.json();
  }

  // ---------- Sheets/Drive helpers ----------
  async function listCandidateSpreadsheets(glbId) {
    try {
      // Drive v3 files.list: spreadsheet を簡易検索（末尾6桁で粗一致）
      const tail = (glbId || "").slice(-6);
      const q = `mimeType='application/vnd.google-apps.spreadsheet' and name contains 'LociMyu' and name contains '${tail}' and trashed=false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
      const { files=[] } = await fetchJSON(url);
      return files;
    } catch (e) {
      warn("drive list failed", e);
      return [];
    }
  }

  async function createSpreadsheetSkeleton(glbId, glbName) {
    // Sheets API: spreadsheets.create
    const title = `LociMyu — ${glbName || 'GLB'} [${(glbId||'').slice(0,8)}]`;
    const body = {
      properties: { title },
      sheets: [
        { properties: { title: "__LM_MATERIALS" } },
        { properties: { title: "Captions" } }
      ]
    };
    const url = "https://sheets.googleapis.com/v4/spreadsheets";
    const data = await fetchJSON(url, { method: "POST", body: JSON.stringify(body) });
    return data.spreadsheetId;
  }

  async function getSpreadsheetInfo(spreadsheetId) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    return await fetchJSON(url);
  }

  function extractGids(spreadsheet) {
    let materialsGid = null;
    let defaultCaptionGid = null;
    const sheets = (spreadsheet && spreadsheet.sheets) || [];
    for (const s of sheets) {
      const p = s.properties || {};
      const title = p.title || "";
      if (title === "__LM_MATERIALS") materialsGid = p.sheetId;
      if (defaultCaptionGid == null && /captions/i.test(title)) defaultCaptionGid = p.sheetId;
    }
    return { materialsGid, defaultCaptionGid };
  }

  async function ensureSheetExists(spreadsheetId, title) {
    // 既に存在すれば何もしない
    const info = await getSpreadsheetInfo(spreadsheetId);
    const existing = (info.sheets || []).some(s => (s.properties && s.properties.title) === title);
    if (existing) return info;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const req = { requests: [{ addSheet: { properties: { title } } }] };
    const upd = await fetchJSON(url, { method: "POST", body: JSON.stringify(req) });
    // 最新の状態を返す
    return await getSpreadsheetInfo(spreadsheetId);
  }

  // ---------- main entry ----------
  async function postLoadEnsureSaveSheet({ glbId, glbName }) {
    log("begin", { glbId, glbName });

    // 1) 既存探索（緩めの一致）
    let spreadsheetId = null;
    const found = await listCandidateSpreadsheets(glbId);
    if (found.length > 0) {
      spreadsheetId = found[0].id;
    } else {
      // 2) なければ新規作成（ルートに作成。フォルダ移動は権限不足対策で省略）
      spreadsheetId = await createSpreadsheetSkeleton(glbId, glbName);
    }

    // 3) __LM_MATERIALS / Captions の存在保証（重複生成回避）
    let info = await ensureSheetExists(spreadsheetId, "__LM_MATERIALS");
    info = await ensureSheetExists(spreadsheetId, "Captions");

    // 4) GID 抽出
    const { materialsGid, defaultCaptionGid } = extractGids(info);

    // 5) ctx 共有 + イベント発火
    window.__lm_ctx = window.__lm_ctx || {};
    Object.assign(window.__lm_ctx, { spreadsheetId, materialsGid, defaultCaptionGid });
    log("ready", { spreadsheetId, materialsGid, defaultCaptionGid });

    document.dispatchEvent(new CustomEvent("lm:sheet-context", {
      detail: { spreadsheetId, sheetGid: defaultCaptionGid }
    }));

    return window.__lm_ctx;
  }

  // 公開
  window.postLoadEnsureSaveSheet = postLoadEnsureSaveSheet;

  // 旧API互換（glb.btn.bridge.v3.js から呼ばれる想定）
  window.loc = window.loc || {};
  if (typeof window.loc.findOrCreateSaveSheetByGlbId !== "function") {
    window.loc.findOrCreateSaveSheetByGlbId = (glbId, glbName) => postLoadEnsureSaveSheet({ glbId, glbName });
  }
})();