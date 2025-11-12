// glb.btn.bridge.v3.js — patched (2025-11-12)
// Robust GLB button wiring + viewer ensure + save sheet ensure (gid-first)
(() => {
  const BTN_SEL = "#btnGlb";
  const INPUT_SEL = "#glbUrl";
  const DATA_KEY = "lmGlbWired";

  // Guard: wire once
  const btn = document.querySelector(BTN_SEL);
  if (!btn) {
    console.warn("[glb-bridge-v3] button not found:", BTN_SEL);
    return;
  }
  if (btn.dataset && btn.dataset[DATA_KEY]) {
    console.log("[glb-bridge-v3] already wired v3");
    return;
  }
  btn.dataset[DATA_KEY] = "1";
  console.log("[glb-bridge-v3] button wired v3");
  console.log("[glb-bridge-v3] event listener armed");

  // Utilities
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  async function ensureViewerReady(canvasId = "gl") {
    // lazy import viewer module (ESM)
    const viewer = await import("./viewer.module.cdn.js");
    if (!viewer || !viewer.ensureViewer) {
      throw new Error("[glb-bridge-v3] viewer.ensureViewer not available");
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas) throw new Error(`[glb-bridge-v3] canvas #${canvasId} not found`);
    // create or fetch viewer instance
    const inst = await viewer.ensureViewer({ canvas });
    return { viewer, inst };
  }

  // Try to import save.locator.js as ESM, fall back to window globals
  async function getSaveLocatorAPI() {
    try {
      const loc = await import("./save.locator.js");
      // prefer named export if present
      if (loc && (loc.findOrCreateSaveSheetByGlbId || loc.default?.findOrCreateSaveSheetByGlbId)) {
        const f = loc.findOrCreateSaveSheetByGlbId || loc.default.findOrCreateSaveSheetByGlbId;
        const g = loc.getDefaultCaptionGid || loc.default?.getDefaultCaptionGid;
        return { findOrCreateSaveSheetByGlbId: f, getDefaultCaptionGid: g };
      }
    } catch (e) {
      console.warn("[glb-bridge-v3] ESM import(save.locator.js) failed, fallback to window", e);
    }
    const f2 = window.findOrCreateSaveSheetByGlbId;
    const g2 = window.getDefaultCaptionGid;
    if (!f2) throw new Error("[glb-bridge-v3] save locator API not found");
    return { findOrCreateSaveSheetByGlbId: f2, getDefaultCaptionGid: g2 };
  }

  // After GLB load, ensure save spreadsheet + __LM_MATERIALS header
  async function postLoadEnsureSaveSheet(fileId) {
    const { findOrCreateSaveSheetByGlbId, getDefaultCaptionGid } = await getSaveLocatorAPI();
    const ctx = await findOrCreateSaveSheetByGlbId(fileId);
    // ctx: { spreadsheetId, captionGid }
    if (!ctx || !ctx.spreadsheetId) {
      throw new Error("[glb-bridge-v3] invalid ctx returned from save locator");
    }
    if (!ctx.captionGid && typeof getDefaultCaptionGid === "function") {
      ctx.captionGid = await getDefaultCaptionGid(ctx.spreadsheetId);
    }

    // Dispatch sheet-context for other modules
    window.dispatchEvent(new CustomEvent("lm:sheet-context", { detail: {
      spreadsheetId: ctx.spreadsheetId,
      sheetGid: String(ctx.captionGid || "")
    }}));

    // Ensure __LM_MATERIALS header if helper is present
    if (typeof window.__lm_ensureMaterialsHeader === "function") {
      await window.__lm_ensureMaterialsHeader(ctx.spreadsheetId);
      console.log("[glb-bridge-v3] materials header ensured");
    } else {
      console.log("[glb-bridge-v3] __lm_ensureMaterialsHeader not found (skipped)");
    }
  }

  async function loadById(fileId) {
    const { viewer, inst } = await ensureViewerReady("gl");
    // viewer exports list for debug
    console.log("[glb-bridge-v3] exports:", Object.keys(viewer));
    // set current glb id on viewer side (optional)
    if (typeof viewer.setCurrentGlbId === "function") {
      viewer.setCurrentGlbId(fileId);
    }
    // Load GLB via Drive helper
    if (!viewer.loadGlbFromDrive) {
      throw new Error("[glb-bridge-v3] loadGlbFromDrive not exported");
    }
    await viewer.loadGlbFromDrive({ fileId });

    // Wait a few frames for scene stabilization
    await sleep(100);
    await postLoadEnsureSaveSheet(fileId);
  }

  async function loadFromInputOrPrompt() {
    const input = document.querySelector("#glbUrl");
    let val = (input && input.value || "").trim();
    if (!val) {
      val = prompt("GLBのDrive共有URLまたはfileIdを入力してください");
      if (!val) return;
    }
    // Normalize: extract fileId if it looks like a share URL
    let fileId = val;
    try {
      if (val.includes("drive.google.com")) {
        const u = new URL(val);
        // patterns: /file/d/<id>/view, or ?id=<id>
        const m = u.pathname.match(/\/file\/d\/([^/]+)/);
        fileId = (m && m[1]) || u.searchParams.get("id") || val;
      }
    } catch {}
    console.log("[glb-bridge-v3] load fileId", fileId);
    await loadById(fileId);
  }

  btn.addEventListener("click", (ev) => {
    // passive:true to keep UI smooth
    (async () => {
      try {
        await loadFromInputOrPrompt();
      } catch (err) {
        console.error("[glb-bridge-v3] load failed", err);
        alert("GLBの読み込みに失敗しました。コンソールを確認してください。");
      }
    })();
  }, { passive: true });

})();