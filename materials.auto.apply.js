// [auto-apply v1.2] Apply material settings automatically per caption sheet (sheetGid)
// Depends on: __LM_SHEET_CTX, LM_MaterialsPersist (for ensureHeaders only), __lm_fetchJSONAuth, THREE, scene

(function(){
  if (window.__LM_AUTO_APPLY__ && window.__LM_AUTO_APPLY__.__ver && window.__LM_AUTO_APPLY__.__ver.startsWith("1.2")) {
    console.log("[auto-apply v1.2] already loaded");
    return;
  }

  async function until(pred, ms=15000, step=100){
    const t0 = performance.now();
    return new Promise((res, rej)=>{
      const id = setInterval(()=>{
        try {
          if (pred()){ clearInterval(id); res(true); }
          else if (performance.now()-t0 > ms){ clearInterval(id); rej(new Error("timeout")); }
        } catch(e){ clearInterval(id); rej(e); }
      }, step);
    });
  }

  async function fetchTable(spreadsheetId){
    const range = encodeURIComponent("__LM_MATERIALS!A:N");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    const got = await __lm_fetchJSONAuth(url);
    return got.values || [];
  }

  function rowToObj(row){
    // A..N -> object
    return {
      materialKey: row[0] || "",
      opacity: row[1]!==undefined ? parseFloat(row[1]) : 1,
      doubleSided: (row[2]||"").toString().toUpperCase()==="TRUE",
      unlitLike:   (row[3]||"").toString().toUpperCase()==="TRUE",
      chromaEnable:(row[4]||"").toString().toUpperCase()==="TRUE",
      chromaColor: row[5] || "#000000",
      chromaTolerance: parseFloat(row[6]||"0"),
      chromaFeather:   parseFloat(row[7]||"0"),
      roughness: row[8] || "",
      metalness: row[9] || "",
      emissiveHex: row[10] || "",
      sheetGid: row[13] || ""
    };
  }

  function buildMap(rows, sheetGid){
    const exact = new Map();
    const fallback = new Map();
    for (let i=1; i<rows.length; i++){
      const o = rowToObj(rows[i]);
      if (!o.materialKey) continue;
      if (String(o.sheetGid) === String(sheetGid)) {
        exact.set(o.materialKey, o);
      } else if (o.sheetGid === "" && !fallback.has(o.materialKey)) {
        fallback.set(o.materialKey, o);
      }
    }
    // prefer exact, else fallback
    const m = new Map(fallback);
    for (const [k,v] of exact) m.set(k,v);
    return m;
  }

  function applyToScene(map){
    const root = window.__LM_SCENE || window.scene;
    const THREE_ = window.THREE;
    if (!root || !THREE_) throw new Error("scene/THREE not ready");

    let hit = 0;
    root.traverse((o)=>{
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m)=>{
        if (!m) return;
        const key = m.name || o.name;
        const conf = map.get(key);
        if (!conf) return;

        // apply core params
        m.opacity = (conf.opacity!=null ? conf.opacity : 1);
        m.transparent = m.opacity < 0.999; // chroma未対応フェーズ
        m.side = conf.doubleSided ? THREE_.DoubleSide : THREE_.FrontSide;

        if (conf.unlitLike){
          m.lightMap = null; m.envMap = null;
          m.emissive = new THREE_.Color(0xffffff);
          m.emissiveIntensity = 1.0;
        } else {
          if (!m.emissive) m.emissive = new THREE_.Color(0x000000);
          m.emissiveIntensity = m.emissiveIntensity || 0;
        }
        m.needsUpdate = true;
        hit++;
      });
    });
    console.log("[auto-apply v1.2] applied to", hit, "materials");
  }

  async function runOnce(){
    await until(()=> typeof __lm_fetchJSONAuth === "function");
    await until(()=> !!window.__LM_SHEET_CTX);
    await until(()=> !!(window.__LM_SCENE || window.scene));
    await until(()=> !!window.THREE);

    const ctx = window.__LM_SHEET_CTX;
    const ssid = ctx.spreadsheetId;
    const gid  = ctx.sheetGid ?? 0;

    try { await window.LM_MaterialsPersist?.ensureHeaders?.(); } catch(_){}

    const rows = await fetchTable(ssid);
    const map  = buildMap(rows, gid);
    applyToScene(map);
  }

  // public export (optional)
  async function __APPLY__(){
    return runOnce();
  }
  __APPLY__.__ver = "1.2";
  window.__LM_AUTO_APPLY__ = __APPLY__;

  // fire on sheet-context
  window.addEventListener("lm:sheet-context", ()=>{
    runOnce().catch(e=>console.warn("[auto-apply v1.2] failed", e));
  });

  console.log("[auto-apply v1.2] armed");
})();
