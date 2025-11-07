/**
 * material.orchestrator.js — Minimal, side‑effect free
 * - DO NOT create/clone/move UI.
 * - Bind only to the canonical material pane (#pane-material).
 * - No global patching; bail out silently if not found.
 */

(() => {
  const TAG = "[mat-orch:min]";
  const log  = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // Guard: run after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function qPane() {
    // Only accept the *pane*, never the tab button
    const right = document.querySelector("#right, aside, .right, .sidebar") || document.body;
    const pane = right.querySelector("#pane-material, #panel-material, [role='tabpanel'][data-tab='material'], [data-panel='material']");
    return pane || null;
  }

  function findUI() {
    const pane = qPane();
    if (!pane) return null;
    const sel = pane.querySelector("select#materialSelect") || pane.querySelector("select[name='materialSelect']");
    const rng = pane.querySelector("input#opacityRange[type='range']") || pane.querySelector("input[type='range']#opacityRange");
    const doubleSided = pane.querySelector("input[type='checkbox']#doubleSided") || null;
    const unlit = pane.querySelector("input[type='checkbox']#unlitLike") || null;

    // If the select exists but is not visible (collapsed tab), skip until visible
    if (sel) {
      const cs = getComputedStyle(sel);
      if (cs.display === "none" || cs.visibility === "hidden") {
        warn("select present but invisible (collapsed?)");
        return null;
      }
    }
    return { pane, select: sel, opacity: rng, doubleSided, unlit };
  }

  // PUBLIC: a very small API for other bridges (optional use)
  window.__lm_mat_orch_min = {
    getUI: findUI,
    getPane: qPane,
  };

  function bindOnce(ui) {
    // No UI? nothing to do
    if (!ui || !ui.select || !ui.opacity) return;

    // Example: re-emit when opacity changes (no sheet write here)
    const apply = () => {
      const key = ui.select.value || "";
      const v = parseFloat(ui.opacity.value || "1");
      window.dispatchEvent(new CustomEvent("lm:material-opacity-ui", { detail: { key, value: v } }));
    };
    ui.opacity.addEventListener("input", apply, { passive: true });
    ui.select.addEventListener("change", apply, { passive: true });
    // Initial echo
    apply();
    log("UI bound");
  }

  function init() {
    // Find once; then also observe the pane for late‑rendered widgets
    let ui = findUI();
    if (ui) {
      log("UI found", ui);
      bindOnce(ui);
      return;
    }

    // Observe only the material *pane* area, not the whole document
    const pane = qPane();
    if (!pane) {
      warn("material pane not found; idle");
      return;
    }
    const mo = new MutationObserver(() => {
      const u = findUI();
      if (u && u.select && u.opacity) {
        bindOnce(u);
        mo.disconnect();
      }
    });
    mo.observe(pane, { childList: true, subtree: true });
    log("waiting for UI in pane");
  }
})();