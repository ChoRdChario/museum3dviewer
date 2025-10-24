//
// LociMyu per-material opacity runtime
// Drop this file into the same folder as index.html and include it at the end of the body:
//
//   <script src="mat-opacity.runtime.js"></script>
//
// It does not change your UI structure. It only wires:
//   - #pm-material  (select)      [fallback: [data-lm="mat-per-select"] ]
//   - #pm-opacity   (range input) [fallback: [data-lm="mat-per-slider"] ]
// and persists per-sheet(gid) in localStorage.
//

(() => {
  if (window.__LM_PERMAT_INSTALLED) return;
  window.__LM_PERMAT_INSTALLED = true;

  const LOG_PREFIX = "[per-mat]";

  // ---------- UI finders ----------
  function findSelect() {
    return (
      document.querySelector('[data-lm="mat-per-select"]') ||
      document.getElementById("pm-material") ||
      null
    );
  }
  function findSlider() {
    return (
      document.querySelector('[data-lm="mat-per-slider"]') ||
      document.getElementById("pm-opacity") ||
      null
    );
  }
  function ensureValueBadge(slider) {
    // create a small live value badge after the slider if not exists
    if (!slider) return null;
    let badge = slider.nextElementSibling;
    const isBadge = badge && badge.dataset && badge.dataset.lmValueBadge === "1";
    if (!isBadge) {
      badge = document.createElement("span");
      badge.dataset.lmValueBadge = "1";
      badge.style.marginLeft = "0.5rem";
      badge.style.fontSize = "0.85em";
      badge.style.opacity = "0.8";
      slider.insertAdjacentElement("afterend", badge);
    }
    return badge;
  }

  // ---------- Scene capture ----------
  function getSceneDirect() {
    return (
      window.__LM_SCENE ||
      window.scene ||
      window.viewer?.scene ||
      window.viewer?.three?.scene ||
      window.app?.scene ||
      null
    );
  }
  function armRendererHook() {
    const THREE = window.THREE || window.viewer?.THREE || window.app?.THREE;
    const R = THREE?.WebGLRenderer;
    if (!R) return false;
    if (R.prototype.__lm_render_hooked) return true;
    const orig = R.prototype.render;
    R.prototype.render = function (scene, camera) {
      if (scene?.isScene && !window.__LM_SCENE) {
        window.__LM_SCENE = scene;
        console.info(LOG_PREFIX, "captured scene via render hook");
      }
      return orig.apply(this, arguments);
    };
    R.prototype.__lm_render_hooked = true;
    console.info(LOG_PREFIX, "renderer hook armed (rotate/zoom once to capture scene)");
    return true;
  }

  // ---------- Materials utilities ----------
  function collectMaterialMap(scene) {
    const dict = Object.create(null);
    if (!scene) return dict;
    scene.traverse((o) => {
      if (!o?.isMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) {
        if (!m) continue;
        dict[m.uuid] = m;
      }
    });
    return dict;
  }

  function materialList(dict) {
    return Object.values(dict).map((m) => ({
      uuid: m.uuid,
      label: (m.name || "").trim() || `${m.type || "Material"}_${m.uuid.slice(-6)}`,
      opacity: typeof m.opacity === "number" ? m.opacity : 1,
      transparent: !!m.transparent,
    }));
  }

  // ---------- Persistence per gid ----------
  function currentGid() {
    // Try known selectors in your UI, fall back to URL ?gid=
    const sheetSel = document.querySelector('select[name="sheet"], select[id*="sheet"]');
    const v = sheetSel?.value || "";
    const m = v.match(/gid=([0-9]+)/);
    if (m) return m[1];
    const urlGid = new URLSearchParams(location.search).get("gid");
    return urlGid || v || "0";
  }
  function storeKey(gid) {
    return `LM:permat:opacity:${gid}`;
  }
  function loadMap(gid) {
    try {
      return JSON.parse(localStorage.getItem(storeKey(gid)) || "{}");
    } catch {
      return {};
    }
  }
  function saveMap(gid, map) {
    localStorage.setItem(storeKey(gid), JSON.stringify(map));
  }

  // ---------- Wire-up ----------
  function populateSelect(selectEl, dict) {
    if (!selectEl) return 0;
    const items = materialList(dict).sort((a, b) => a.label.localeCompare(b.label, "en"));
    const selected = selectEl.value;
    selectEl.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— Select material —";
    selectEl.appendChild(ph);
    for (const it of items) {
      const op = document.createElement("option");
      op.value = it.uuid;
      op.textContent = it.label;
      selectEl.appendChild(op);
    }
    // try to keep previous selection
    if (selected) selectEl.value = selected;
    return items.length;
  }

  function applySavedOpacities(dict) {
    const gid = currentGid();
    const map = loadMap(gid);
    for (const [uuid, val] of Object.entries(map)) {
      const m = dict[uuid];
      if (!m) continue;
      const v = +val;
      m.transparent = v < 1 ? true : m.transparent; // leave true if already true
      m.opacity = v;
      m.needsUpdate = true;
    }
  }

  function clamp01(x) {
    x = +x;
    if (!Number.isFinite(x)) return 1;
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function wire(selectEl, sliderEl, dict) {
    if (!selectEl || !sliderEl) return;
    const badge = ensureValueBadge(sliderEl);

    // support sliders that are 0..1 or 0..100
    const scale100 = (+sliderEl.max || 1) > 1;
    const setSliderFromOpacity = (o) => {
      const val = scale100 ? Math.round(o * 100) : o;
      sliderEl.value = String(val);
      if (badge) badge.textContent = scale100 ? `${val}%` : `${(+o).toFixed(2)}`;
    };
    const readOpacityFromSlider = () => {
      const raw = +sliderEl.value;
      const o = scale100 ? raw / 100 : raw;
      return clamp01(o);
    };

    // on selection sync slider to actual value
    selectEl.addEventListener("change", () => {
      const m = dict[selectEl.value];
      if (!m) return;
      setSliderFromOpacity(typeof m.opacity === "number" ? m.opacity : 1);
    });

    // on input, apply + persist per gid
    sliderEl.addEventListener("input", () => {
      const uuid = selectEl.value;
      const m = dict[uuid];
      if (!uuid || !m) return;
      const gid = currentGid();
      const map = loadMap(gid);

      const v = readOpacityFromSlider();
      m.transparent = v < 1 ? true : m.transparent;
      m.opacity = v;
      m.needsUpdate = true;

      map[uuid] = v;
      saveMap(gid, map);
      setSliderFromOpacity(v);
    });

    // if already selected, reflect right away
    if (selectEl.value && dict[selectEl.value]) {
      setSliderFromOpacity(dict[selectEl.value].opacity ?? 1);
    } else {
      setSliderFromOpacity(1);
    }
  }

  // ---------- Boot sequence ----------
  async function bootOnce() {
    const selectEl = findSelect();
    const sliderEl = findSlider();
    if (!selectEl || !sliderEl) {
      console.warn(LOG_PREFIX, "UI elements not found (select/slider).");
      return;
    }

    // scene capture
    let scene = getSceneDirect();
    if (!scene) {
      armRendererHook();
      // wait a bit for a first render
      for (let i = 0; i < 30 && !scene; i++) {
        await new Promise((r) => setTimeout(r, 200));
        scene = getSceneDirect();
      }
    }
    if (!scene) {
      console.warn(LOG_PREFIX, "scene not available yet. Will retry on an interval.");
      return;
    }

    // collect materials
    const dict = collectMaterialMap(scene);
    const count = populateSelect(selectEl, dict);
    applySavedOpacities(dict);
    wire(selectEl, sliderEl, dict);
    console.info(LOG_PREFIX, `ready. materials=${count}`);

    // Optional: refresh options once later (after textures/GLB settle)
    setTimeout(() => {
      const again = collectMaterialMap(scene);
      const n = populateSelect(selectEl, again);
      if (n) console.info(LOG_PREFIX, `refreshed options = ${n}`);
    }, 1000);
  }

  // start: after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootOnce, { once: true });
  } else {
    bootOnce();
  }

  // Fallback periodic retry if scene wasn't ready
  let retryCount = 0;
  const retryTimer = setInterval(() => {
    if (getSceneDirect()) {
      clearInterval(retryTimer);
      bootOnce();
    } else if (++retryCount > 60) {
      clearInterval(retryTimer);
      console.warn(LOG_PREFIX, "give up waiting for scene.");
    }
  }, 500);
})();
