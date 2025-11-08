/* mat_orchestrator_fix.js v3.0
 * Purpose: Wire UI <-> Three.js scene <-> Sheets bridge
 * - Caches scene on lm:scene-ready
 * - Keeps UI numeric, slider, and render fully in sync
 * - Dispatches lm:material-opacity-changed and calls MaterialsSheetBridge.saveOpacity if present
 */
(function () {
  const TAG = "[mat-orch v3.0]";

  let SCENE = null;
  window.addEventListener("lm:scene-ready", (e) => {
    SCENE = e?.detail?.scene || SCENE || window.__LM_SCENE || window.viewer?.scene || window.viewerBridge?.scene || null;
    console.debug(TAG, "scene bound", !!SCENE);
  });

  function getScene() {
    return SCENE || window.__LM_SCENE || window.viewer?.scene || window.viewerBridge?.scene || null;
  }

  function normalizeName(s) {
    return String(s || "").trim();
  }

  function clamp01(v) {
    v = Number(v);
    if (Number.isNaN(v)) return 1;
    return Math.max(0, Math.min(1, v));
  }

  function applyOpacity(targetName, val) {
    const scene = getScene();
    if (!scene) { console.warn(TAG, "scene missing at applyOpacity"); return; }
    const target = normalizeName(targetName);
    const x = clamp01(val);

    let hit = 0;
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        const mname = normalizeName(m.name && m.name.length ? m.name : `Material_${m.uuid.slice(0,8)}`);
        if (mname !== target) return;
        m.opacity = x;
        m.transparent = true;          // keep path stable
        m.depthWrite = x >= 0.999;     // avoid sorting artifacts when semi-transparent
        // Optional: help performance / visuals when semi-transparent
        m.alphaTest = x < 0.99 ? 0.01 : 0;
        m.needsUpdate = true;
        hit++;
      });
    });
    if (hit === 0) {
      console.debug(TAG, "no material matched", { target });
    }
  }

  function bindUi() {
    const ui = window.__LM_MAT_UI;
    if (!ui) {
      console.warn(TAG, "UI not ready");
      return;
    }
    const sel = ui.select;
    const range = ui.range;
    const num = ui.valueDisplay;

    if (!sel || !range || !num) {
      console.warn(TAG, "UI elements missing", { hasSel: !!sel, hasRange: !!range, hasNum: !!num });
      return;
    }

    // Sync helpers
    function setValue(v) {
      const x = clamp01(v);
      range.value = String(x);
      num.value = x.toFixed(2);
    }

    // When dropdown changes, push current value to scene
    sel.addEventListener("change", () => {
      const mat = sel.value;
      if (!mat) return;
      setValue(range.value || num.value || 1);
      applyOpacity(mat, range.value);
      // Emit + optionally save
      const payload = { material: mat, opacity: clamp01(range.value), source: "orchestrator" };
      window.dispatchEvent(new CustomEvent("lm:material-opacity-changed", { detail: payload }));
      try {
        if (window.MaterialsSheetBridge?.saveOpacity) {
          window.MaterialsSheetBridge.saveOpacity(payload);
        }
      } catch (e) {
        console.debug(TAG, "saveOpacity unavailable", e);
      }
    });

    // Slider & number inputs keep in lockstep and update scene
    function onValueInput() {
      const mat = sel.value;
      const v = clamp01(range.value);
      num.value = v.toFixed(2);
      if (!mat) return; // nothing selected yet
      applyOpacity(mat, v);
      const payload = { material: mat, opacity: v, source: "orchestrator" };
      window.dispatchEvent(new CustomEvent("lm:material-opacity-changed", { detail: payload }));
      try {
        if (window.MaterialsSheetBridge?.saveOpacity) {
          window.MaterialsSheetBridge.saveOpacity(payload);
        }
      } catch (e) {}
    }

    range.addEventListener("input", onValueInput, { passive: true });
    num.addEventListener("input", () => {
      const v = clamp01(num.value);
      num.value = v.toFixed(2);
      range.value = String(v);
      onValueInput();
    }, { passive: true });

    console.debug(TAG, "UI bound");
  }

  // Bind after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUi, { once: true });
  } else {
    bindUi();
  }
})();