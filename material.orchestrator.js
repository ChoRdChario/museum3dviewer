/* LociMyu Material Orchestrator (panel-targeted)
 * VERSION_TAG: V6_12m_PANEL_INJECT_APPLY
 * - Enumerate materials via viewerBridge.listMaterials() (preferred).
 * - Populate the existing select in the "Per‑material opacity" card.
 * - Remove stray debug select (#lm-material-select) if it exists outside the panel.
 * - Wire the slider to apply opacity directly to the scene (fallback when app handlers don't).
 * - Re-run safely on scene ready, sheet context, and material tab activation.
 */
(function(){
  const NS='[mat-orch]';
  const log =( ...a)=>console.log(NS, ...a);
  const warn=( ...a)=>console.warn(NS, ...a);

  // --- helpers ---------------------------------------------------------------
  function getRightPanel(){
    return document.querySelector('[data-lm="right-panel"]')
        || document.querySelector('#right-panel')
        || document.querySelector('#panel')
        || document.body;
  }
  function getMaterialSection(){
    const root = getRightPanel();
    const cands = [
      root.querySelector('[data-lm="material-tab"]'),
      root.querySelector('#lm-material-tab'),
      root.querySelector('#tab-material'),
      root
    ];
    for (const el of cands) if (el) return el;
    return root;
  }
  function getOpacityCard(){
    const box = getMaterialSection();
    // The card that contains label like "Per-material opacity"
    const cards = box.querySelectorAll('div');
    for (const c of cards){
      const t = (c.textContent||'').toLowerCase();
      if (t.includes('per-material opacity') || t.includes('per material opacity')) return c;
    }
    // fallback: first fieldset-like block
    return box;
  }
  function findPanelSelect(){
    const card = getOpacityCard();
    // Prefer specifically named hooks if present
    let sel = card.querySelector('[data-lm="material-select"]')
           || card.querySelector('#material-select')
           || card.querySelector('select[name="material"]')
           || card.querySelector('select');
    return sel || null;
  }
  function findPanelSlider(){
    const card = getOpacityCard();
    // The first range input inside the opacity card
    const r = card.querySelector('input[type="range"]');
    return r || null;
  }
  function removeStrayDebugSelect(){
    const dbg = document.getElementById('lm-material-select');
    if (!dbg) return;
    const panel = getMaterialSection();
    if (!panel.contains(dbg)) {
      dbg.remove();
      log('removed stray debug select');
    }
  }

  // --- materials enumeration -------------------------------------------------
  function listMaterials(){
    try{
      const b = window.viewerBridge || window.__lm_viewerBridge || window.lm_viewer_bridge;
      if (b && typeof b.listMaterials==='function'){
        const arr = b.listMaterials() || [];
        if (Array.isArray(arr)) return arr.slice();
      }
    }catch(_){}
    // As a fallback, traverse scene and collect material names (excluding placeholders)
    const scene = (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene())
               || (window.__lm_getScene && window.__lm_getScene())
               || (window.__lm_viewer && window.__lm_viewer.scene)
               || (window.viewer && window.viewer.scene)
               || null;
    const THREE = window.THREE;
    if (!scene || !THREE) return [];
    const badType = (m)=>/Depth|Distance|Shadow|Sprite|Shader/.test(m?.type||'') || m?.isLineBasicMaterial || m?.isLineDashedMaterial || m?.isPointsMaterial;
    const set = new Set();
    scene.traverse((obj)=>{
      const mat = obj && obj.material;
      const push = (m)=>{
        if (!m || badType(m)) return;
        const n = (m.name||'').trim();
        if (!n || /^material\.\d+$/.test(n)) return;
        set.add(n);
      };
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(push); else push(mat);
    });
    return [...set];
  }

  // --- populate & wire -------------------------------------------------------
  function populatePanelSelect(){
    const sel = findPanelSelect();
    if (!sel){ warn('panel select not found'); return false; }
    const materials = listMaterials();
    if (!materials.length){ warn('[mat-orch-hotfix] materials still empty after retries (non-fatal)'); return false; }

    // clear and fill
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t||v; sel.appendChild(o); };
    add('','-- Select --');
    materials.forEach((m)=>add(m,m));
    sel.value='';
    sel.dispatchEvent(new Event('change', {bubbles:true}));

    log('populated into panel select:', materials.length);
    return true;
  }

  // direct scene application (fallback when the host app doesn't react)
  function getScene(){
    return (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene())
        || (window.__lm_getScene && window.__lm_getScene())
        || (window.__lm_viewer && window.__lm_viewer.scene)
        || (window.viewer && window.viewer.scene)
        || null;
  }
  function applyOpacityToScene(name, alpha){
    const scene = getScene();
    if (!scene || !name) return;
    const clamp = (v)=>Math.max(0, Math.min(1, Number(v)||0));
    const a = clamp(alpha);
    scene.traverse((obj)=>{
      let mat = obj && obj.material;
      const set = (m)=>{
        if (!m || (m.name||'')!==name) return;
        if (typeof m.opacity==='number'){
          m.transparent = a < 1 ? true : m.transparent;
          m.opacity = a;
          m.needsUpdate = true;
        }
      };
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(set); else set(mat);
    });
  }

  function wireSlider(){
    const sel = findPanelSelect();
    const slider = findPanelSlider();
    if (!sel || !slider) return;
    // avoid duplicate wiring
    if (slider.__lm_mat_wired) return;
    slider.__lm_mat_wired = true;
    slider.addEventListener('input', ()=>{
      // if host app has its own handler, it will run too; this is a safe fallback
      const name = sel.value;
      const val = parseFloat(slider.value);
      applyOpacityToScene(name, val);
    });
  }

  // --- runners & event hooks -------------------------------------------------
  let armed = false;
  function arm(){
    if (armed) return;
    armed = true;

    // try immediately and then lazy retries
    const start = Date.now();
    const tryFill = ()=>{
      removeStrayDebugSelect();
      populatePanelSelect();
      wireSlider();
      // throttle retries for ~2s while scene gets ready
      if (Date.now()-start < 2000){
        setTimeout(tryFill, 150);
      }
    };
    tryFill();

    // tab activation (click on "Material")
    const tabRoot = getRightPanel();
    tabRoot.addEventListener('click', (ev)=>{
      const t = (ev.target && (ev.target.textContent||'').toLowerCase()) || '';
      if (t.includes('material')){
        setTimeout(()=>{ removeStrayDebugSelect(); populatePanelSelect(); wireSlider(); }, 0);
      }
    });

    // app-specific custom events (if present)
    window.addEventListener('lm:scene-ready', ()=>{ setTimeout(()=>{ removeStrayDebugSelect(); populatePanelSelect(); wireSlider(); }, 0); });
    window.addEventListener('lm:sheet-context', ()=>{ setTimeout(()=>{ populatePanelSelect(); }, 0); });
  }

  // boot
  log('loaded VERSION_TAG:V6_12m_PANEL_INJECT_APPLY');
  arm();
})();