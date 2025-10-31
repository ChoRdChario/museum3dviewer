/* material.orchestrator.js */
(function(){
  const VERSION_TAG='V6_15b_LOAD_FIRST';
  const log=(...a)=>console.log('[mat-orch]',...a), warn=(...a)=>console.warn('[mat-orch]',...a);

  function getScene(){ try{ return window.viewerBridge?.getScene?.() || null; }catch(e){ return null; } }
  function listMaterials(){ try{ return window.viewerBridge?.listMaterials?.() || []; }catch(e){ return []; } }

  function applyOpacityByName(name,a){
    const sc=getScene(); if(!sc||!name) return 0;
    let hit=0;
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm?.name===name){
          mm.transparent = a<1 ? true : mm.transparent;
          mm.opacity=a; mm.needsUpdate=true; hit++;
        }
      });
    });
    if (hit) log(`opacity ${a.toFixed(2)} → "${name}" x${hit}`);
    return hit;
  }

  function nearestSlider(from){
    let p=from.closest('section,fieldset,div')||from.parentElement;
    while(p){ const r=p.querySelector('input[type="range"]'); if(r) return r; p=p.parentElement; }
    return document.querySelector('[data-lm="right-panel"] input[type="range"]') || document.querySelector('input[type="range"]');
  }
  function populateSelect(sel,names){
    sel.innerHTML=''; const add=(v,t)=>{const o=document.createElement('option');o.value=v;o.textContent=t;sel.appendChild(o);};
    add('','-- Select --'); names.forEach(n=>add(n,n)); sel.value='';
  }
  const latestByKey = (map)=>{ const m=new Map(); for(const v of map.values()){ if(v?.materialKey) m.set(v.materialKey,v);} return m; };

  async function wireOnce(){
    const sel = document.getElementById('pm-material');
    if(!sel){ warn('panel select not found'); return false; }
    const slider = nearestSlider(sel) || null;

    const mats = listMaterials();
    if(!mats.length){ warn('no materials yet'); return false; }

    populateSelect(sel, mats);

    // 初期ロード：保存はしない（上書き抑止）
    let bootApplying=true, cache=null;
    try{
      const all = await window.materialsSheetBridge.loadAll();
      cache = latestByKey(all);
      for(const name of mats){
        const hit = cache.get(name);
        if(hit && hit.opacity!=='' && hit.opacity!=null){
          const a = Math.max(0,Math.min(1,Number(hit.opacity)));
          applyOpacityByName(name,a);
        }
      }
    }catch(e){ warn('loadAll failed:', e); }
    finally{ bootApplying=false; }

    // 重複防止の clone 置換
    const sel2 = sel.cloneNode(true); sel2.id=sel.id; sel.parentNode.replaceChild(sel2, sel);
    let sld2 = slider;
    if(slider){ const c=slider.cloneNode(true); c.id=slider.id; slider.parentNode.replaceChild(c,slider); sld2=c; }

    const onInput = ()=>{
      const name=sel2.value; if(!name||!sld2) return;
      const a = Math.max(0,Math.min(1,Number(sld2.value||0)));
      applyOpacityByName(name,a);
    };
    const persist = async ()=>{
      if(bootApplying) return;
      const name=sel2.value; if(!name||!sld2) return;
      const a = Math.max(0,Math.min(1,Number(sld2.value||0)));
      try{
        await window.materialsSheetBridge.upsertOne({
          key: `${name}`,
          modelKey: '',
          materialKey: name,
          opacity: a,
          doubleSided: '',
          unlit: '',
          chromaEnable: '',
          chromaColor: '',
          chromaTolerance: '',
          chromaFeather: '',
          updatedBy: 'mat-orch'
        });
        log('persisted to sheet:', name);
      }catch(e){ warn('persist failed:', e); }
    };

    sel2.addEventListener('change', ()=>{
      if(!sld2) return;
      const hit = cache?.get(sel2.value);
      const a = hit && hit.opacity!=='' && hit.opacity!=null ? Number(hit.opacity) : 1;
      sld2.value = String(a);
      onInput();
    });
    sld2?.addEventListener('input', onInput, {passive:true});
    ['change','mouseup','pointerup','touchend'].forEach(ev=> sld2?.addEventListener(ev, persist, {passive:true}));

    log('wired panel');
    return true;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);
    if (wireOnce()) return;

    window.addEventListener('lm:scene-ready', ()=>{ log('scene-ready received, trying wireOnce...'); wireOnce(); }, {once:false});

    let tries=0; const iv=setInterval(()=>{
      if (wireOnce()) { clearInterval(iv); }
      else { tries++; if(tries%20===0) log('still trying...', tries); if(tries>100){ clearInterval(iv); warn('gave up'); } }
    },200);
  }

  document.readyState==='loading' ? document.addEventListener('DOMContentLoaded', start, {once:true}) : start();
})();