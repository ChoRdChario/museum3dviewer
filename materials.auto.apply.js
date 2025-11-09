// materials.auto.apply.js
// [auto-apply v1.0] Apply material settings automatically per caption sheet (sheetGid).

(function(){
  const log = (...a)=>console.log("[auto-apply v1.0]", ...a);
  const warn = (...a)=>console.warn("[auto-apply v1.0]", ...a);

  function waitSheetCtx(timeoutMs=15000){
    return new Promise((resolve, reject)=>{
      if (window.__LM_SHEET_CTX?.spreadsheetId != null) return resolve(window.__LM_SHEET_CTX);
      const timer = setTimeout(()=>{
        reject(new Error("sheet ctx timeout"));
      }, timeoutMs);
      const on = (e)=>{
        const d = (e && e.detail) || {};
        if (d && d.spreadsheetId != null) {
          clearTimeout(timer);
          window.removeEventListener("lm:sheet-context", on, true);
          resolve(d);
        }
      };
      window.addEventListener("lm:sheet-context", on, true);
    });
  }

  function waitSceneStable(fallbackMs=1500){
    return new Promise((resolve)=>{
      if (window.__LM_SCENE || window.scene) return resolve();
      const on = ()=>{ window.removeEventListener("lm:scene-stable", on, true); resolve(); };
      window.addEventListener("lm:scene-stable", on, true);
      setTimeout(resolve, fallbackMs);
    });
  }

  async function fetchJSONAuth(url, init){
    if (typeof window.__lm_fetchJSONAuth !== "function") {
      throw new Error("__lm_fetchJSONAuth missing");
    }
    return window.__lm_fetchJSONAuth(url, init || {});
  }

  async function readMaterialsFor(ctx){
    const sheetId = ctx.spreadsheetId;
    const range = encodeURIComponent("__LM_MATERIALS!A1:N");
    const data = await fetchJSONAuth("https://sheets.googleapis.com/v4/spreadsheets/"+sheetId+"/values/"+range);
    const rows = (data && data.values) || [];
    if (!rows.length) return new Map();
    const hdr = rows[0];
    const ix = (name)=>hdr.indexOf(name);
    const iKey = ix("materialKey");
    const iGid = ix("sheetGid");
    const iOpacity = ix("opacity");
    const iDouble  = ix("doubleSided");
    const iUnlit   = ix("unlitLike");

    const wantGid = String(ctx.sheetGid || "");
    const map = new Map();
    const defs = new Map();

    for (let r=1;r<rows.length;r++){
      const v = rows[r] || [];
      const key = (v[iKey]||"").trim();
      if (!key) continue;
      const gid = iGid>=0 ? String(v[iGid]||"") : "";
      const rec = {
        opacity: (iOpacity>=0 && v[iOpacity]!==undefined) ? parseFloat(v[iOpacity]) : undefined,
        doubleSided: (iDouble>=0 ? String(v[iDouble]).toUpperCase()==="TRUE" : undefined),
        unlitLike:   (iUnlit>=0  ? String(v[iUnlit]).toUpperCase()==="TRUE"  : undefined),
      };
      if (gid && gid===wantGid) map.set(key, rec);
      else if (!gid) defs.set(key, rec);
    }
    defs.forEach((rec,key)=>{ if(!map.has(key)) map.set(key, rec); });
    return map;
  }

  let AUTOP = false;
  function applySettingsMap(settings){
    AUTOP = true;
    try {
      const root = window.__LM_SCENE || window.scene;
      if (!root) return;
      root.traverse(o=>{
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material)?o.material:[o.material];
        mats.forEach(m=>{
          if (!m) return;
          const rec = settings.get(m.name) || settings.get(o.name);
          if (!rec) return;
          if (typeof rec.opacity === "number" && !Number.isNaN(rec.opacity)){
            m.opacity = rec.opacity;
            m.transparent = rec.opacity < 0.999;
          }
          if (typeof rec.doubleSided === "boolean"){
            m.side = rec.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
          }
          if (typeof rec.unlitLike === "boolean"){
            m.emissive = m.emissive || new THREE.Color(0x000000);
            m.emissiveIntensity = rec.unlitLike ? 1.0 : (m.emissiveIntensity || 0.0);
          }
          m.needsUpdate = true;
        });
      });
    } finally {
      setTimeout(()=>{ AUTOP = false; }, 200);
    }
  }

  window.__LM_MAT_PERSIST_GUARD__ = ()=>AUTOP;

  (async ()=>{
    try {
      const ctx = await waitSheetCtx().catch(()=>null);
      await waitSceneStable();
      if (!ctx || !ctx.spreadsheetId) {
        warn("no sheet ctx, skip auto-apply");
        return;
      }
      const map = await readMaterialsFor(ctx);
      applySettingsMap(map);
      log("applied for sheetGid=", ctx.sheetGid, " records=", map.size);
    } catch (e) {
      warn("failed", e);
    }
  })();
})();