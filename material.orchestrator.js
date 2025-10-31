/* LociMyu material.orchestrator.js (permanent fix)
 * VERSION_TAG: V6_12p_PANEL_PM_BIND
 * - Prefer the in-panel select #pm-material
 * - Populate material names via viewerBridge.listMaterials()
 * - Bind the nearest opacity slider to the select (no duplicate handlers)
 * - Robust retries with MutationObserver + interval, low-noise logging
 */
(()=>{
  const TAG = 'mat-orch';
  const log  = (...a)=>console.log(`[${TAG}]`, ...a);
  const warn = (...a)=>console.warn(`[${TAG}]`, ...a);

  // --- helpers ---------------------------------------------------------------
  function listMaterials(){
    try{
      const b = window.viewerBridge;
      if (b && typeof b.listMaterials === 'function') {
        const arr = b.listMaterials() || [];
        if (Array.isArray(arr) && arr.length) return arr.slice();
      }
    }catch(e){/*ignore*/}
    return [];
  }

  function getScene(){
    const b = window.viewerBridge;
    if (b && typeof b.getScene === 'function') { try { return b.getScene(); } catch(e){} }
    return window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }

  function applyOpacityByName(name, alpha){
    const scene = getScene();
    if (!scene || !name) return false;
    let hit = 0;
    scene.traverse(o=>{
      const m = o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm && mm.name === name){
          mm.transparent = alpha < 1 ? true : mm.transparent;
          mm.opacity = alpha;
          mm.needsUpdate = true;
          hit++;
        }
      });
    });
    if (hit) log(`opacity ${alpha.toFixed(2)} → "${name}" x${hit}`);
    return !!hit;
  }

  // Prefer the real panel select first
  function getPanelSelect(){
    const panel = document.querySelector('[data-lm="right-panel"]') || document;
    return (
      document.getElementById('pm-material') ||
      panel.querySelector('[data-lm="material-select"]') ||
      panel.querySelector('select[name="material"]') ||
      panel.querySelector('select') ||
      null
    );
  }

  function nearestSlider(from){
    if (!from) return null;
    let p = from.closest('section,fieldset,div') || from.parentElement;
    while (p){
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    const panel = document.querySelector('[data-lm="right-panel"]') || document;
    return panel.querySelector('input[type="range"]');
  }

  function populateSelect(sel, names){
    if (!sel) return false;
    const prev = sel.value;
    sel.innerHTML = '';
    const add = (v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('', '-- Select --');
    names.forEach(n=>add(n,n));
    // keep previous selection if still exists
    sel.value = names.includes(prev) ? prev : '';
    sel.title = sel.value || '-- Select --';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  }

  function bindSliderAndSelect(sel){
    if (!sel) return false;
    const sld = nearestSlider(sel);
    if (!sld){ warn('opacity slider not found (bind skipped)'); return false; }

    // avoid duplicate handlers by cloning
    const sel2 = sel.cloneNode(true);  sel2.id  = sel.id;
    sel.parentNode.replaceChild(sel2, sel);
    const sld2 = sld.cloneNode(true); sld2.id = sld.id;
    sld.parentNode.replaceChild(sld2, sld);

    const onChange = () => {
      const name = sel2.value; if (!name) return;
      let a = parseFloat(sld2.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(sld2.value)||100)/100));
      applyOpacityByName(name, a);
    };

    sel2.addEventListener('change', onChange);
    sld2.addEventListener('input', onChange, {passive:true});
    log('wired select+slider');
    return true;
  }

  // --- main loop (retry until both UI and materials are ready) ---------------
  let tries = 0;
  const MAX_TRIES = 120; // ~12s
  function tick(){
    const sel   = getPanelSelect();
    const mats  = listMaterials();

    if (sel && mats.length){
      populateSelect(sel, mats);
      bindSliderAndSelect(sel);
      stop();
      return;
    }
    tries++;
    if (tries === 1) log('loaded VERSION_TAG: V6_12p_PANEL_PM_BIND');
    if (tries % 20 === 0) log('waiting...', {hasSelect: !!sel, materials: mats.length});
    if (tries >= MAX_TRIES){
      warn('gave up (no select or no materials)');
      stop();
    }
  }

  let iv = null, mo = null;
  function start(){
    if (iv) clearInterval(iv);
    iv = setInterval(tick, 100);
    if (mo) mo.disconnect();
    mo = new MutationObserver(()=>tick());
    mo.observe(document.body, {childList:true, subtree:true});
    // couple of likely signals
    document.addEventListener('lm:scene-ready', tick, {once:false});
    document.addEventListener('lm:sheet-context', tick, {once:false});
  }
  function stop(){
    if (iv){ clearInterval(iv); iv = null; }
    if (mo){ mo.disconnect(); mo = null; }
  }

  // kick
  start();
})();