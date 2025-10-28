// material.ui.orch.js
const LOG_PREFIX='[lm-orch]'; const log=(...a)=>console.log(LOG_PREFIX,...a);
const viewerModPromise = import('./viewer.module.cdn.js').catch(()=> ({}));
let sceneReady=false, modelReady=false;

function namesFromScene(){
  const s=window.__LM_SCENE,set=new Set();
  s?.traverse(o=>{ if(!o.isMesh||!o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.name&&set.add(m.name));});
  return [...set].filter(n=>!/^#\d+$/.test(n));
}
async function namesFromViewer(){
  const mod=await viewerModPromise;
  try{ const arr=mod.listMaterials?.()||[]; return arr.map(r=>r?.name).filter(Boolean).filter(n=>!/^#\d+$/.test(n)); }
  catch{ return []; }
}
function getOpacityByName(name){
  let val=null;
  window.__LM_SCENE?.traverse(o=>{
    if(val!==null) return;
    if(!o.isMesh||!o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).some(m=>{
      if((m?.name||'')===name){ val=Number(m.opacity??1); return true; }
      return false;
    });
  });
  return (val==null?1:Math.max(0,Math.min(1,val)));
}
async function applyOpacityByName(name,v){
  const mod=await viewerModPromise;
  v=Math.max(0,Math.min(1,Number(v)));
  if(typeof mod.applyMaterialPropsByName==='function'){
    try{ mod.applyMaterialPropsByName(name,{opacity:v}); return; }catch{}
  }
  window.__LM_SCENE?.traverse(o=>{
    if(!o.isMesh||!o.material) return;
    (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
      if((m?.name||'')===name){ m.transparent=v<1; m.opacity=v; m.depthWrite=v>=1; m.needsUpdate=true; }
    });
  });
}
async function emitMaterialList(){
  if(!modelReady && !sceneReady) return;
  const vv=await namesFromViewer(); const ss=namesFromScene();
  const uniq=[...new Set([...(vv||[]),...(ss||[])])];
  document.dispatchEvent(new CustomEvent('pm:set-materials',{detail:{materials:uniq,values:{'*':1}}}));
}

(function wire(){
  log('loaded');
  document.addEventListener('lm:scene-ready',()=>{ sceneReady=true; log('scene-ready'); },{once:true});
  document.addEventListener('lm:model-ready',()=>{ modelReady=true; log('model-ready'); emitMaterialList(); });
  document.addEventListener('pm:request-materials',()=>{ emitMaterialList(); });
  document.addEventListener('pm:request-value',(e)=>{
    const name=e.detail?.material; if(!name) return;
    const v=getOpacityByName(name);
    document.dispatchEvent(new CustomEvent('pm:set-value',{detail:{material:name,opacity:v}}));
  });
  document.addEventListener('pm:opacity-change',(e)=>{
    const {material,opacity}=e.detail||{}; if(!material||typeof opacity!=='number') return;
    applyOpacityByName(material,opacity);
  });
})();