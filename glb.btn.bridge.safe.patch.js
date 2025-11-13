/*!
 * glb.btn.bridge.safe.patch.js — 2025-11-13c
 * - glb.btn.bridge.v3.js の旧呼び出しに対して安全に委譲
 * - ロード順不問（GLBクリック前に読み込まれていればOK）
 */
(() => {
  'use strict';
  const TAG = "[glb-bridge-safe]";
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // 既にpolyfillされていれば何もしない
  window.loc = window.loc || {};
  if (typeof window.loc.findOrCreateSaveSheetByGlbId === "function") {
    log("compat already present");
    return;
  }

  // postLoadEnsureSaveSheet があとから来る場合も考慮し、遅延委譲でラップ
  window.loc.findOrCreateSaveSheetByGlbId = async (glbId, glbName) => {
    if (typeof window.postLoadEnsureSaveSheet === "function") {
      return window.postLoadEnsureSaveSheet({ glbId, glbName });
    }
    // 簡易リトライ（最大2秒）
    const t0 = performance.now();
    while (performance.now() - t0 < 2000) {
      await new Promise(r => setTimeout(r, 100));
      if (typeof window.postLoadEnsureSaveSheet === "function") {
        return window.postLoadEnsureSaveSheet({ glbId, glbName });
      }
    }
    warn("postLoadEnsureSaveSheet not ready; skip");
    return null;
  };

  log("compat installed");
})();