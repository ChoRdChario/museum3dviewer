(function(){
  const log = (...a)=>console.log('[lm-orch]', ...a);
  let wired = false, filled = false;

  function $(id){return document.getElementById(id)}
  const sel = $('pm-material'), rng = $('pm-opacity-range'), out = $('pm-opacity-val');

  function namesFromScene(){
    const s = window.__LM_SCENE, set = new Set();
    s?.traverse(o=>{
      if(!o.isMesh||!o.material) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.name&&set.add(m.name));
    });
    return [...set].filter(n=>!/^#\d+$/.test(n));
  }

  function fillOnce(){
    if(filled) return;
    const names = namesFromScene();
    if(!names.length) return;
    sel.innerHTML = '<option value="">— Select material —</option>';
    names.forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; sel.appendChild(o); });
    filled = true;
    log('filled', names.length, names);
  }

  function getOpacityByName(name){
    let val = null;
    window.__LM_SCENE?.traverse(o=>{
      if(val!==null) return;
      if(!o.isMesh||!o.material) return;
      (Array.isArray(o.material)?o.material:[o.material]).some(m=>{
        if((m?.name||'')===name){ val = Number(m.opacity ?? 1); return true; }
        return false;
      });
    });
    return (val==null?1:Math.max(0,Math.min(1,val)));
  }

  function setOpacityByName(name, v){
    v = Math.max(0,Math.min(1,Number(v)));
    let count=0;
    const mapi = window.LM_viewer?.applyMaterialPropsByName;
    if(typeof mapi==='function'){
      count = mapi(name,{opacity:v});
    }else{
      const s = window.__LM_SCENE;
      s?.traverse(o=>{
        if(!o.isMesh||!o.material) return;
        (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
          if((m?.name||'')===name){
            m.transparent = v < 1;
            m.opacity = v;
            m.depthWrite = v >= 1;
            m.needsUpdate = true;
            count++;
          }
        });
      });
    }
    return count;
  }

  function wire(){
    if(wired) return; wired = true;
    // tab buttons
    document.querySelectorAll('.tabs [role="tab"]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tabs [role="tab"]').forEach(b=>b.setAttribute('aria-selected', b===btn ? 'true':'false'));
        document.querySelectorAll('.pane').forEach(p=>p.dataset.active = (p.dataset.tab===tab?'true':'false'));
      });
    });

    // range → apply
    rng.addEventListener('input', ()=>{
      const n = sel.value; if(!n) return;
      const v = Number(rng.value||1);
      out.textContent = v.toFixed(2);
      setOpacityByName(n,v);
    }, {passive:true});

    // select change → sync current
    sel.addEventListener('change', ()=>{
      const n = sel.value;
      const v = n ? getOpacityByName(n) : 1;
      rng.value = v;
      out.textContent = v.toFixed(2);
    });

    // chroma fields just update labels for now (effect wiring will come in step2 impl)
    const tol=$('pm-chroma-tol'), tolv=$('pm-chroma-tol-val');
    const fea=$('pm-chroma-feather'), feav=$('pm-chroma-feather-val');
    tol?.addEventListener('input', ()=> tolv.textContent = Number(tol.value||0).toFixed(2));
    fea?.addEventListener('input', ()=> feav.textContent = Number(fea.value||0).toFixed(2));
  }

  // model/scene lifecycle from bridge/viewer
  document.addEventListener('lm:scene-ready', ()=>{ wire(); fillOnce(); }, {once:false});
  document.addEventListener('lm:model-ready', ()=>{ fillOnce(); }, {once:false});

  // Fallback: poll a short time just in case events were missed
  let tries=0; const iv=setInterval(()=>{
    tries++; fillOnce();
    if(filled || tries>40) clearInterval(iv);
  },200);

  log('loaded');
})();