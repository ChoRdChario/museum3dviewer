
(() => {
  const LOG_PREFIX = '[per-mat]';

  const once = (fn) => { let done=false; return (...args)=>{ if(done) return; done=true; try{ return fn(...args);}catch(e){ console.warn(LOG_PREFIX,e);} }; };
  const onDOMReady = (cb) => { if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', cb, {once:true}); else queueMicrotask(cb); };

  function getGid(){
    const sheetSel = document.querySelector('select[name="sheet"], select[id*="sheet"]');
    const v = sheetSel?.value || '';
    const m = v.match(/gid=(\d+)/);
    return m ? m[1] : (v || '0');
  }
  const storeKey = gid => `LM:permat:opacity:${gid}`;
  const loadMap = () => { try { return JSON.parse(localStorage.getItem(storeKey(getGid())) || '{}'); } catch { return {}; } };
  const saveMap = (map) => { localStorage.setItem(storeKey(getGid()), JSON.stringify(map)); };

  const dispatchSceneReady = once((scene)=>{
    if (!scene || !scene.isScene) return;
    window.__LM_SCENE = scene;
    document.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene } }));
    console.log('[boot] lm:scene-ready dispatched');
  });

  function armRendererHook(){
    const THREE = window.THREE || window.viewer?.THREE || window.app?.THREE;
    const R = THREE?.WebGLRenderer;
    if (!R) return false;
    if (R.prototype.__lm_render_hooked) return true;
    const orig = R.prototype.render;
    R.prototype.render = function(scene, camera){
      if (scene?.isScene && !window.__LM_SCENE){
        dispatchSceneReady(scene);
        try { this.render = orig; } catch {}
        R.prototype.__lm_render_hooked = true;
      }
      return orig.apply(this, arguments);
    };
    console.log('[boot] renderer hook armed');
    return true;
  }

  function pickMaterialSelect(){
    return (
      document.querySelector('[data-lm="mat-per-select"]') ||
      document.getElementById('pm-material') ||
      document.querySelector('#panel-materials select') ||
      [...document.querySelectorAll('select')].find(s => /select material/i.test((s.getAttribute('aria-label')||'') + ' ' + (s.textContent||'')))
    ) || null;
  }
  function pickOpacitySlider(){
    return (
      document.querySelector('[data-lm="mat-per-slider"]') ||
      document.getElementById('pm-opacity') ||
      document.getElementById('mat-opacity') ||
      document.querySelector('#panel-materials input[type="range"]') ||
      [...document.querySelectorAll('input[type="range"]')].find(r => { const min=+r.min, max=+r.max; return min===0 && (max===1 || max===100 || max===1.0); })
    ) || null;
  }

  function buildMaterialIndex(scene){
    const dict = new Map();
    scene.traverse(o=>{
      if (!o?.isMesh) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ if(m && !dict.has(m.uuid)) dict.set(m.uuid, m); });
    });
    return dict;
  }
  function makeOptions(dict){
    return [...dict.values()].map(m=>{
      const label = (m.name||'').trim() || `${m.type||'Material'}_${m.uuid.slice(-6)}`;
      return { value:m.uuid, label, opacity:m.opacity ?? 1 };
    }).sort((a,b)=> a.label.localeCompare(b.label,'en'));
  }
  function populateSelect(selectEl, options){
    const CUR = selectEl.value;
    selectEl.innerHTML='';
    const ph = document.createElement('option'); ph.value=''; ph.textContent='— Select material —'; selectEl.appendChild(ph);
    options.forEach(o=>{ const op=document.createElement('option'); op.value=o.value; op.textContent=o.label; selectEl.appendChild(op); });
    if (CUR && options.some(o=>o.value===CUR)) selectEl.value = CUR;
  }
  function applySavedOpacity(dict){
    const map = loadMap();
    Object.entries(map).forEach(([uuid,val])=>{
      const m = dict.get(uuid); if(!m) return;
      m.transparent = true;
      m.opacity = +val;
      m.needsUpdate = true;
    });
  }

  function wire(selectEl, sliderEl, scene){
    const dict = buildMaterialIndex(scene);
    const opts = makeOptions(dict);
    populateSelect(selectEl, opts);
    applySavedOpacity(dict);

    selectEl.addEventListener('change', ()=>{
      const m = dict.get(selectEl.value);
      sliderEl.value = String(m ? (m.opacity ?? 1) : 1);
    });
    sliderEl.addEventListener('input', ()=>{
      const uuid = selectEl.value;
      const m = dict.get(uuid);
      if (!uuid || !m) return;
      const v = +sliderEl.value;
      m.transparent = true;
      m.opacity = v;
      m.needsUpdate = true;
      const map = loadMap(); map[uuid]=v; saveMap(map);
    });
    console.log(LOG_PREFIX, 'ready. materials:', opts.length);
  }

  function bootOnce(){
    const selectEl = pickMaterialSelect();
    const sliderEl = pickOpacitySlider();
    if (!selectEl || !sliderEl){
      console.warn(LOG_PREFIX, 'UI elements not found (select/slider).');
      return false;
    }
    selectEl.setAttribute('data-lm','mat-per-select');
    sliderEl.setAttribute('data-lm','mat-per-slider');
    return true;
  }

  onDOMReady(()=>{
    armRendererHook();

    document.addEventListener('lm:scene-ready', (ev)=>{
      const scene = ev?.detail?.scene || window.__LM_SCENE;
      const ok = bootOnce();
      if (!ok || !scene) return;
      const selectEl = pickMaterialSelect();
      const sliderEl = pickOpacitySlider();
      if (selectEl && sliderEl) wire(selectEl, sliderEl, scene);
    });

    if (window.__LM_SCENE?.isScene){
      dispatchSceneReady(window.__LM_SCENE);
    }

    let tries = 0;
    const timer = setInterval(()=>{
      tries++;
      const ok = bootOnce();
      if (ok && window.__LM_SCENE?.isScene){
        const selectEl = pickMaterialSelect();
        const sliderEl = pickOpacitySlider();
        if (selectEl && sliderEl){
          wire(selectEl, sliderEl, window.__LM_SCENE);
          clearInterval(timer);
        }
      }
      if (tries > 60) clearInterval(timer);
    }, 250);
  });
})();
