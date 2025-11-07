
// LociMyu material injector v10
// - Lazy: only reacts after pm:scene-deep-ready (GLB loaded)
// - Scoped: populates the *Material tab*'s "Per‑material opacity" card only
// - Name-based: uses GLB material names (filters out runtime/anonymous)
// - Persistence bridge: dispatches lm:material-opacity-changed(name, value)
// - UI detox: ensures GLB URL field is fully clickable (no overlays)

(() => {
  const TAG = '[lm-mat v10]';
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // -------- small UI detox for the GLB URL field (non-destructive) --------
  function detoxUrlField(){
    const right = document.querySelector('#right') || document.querySelector('aside,.right,.sidebar') || document.body;
    const url = document.querySelector('#glbUrl') ||
      (right && right.querySelector('input[type="text"], input:not([type])'));
    if (url){
      url.style.pointerEvents = 'auto';
      url.disabled = false;
      url.readOnly = false;
      // Expand clickable area: raise its wrapper slightly without covering others
      const wrap = url.closest('section,.card,.panel,.group,form,div');
      if (wrap && getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      // Ensure no rogue high-z element inside the right pane blocks clicks
      const r = url.getBoundingClientRect();
      const mid = {x:r.left + r.width*0.5, y:r.top + Math.min(16, r.height/2)};
      (document.elementsFromPoint(mid.x, mid.y) || []).forEach(el => {
        if (!right.contains(el)) return;
        const cs = getComputedStyle(el);
        const fixedLike = cs.position==='fixed' || cs.position==='absolute' || cs.position==='sticky';
        if (fixedLike && cs.pointerEvents!=='none' && parseInt(cs.zIndex||'0',10) >= 10 && el !== url) {
          el.style.pointerEvents = 'none';
          el.classList.add('lm-pe-none');
        }
      });
      log('url field ready');
    }
  }

  // -------- helpers to find correct Material tab card --------
  function findMaterialCard(){
    const right = document.querySelector('#right') || document.querySelector('aside,.right,.sidebar') || document.body;
    // Locate the tab list and the currently active "Material" tab panel
    const tabs = [...right.querySelectorAll('button, [role="tab"]')];
    const matTabBtn = tabs.find(b => /(material|マテリアル)/i.test(b.textContent||''));
    let matPanel = null;
    if (matTabBtn){
      // aria-controls pattern
      const pid = matTabBtn.getAttribute('aria-controls');
      if (pid) matPanel = document.getElementById(pid);
    }
    // Fallback: search visible containers whose header contains "Per‑material"
    const containers = [...right.querySelectorAll('section,.card,.panel,.group')]
      .filter(c => c.offsetParent !== null); // visible
    // Prefer within matPanel if available
    const inScope = (matPanel ? containers.filter(c => matPanel.contains(c)) : containers);
    const card = inScope.find(c => /per\s*-?material|saved per sheet|opacity/i.test(c.textContent||'')) || null;
    return { right, matPanel, card };
  }

  // -------- GLB material collection (name-based, filter out runtime/anonymous) --------
  const isGLBName = (n)=>{
    if (!n) return false;
    if (/^mesh.*material$/i.test(n)) return false;
    if (/^material(\.\d+)?$/i.test(n)) return false;
    if (n.startsWith('__') || n.startsWith('LM_')) return false;
    return true;
  };

  function collectByName(scene){
    const map = new Map(); // name -> material[]
    scene?.traverse?.(o=>{
      if (!o?.isMesh) return;
      (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{
        const name = (m?.name||'').trim();
        if (!isGLBName(name)) return;
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(m);
      });
    });
    return map;
  }

  function ensureControls(card){
    const sel = card?.querySelector('select') || document.getElementById('materialSelect');
    const rng = card?.querySelector('input[type="range"]') || document.getElementById('opacityRange');
    // value readout if exists
    const readout = card?.querySelector('#pm-opacity-value,.value,.readout') || null;
    return {sel, rng, readout};
  }

  function populateSelect(sel, nameMap){
    sel.innerHTML = '';
    const names = [...nameMap.keys()].sort((a,b)=>a.localeCompare(b,'ja'));
    if (!names.length){
      const opt = document.createElement('option');
      opt.value=''; opt.textContent='(no GLB materials)';
      sel.appendChild(opt);
      return 0;
    }
    for (const nm of names){
      const opt = document.createElement('option');
      opt.value = nm; opt.textContent = nm;
      sel.appendChild(opt);
    }
    return names.length;
  }

  function wire(scene, sel, rng, nameMap, readout){
    const apply = ()=>{
      const key = sel.value; if (!key) return;
      const v = parseFloat(rng.value);
      const mats = nameMap.get(key)||[];
      for (const m of mats){
        m.transparent = (v < 1.0) || m.transparent;
        m.opacity = v;
        if ('needsUpdate' in m) m.needsUpdate = true;
      }
      if (readout) readout.textContent = v.toFixed(2);
      window.dispatchEvent(new CustomEvent('lm:material-opacity-changed', {
        detail: { materialKey: key, value: v }
      }));
    };
    rng.addEventListener('input', apply, {passive:true});
    sel.addEventListener('change', ()=> rng.dispatchEvent(new Event('input')));
    // First apply
    rng.dispatchEvent(new Event('input'));
  }

  async function hydrateFromScene(scene){
    const { right, card } = findMaterialCard();
    if (!card){ warn('Material card not found (visible)'); return; }
    const { sel, rng, readout } = ensureControls(card);
    if (!sel || !rng){ warn('controls missing'); return; }

    // Make sure viewer is actually ready with meshes
    let hasMesh = false; try{ scene?.traverse?.(o=>{ if(o?.isMesh) hasMesh = true; }); }catch(_){}
    if (!hasMesh){ warn('scene has no meshes yet'); return; }

    const nameMap = collectByName(scene);
    const n = populateSelect(sel, nameMap);
    if (!n){ warn('no GLB materials'); return; }

    wire(scene, sel, rng, nameMap, readout);
    log('materials populated', n);
  }

  // -------- boot: lazy wiring --------
  let lastScene = null;
  window.addEventListener('pm:scene-deep-ready', (e)=>{
    lastScene = e?.detail?.scene || lastScene || null;
    // defer to allow viewer UI to settle
    setTimeout(()=>hydrateFromScene(lastScene), 0);
  });

  // Fallback poll if event not emitted
  const poll = setInterval(()=>{
    const s = (typeof getScene==='function' && getScene()) || window.__lm_scene || null;
    if (!s) return;
    let has = false; try{s.traverse(o=>{ if(o?.isMesh) has = true; });}catch(_){}
    if (has){
      clearInterval(poll);
      lastScene = s;
      window.dispatchEvent(new CustomEvent('pm:scene-deep-ready', {detail:{scene:s, auto:true}}));
    }
  }, 700);

  // Tidy up rogue duplicated "Material" UIs: hide anything outside the tab body
  function hideRogueMaterialBlocks(){
    const { right, matPanel } = findMaterialCard();
    const blocks = [...right.querySelectorAll('section,.card,.panel,.group')]
      .filter(b => /(material|opacity)/i.test(b.textContent||''))
      .filter(b => !(matPanel && matPanel.contains(b))); // outside main panel
    blocks.forEach(b => { b.style.display = 'none'; b.classList.add('lm-rogue-hidden'); });
    if (blocks.length) log('hid rogue material blocks:', blocks.length);
  }

  // first pass
  detoxUrlField();
  hideRogueMaterialBlocks();
  // and re-run when tabs change
  document.addEventListener('click', (e)=>{
    const t = e.target;
    if (t && /(material|マテリアル)/i.test(t.textContent||'')) {
      setTimeout(()=>{ hideRogueMaterialBlocks(); detoxUrlField(); }, 0);
    }
  });

  log('installed');
})();
