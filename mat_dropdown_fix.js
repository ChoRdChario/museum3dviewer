/* mat_dropdown_fix.js v3.0
 * Purpose: Populate the material dropdown once the scene is ready.
 * - Listens to lm:scene-ready (your system reliably fires this)
 * - Value is material.name for direct matching
 * - Idempotent: clears & repopulates on invocation
 */
(function () {
  const TAG = "[mat-dd v3.0]";

  function getScene(e) {
    const fromEvt = e?.detail?.scene;
    return fromEvt || window.__LM_SCENE || window.viewer?.scene || window.viewerBridge?.scene || null;
  }

  function collectMaterials(scene) {
    const set = new Map();
    scene.traverse(obj => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          const name = m.name && String(m.name).trim() ? m.name : `Material_${m.uuid.slice(0, 8)}`;
          if (!set.has(name)) set.set(name, m);
        });
      }
    });
    return Array.from(set.keys()).sort((a,b)=>a.localeCompare(b));
  }

  function populate(scene) {
    const ui = window.__LM_MAT_UI;
    if (!ui || !ui.select) { console.warn(TAG, "UI missing"); return; }
    const sel = ui.select;

    const names = collectMaterials(scene);
    sel.innerHTML = ""; // clear
    // placeholder
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— select material —";
    sel.appendChild(ph);

    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    console.debug(TAG, "populated", names.length);
    window.dispatchEvent(new CustomEvent("lm:materials-dropdown-populated", { detail: { count: names.length } }));
  }

  function onSceneReady(e) {
    const scene = getScene(e);
    if (!scene) { console.warn(TAG, "scene not found on lm:scene-ready"); return; }
    populate(scene);
  }

  // Bind once
  if (!window.__LM_MAT_DD_BOUND) {
    window.addEventListener("lm:scene-ready", onSceneReady, { once: true });
    // Optional: if your stack emits a custom glb-detected, allow repopulate
    window.addEventListener("lm:glb-detected", onSceneReady); // non-once to handle re-loads

    window.__LM_MAT_DD_BOUND = true;
    console.debug(TAG, "armed");
  }
})();