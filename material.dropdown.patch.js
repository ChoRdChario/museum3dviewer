// material.dropdown.patch.js v3.1
(function(){
  const TAG='[mat-dd v3.1]';
  const $ = s => document.querySelector(s);
  const sel = $('#pm-material');
  if(!sel){ console.warn(TAG,'select not found'); return; }

  function unique(arr){ return [...new Set(arr)].filter(Boolean); }

  function populateFromScene(){
    const scene = window.__LM_SCENE;
    if(!scene){ return false; }
    const names = [];
    scene.traverse(obj=>{
      const mats = obj.material ? (Array.isArray(obj.material)?obj.material:[obj.material]) : [];
      mats.forEach(m=>{ if(m && m.name) names.push(m.name); });
    });
    const list = unique(names).sort((a,b)=>String(a).localeCompare(String(b)));
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select material —</option>' + list.map(n=>`<option value="${n}">${n}</option>`).join('');
    if(list.includes(cur)) sel.value = cur;
    console.log(TAG,'populated', list.length);
    return true;
  }

  // attempt immediately, then after GLB load signal
  if(!populateFromScene()){
    const onScene = ()=>{ populateFromScene(); window.removeEventListener('lm:scene-ready', onScene); };
    window.addEventListener('lm:scene-ready', onScene, {once:true});
  }

  // repopulate when our helper signal says GLB loaded
  window.addEventListener('lm:glb-detected', populateFromScene);
})();
