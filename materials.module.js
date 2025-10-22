/* LociMyu v6.6 - materials.module.js (P0)
 * - Ensure 'materials' sheet header (A1:K1) via GET / batchUpdate / PUT
 * - Append rows via values:append with RAW + INSERT_ROWS
 * - Exponential backoff (400ms * 2^n, max 4)
 * - Debounce UI-driven saves (400–600ms responsibility rests with caller; here we provide a simple guard)
 * - Light bridge to reflect changes into materials (unlit / doubleSided / opacity / alphaTest as preview)
 */
(function(){
  const SHEET_TITLE = "materials";
  const HEADER_RANGE = "'materials'!A1:K1";
  const APPEND_RANGE = "'materials'!A2:K9999";
  const HEADERS = ["sheetId","materialKey","unlit","doubleSided","opacity","white2alpha","whiteThr","black2alpha","blackThr","updatedAt","updatedBy"];

  let spreadsheetId = null;
  let currentSheetId = 0; // gid of caption sheet in use (external owner should set)
  let saveGuard = 0;

  function nowISO(){ return new Date().toISOString(); }

  function authHeader(){
    const tok = (window.LM_GAuth && LM_GAuth.getAccessToken) ? LM_GAuth.getAccessToken() : "";
    if (!tok) throw new Error("No access token; call ensureToken first");
    return { "Authorization": "Bearer " + tok };
  }

  async function fetchJSON(url, init){
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.text().catch(()=>"(no body)");
      console.error("[materials] fetch fail", res.status, url, body);
      throw new Error("HTTP "+res.status);
    }
    return await res.json();
  }

  async function ensureHeader(){
    console.log("[materials] ensure start");
    // 1) GET header
    const v1 = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values/"+encodeURIComponent(HEADER_RANGE);
    try {
      const j = await fetchJSON(v1, {headers: authHeader()});
      if (j && Array.isArray(j.values) && j.values[0]) {
        console.log("[materials] ensure ok (header exists)");
        return;
      }
    } catch(e) {
      // fallthrough to create
    }
    // 2) addSheet (idempotent)
    const v2 = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+":batchUpdate";
    const body2 = {requests:[{addSheet:{properties:{title:SHEET_TITLE}}}]};
    try {
      await fetchJSON(v2, {
        method: "POST",
        headers: { "Content-Type":"application/json", ...authHeader() },
        body: JSON.stringify(body2)
      });
    } catch(e) {
      // If already exists, it's fine; continue to write header
    }
    // 3) PUT header
    const v3 = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values/"+encodeURIComponent(HEADER_RANGE)+"?valueInputOption=RAW";
    const body3 = { values: [ HEADERS ] };
    await fetchJSON(v3, {
      method: "PUT",
      headers: { "Content-Type":"application/json", ...authHeader() },
      body: JSON.stringify(body3)
    });
    console.log("[materials] ensure ok (header written)");
  }

  function debounceSave(fn){
    return function(...args){
      clearTimeout(saveGuard);
      const d = 480 + Math.floor(Math.random()*120); // 480–600ms
      saveGuard = setTimeout(()=>fn.apply(this,args), d);
    }
  }

  async function appendRow(rec, attempt=0){
    const url = "https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values:append"
      + "?range="+encodeURIComponent(APPEND_RANGE)
      + "&valueInputOption=RAW&insertDataOption=INSERT_ROWS";
    const row = [
      currentSheetId,
      rec.materialKey || "GLOBAL",
      rec.unlit ? 1:0,
      rec.doubleSided ? 1:0,
      Math.max(0, Math.min(1, rec.opacity ?? 1)),
      rec.white2alpha ? 1:0,
      Number.isFinite(rec.whiteThr)? rec.whiteThr : "",
      rec.black2alpha ? 1:0,
      Number.isFinite(rec.blackThr)? rec.blackThr : "",
      nowISO(),
      rec.updatedBy || "unknown"
    ];
    const body = { values: [ row ] };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type":"application/json", ...authHeader() },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const t = await res.text().catch(()=>"(no body)");
        console.warn("[materials] append url="+url+" status="+res.status, t);
        if ((res.status===429 || res.status>=500) && attempt<4){
          const wait = 400 * Math.pow(2, attempt);
          await new Promise(r=>setTimeout(r, wait));
          return appendRow(rec, attempt+1);
        }
        throw new Error("append failed "+res.status);
      }
      console.log("[materials] append ok");
    } catch(e){
      throw e;
    }
  }

  // --- Render bridge (very light) ---
  function applyToMaterial(mat, rec){
    if (!mat) return;
    try{
      if (rec.unlit != null) {
        // naive approximation: if unlit, prefer basic shading flags
        mat.lights = !rec.unlit;
        if (mat.type && /Standard|Physical|Phong/.test(mat.type)) {
          mat.needsUpdate = true;
        }
      }
      if (rec.doubleSided != null) {
        if (typeof THREE !== "undefined" && THREE && THREE.DoubleSide) {
          mat.side = rec.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
          mat.needsUpdate = true;
        }
      }
      if (rec.opacity != null) {
        mat.transparent = rec.opacity < 1;
        mat.opacity = rec.opacity;
        mat.needsUpdate = true;
      }
      // preview-only alpha: use alphaTest as a coarse visual cue (not production-accurate white/black2alpha)
      if (rec.white2alpha || rec.black2alpha) {
        mat.alphaTest = Math.max( mat.alphaTest || 0, (rec.white2alpha? (rec.whiteThr||0) : 0), (rec.black2alpha? (rec.blackThr||0):0) );
        mat.needsUpdate = true;
      }
    }catch(e){
      console.warn("[materials] render bridge error", e);
    }
  }

  // materialKey can be "GLOBAL" or "meshName/materialName"
  function applyToScene(scene, rec){
    if (!scene || !scene.traverse) return;
    if (!rec || !rec.materialKey) return;
    if (rec.materialKey === "GLOBAL") {
      scene.traverse(obj=>{
        if (obj && obj.isMesh && obj.material) applyToMaterial(obj.material, rec);
      });
      return;
    }
    // Else try matching by material name
    const targetKey = String(rec.materialKey);
    scene.traverse(obj=>{
      if (obj && obj.isMesh && obj.material) {
        const name = (obj.material && obj.material.name) ? obj.material.name : (obj.name || "");
        if (name && targetKey.includes(name)) applyToMaterial(obj.material, rec);
      }
    });
  }

  // --- Public API ---
  function setCaptionSheetGid(gid){
    currentSheetId = Number(gid)||0;
  }

  const debouncedAppend = debounceSave(appendRow);

  function save(rec){
    if (!spreadsheetId) {
      console.warn("[materials] no spreadsheetId yet; ignoring save");
      return;
    }
    debouncedAppend(rec);
  }

  function init(){
    window.addEventListener("materials:spreadsheetId", async (ev)=>{
      if (!ev || !ev.detail || !ev.detail.id) return;
      spreadsheetId = ev.detail.id;
      console.log("[materials] ensure start");
      try{
        await LM_GAuth.ensureToken();
        await ensureHeader();
      }catch(e){
        console.error("[materials] ensure fail", e);
      }
    }, {once:false});
  }

  window.LM_Materials = { init, save, applyToScene, setCaptionSheetGid };
})();
