// material.orchestrator.js v3.1
(function(){
  const TAG='[mat-orch v3.1]';
  const $ = s => document.querySelector(s);
  const ui = {
    select: $('#pm-material'),
    range:  $('#pm-opacity-range'),
    out:    $('#pm-opacity-val')
  };
  if(!ui.select || !ui.range || !ui.out){ console.warn(TAG,'ui missing'); return; }
  console.log(TAG,'ready');

  function getScene(){ return window.__LM_SCENE || null; }

  function updateUIFromMaterial(name){
    const scene = getScene();
    if(!scene || !name){ return; }
    let value = 1.0;
    scene.traverse(obj=>{
      const mats = obj.material ? (Array.isArray(obj.material)?obj.material:[obj.material]) : [];
      mats.forEach(m=>{
        if(m && m.name === name){ value = (typeof m.opacity==='number'?m.opacity:1.0); }
      });
    });
    ui.range.value = value;
    ui.out.textContent = Number(value).toFixed(2);
  }

  function applyOpacity(name, value){
    const scene = getScene();
    if(!scene || !name){ return; }
    scene.traverse(obj=>{
      const mats = obj.material ? (Array.isArray(obj.material)?obj.material:[obj.material]) : [];
      mats.forEach(m=>{
        if(m && m.name === name){
          m.opacity = value;
          m.transparent = true;      // keep transparent path stable
          m.depthWrite = value >= 0.999;
          m.needsUpdate = true;
        }
      });
    });
  }

  // event wiring
  window.addEventListener('lm:pm-material-selected', (e)=>{
    updateUIFromMaterial(e.detail?.name || '');
  });

  window.addEventListener('lm:pm-opacity-input', (e)=>{
    const {name, opacity} = e.detail || {};
    applyOpacity(name, opacity);
  });

  // when scene becomes ready, try to sync current selection
  const trySync = ()=>{ if(ui.select.value) updateUIFromMaterial(ui.select.value); };
  window.addEventListener('lm:scene-ready', trySync);
  window.addEventListener('lm:glb-detected', trySync);
})();
