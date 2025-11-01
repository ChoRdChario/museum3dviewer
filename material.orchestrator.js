
// LociMyu - Material Orchestrator (sticky-ready & resilient)
// VERSION_TAG: V6_16d_STICKY_READY_UI_SYNC_FIX
(function () {
  if (window.__lm_material_orch_installed) return;
  window.__lm_material_orch_installed = true;

  const VERSION_TAG = "V6_16d_STICKY_READY_UI_SYNC_FIX";
  const NS = "[mat-orch]";

  const log  = (...a)=>console.log(NS, ...a);
  const warn = (...a)=>console.warn(NS, ...a);
  const err  = (...a)=>console.error(NS, ...a);

  log("loaded VERSION_TAG:", VERSION_TAG);

  // --- helpers ---------------------------------------------------------------
  function onceWithTimeout(target, type, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const h = (e) => {
        try { target.removeEventListener(type, h, true); } catch {}
        if (timer) clearTimeout(timer);
        resolve(e);
      };
      try { target.addEventListener(type, h, { once:true }); } catch (e) {}
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          try { target.removeEventListener(type, h, true); } catch {}
          reject(new Error(type+" timeout"));
        }, timeoutMs);
      }
    });
  }

  function throttle(fn, ms) {
    let t = 0, pend = null, ctx = null, args = null;
    return function () {
      ctx = this; args = arguments;
      const now = Date.now();
      if (!t) {
        t = now; fn.apply(ctx, args);
        setTimeout(() => {
          t = 0;
          if (pend) { const p = pend; pend=null; fn.apply(p.ctx, p.args); }
        }, ms);
      } else {
        pend = { ctx, args };
      }
    };
  }

  async function waitSceneReadySticky(timeout=1200) {
    if (window.viewerBridge && typeof window.viewerBridge.listMaterials === "function") {
      try { await onceWithTimeout(window, "lm:scene-ready", timeout); }
      catch { /* soft-timeout ok */ }
      return true;
    }
    await onceWithTimeout(window, "lm:scene-ready", timeout);
    return true;
  }

  async function getSheetCtxSticky(timeout=1200) {
    if (window.__lm_last_sheet_ctx && window.__lm_last_sheet_ctx.spreadsheetId) {
      return window.__lm_last_sheet_ctx;
    }
    try {
      const ev = await onceWithTimeout(window, "lm:sheet-context", timeout);
      const ctx = (ev && ev.detail) || null;
      if (ctx && ctx.spreadsheetId) return ctx;
      throw new Error("sheet-context missing detail");
    } catch (e) {
      return null; // fallback
    }
  }

  // --- UI refs ---------------------------------------------------------------
  function uiRefs() {
    const sel  = document.getElementById("pm-material");
    const rng  = document.getElementById("pm-opacity-range");
    const out  = document.getElementById("pm-opacity-val");
    const cbDS = document.getElementById("pm-flag-doublesided");
    const cbUL = document.getElementById("pm-flag-unlit");
    const ckEn = document.querySelector("#pane-material input[type=checkbox][data-ck='enable']") || document.querySelector("#pane-material input[type=checkbox]#ck-enable");
    const tol  = document.querySelector("#pane-material input[type=range][data-ck='tol']");
    const fea  = document.querySelector("#pane-material input[type=range][data-ck='feather']");
    return { sel, rng, out, cbDS, cbUL, ckEn, tol, fea };
  }

  function populatePanelFromViewer() {
    const { sel } = uiRefs();
    if (!sel) return false;
    const vb = window.viewerBridge;
    const list = vb && typeof vb.listMaterials === "function" ? vb.listMaterials() : [];
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = ""; opt0.textContent = "— Select —";
    sel.appendChild(opt0);
    (list||[]).forEach(name => {
      const o = document.createElement("option");
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });
    log("panel populated", list ? list.length : 0, "materials");
    return true;
  }

  function setOpacityUI(value) {
    const { rng, out } = uiRefs();
    if (rng) rng.value = String(value);
    if (out) out.value = (Math.round(Number(value)*100)/100).toFixed(2);
  }

  function reflectRowToUI(row) {
    if (!row) return;
    setOpacityUI(row.opacity ?? 1);
    const { cbDS, cbUL } = uiRefs();
    if (cbDS) cbDS.checked = !!row.doubleSided;
    if (cbUL) cbUL.checked = !!row.unlit;
    const { ckEn, tol, fea } = uiRefs();
    if (ckEn) ckEn.checked = !!row.chromaEnable;
    if (tol && typeof row.chromaTolerance === "number") tol.value = String(row.chromaTolerance);
    if (fea && typeof row.chromaFeather === "number")   fea.value = String(row.chromaFeather);
  }

  function readUI() {
    const { rng, cbDS, cbUL, ckEn, tol, fea } = uiRefs();
    return {
      opacity: Number(rng ? rng.value : 1),
      doubleSided: !!(cbDS && cbDS.checked),
      unlit: !!(cbUL && cbUL.checked),
      chromaEnable: !!(ckEn && ckEn.checked),
      chromaTolerance: Number(tol ? tol.value : 0),
      chromaFeather: Number(fea ? fea.value : 0),
    };
  }

  const msb = window.materialsSheetBridge || {};
  if (!msb.loadByKey) {
    log("polyfilled materialsSheetBridge.loadByKey");
    msb.loadByKey = async function(ctx, modelKey, matKey) {
      if (!msb.loadAll) return null;
      const rows = await msb.loadAll(ctx, modelKey);
      if (!Array.isArray(rows)) return null;
      return rows.find(r => r.materialKey === matKey) || null;
    };
    window.materialsSheetBridge = msb;
  }

  async function wireOnce() {
    populatePanelFromViewer();

    let sheetCtx = null;
    try { await waitSceneReadySticky(1000); } catch(e){ /* soft timeout */ }
    try { sheetCtx = await getSheetCtxSticky(1000); } catch(e){ sheetCtx=null; }

    const vb = window.viewerBridge;
    const { sel, rng } = uiRefs();
    if (!sel || !vb) return;

    sel.addEventListener("change", async () => {
      const key = sel.value;
      if (!key) return;
      try {
        let row = null;
        if (sheetCtx && window.materialsSheetBridge && window.materialsSheetBridge.loadByKey) {
          const modelKey = (vb.modelKey && vb.modelKey()) || "model";
          try { row = await window.materialsSheetBridge.loadByKey(sheetCtx, modelKey, key); }
          catch(e){}
        }
        reflectRowToUI(row || { opacity: 1 });
      } catch(e) { warn("reflect UI on change failed", e); }
    });

    const applyOpacity = throttle(() => {
      const key = sel && sel.value;
      if (!key) return;
      const v = Number(rng ? rng.value : 1);
      try { vb.applyOpacityByMaterial && vb.applyOpacityByMaterial(key, v); } catch {}
    }, 40);
    if (rng) rng.addEventListener("input", () => { setOpacityUI(Number(rng.value)); applyOpacity(); });

    log("wired panel");
  }

  async function boot() {
    try { await wireOnce(); }
    catch (e) { warn("first wire failed, retry soon", e); }
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      try { wireOnce(); } catch {}
      if (tries > 10) clearInterval(timer);
    }, 1200);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") boot();
  else window.addEventListener("DOMContentLoaded", boot, { once:true });
})();
