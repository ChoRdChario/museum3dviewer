
/*! material.orchestrator.js */
(() => {
  const TAG = "V6_15k_READY_STICKY";
  const log = (...a) => console.log("[mat-orch]", ...a);
  const warn = (...a) => console.warn("[mat-orch]", ...a);

  function $(id) { return document.getElementById(id); }

  function waitForUI(timeout=5000) {
    return new Promise((resolve, reject) => {
      const ok = () => {
        const selMat = $("pm-material");
        const range = $("pm-opacity-range");
        if (selMat && range) { resolve({ selMat, range }); return true; }
        return false;
      };
      if (ok()) return;
      const st = Date.now();
      const id = setInterval(() => {
        if (ok()) { clearInterval(id); return; }
        if (Date.now() - st > timeout) { clearInterval(id); reject(new Error("UI controls not found")); }
      }, 100);
    });
  }

  async function waitReadyBridges(timeout=8000) {
    const start = Date.now();
    const needViewer = async () => {
      if (window.viewerBridge?.isReady?.()) return true;
      // sticky check
      if (window.__lm_sceneReady) return true;
      if (window.viewerBridge?.waitUntilReady) {
        try { await window.viewerBridge.waitUntilReady({ timeout: Math.max(100, timeout - (Date.now()-start)) }); return true; } catch {}
      }
      // final poll loop
      while (Date.now() - start < timeout) {
        if (window.__lm_sceneReady || (window.viewerBridge && window.viewerBridge.isReady && window.viewerBridge.isReady())) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error("viewerBridge not ready");
    };
    const needSheet = async () => {
      // sticky context from sheet.ctx.bridge.js
      const ok = () => !!(window.__lm_sheetContext && window.__lm_sheetContext.spreadsheetId);
      if (ok()) return true;
      const st = Date.now();
      return new Promise((resolve, reject) => {
        const on = (e) => {
          window.__lm_sheetContext = e.detail || window.__lm_sheetContext;
          if (ok()) { document.removeEventListener("lm:sheet-context", on); resolve(true); }
        };
        document.addEventListener("lm:sheet-context", on);
        const id = setInterval(() => {
          if (ok()) { clearInterval(id); document.removeEventListener("lm:sheet-context", on); resolve(true); }
          else if (Date.now() - st > timeout) { clearInterval(id); document.removeEventListener("lm:sheet-context", on); reject(new Error("sheetBridge not ready")); }
        }, 100);
      });
    };
    await needViewer();
    await needSheet();
  }

  function populateMaterialSelect(sel, materials) {
    sel.innerHTML = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "— Select —";
    sel.appendChild(def);
    materials.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.name || "(unnamed)";
      sel.appendChild(opt);
    });
  }

  function getMaterialByKey(key) {
    const list = (window.viewerBridge?.listMaterials?.() || []);
    return list.find(m => m.key === key);
  }

  async function wireOnce() {
    const ui = await waitForUI();
    log("loaded VERSION_TAG:", TAG);
    log("ui ok");

    await waitReadyBridges();
    const spreadsheetId = window.__lm_sheetContext?.spreadsheetId;
    if (!spreadsheetId) { throw new Error("spreadsheetId missing"); }

    const materials = (window.viewerBridge?.listMaterials?.() || []);
    populateMaterialSelect(ui.selMat, materials);
    log("panel populated", materials.length, "materials");

    // Load saved values, apply first, then bind UI
    let saved = new Map();
    try {
      saved = await window.materialsSheetBridge.loadAll(spreadsheetId);
    } catch (e) {
      warn("loadAll failed (continue with empty):", e);
      saved = new Map();
    }

    // Apply saved opacity to scene and reflect UI when user selects
    const range = ui.range;
    const out = $("pm-opacity-val");

    function applyOpacity(key, value) {
      const mat = getMaterialByKey(key);
      if (!mat || !mat.ref) return;
      const v = Number(value);
      if (Number.isFinite(v)) {
        mat.ref.transparent = v < 1.0 || mat.ref.transparent;
        mat.ref.opacity = v;
      }
    }

    ui.selMat.addEventListener("change", () => {
      const key = ui.selMat.value;
      const rec = key ? saved.get(key) : null;
      const val = rec && rec.opacity != null ? Number(rec.opacity) : 1.0;
      range.value = String(val);
      out.value = `${val.toFixed(2)}`;
      applyOpacity(key, val);
    });

    range.addEventListener("input", () => {
      const val = Number(range.value);
      out.value = `${val.toFixed(2)}`;
    });

    let pending = null;
    range.addEventListener("change", () => {
      const key = ui.selMat.value;
      if (!key) return;
      const val = Number(range.value);
      applyOpacity(key, val);
      // throttle append
      if (pending) clearTimeout(pending);
      pending = setTimeout(async () => {
        try {
          await window.materialsSheetBridge.upsertOne(spreadsheetId, { materialKey: key, opacity: val });
        } catch (e) {
          warn("upsertOne failed", e);
        }
      }, 250);
    });

    // Trigger initial UI sync
    ui.selMat.dispatchEvent(new Event("change"));
    log("wired panel");
  }

  // Start
  (async () => {
    try { await wireOnce(); }
    catch (e) {
      warn("boot failed (will retry automatically)", e);
      setTimeout(() => wireOnce().catch(()=>{}), 800);
    }
  })();
})();
