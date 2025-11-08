
/*! [mat-orch v2.0] orchestrator: bind UI and apply to scene */
(() => {
  const log = (...a) => console.log("[mat-orch]", ...a);
  const warn = (...a) => console.warn("[mat-orch] warn", ...a);

  // Singleton
  if (window.__LM_MAT_ORCH_ONCE) return;
  window.__LM_MAT_ORCH_ONCE = true;

  let scene = null;
  /** name -> Set<THREE.Material> */
  const nameMap = new Map();

  function bindScene(s) {
    if (!s || scene === s) return;
    scene = s;
    indexMaterials();
  }

  function indexMaterials() {
    nameMap.clear();
    if (!scene || !scene.traverse) return;
    scene.traverse(obj => {
      const mats = [];
      if (obj.material) {
        if (Array.isArray(obj.material)) mats.push(...obj.material);
        else mats.push(obj.material);
      }
      for (const m of mats) {
        if (!m || !m.name) continue;
        if (!nameMap.has(m.name)) nameMap.set(m.name, new Set());
        nameMap.get(m.name).add(m);
      }
    });
    log("indexed materials", [...nameMap.keys()]);
  }

  function applyOpacityByName(matName, value) {
    if (!matName) return;
    if (!nameMap.size) indexMaterials();
    const set = nameMap.get(matName);
    if (!set) return;
    const v = Math.max(0, Math.min(1, Number(value)));
    for (const m of set) {
      try {
        if ("opacity" in m) m.opacity = v;
        if ("transparent" in m) m.transparent = v < 1;
        if ("depthWrite" in m) m.depthWrite = v >= 1 ? true : m.depthWrite;
        if ("alphaTest" in m && v === 0) m.alphaTest = 0; // keep default
        m.needsUpdate = true;
      } catch (e) {
        console.warn("[mat-orch] apply failed", m?.name, e);
      }
    }
  }

  function selectedMaterialName() {
    const dd = document.getElementById("materialSelect");
    if (dd && dd.value) return dd.value;
    const dd2 = document.querySelector("#pm-opacity select");
    return dd2 && dd2.value;
  }

  function wireUI() {
    // prefer pm-opacity group
    const range = document.querySelector("#pm-opacity input[type=range]") || document.getElementById("opacityRange");
    if (!range) { warn("range not found"); return; }
    const sel = document.getElementById("materialSelect") || document.querySelector("#pm-opacity select");

    const onInput = () => {
      const name = sel?.value || selectedMaterialName();
      applyOpacityByName(name, range.value ?? 1);
    };
    range.addEventListener("input", onInput, { passive: true });
    sel && sel.addEventListener("change", onInput);

    // Kick once
    onInput();
    log("UI bound");
  }

  function arm() {
    // Listen a variety of viewer events from prior builds
    window.addEventListener("lm:scene-ready", (ev) => bindScene(ev.detail?.scene || ev.detail));
    window.addEventListener("lm:scene-stable", (ev) => bindScene(ev.detail?.scene || ev.detail));

    // Soft polling fallback (in case bridge didn't dispatch)
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const s = (window.__lm_viewer && window.__lm_viewer.scene) || (window.viewer && window.viewer.scene);
      if (s) {
        bindScene(s);
        clearInterval(t);
      }
      if (tries > 100) clearInterval(t);
    }, 200);

    // Wire UI when DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", wireUI);
    } else {
      setTimeout(wireUI, 0);
    }
  }

  arm();
})();
