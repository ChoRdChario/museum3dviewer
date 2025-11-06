// material.orchestrator.adapt.vNext.js
// LociMyu Material UI Orchestrator (adaptive)
// - Robustly finds the Material-select & Opacity-range near the descriptive text
// - Works with custom DOM or Shadow DOM (open) by walking composed tree
// - Binds to scene via pm:scene-deep-ready
// - Safe to include alongside existing orchestrator (namespaced)

(function(){
  const NS = '[mat-orch vNext]';
  if (window.__lm_mat_orch_vnext) return;
  window.__lm_mat_orch_vnext = true;

  const log  = (...a)=>console.log(NS, ...a);
  const warn = (...a)=>console.warn(NS, ...a);

  // ---- helpers ---------------------------------------------------------------
  function getMaterialPanelRoot(){
    return (
      document.querySelector('#tab-material, [data-tab="material"], .tab-material, .material-tab') ||
      document.getElementById('right') ||
      document.querySelector('aside, .right, #sidebar, .sidebar') ||
      document.body
    );
  }

  function* allNodesDeep(root=document){
    // Traverse DOM including open shadow roots
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null);
    let node = walker.currentNode;
    while(node){
      yield node;
      // dive into shadow
      if (node.shadowRoot){
        yield* allNodesDeep(node.shadowRoot);
      }
      node = walker.nextNode();
    }
  }

  function findByTextAnchor(root, substr){
    substr = (substr||'').toLowerCase();
    for (const n of allNodesDeep(root)){
      try{
        if (n.nodeType === Node.TEXT_NODE){
          const t = (n.nodeValue||'').trim();
          if (!t) continue;
          if (t.toLowerCase().includes(substr)) return n.parentElement || n;
        } else {
          const t = (n.textContent||'').trim();
          if (!t) continue;
          if (t.toLowerCase().includes(substr)) return n;
        }
      }catch{}
    }
    return null;
  }

  function nearestContainer(el){
    for (let cur = el; cur; cur = cur.parentElement){
      if (cur.matches?.('[data-section], .card, .panel, section, fieldset, .group, .box')) return cur;
      if (cur === document.body) break;
    }
    return el?.parentElement || document.body;
  }

  function queryInside(el, sel){
    if (!el) return null;
    return el.querySelector?.(sel) || null;
  }

  function ensureIds(selectEl, rangeEl){
    if (selectEl) selectEl.id = 'materialSelect';
    if (rangeEl)  rangeEl.id = 'opacityRange';
  }

  function removeAutoinject(){
    const auto = document.getElementById('lm-material-panel-autogen');
    if (auto) auto.remove();
  }

  function collectMaterials(scene){
    const map = new Map();
    if (!scene) return map;
    scene.traverse(obj => {
      if (!obj || !obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats){ if (m) map.set(m.uuid, m); }
    });
    return map;
  }

  function wireOpacity(scene, sel, rng){
    function applyOpacity(){
      const id = sel.value;
      if (!id) return;
      const val = parseFloat(rng.value);
      scene.traverse(obj=>{
        if (!obj?.isMesh) return;
        const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of arr){
          if (!m || m.uuid !== id) continue;
          m.transparent = (val < 1.0) || m.transparent;
          m.opacity = val;
          if (m.needsUpdate !== undefined) m.needsUpdate = true;
        }
      });
    }
    rng.addEventListener('input', applyOpacity);
    sel.addEventListener('change', ()=> rng.dispatchEvent(new Event('input')));
  }

  function populateFromScene(scene, sel){
    const mats = collectMaterials(scene);
    sel.innerHTML = '';
    if (mats.size === 0){
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no materials found)';
      sel.appendChild(opt);
      return 0;
    }
    for (const m of mats.values()){
      const opt = document.createElement('option');
      const label = m.name && m.name.trim() ? m.name.trim() : `${m.type||'Material'} ${m.uuid.slice(0,8)}`;
      opt.value = m.uuid;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    return mats.size;
  }

  async function rebind(scene){
    const root = getMaterialPanelRoot();
    // Strategy A: anchor by exact help message
    const anchor = findByTextAnchor(root, 'pick a material, then set its opacity');
    let container = anchor ? nearestContainer(anchor) : root;

    // Preferred: data-lm-role
    let sel = root.querySelector('[data-lm-role="materialSelect"]');
    let rng = root.querySelector('[data-lm-role="opacityRange"]');

    // Fallback: within container near anchor
    if (!sel) sel = queryInside(container, 'select');
    if (!rng) rng = queryInside(container, 'input[type="range"]');

    // Last resort: first select/range inside material root
    if (!sel) sel = queryInside(root, 'select');
    if (!rng) rng = queryInside(root, 'input[type="range"]');

    if (!sel || !rng){
      console.warn('[mat-orch vNext] UI controls not found');
      return false;
    }

    ensureIds(sel, rng);
    removeAutoinject();

    const count = populateFromScene(scene, sel);
    wireOpacity(scene, sel, rng);
    rng.dispatchEvent(new Event('input'));
    console.log('[mat-orch vNext] rebinding ok; materials:', count);
    return true;
  }

  function getSceneLoose(){
    try{
      if (typeof getScene === 'function'){
        const s = getScene(); if (s) return s;
      }
    }catch{}
    return window.__lm_scene || null;
  }

  // ---- event wire ------------------------------------------------------------
  async function onDeepReady(e){
    const scene = e?.detail?.scene || getSceneLoose();
    if (!scene){ console.warn('[mat-orch vNext] scene missing on deep-ready'); return; }
    await rebind(scene);
  }

  window.addEventListener('pm:scene-deep-ready', onDeepReady);
  // manual hook
  window.__lm_bindMaterialUI = () => rebind(getSceneLoose());

  // try once in case scene & UI already exist
  const s0 = getSceneLoose();
  if (s0) rebind(s0);
  console.log('[mat-orch vNext] installed');
})();