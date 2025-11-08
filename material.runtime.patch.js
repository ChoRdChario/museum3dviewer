
/**
 * material.runtime.patch.js
 * v1.0
 * Purpose: Wire Material tab controls to live Three.js materials (opacity, double-sided, unlit-like stub).
 * Scope  : Non-invasive. Does NOT modify layout or existing orchestrators. Safe to drop-in.
 *
 * Assumptions:
 *  - A Material panel exists (either #pane-material or synthesized) that contains:
 *      - <select id="materialSelect">   (or #pm-material or aria-label*="material")
 *      - <input id="opacityRange" type="range" min="0" max="1" step="0.01">
 *      - <input id="doubleSided" type="checkbox">   (optional)
 *      - <input id="unlitLike"   type="checkbox">   (optional)
 *      - Optional chroma controls are ignored in this patch (left intact)
 *  - The scene is available via window.viewer?.scene or window.__LM_SCENE.
 */
(() => {
  const TAG = "[mat-runtime]";
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // ---------- Helpers ----------
  function $(root, sel) {
    try { return root.querySelector(sel); } catch { return null; }
  }
  function findPanel() {
    return document.querySelector('#pane-material') ||
           document.querySelector('#panel-material') ||
           document.querySelector('section.lm-panel-material') ||
           document.querySelector('section.pane[data-pane="material"]') ||
           document.querySelector('section.pane:nth-of-type(2)'); // fallback
  }
  function findScene() {
    return (window.viewer && window.viewer.scene) ||
           window.__LM_SCENE ||
           (window.viewerBridge && window.viewerBridge.getScene && window.viewerBridge.getScene()) ||
           null;
  }
  function indexMaterials(scene) {
    const map = new Map(); // name -> [materials]
    if (!scene || !scene.traverse) return map;
    scene.traverse(obj => {
      const mats = obj && obj.material
        ? (Array.isArray(obj.material) ? obj.material : [obj.material])
        : null;
      if (!mats) return;
      mats.forEach(m => {
        const key = (m && m.name) ? m.name : null;
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(m);
      });
    });
    return map;
  }

  // ---------- State ----------
  let matIndex = new Map();
  let currentKey = "";
  const memory = new Map(); // key -> {opacity:number, doubleSided:boolean, unlitLike:boolean}

  // ---------- Wiring ----------
  function wireOnce() {
    const panel = findPanel();
    if (!panel) { warn("panel not found"); return false; }

    // controls (robust selectors)
    const sel = panel.querySelector('#materialSelect') ||
                panel.querySelector('#pm-material') ||
                panel.querySelector('select[aria-label*="material" i]');
    const opacity = panel.querySelector('#opacityRange') ||
                    panel.querySelector('input[type="range"][id*="opacity" i]');
    const chkDouble = panel.querySelector('#doubleSided') ||
                      panel.querySelector('input[type="checkbox"][id*="double" i]');
    const chkUnlit  = panel.querySelector('#unlitLike') ||
                      panel.querySelector('input[type="checkbox"][id*="unlit" i]');

    if (!sel || !opacity) {
      warn("controls missing", { sel: !!sel, opacity: !!opacity });
      return false;
    }

    // scene + index
    const scene = findScene();
    if (!scene) { warn("scene not ready"); return false; }
    matIndex = indexMaterials(scene);
    log("materials indexed", matIndex.size);

    // Handlers
    sel.addEventListener('change', () => {
      currentKey = sel.value || "";
      const mem = memory.get(currentKey) || {};
      if (opacity) {
        const v = typeof mem.opacity === "number" ? mem.opacity : 1.0;
        opacity.value = String(v);
      }
      if (chkDouble) {
        chkDouble.checked = !!mem.doubleSided;
      }
      if (chkUnlit) {
        chkUnlit.checked = !!mem.unlitLike;
      }
      applyAll();
    });

    if (opacity) {
      opacity.addEventListener('input', () => {
        if (!currentKey) return;
        const v = Math.max(0, Math.min(1, parseFloat(opacity.value || "1")));
        const mem = memory.get(currentKey) || {};
        mem.opacity = v;
        memory.set(currentKey, mem);
        applyOpacity(currentKey, v);
      });
    }

    if (chkDouble) {
      chkDouble.addEventListener('change', () => {
        if (!currentKey) return;
        const on = !!chkDouble.checked;
        const mem = memory.get(currentKey) || {};
        mem.doubleSided = on;
        memory.set(currentKey, mem);
        applyDoubleSided(currentKey, on);
      });
    }

    if (chkUnlit) {
      chkUnlit.addEventListener('change', () => {
        if (!currentKey) return;
        const on = !!chkUnlit.checked;
        const mem = memory.get(currentKey) || {};
        mem.unlitLike = on;
        memory.set(currentKey, mem);
        applyUnlitLike(currentKey, on);
      });
    }

    // Initial select to first option (if any)
    if (!sel.value && sel.options && sel.options.length > 0) {
      sel.selectedIndex = 0;
      currentKey = sel.value || "";
      applyAll();
    } else {
      currentKey = sel.value || "";
      applyAll();
    }

    // expose debug refresh
    window.__lm_reindexMaterials = () => {
      const sc = findScene(); matIndex = indexMaterials(sc);
      log("materials re-indexed", matIndex.size);
    };

    return true;
  }

  // ---------- Effects ----------
  function matsOf(key) {
    return (key && matIndex.get(key)) || [];
  }
  function applyOpacity(key, v) {
    const mats = matsOf(key);
    mats.forEach(m => {
      try {
        if (typeof m.opacity === "number") {
          m.transparent = v < 1.0 ? true : m.transparent; // keep true if already
          m.opacity = v;
          // optional nicer z-sort when transparent
          if (v < 1.0) {
            m.depthWrite = false;
          } else {
            m.depthWrite = true;
          }
          m.needsUpdate = true;
        }
      } catch (e) { /* ignore */ }
    });
  }
  function applyDoubleSided(key, on) {
    const mats = matsOf(key);
    const THREE = window.THREE;
    const front = THREE && THREE.FrontSide || 0;
    const double = THREE && THREE.DoubleSide || 2;
    mats.forEach(m => {
      try {
        if ("side" in m) {
          m.side = on ? double : front;
          m.needsUpdate = true;
        }
      } catch (e) {}
    });
  }
  function applyUnlitLike(key, on) {
    // Conservative "unlit-like": disable toneMapping & lighting contributions without replacing the material.
    const mats = matsOf(key);
    mats.forEach(m => {
      try {
        // Preserve original values once
        if (!m.userData.__lm_unlitSaved) {
          m.userData.__lm_unlitSaved = {
            emissive: m.emissive ? m.emissive.clone && m.emissive.clone() : null,
            metalness: typeof m.metalness === "number" ? m.metalness : null,
            roughness: typeof m.roughness === "number" ? m.roughness : null,
            toneMapped: m.toneMapped
          };
        }
        if (on) {
          if ("toneMapped" in m) m.toneMapped = false;
          if (typeof m.metalness === "number") m.metalness = 0.0;
          if (typeof m.roughness === "number") m.roughness = 1.0;
          if (m.emissive && m.color) {
            // approximate: push base color to emissive to look lit
            m.emissive.copy ? m.emissive.copy(m.color) : null;
          }
        } else {
          const sv = m.userData.__lm_unlitSaved || {};
          if ("toneMapped" in m && sv.toneMapped != null) m.toneMapped = sv.toneMapped;
          if (typeof m.metalness === "number" && sv.metalness != null) m.metalness = sv.metalness;
          if (typeof m.roughness === "number" && sv.roughness != null) m.roughness = sv.roughness;
          if (m.emissive && sv.emissive) {
            m.emissive.copy ? m.emissive.copy(sv.emissive) : null;
          }
        }
        m.needsUpdate = true;
      } catch (e) {}
    });
  }
  function applyAll() {
    if (!currentKey) return;
    const mem = memory.get(currentKey) || {};
    if (typeof mem.opacity === "number") applyOpacity(currentKey, mem.opacity);
    if (typeof mem.doubleSided === "boolean") applyDoubleSided(currentKey, mem.doubleSided);
    if (typeof mem.unlitLike === "boolean") applyUnlitLike(currentKey, mem.unlitLike);
  }

  // ---------- Boot ----------
  function boot() {
    if (wireOnce()) {
      log("wired");
      return;
    }
    // retry a few times while UI/scene settle
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (wireOnce()) { clearInterval(t); return; }
      if (tries > 20) { clearInterval(t); warn("failed to wire controls"); }
    }, 300);
  }

  // trigger on load + scene ready (if any)
  window.addEventListener('load', boot);
  window.addEventListener('lm:scene-ready', () => setTimeout(boot, 150));

  log("installed");
})();
