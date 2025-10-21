/* LociMyu boot (self-contained) — LM-PATCH-STABLE-2 (full)
   This file is safe to drop-in as boot.esm.cdn.js.
   It does not remove existing globals; it only augments behavior.
*/

(() => {
  const LOG_TAG = "[LociMyu ESM/CDN]";
  try { console.log(`${LOG_TAG} boot clean full build loaded`); } catch(e){}

  // ---------- small logger with on/off ----------
  const LM_LOG_LEVEL = (window.LM_LOG_LEVEL || "info"); // "info" | "debug" | "silent"
  const shouldLog = (lvl) => (LM_LOG_LEVEL !== "silent" && (LM_LOG_LEVEL === "debug" || lvl !== "debug"));
  const log   = (...a)=> { if (shouldLog("info"))  console.log(...a); };
  const debug = (...a)=> { if (shouldLog("debug")) console.debug(...a); };
  const warn  = (...a)=> { if (shouldLog("info"))  console.warn(...a); };
  const error = (...a)=> console.error(...a);

  // Expose patch marker.
  window.__LM_PATCH = Object.assign(window.__LM_PATCH || {}, { version: "LM-PATCH-STABLE-2" });

  // ---------- Auth helpers ----------
  async function ensureAuth() {
    try { if (typeof window.ensureToken === "function") await window.ensureToken(); } catch (e) {}
    if (typeof window.getAccessToken === "function") {
      try { return await window.getAccessToken(); } catch (e) { return null; }
    }
    return null;
  }

  // ---------- Sheets API helpers (fetch fallbacks) ----------
  const GV = (typeof window.getValues === "function") ? window.getValues : async function(ssid, range, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`GV ${r.status}`);
    const j = await r.json(); return j.values || [];
  };
  const PV_raw = (typeof window.putValues === "function") ? window.putValues : async function(ssid, range, rows, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const body = { range, majorDimension: "ROWS", values: rows };
    const r = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`PV ${r.status} ${t}`); }
  };
  const AV_raw = (typeof window.appendValues === "function") ? window.appendValues : async function(ssid, range, rows, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const body = { range, majorDimension: "ROWS", values: rows };
    const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text().catch(()=> ""); throw new Error(`AV ${r.status} ${t}`); }
  };

  // ---------- gentle rate limiter (serialize writes) ----------
  class RateLimiter {
    constructor(minIntervalMs = 450) {
      this.min = minIntervalMs;
      this.q = Promise.resolve();
      this.last = 0;
    }
    run(fn) {
      this.q = this.q.then(async () => {
        const now = Date.now();
        const wait = Math.max(0, this.min - (now - this.last));
        if (wait) await new Promise(r => setTimeout(r, wait));
        try {
          return await fn();
        } finally {
          this.last = Date.now();
        }
      });
      return this.q;
    }
  }
  const writeLimiter = new RateLimiter(500);
  const PV = (...args) => writeLimiter.run(() => PV_raw(...args));
  const AV = (...args) => writeLimiter.run(() => AV_raw(...args));

  // ========== Materials module ==========
  (function(){
    const MATERIALS_SHEET_TITLE = "materials";
    const DEFAULTS = { unlit:false, doubleSided:false, opacity:1, white2alpha:false, whiteThr:0.92, black2alpha:false, blackThr:0.08 };

    const materialsIndex = new Map(); // key -> { rowIndex }
    const materialsCache = new Map(); // key -> settings
    const alphaMapCache  = new Map(); // sourceTexture -> generated alpha map (THREE.Texture)

    const keyOf = (sheetId, materialKey) => `${sheetId}::${materialKey}`;

    // --- util: active sheet id ---
    function getActiveSheetId(){
      const g = window;
      const cand = [g.currentSheetId, g.activeSheetId, g.sheetId, g.currentGid, g.currentSheetGid]
        .find(v => (typeof v === "number" && isFinite(v)) || (typeof v === "string" && /^\d+$/.test(v)));
      if (cand != null) return Number(cand);
      try {
        const sel = document.querySelector('nav select, #sheet-select, select[name="sheet"], select[data-role="sheet"]');
        if (sel && sel.value && /^\d+$/.test(sel.value)) return Number(sel.value);
        const any = document.querySelector("select option:checked");
        if (any && /^\d+$/.test(any.value)) return Number(any.value);
      } catch(e){}
      return 0;
    }

    // --- sheet ensure ---
    async function ensureMaterialsSheet(token){
      const ssid = window.currentSpreadsheetId; if (!ssid) return false;
      const headers = ["sheetId","materialKey","unlit","doubleSided","opacity","white2alpha","whiteThr","black2alpha","blackThr","updatedAt","updatedBy"];
      try {
        try {
          const vals = await GV(ssid, `${MATERIALS_SHEET_TITLE}!A1:K1`, token);
          if (!vals || !vals.length || !(vals[0]||[]).length) {
            await PV(ssid, `${MATERIALS_SHEET_TITLE}!A1:K1`, [headers], token);
          }
        } catch(e) {
          // create sheet
          const body = { requests:[{ addSheet:{ properties:{ title: MATERIALS_SHEET_TITLE } } }] };
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(ssid)}:batchUpdate`;
          const r = await fetch(url, { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify(body) });
          if(!r.ok){ const t=await r.text().catch(()=> ""); warn("[materials] addSheet fail", t); }
          await PV(ssid, `${MATERIALS_SHEET_TITLE}!A1:K1`, [headers], token);
        }
        return true;
      } catch (err) {
        warn("[materials] ensureMaterialsSheet error", err);
        return false;
      }
    }

    async function ensureMaterialsIndex(){
      materialsIndex.clear(); materialsCache.clear();
      const token = await ensureAuth();
      const ssid = window.currentSpreadsheetId; const sid = getActiveSheetId();
      if (!token || !ssid) return false;
      const ok = await ensureMaterialsSheet(token); if (!ok) return false;
      try{
        const values = await GV(ssid, `${MATERIALS_SHEET_TITLE}!A1:K9999`, token);
        if (!values || !values.length) return true;
        const headers = values[0].map(v => (v||"").toString().trim());
        const idx = {}; headers.forEach((h,i)=> idx[h.toLowerCase()] = i);
        const iSheetId = idx["sheetid"];
        const iKey     = idx["materialkey"];
        for (let r=1; r<values.length; r++){
          const row = values[r] || [];
          const s = Number(row[iSheetId] || 0);
          const mkey = (row[iKey] || "").toString();
          if (!mkey) continue;
          const k = keyOf(s, mkey);
          materialsIndex.set(k, { rowIndex: r+1 });
          const getB = (name, def)=>{
            const i = idx[name]; if (i==null) return def;
            const v = String(row[i] ?? "").trim().toLowerCase();
            return (v === "1" || v === "true");
          };
          const getN = (name, def)=>{
            const i = idx[name]; if (i==null) return def;
            const n = Number(row[i]); return isFinite(n) ? n : def;
          };
          materialsCache.set(k, {
            unlit: getB("unlit", false),
            doubleSided: getB("doublesided", false),
            opacity: getN("opacity", 1),
            white2alpha: getB("white2alpha", false),
            whiteThr: getN("whitethr", 0.92),
            black2alpha: getB("black2alpha", false),
            blackThr: getN("blackthr", 0.08),
          });
        }
        return true;
      }catch(e){ warn("[materials] ensureMaterialsIndex read error", e); return false; }
    }

    // --- save(upsert) with debounce ---
    const saveTimers = new Map();
    function scheduleSave(sheetId, materialKey, s){
      const tokenPromise = ensureAuth();
      const ssid = window.currentSpreadsheetId;
      const key = keyOf(sheetId, materialKey);
      materialsCache.set(key, {...s});

      if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
      saveTimers.set(key, setTimeout(async () => {
        try{
          const token = await tokenPromise; if (!token || !ssid) return;
          await ensureMaterialsSheet(token);
          const now = new Date().toISOString(); const user = (window.gapiUserEmail || "unknown");
          const row = [ sheetId, materialKey, s.unlit?1:0, s.doubleSided?1:0, s.opacity, s.white2alpha?1:0, s.whiteThr, s.black2alpha?1:0, s.blackThr, now, user ];
          const idxEntry = materialsIndex.get(key);
          if (idxEntry && idxEntry.rowIndex) {
            const range = `${MATERIALS_SHEET_TITLE}!A${idxEntry.rowIndex}:K${idxEntry.rowIndex}`;
            debug("[materials] PV update", range, row);
            await PV(ssid, range, [row], token);
          } else {
            debug("[materials] AV append", row);
            await AV(ssid, `${MATERIALS_SHEET_TITLE}!A2:K9999`, [row], token);
            await ensureMaterialsIndex();
          }
          log("[materials] saved", {sheetId, materialKey});
        }catch(e){ warn("[materials] save fail", e); }
      }, 500));
    }

    // --- UI bridge ---
    function readUI(){
      const target = document.getElementById("mat-target");
      return {
        materialKey: target?.value || "GLOBAL",
        unlit: !!document.getElementById("mat-unlit")?.checked,
        doubleSided: !!document.getElementById("mat-doubleside")?.checked,
        opacity: Number(document.getElementById("mat-opacity")?.value ?? 1),
        white2alpha: !!document.getElementById("mat-white2alpha")?.checked,
        whiteThr: Number(document.getElementById("mat-white-thr")?.value ?? 0.92),
        black2alpha: !!document.getElementById("mat-black2alpha")?.checked,
        blackThr: Number(document.getElementById("mat-black-thr")?.value ?? 0.08),
      };
    }
    function writeUI(s){
      const set = (id, fn)=>{ const el=document.getElementById(id); if(el) fn(el); };
      set("mat-unlit",        el=> el.checked = !!s.unlit);
      set("mat-doubleside",   el=> el.checked = !!s.doubleSided);
      set("mat-opacity",      el=> el.value   = (s.opacity ?? 1));
      set("mat-white2alpha",  el=> el.checked = !!s.white2alpha);
      set("mat-white-thr",    el=> el.value   = (s.whiteThr ?? 0.92));
      set("mat-black2alpha",  el=> el.checked = !!s.black2alpha);
      set("mat-black-thr",    el=> el.value   = (s.blackThr ?? 0.08));
      const wOut = document.getElementById("mat-white-thr-val"); if (wOut) wOut.textContent = String((s.whiteThr ?? 0.92).toFixed(2));
      const bOut = document.getElementById("mat-black-thr-val"); if (bOut) bOut.textContent = String((s.blackThr ?? 0.08).toFixed(2));
    }

    // --- Scene helpers ---
    function detectScene(){
      const g = window;
      return g.gltfScene || g.scene || (g.viewer && (g.viewer.scene || g.viewer.gltfScene)) || null;
    }

    function collectMaterialsFromScene(scene){
      const out = [];
      if (!scene || !scene.traverse) return out;
      scene.traverse(obj=>{
        try {
          if (obj && obj.isMesh){
            const meshName = obj.name || "Mesh";
            const pushOne = (m)=>{
              if (!m) return;
              const mName = m.name || "Material";
              const key = `${meshName}/${mName}`;
              const label = `${mName} — ${meshName}`;
              out.push({ key, label, mesh: obj, mat: m });
            };
            if (Array.isArray(obj.material)) obj.material.forEach(pushOne);
            else pushOne(obj.material);
          }
        } catch(e){}
      });
      // uniq by key
      const uniq = new Map(); out.forEach(o => { if (o.key) uniq.set(o.key, o); });
      return Array.from(uniq.values());
    }

    function populateTarget(){
      const sel = document.getElementById("mat-target");
      if (!sel) return;
      const scene = detectScene();
      const cands = collectMaterialsFromScene(scene);
      sel.innerHTML = "";
      const add = (val, text)=>{
        const opt = document.createElement("option"); opt.value = val; opt.textContent = text; sel.appendChild(opt);
      };
      add("GLOBAL", "GLOBAL — All Meshes / All Materials");
      cands.forEach(c => add(c.key, c.label));
      if (!sel.value) sel.value = "GLOBAL";
      sel.dispatchEvent(new Event("change"));
    }

    // --- Texture alpha creation (white/black -> alpha) ---
    function ensureTHREE(){ return window.THREE || window.three || null; }
    function makeAlphaMapFromColorMap(map, mode /* 'white'|'black' */, thr /*0..1*/){
      const THREE = ensureTHREE(); if (!THREE || !map || !map.image) return null;
      if (alphaMapCache.has(map)) return alphaMapCache.get(map);

      try {
        const img = map.image;
        const w = img.width || 1024, h = img.height || 1024;
        const cnv = document.createElement("canvas"); cnv.width = w; cnv.height = h;
        const ctx = cnv.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const im = ctx.getImageData(0, 0, w, h);
        const d = im.data;
        const t = Math.max(0, Math.min(255, Math.floor(thr * 255)));
        for (let i=0;i<d.length;i+=4){
          const r=d[i], g=d[i+1], b=d[i+2];
          const lum = (r+g+b)/3;
          const alpha = (mode === "white") ? (255 - (lum>=t?255:0)) : (lum<=t?255:0);
          d[i+3] = alpha;
        }
        ctx.putImageData(im, 0, 0);
        const tex = new THREE.Texture(cnv); tex.needsUpdate = true;
        alphaMapCache.set(map, tex);
        return tex;
      } catch(e){ return null; }
    }

    // --- Apply to scene ---
    function findMeshAndMaterialByKey(scene, key){
      const [meshName, matName] = String(key).split("/", 2);
      let target = [];
      scene.traverse(obj => {
        if (obj && obj.isMesh && (obj.name || "Mesh") === meshName){
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => { if ((m?.name || "Material") === matName) target.push({mesh: obj, mat: m}); });
        }
      });
      return target;
    }

    function applySettingsToMaterial(mat, s){
      const THREE = ensureTHREE(); if (!mat || !THREE) return;

      // double-sided
      mat.side = s.doubleSided ? THREE.DoubleSide : THREE.FrontSide;

      // opacity
      const opa = Math.max(0, Math.min(1, Number(s.opacity ?? 1)));
      mat.transparent = opa < 1 || s.white2alpha || s.black2alpha;
      mat.opacity = opa;

      // white/black -> alpha
      if ((s.white2alpha || s.black2alpha) && mat.map){
        const mode = s.white2alpha ? "white" : "black";
        const thr  = s.white2alpha ? (s.whiteThr ?? 0.92) : (s.blackThr ?? 0.08);
        const alphaTex = makeAlphaMapFromColorMap(mat.map, mode, thr);
        if (alphaTex){
          mat.alphaMap = alphaTex;
          mat.alphaTest = 0.001;
        } else {
          // fallback by alphaTest threshold only
          mat.alphaMap = null;
          mat.alphaTest = mode === "white" ? (1 - thr) : thr;
        }
      } else {
        mat.alphaMap = null;
        mat.alphaTest = 0;
      }

      // unlit
      if (s.unlit) {
        if (!mat.__lm_origType) {
          mat.__lm_origType = mat.type;
          mat.__lm_origData = { color: mat.color?.clone?.(), map: mat.map, envMap: mat.envMap };
        }
        if (THREE.MeshBasicMaterial && !(mat instanceof THREE.MeshBasicMaterial)) {
          // swap material type while keeping map/color
          const params = { map: mat.map, color: mat.color ? mat.color.getHex() : 0xffffff };
          const basic = new THREE.MeshBasicMaterial(params);
          basic.name = mat.name;
          basic.side = mat.side;
          basic.transparent = mat.transparent;
          basic.opacity = mat.opacity;
          basic.alphaMap = mat.alphaMap;
          basic.alphaTest = mat.alphaTest;
          // Replace on mesh (caller will set .needsUpdate)
          return basic;
        }
      } else if (mat.__lm_origType && THREE[mat.__lm_origType]) {
        // restore original class when leaving unlit
        try {
          const origKlass = THREE[mat.__lm_origType];
          const m = new origKlass();
          m.name = mat.name;
          if (mat.__lm_origData?.color) m.color = mat.__lm_origData.color.clone();
          m.map = mat.__lm_origData?.map ?? mat.map;
          m.envMap = mat.__lm_origData?.envMap ?? mat.envMap;
          m.side = mat.side;
          m.transparent = mat.transparent;
          m.opacity = mat.opacity;
          m.alphaMap = mat.alphaMap;
          m.alphaTest = mat.alphaTest;
          delete mat.__lm_origType; delete mat.__lm_origData;
          return m;
        } catch(e){}
      }
      // no swap
      return null;
    }

    function applyToScene(materialKey, s){
      const scene = detectScene(); if (!scene) return;
      const THREE = ensureTHREE(); if (!THREE) return;

      if (materialKey === "GLOBAL"){
        scene.traverse(obj => {
          if (obj && obj.isMesh) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            let changed = false;
            const next = mats.map(m => {
              const swapped = applySettingsToMaterial(m, s);
              if (swapped) { changed = true; return swapped; }
              return m;
            });
            if (changed) {
              obj.material = Array.isArray(obj.material) ? next : next[0];
            }
            next.forEach(m => { if (m) m.needsUpdate = true; });
          }
        });
      } else {
        const targets = findMeshAndMaterialByKey(scene, materialKey);
        targets.forEach(({mesh, mat}) => {
          const swapped = applySettingsToMaterial(mat, s);
          if (swapped) {
            if (Array.isArray(mesh.material)){
              const idx = mesh.material.indexOf(mat);
              if (idx >= 0) mesh.material[idx] = swapped;
            } else {
              mesh.material = swapped;
            }
          }
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => { if (m) m.needsUpdate = true; });
        });
      }
      // custom hook (optional)
      try {
        if (typeof window.materialsApplyHook === "function") {
          window.materialsApplyHook({materialKey, settings: s, sheetId: getActiveSheetId()});
        }
      } catch(e){}
    }

    // --- UI wiring ---
    function onUIChanged(){
      const s = readUI(); if (!s.materialKey) return;
      const merged = { ...DEFAULTS, ...s };
      const sheetId = getActiveSheetId();
      applyToScene(s.materialKey, merged);
      scheduleSave(sheetId, s.materialKey, merged);
    }
    function wireUI(){
      const ids = ["mat-target","mat-unlit","mat-doubleside","mat-opacity","mat-white2alpha","mat-white-thr","mat-black2alpha","mat-black-thr"];
      ids.forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        const ev = (el.tagName === "SELECT") ? "change" : "input";
        el.addEventListener(ev, onUIChanged);
      });
      const r1 = document.getElementById("mat-reset-one");
      const r2 = document.getElementById("mat-reset-all");
      if (r1) r1.addEventListener("click", ()=>{ writeUI(DEFAULTS); onUIChanged(); });
      if (r2) r2.addEventListener("click", ()=>{ writeUI(DEFAULTS); onUIChanged(); });
    }

    // --- boot ---
    async function bootOnce(){
      if (bootOnce._done) return; bootOnce._done = true;
      log("[materials] bootOnce");

      // wait spreadsheet id a bit
      let tries = 0;
      while((!window.currentSpreadsheetId || !getActiveSheetId()) && tries < 60){
        await new Promise(r => setTimeout(r, 250)); tries++;
      }
      debug("[materials] ids", { spreadsheet: window.currentSpreadsheetId, sheetId: getActiveSheetId(), waited: tries });

      await ensureMaterialsIndex();

      // populate target after scene ready
      let sTries = 0;
      while (!detectScene() && sTries < 60){
        await new Promise(r => setTimeout(r, 250)); sTries++;
      }
      populateTarget();
      wireUI();

      // initial apply
      const target = document.getElementById("mat-target");
      const mk = target?.value || "GLOBAL";
      const s = materialsCache.get(keyOf(getActiveSheetId(), mk)) || DEFAULTS;
      writeUI(s);
      applyToScene(mk, s);
    }

    // public refresh
    window.addEventListener("materials:refresh", ()=> bootOnce());

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootOnce, { once: true });
    } else {
      setTimeout(bootOnce, 0);
    }

    // banner
    log("[materials] overlay applied LM-PATCH-STABLE-2");
  })();

})();