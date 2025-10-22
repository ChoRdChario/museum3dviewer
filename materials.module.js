
/* materials.module.js — ensure headers + append + light render bridge */
(function(){
  const SHEET_TITLE="materials";
  const HEADER_RANGE="'materials'!A1:K1";
  const APPEND_RANGE="'materials'!A2:K9999";
  const HEADERS=["sheetId","materialKey","unlit","doubleSided","opacity","white2alpha","whiteThr","black2alpha","blackThr","updatedAt","updatedBy"];
  let spreadsheetId=null, currentSheetId=0, saveGuard=0;
  const nowISO=()=>new Date().toISOString();
  const authHeader=()=>{ const tok=(window.LM_GAuth&&LM_GAuth.getAccessToken)?LM_GAuth.getAccessToken():""; if(!tok) throw new Error("No access token"); return {"Authorization":"Bearer "+tok}; };
  async function fetchJSON(url, init){ const res=await fetch(url,init); if(!res.ok){ const body=await res.text().catch(()=>"(no body)"); console.error("[materials] fetch fail", res.status, url, body); throw new Error("HTTP "+res.status);} return await res.json(); }

  async function ensureHeader(){
    console.log("[materials] ensure start");
    const v1="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values/"+encodeURIComponent(HEADER_RANGE);
    try{ const j=await fetchJSON(v1,{headers:authHeader()}); if(j && Array.isArray(j.values) && j.values[0]){ console.log("[materials] ensure ok (header exists)"); return; } }catch(_){}
    const v2="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+":batchUpdate";
    try{ await fetchJSON(v2,{method:"POST",headers:{"Content-Type":"application/json",...authHeader()},body:JSON.stringify({requests:[{addSheet:{properties:{title:SHEET_TITLE}}}]})}); }catch(_){}
    const v3="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values/"+encodeURIComponent(HEADER_RANGE)+"?valueInputOption=RAW";
    await fetchJSON(v3,{method:"PUT",headers:{"Content-Type":"application/json",...authHeader()},body:JSON.stringify({values:[HEADERS]})});
    console.log("[materials] ensure ok (header written)");
  }

  function debounceSave(fn){ return function(...args){ clearTimeout(saveGuard); const d=480+Math.floor(Math.random()*120); saveGuard=setTimeout(()=>fn.apply(this,args), d); } }

  async function appendRow(rec, attempt=0){
    const url="https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(spreadsheetId)+"/values:append?range="+encodeURIComponent(APPEND_RANGE)+"&valueInputOption=RAW&insertDataOption=INSERT_ROWS";
    const row=[ currentSheetId, rec.materialKey||"GLOBAL", rec.unlit?1:0, rec.doubleSided?1:0, Math.max(0,Math.min(1,rec.opacity??1)), rec.white2alpha?1:0, Number.isFinite(rec.whiteThr)?rec.whiteThr:"", rec.black2alpha?1:0, Number.isFinite(rec.blackThr)?rec.blackThr:"", nowISO(), rec.updatedBy||"unknown" ];
    try{
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...authHeader()},body:JSON.stringify({values:[row]})});
      if(!res.ok){ const t=await res.text().catch(()=>"(no body)"); console.warn("[materials] append url="+url+" status="+res.status, t);
        if((res.status===429||res.status>=500)&&attempt<4){ const wait=400*Math.pow(2,attempt); await new Promise(r=>setTimeout(r,wait)); return appendRow(rec, attempt+1); }
        throw new Error("append failed "+res.status);
      }
      console.log("[materials] append ok");
    }catch(e){ throw e; }
  }

  function applyToMaterial(mat, rec){
    if (!mat) return;
    try{
      if (rec.unlit!=null){ mat.lights=!rec.unlit; mat.needsUpdate=true; }
      if (rec.doubleSided!=null && typeof THREE!=="undefined" && THREE.DoubleSide){ mat.side=rec.doubleSided?THREE.DoubleSide:THREE.FrontSide; mat.needsUpdate=true; }
      if (rec.opacity!=null){ mat.transparent=rec.opacity<1; mat.opacity=rec.opacity; mat.needsUpdate=true; }
      if (rec.white2alpha||rec.black2alpha){ mat.alphaTest=Math.max(mat.alphaTest||0,(rec.white2alpha?(rec.whiteThr||0):0),(rec.black2alpha?(rec.blackThr||0):0)); mat.needsUpdate=true; }
    }catch(e){ console.warn("[materials] render bridge error", e); }
  }
  function applyToScene(scene, rec){
    if (!scene||!scene.traverse||!rec||!rec.materialKey) return;
    if (rec.materialKey==="GLOBAL"){ scene.traverse(o=>{ if(o&&o.isMesh&&o.material) applyToMaterial(o.material, rec); }); return; }
    const key=String(rec.materialKey);
    scene.traverse(o=>{ if(o&&o.isMesh&&o.material){ const name=(o.material&&o.material.name)?o.material.name:(o.name||""); if(name && key.includes(name)) applyToMaterial(o.material, rec); } });
  }

  function setCaptionSheetGid(gid){ currentSheetId=Number(gid)||0; }
  const debouncedAppend=debounceSave(appendRow);
  function save(rec){ if (!spreadsheetId){ console.warn("[materials] no spreadsheetId yet; ignoring save"); return; } debouncedAppend(rec); }

  function init(){
    window.addEventListener("materials:spreadsheetId", async (ev)=>{
      if (!ev||!ev.detail||!ev.detail.id) return;
      spreadsheetId=ev.detail.id;
      console.log("[materials] ensure start");
      try{ await LM_GAuth.ensureToken(); await ensureHeader(); }catch(e){ console.error("[materials] ensure fail", e); }
    }, {once:false});
  }
  window.LM_Materials = { init, save, applyToScene, setCaptionSheetGid };
})();
