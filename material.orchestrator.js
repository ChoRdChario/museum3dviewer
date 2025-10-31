// material.orchestrator.js (UUID-safe P0 hotfix) 
// VERSION_TAG: V6_13b_UUID_FALLBACK
(() => {
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  function getScene() {
    try {
      const b = window.viewerBridge;
      if (b && typeof b.getScene === 'function') { return b.getScene(); }
    } catch (e) {}
    if (window.__viewer?.scene) return window.__viewer.scene;
    if (window.viewer?.scene)   return window.viewer.scene;
    if (window.lm?.scene)       return window.lm.scene;
    return null;
  }

  function listMaterialsFromScene() {
    const scene = getScene();
    if (!scene) return [];
    const seen = new Map();
    let idx = 0;
    scene.traverse(obj => {
      const m = obj.material;
      if (!m) return;
      const mats = Array.isArray(m) ? m : [m];
      mats.forEach(mm => {
        if (!mm) return;
        const key = mm.uuid || ('no-uuid-' + (++idx));
        if (seen.has(key)) return;
        const name = (mm.name && String(mm.name).trim()) || null;
        const label = name ? name : `mat_${String(seen.size+1).padStart(2,'0')}`;
        seen.set(key, { uuid: mm.uuid, name, label });
      });
    });
    return Array.from(seen.values());
  }

  // Prefer viewerBridge.listMaterials() if it returns non-empty names; otherwise fallback to scene walk
  function listMaterials() {
    try {
      const b = window.viewerBridge;
      if (b && typeof b.listMaterials === 'function') {
        const arr = b.listMaterials() || [];
        if (Array.isArray(arr) && arr.length) {
          // Normalize into {uuid?, name, label}
          return arr.map(n => (typeof n === 'string') ? ({uuid:null, name:n, label:n}) : n);
        }
      }
    } catch (e) {}
    return listMaterialsFromScene();
  }

  function findOpacityCard() {
    const panel = document.querySelector('[data-lm="right-panel"]') || document;
    const blocks = panel.querySelectorAll('section,fieldset,div');
    for (const el of blocks) {
      const txt = (el.textContent||'').toLowerCase();
      const hasRange = el.querySelector('input[type="range"]');
      if (hasRange && (txt.includes('per-material opacity') || txt.includes('material opacity'))) return el;
    }
    return Array.from(blocks).find(el => el.querySelector('input[type="range"]')) || null;
  }

  function ensureSelect(card) {
    // Priority 1: existing #pm-material if present
    const pre = document.getElementById('pm-material');
    if (pre) return pre;
    // Priority 2: any select already inside the card
    let sel = card.querySelector('select[name="material"]') || card.querySelector('select');
    if (sel) return sel;
    // Create one at top of card
    sel = document.createElement('select');
    sel.id = 'pm-material';
    sel.title = '-- Select material --';
    sel.style.cssText = 'width:100%;max-width:100%;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:6px 0 10px 0;';
    const lab = document.createElement('div');
    lab.textContent = 'Select material';
    lab.style.cssText = 'font-size:12px;opacity:.7;white-space:nowrap;';
    row.appendChild(lab);
    row.appendChild(sel);
    card.prepend(row);
    return sel;
  }

  function nearestSlider(from) {
    let p = from.closest('section,fieldset,div') || from.parentElement;
    while (p) {
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    return (document.querySelector('[data-lm="right-panel"] input[type="range"]') ||
            document.querySelector('input[type="range"]'));
  }

  function populateSelect(sel, mats) {
    sel.innerHTML = '';
    const add = (v, txt, extra) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = txt;
      if (extra?.uuid) o.dataset.uuid = extra.uuid;
      sel.appendChild(o);
    };
    add('', '-- Select material --');
    mats.forEach(m => add(m.name || m.label, m.label + (m.name ? '' : ' (auto)'), {uuid:m.uuid}));
    sel.value = '';
    sel.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function applyOpacity(match, alpha) {
    const scene = getScene();
    if (!scene) return false;
    let hit = 0;
    scene.traverse(obj => {
      const m = obj.material;
      if (!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm => {
        if (!mm) return;
        const byUuid = match.uuid && mm.uuid === match.uuid;
        const byName = match.name && mm.name === match.name;
        if (byUuid || byName) {
          mm.transparent = alpha < 1 ? true : mm.transparent;
          mm.opacity = alpha;
          mm.needsUpdate = true;
          hit++;
        }
      });
    });
    if (hit) log(`applied opacity ${alpha.toFixed(2)} to material (${match.uuid || match.name}) x${hit}`);
    return !!hit;
  }

  function bind(sel, slider, mats) {
    const getMatch = () => {
      const opt = sel.options[sel.selectedIndex];
      if (!opt || !opt.value) return null;
      const uuid = opt.dataset.uuid || null;
      const name = opt.value;
      if (uuid) return {uuid, name: null};
      return {uuid:null, name};
    };

    const handler = () => {
      const m = getMatch();
      if (!m || !slider) return;
      let a = parseFloat(slider.value);
      if (isNaN(a)) a = Math.min(1, Math.max(0, (parseFloat(slider.value)||100)/100));
      applyOpacity(m, a);
    };

    // replace to avoid duplicate bindings
    const sel2 = sel.cloneNode(true); sel2.id = sel.id;
    sel.parentNode.replaceChild(sel2, sel);
    const sld2 = slider.cloneNode(true); sld2.id = slider.id || 'pm-opacity';
    slider.parentNode.replaceChild(sld2, slider);

    sel2.addEventListener('change', handler);
    sld2.addEventListener('input', handler, {passive:true});
  }

  // Main retry loop
  log('loaded VERSION_TAG:', 'V6_13b_UUID_FALLBACK');
  let tries = 0, max = 120; // up to ~12s
  const iv = setInterval(() => {
    const mats = listMaterials();
    const card = findOpacityCard();
    if (!card) { tries++; if (tries>=max) { clearInterval(iv); warn('card not found'); } return; }
    const sel = ensureSelect(card);
    const slider = nearestSlider(sel);

    if (!mats.length) {
      tries++;
      if (tries % 10 === 0) warn('no materials yet, retrying…');
      if (tries >= max) { clearInterval(iv); warn('gave up: no materials'); }
      return;
    }

    populateSelect(sel, mats);
    bind(sel, slider, mats);
    clearInterval(iv);
  }, 100);
})();