
/* materials.peropacity.runtime.js — robust material dropdown + opacity binding
   - Populates #pm-material (or data-lm="mat-per-select") with unique materials
   - Binds #pm-material-opacity (or #pm-opacity / [data-lm="mat-per-slider"]) as 0..1 slider
   - Persists per-sheet (gid) opacity map in localStorage
   - Responds to `lm:scene-ready` and also retries if scene/event timing is late
*/
(function(){
  if (window.__LM_PEROP && window.__LM_PEROP.__installed) return;
  const log = (...a)=>console.log('[peropacity]', ...a);
  const warn = (...a)=>console.warn('[peropacity]', ...a);

  function pickSelect(){
    return document.querySelector('[data-lm="mat-per-select"]')
        || document.getElementById('pm-material')
        || [...document.querySelectorAll('select')].find(s=>/Select material/i.test(s.textContent||''));
  }
  function pickSlider(){
    return document.querySelector('[data-lm="mat-per-slider"]')
        || document.getElementById('pm-material-opacity')
        || document.getElementById('pm-opacity')
        || [...document.querySelectorAll('input[type="range"]')].find(r => +r.min === 0 && (+r.max === 1 || +r.max === 100));
  }
  function getScene(){
    return window.__LM_SCENE || window.scene || window.viewer?.scene || window.viewer?.three?.scene || window.app?.scene || null;
  }
  function getGid(){
    const ss = document.querySelector('select[name="sheet"], select[id*="sheet"]');
    const v = ss?.value || '';
    const m = v.match(/gid=(\d+)/);
    return m ? m[1] : (v || '0');
  }
  const storeKey = gid => `LM:permat:opacity:${gid}`;
  const loadMap = gid => {
    try { return JSON.parse(localStorage.getItem(storeKey(gid))||'{}'); } catch { return {}; }
  };
  const saveMap = (gid, map) => {
    localStorage.setItem(storeKey(gid), JSON.stringify(map||{}));
  };

  function collectMaterials(scene){
    const uniq = new Map();
    let meshCount = 0;
    scene.traverse(o => {
      if (!o?.isMesh) return;
      meshCount++;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (!m) return;
        if (!uniq.has(m.uuid)) uniq.set(m.uuid, m);
      });
    });
    return { uniq, meshCount };
  }

  function buildFromScene(scene){
    const select = pickSelect();
    const slider = pickSlider();
    if (!select || !slider) { warn('UI parts not found (select/slider).'); return false; }
    if (!scene?.isScene) { warn('invalid scene'); return false; }

    const { uniq } = collectMaterials(scene);
    const items = [...uniq.values()].map(m => {
      const label = (m.name||'').trim() || `${m.type||'Material'}_${m.uuid.slice(-6)}`;
      return { uuid: m.uuid, label, ref: m };
    }).sort((a,b)=> a.label.localeCompare(b.label,'en'));

    // Inject options
    select.innerHTML = '';
    const ph = document.createElement('option'); ph.value=''; ph.textContent='— Select material —'; select.appendChild(ph);
    for (const it of items) {
      const op = document.createElement('option'); op.value = it.uuid; op.textContent = it.label; select.appendChild(op);
    }

    // Prepare slider range
    const is01 = (+slider.max <= 1);
    slider.min = 0;
    slider.max = is01 ? 1 : 100;
    slider.step = is01 ? 0.01 : 1;

    // Apply saved map
    const gid = getGid();
    const map = loadMap(gid);
    Object.entries(map).forEach(([uuid,val]) => {
      const m = uniq.get(uuid);
      if (!m) return;
      const v = +val;
      m.transparent = true;
      m.opacity = v;
      m.needsUpdate = true;
    });

    // Wire
    select.onchange = () => {
      const m = uniq.get(select.value);
      if (!m) return;
      const cur = m.opacity ?? 1;
      slider.value = String(is01 ? cur : Math.round(cur*100));
    };
    slider.oninput = () => {
      const uuid = select.value;
      const m = uniq.get(uuid);
      if (!uuid || !m) return;
      const raw = +slider.value;
      const v = is01 ? raw : (raw/100);
      m.transparent = true;
      m.opacity = v;
      m.needsUpdate = true;
      map[uuid] = v;
      saveMap(gid, map);
    };

    log(`options injected: ${items.length}`);
    window.__LM_PEROP = { __installed:true, rebuild: () => buildFromScene(scene) };
    return true;
  }

  // Boot strategy:
  // 1) If scene exists now, build immediately.
  // 2) Listen to lm:scene-ready once.
  // 3) As safety, retry a few times via rAF in case UI renders late.
  let built = false;

  function tryBuild(tag){
    if (built) return;
    const s = getScene();
    if (!s) return;
    built = buildFromScene(s);
    if (built) log('built via', tag);
  }

  // 1) immediate
  tryBuild('immediate');

  // 2) event
  const onReady = (e)=>{ if (!built) {window.__LM_SCENE = e.detail?.scene || window.__LM_SCENE; tryBuild('scene-ready'); } };
  document.addEventListener('lm:scene-ready', onReady, { once:false });

  // 3) rAF retries (UI late)
  let tries = 120;
  (function pump(){
    if (!built && tries-- > 0) {
      tryBuild('raf');
      requestAnimationFrame(pump);
    }
  })();

  log('runtime loaded');
})();
