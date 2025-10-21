// materials.module.js
// LociMyu Materials: robust, rate-limit-safe, scene-aware module
// Drop-in alongside existing files. No rename of other files required.
// This module auto-initializes and integrates with existing UI without changing HTML.

(() => {
  const TAG = "[materials]";
  const win = window;

  // ---------- Utilities ----------
  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const sel = (q) => document.querySelector(q);
  const $id = (id) => document.getElementById(id);

  const getScene = () =>
    win.gltfScene ||
    win.scene ||
    (win.viewer && (win.viewer.scene || win.viewer.gltfScene)) ||
    null;

  const getGid = () => {
    const s = sel("nav select, #sheet-select");
    if (s && s.value && /^\d+$/.test(s.value)) return Number(s.value);
    const any = sel("select option:checked");
    if (any && /^\d+$/.test(any.value)) return Number(any.value);
    // fallback 0
    return 0;
  };

  const getSpreadsheetId = () => {
    if (typeof win.currentSpreadsheetId === "string" && win.currentSpreadsheetId.length > 10) {
      return win.currentSpreadsheetId;
    }
    // Try to extract from location (last ditch)
    const m = (location.href || "").match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    return null;
  };

  // ---------- Google Sheets I/O ----------
  // Prefer existing helpers if present; otherwise use fetch with getAccessToken()
  const hasHelper = {
    GV: typeof win.GV === "function",
    PV: typeof win.PV === "function",
    AV: typeof win.AV === "function",
    ensureToken: typeof win.ensureToken === "function",
    getAccessToken: typeof win.getAccessToken === "function",
  };

  const getToken = async () => {
    if (hasHelper.ensureToken) {
      try { await win.ensureToken(); } catch {}
    }
    if (hasHelper.getAccessToken) {
      try {
        const t = await win.getAccessToken();
        if (t) return t;
      } catch {}
    }
    return null;
  };

  const api = {
    GV: async (range, ssid) => {
      if (hasHelper.GV) return await win.GV(range, ssid);
      const token = await getToken();
      if (!token) throw new Error("No token");
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`GV ${res.status}`);
      return await res.json();
    },
    PV: async (range, values, ssid) => {
      if (hasHelper.PV) return await win.PV(range, values, ssid);
      const token = await getToken();
      if (!token) throw new Error("No token");
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ range, values, majorDimension: "ROWS" }),
      });
      if (!res.ok) throw new Error(`PV ${res.status}`);
      return await res.json();
    },
    AV: async (range, values, ssid) => {
      if (hasHelper.AV) return await win.AV(range, values, ssid);
      const token = await getToken();
      if (!token) throw new Error("No token");
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values, majorDimension: "ROWS" }),
      });
      if (!res.ok) throw new Error(`AV ${res.status}`);
      return await res.json();
    },
    batchAddSheet: async (ssid, title) => {
      const token = await getToken();
      if (!token) throw new Error("No token");
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
      });
      if (!res.ok) throw new Error(`batchUpdate ${res.status}`);
      return await res.json();
    },
  };

  // Exponential backoff wrapper for write ops
  const withBackoff = async (fn, label) => {
    const MAX = 6;
    let wait = 400;
    for (let i = 0; i < MAX; i++) {
      try {
        return await fn();
      } catch (e) {
        const msg = String(e && e.message || e);
        if (msg.includes("429") || msg.includes("RATE_LIMIT") || msg.includes("exhausted")) {
          warn(`${label} retry ${i + 1}/${MAX} after ${wait}ms`, e);
          await sleep(wait);
          wait = Math.min(wait * 2, 8000);
          continue;
        }
        throw e;
      }
    }
    throw new Error(`${label} failed after retries`);
  };

  // ---------- Materials Sheet ensure ----------
  const HEADERS = ["sheetId","materialKey","unlit","doubleSided","opacity","white2alpha","whiteThr","black2alpha","blackThr","updatedAt","updatedBy"];

  const ensureMaterialsSheet = async (ssid) => {
    // A1:K1 exists?
    try {
      const r = await api.GV("materials!A1:K1", ssid);
      const rows = r && r.values || [];
      if (!rows.length) {
        await withBackoff(() => api.PV("materials!A1:K1", [HEADERS], ssid), "header PV");
      } else {
        const h = rows[0] || [];
        if (h.join(",") !== HEADERS.join(",")) {
          await withBackoff(() => api.PV("materials!A1:K1", [HEADERS], ssid), "header fix PV");
        }
      }
      log("ensure: header OK");
      return;
    } catch (e) {
      const msg = String(e && e.message || e);
      if (msg.includes("404") || msg.includes("400")) {
        // add sheet
        try {
          await withBackoff(() => api.batchAddSheet(ssid, "materials"), "addSheet");
          await withBackoff(() => api.PV("materials!A1:K1", [HEADERS], ssid), "header PV after add");
          log("ensure: created");
          return;
        } catch (e2) {
          // 既に存在
          if (String(e2).includes("already")) {
            await withBackoff(() => api.PV("materials!A1:K1", [HEADERS], ssid), "header PV race");
            return;
          }
          throw e2;
        }
      }
      throw e;
    }
  };

  // ---------- Target population (GLOBAL + mesh/material) ----------
  const populateTarget = async () => {
    const selEl = $id("mat-target");
    if (!selEl) return;

    // Always include GLOBAL
    const items = [{ value: "GLOBAL", label: "GLOBAL — All Meshes" }];

    const scene = getScene();
    if (!scene) {
      // If scene not yet, keep just GLOBAL; will be re-run when ready
      log("populateTarget: scene not ready — GLOBAL only for now");
      selEl.innerHTML = items.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
      selEl.value = "GLOBAL";
      return;
    }

    const uniq = new Set();
    scene.traverse(obj => {
      if (!obj || !obj.isMesh || !obj.material) return;
      const meshName = obj.name || "Mesh";
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        const matName = (m && m.name) ? m.name : "Material";
        const key = `${meshName}/${matName}`;
        if (!uniq.has(key)) {
          uniq.add(key);
          items.push({ value: key, label: key });
        }
      });
    });

    selEl.innerHTML = items.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    if (!selEl.value) selEl.value = "GLOBAL";
    log("populateTarget: options =", items.length);
  };

  // ---------- Load latest values for current gid ----------
  const cacheByKey = new Map(); // key = `${gid}|${materialKey}` -> { ...row }

  const loadCacheForGid = async (ssid, gid) => {
    try {
      const r = await withBackoff(() => api.GV("materials!A1:K9999", ssid), "GV all");
      const rows = (r && r.values) || [];
      // find headers row index
      let start = 0;
      if (rows.length && rows[0][0] !== "sheetId") start = 0;
      cacheByKey.clear();
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i];
        if (!a || !a.length) continue;
        const rowSid = Number(a[0] || 0);
        if (rowSid !== gid) continue;
        const rec = {
          sheetId: rowSid,
          materialKey: a[1] || "GLOBAL",
          unlit: a[2] === "1" || a[2] === 1 || a[2] === true,
          doubleSided: a[3] === "1" || a[3] === 1 || a[3] === true,
          opacity: Number(a[4] ?? 1) || 1,
          white2alpha: a[5] === "1" || a[5] === 1 || a[5] === true,
          whiteThr: Number(a[6] ?? 0.92) || 0.92,
          black2alpha: a[7] === "1" || a[7] === 1 || a[7] === true,
          blackThr: Number(a[8] ?? 0.08) || 0.08,
          updatedAt: a[9] || "",
          updatedBy: a[10] || "",
          __rowIndex: i + 1, // 1-based for A1 notation
        };
        cacheByKey.set(`${gid}|${rec.materialKey}`, rec);
      }
      log("load cache for gid", gid, "count", cacheByKey.size);
    } catch (e) {
      warn("loadCacheForGid failed", e);
    }
  };

  const applyToUI = (rec) => {
    if (!rec) return;
    const set = (id, v) => { const el = $id(id); if (!el) return; if (el.type === "checkbox") el.checked = !!v; else el.value = String(v); };
    set("mat-unlit", !!rec.unlit);
    set("mat-doubleside", !!rec.doubleSided);
    set("mat-opacity", Number(rec.opacity ?? 1));
    set("mat-white2alpha", !!rec.white2alpha);
    set("mat-white-thr", Number(rec.whiteThr ?? 0.92));
    set("mat-black2alpha", !!rec.black2alpha);
    set("mat-black-thr", Number(rec.blackThr ?? 0.08));
  };

  // ---------- Three.js apply ----------
  const swapToBasic = (mesh) => {
    const THREE = win.THREE;
    if (!THREE) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = [];
    mats.forEach((m,i) => {
      if (!mesh.userData._origMat) mesh.userData._origMat = {};
      if (!mesh.userData._origMat[i]) mesh.userData._origMat[i] = m;
      const basic = new THREE.MeshBasicMaterial({
        map: m && m.map || null,
        color: m && m.color || undefined,
        transparent: true,
        opacity: (m && "opacity" in m) ? m.opacity : 1,
        side: (m && m.side) || THREE.FrontSide,
        alphaTest: (m && m.alphaTest) || 0,
      });
      basic.needsUpdate = true;
      out.push(basic);
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
    if (mesh.material) mesh.material.needsUpdate = true;
  };

  const restoreMaterial = (mesh) => {
    const orig = mesh.userData && mesh.userData._origMat;
    if (!orig) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = Object.keys(orig).map(k => orig[k]);
    } else {
      mesh.material = orig[0] || mesh.material;
    }
    if (mesh.material) mesh.material.needsUpdate = true;
  };

  const applySettingsToScene = (materialKey, s) => {
    const THREE = win.THREE;
    const scene = getScene();
    if (!scene || !THREE) return;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh || !obj.material) return;
      let target = true;
      if (materialKey && materialKey !== "GLOBAL") {
        const meshName = obj.name || "Mesh";
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        target = mats.some(m => {
          const mName = (m && m.name) ? m.name : "Material";
          return `${meshName}/${mName}` === materialKey;
        });
      }
      if (!target) return;

      if (s.unlit) swapToBasic(obj); else restoreMaterial(obj);

      const mats2 = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats2.forEach(m => {
        if (!m) return;
        m.side = s.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        m.transparent = (s.opacity < 1) || m.transparent;
        m.opacity = (typeof s.opacity === "number") ? s.opacity : 1;
        if (s.white2alpha || s.black2alpha) {
          const thr = Math.max(0, Math.min(0.5, (s.white2alpha ? s.whiteThr : s.blackThr)));
          m.alphaTest = thr;
        } else {
          m.alphaTest = 0;
        }
        m.needsUpdate = true;
      });
    });
    try { win.viewer && typeof win.viewer.renderNow === "function" && win.viewer.renderNow(); } catch {}
  };

  // expose hook for other modules
  win.materialsApplyHook = ({ materialKey, settings }) => {
    applySettingsToScene(materialKey || "GLOBAL", settings || {});
  };

  // ---------- UI interactions ----------
  const readUI = () => ({
    materialKey: $id("mat-target")?.value || "GLOBAL",
    unlit: !!$id("mat-unlit")?.checked,
    doubleSided: !!$id("mat-doubleside")?.checked,
    opacity: Number($id("mat-opacity")?.value ?? 1),
    white2alpha: !!$id("mat-white2alpha")?.checked,
    whiteThr: Number($id("mat-white-thr")?.value ?? 0.92),
    black2alpha: !!$id("mat-black2alpha")?.checked,
    blackThr: Number($id("mat-black-thr")?.value ?? 0.08),
  });

  let saveQueue = Promise.resolve();
  let saveTimer = null;

  const saveDebounced = (ssid) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveQueue = saveQueue.then(() => saveNow(ssid)).catch(e => warn("save chain", e));
    }, 400);
  };

  const saveNow = async (ssid) => {
    const gid = getGid();
    const s = readUI();
    const key = `${gid}|${s.materialKey}`;
    const values = [
      gid,
      s.materialKey,
      s.unlit ? 1 : 0,
      s.doubleSided ? 1 : 0,
      isFinite(s.opacity) ? Number(s.opacity) : 1,
      s.white2alpha ? 1 : 0,
      isFinite(s.whiteThr) ? Number(s.whiteThr) : 0.92,
      s.black2alpha ? 1 : 0,
      isFinite(s.blackThr) ? Number(s.blackThr) : 0.08,
      new Date().toISOString(),
      "unknown"
    ];

    const cached = cacheByKey.get(key);
    if (cached && cached.__rowIndex) {
      const rowIdx = cached.__rowIndex;
      const range = `materials!A${rowIdx}:K${rowIdx}`;
      await withBackoff(() => api.PV(range, [values], ssid), "PV update");
      log("PV ok", range, values);
    } else {
      const range = `materials!A2:K9999`;
      await withBackoff(() => api.AV(range, [values], ssid), "AV append");
      log("AV ok", values);
      // Reload cache to get new row indexes
      await loadCacheForGid(ssid, gid);
    }

    // Apply to scene immediately
    applySettingsToScene(s.materialKey, s);
  };

  const wireUI = (ssid) => {
    const ids = ["mat-unlit","mat-doubleside","mat-opacity","mat-white2alpha","mat-white-thr","mat-black2alpha","mat-black-thr"];
    ids.forEach(id => {
      const el = $id(id);
      if (!el) return;
      const evt = (el.tagName === "INPUT" ? "input" : "change");
      el.addEventListener(evt, () => saveDebounced(ssid));
    });
    const selEl = $id("mat-target");
    if (selEl) {
      selEl.addEventListener("change", async () => {
        // when switching target, try to load existing values for that key
        const gid = getGid();
        const rec = cacheByKey.get(`${gid}|${selEl.value}`);
        if (rec) {
          applyToUI(rec);
          // do not save immediately; just reflect to scene
          applySettingsToScene(selEl.value, readUI());
        } else {
          // if not found, keep current UI; user will tweak then save
          applySettingsToScene(selEl.value, readUI());
        }
      });
    }

    // caption sheet change
    const sheetSel = sel("nav select, #sheet-select");
    if (sheetSel) {
      sheetSel.addEventListener("change", async () => {
        const gid = getGid();
        await loadCacheForGid(ssid, gid);
        // default to GLOBAL on sheet switch
        if ($id("mat-target")) $id("mat-target").value = "GLOBAL";
        applyToUI(cacheByKey.get(`${gid}|GLOBAL`) || null);
        applySettingsToScene("GLOBAL", readUI());
      });
    }
  };

  // ---------- Scene-ready gating for target list ----------
  const waitSceneThenPopulate = async () => {
    let tries = 0;
    while (tries++ < 80) {
      if (getScene()) break;
      await sleep(250);
    }
    await populateTarget();
  };

  // ---------- Boot ----------
  const boot = async () => {
    try {
      log("module booting…");
      const ssid = getSpreadsheetId();
      const hasUi =
        $id("mat-target") &&
        $id("mat-unlit") &&
        $id("mat-doubleside") &&
        $id("mat-opacity");
      if (!hasUi) {
        warn("UI controls not found — module idle");
        return;
      }

      // Ensure sheet & header
      if (ssid) {
        await ensureMaterialsSheet(ssid);
      } else {
        warn("No spreadsheet id — sheet operations disabled");
      }

      // Initial cache load
      if (ssid) {
        await loadCacheForGid(ssid, getGid());
      }

      // Populate target once scene ready (GLOBAL is inserted immediately)
      await populateTarget();
      waitSceneThenPopulate();

      // Wire UI and initial apply
      wireUI(ssid);
      applySettingsToScene($id("mat-target")?.value || "GLOBAL", readUI());

      log("module ready");
    } catch (e) {
      warn("boot failed", e);
    }
  };

  // Defer boot until DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
